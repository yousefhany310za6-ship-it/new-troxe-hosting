import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';
import { config } from '../../config/env';
import { DB, Db } from '../../db/db.module';
import { auditLogs, authSessions, nodes, serverEvents, servers, sessions } from '../../db/schema';
import { DockerService } from './provisioning/docker.service';
import { NetworkHardeningService } from './provisioning/network-hardening.service';
import { ProvisionerService } from './provisioning/provisioner.service';
import { runtimeImage } from './provisioning/images';
import { BackupsService } from './backups.service';

const GRACE_MS = 5 * 60 * 1000; // never GC a resource that is seconds old
const STUCK_PROVISIONING_MS = 15 * 60 * 1000;
// retention: telemetry tables grow with every login/action — prune daily
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SESSIONS_TTL_MS = 90 * 24 * 60 * 60 * 1000; // login history
const EVENTS_TTL_MS = 90 * 24 * 60 * 60 * 1000; // per-server events
const AUDIT_TTL_MS = 180 * 24 * 60 * 60 * 1000; // compliance trail (longer)
// storage fence: re-check a server's disk usage at most once per hour, and
// bound the work per tick so a large fleet never stalls the reconciler.
const STORAGE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STORAGE_CHECKS_PER_TICK = 5;

/**
 * Background reconciler — the source of truth is the database, Docker is
 * expected to converge to it:
 *
 *  • DB status is corrected from the real container state (after host reboots,
 *    manual docker commands, OOM kills, …)
 *  • containers/networks/volumes labelled `troxe.managed` whose server row no
 *    longer exists are garbage collected (with the matching iptables rules)
 *  • iptables hardening is converged back: netfilter rules (unlike Docker
 *    networks) are lost on daemon/host restart, so every live server subnet
 *    is re-applied every 5th tick and immediately after daemon recovery
 *  • servers stuck in `provisioning` are marked as errors
 *  • daily auto-backups run when due
 *
 * It is single-flight: overlapping ticks are impossible.
 */
@Injectable()
export class ReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private busy = false;
  private tickCount = 0;
  private lastStorageCheck = new Map<string, number>();
  /** disk: measurement cadence (10min) and warn throttle (hourly) per node */
  private readonly lastDiskCheck = new Map<string, number>();
  private readonly lastDiskWarn = new Map<string, number>();
  /** remote-node firewall verification cadence (hourly per node) */
  private readonly lastFwCheck = new Map<string, number>();
  private lastPrune = 0;
  /** per-node liveness (a down daemon converges hardening on recovery) */
  private readonly nodeUp = new Map<string, boolean>();
  /** restart-count velocity tracking for crash-loop detection (in-memory; single instance) */
  private restarts = new Map<string, { count: number; at: number }>();

  constructor(
    @Inject(DB) private db: Db,
    private docker: DockerService,
    private hardening: NetworkHardeningService,
    private provisioner: ProvisionerService,
    private backups: BackupsService,
  ) {}

  onModuleInit() {
    if (!config.DOCKER_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    this.firstRun = setTimeout(() => void this.tick(), 5_000);
    this.firstRun.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const started = Date.now();
    try {
      // node inventory first: every daemon below is converged independently
      // (volumes/networks/containers are node-local). An unreachable node is
      // skipped for this tick — its rows are left untouched, never reaped.
      const nodeRows = await this.db
        .select({ id: nodes.id })
        .from(nodes)
        .where(eq(nodes.enabled, true));
      const rows = await this.db.select().from(servers);
      const byNode = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byNode.get(row.nodeId) ?? [];
        list.push(row);
        byNode.set(row.nodeId, list);
      }
      for (const n of nodeRows) {
        const wasDown = this.nodeUp.get(n.id) === false;
        if (!(await this.docker.ping(3000, n.id).catch(() => false))) {
          if (!wasDown) this.log.warn(`node "${n.id}" unreachable — skipping this tick`);
          this.nodeUp.set(n.id, false);
          continue;
        }
        this.nodeUp.set(n.id, true);
        this.tickCount++;
        const subset = byNode.get(n.id) ?? [];
        await this.warnIfDiskFull(n.id);
        await this.syncStatuses(subset, n.id);
        // daemon restarts flush DOCKER-USER: converge local rules on recovery
        if (n.id === 'local' && (wasDown || this.tickCount % 5 === 0)) await this.syncHardening();
        // remote: static supernet, verified hourly against the live ruleset
        else if (n.id !== 'local') await this.verifySupernet(n.id);
        await this.enforceStorage(subset, n.id);
        await this.gcOrphans(n.id);
      }
      if (Date.now() - this.lastPrune > PRUNE_INTERVAL_MS) {
        this.lastPrune = Date.now();
        await this.pruneHistory();
      }
      await this.backups.createAutoIfDue();
    } catch (e) {
      this.log.warn(`reconcile failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
      this.log.debug(`tick done in ${Date.now() - started}ms`);
    }
  }

  private async syncStatuses(rows: (typeof servers.$inferSelect)[], nodeId: string): Promise<void> {
    const now = Date.now();

    // bounded worker pool: sequential inspects stall the tick at fleet
    // scale (1k servers ≈ 1k serial daemon round-trips); 8-way keeps the
    // daemon socket and the PG pool healthy while converging ~8x faster.
    const queue = [...rows];
    const workers = Array.from({ length: Math.min(8, Math.max(queue.length, 1)) }, async () => {
      while (queue.length) {
        const row = queue.shift()!;
      try {
        if (!row.containerId) {
          if (row.status === 'provisioning' && now - row.createdAt.getTime() > STUCK_PROVISIONING_MS) {
            await this.db
              .update(servers)
              .set({ status: 'error', lastError: 'provisioning timed out' })
              .where(eq(servers.id, row.id));
          }
          continue;
        }

        const state = await this.docker.inspect(row.containerId, nodeId);
        if (!state) {
          if (row.status !== 'error') {
            await this.db
              .update(servers)
              .set({ status: 'error', lastError: 'container missing — start the server to rebuild it' })
              .where(eq(servers.id, row.id));
          }
          continue;
        }

        // crash-loop guard: 3+ restarts inside ~two ticks means the process
        // can never stay up (missing entry file, boot error, …) — stop it
        // instead of burning CPU restarts forever, and say so plainly.
        // (Threshold spans 2 ticks because ticks themselves are 60s apart.)
        const prev = this.restarts.get(row.id);
        if (state.restartCount > (prev?.count ?? 0)) {
          if (
            prev &&
            state.restartCount - prev.count >= 3 &&
            now - prev.at < 130_000 &&
            row.status !== 'error'
          ) {
            await this.docker.stop(row.containerId, 15, nodeId).catch(() => undefined);
            await this.db
              .update(servers)
              .set({
                status: 'error',
                lastError: `Crash loop detected (${state.restartCount} restarts in under a minute) — check the startup command and logs`,
              })
              .where(eq(servers.id, row.id));
            this.restarts.delete(row.id);
            continue;
          }
          this.restarts.set(row.id, { count: state.restartCount, at: now });
        } else if (state.restartCount === 0 && prev) {
          this.restarts.delete(row.id);
        }

        if (state.running && row.status !== 'online') {
          await this.db.update(servers).set({ status: 'online', lastError: null }).where(eq(servers.id, row.id));
        } else if (!state.running && row.status === 'online') {
          const lastError = state.oomKilled
            ? 'Process was killed: memory limit exceeded'
            : state.error || (state.exitCode ? `Process exited with code ${state.exitCode}` : null);
          await this.db
            .update(servers)
            .set({ status: 'offline', lastError })
            .where(eq(servers.id, row.id));
        } else if (!state.running && row.status === 'restarting' && now - row.updatedAt.getTime() > 60_000) {
          await this.db.update(servers).set({ status: 'offline' }).where(eq(servers.id, row.id));
        }
      } catch (e) {
        this.log.debug(`sync ${row.id}: ${(e as Error).message}`);
      }
      }
    });
    await Promise.all(workers);
    // drop velocity state for servers that no longer exist (bounded memory)
    if (this.restarts.size > rows.length) {
      const live = new Set(rows.map((r) => r.id));
      for (const id of this.restarts.keys()) if (!live.has(id)) this.restarts.delete(id);
    }
  }

  /**
   * Convergence for netfilter state: re-apply (idempotent, quiet when
   * nothing changes) every live server's hardening rules. Docker networks
   * survive a daemon restart but DOCKER-USER/INPUT rules do not.
   */
  private async syncHardening(): Promise<void> {
    const rows = await this.db
      .select({ id: servers.id, networkName: servers.networkName, networkSubnet: servers.networkSubnet })
      .from(servers)
      .where(eq(servers.nodeId, 'local'));
    const targets: Array<{ id: string; subnet: string; networkName: string }> = [];
    for (const row of rows) {
      try {
        if (!row.networkName) continue;
        let subnet = row.networkSubnet;
        if (!subnet) {
          const info = await this.docker.networkInfo(row.networkName).catch(() => null);
          subnet = info?.subnet ?? '';
        }
        if (!subnet) {
          this.log.debug(`hardening sync ${row.id}: subnet unknown, skipping`);
          continue;
        }
        await this.hardening.apply(subnet, row.networkName, { quiet: true });
        targets.push({ id: row.id, subnet, networkName: row.networkName });
      } catch (e) {
        this.log.debug(`hardening sync ${row.id}: ${(e as Error).message}`);
      }
    }
    // ONE ruleset read for the whole fleet: `apply()` reports ">0 rules
    // installed", which is not the same as the full set — reading the RUNNING
    // ruleset back is the only proof it actually landed.
    if (!targets.length) return;
    const check = await this.hardening.verifySandboxes(targets);
    if (check && !check.ok)
      this.log.error(
        `hardening drift after converge: ${check.missing.length}/${check.expected} rule(s) missing` +
          `${check.stale.length ? `, ${check.stale.length} stale` : ''} — ${check.missing.slice(0, 3).join(' | ')}`,
      );
  }

  /**
   * Remote nodes carry their isolation in ONE static ruleset installed by
   * `node-setup.sh` — never re-checked before. Verify the node's LIVE kernel
   * ruleset hourly: a reboot without persistence, a stray `iptables -F`, or
   * setup never having run all leave sandboxes able to reach RFC1918 and the
   * host itself while the API still believes they are isolated. Placement
   * refuses new servers on a node with confirmed drift (isolationOk).
   */
  private async verifySupernet(nodeId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastFwCheck.get(nodeId) ?? 0) < 60 * 60 * 1000) return;
    this.lastFwCheck.set(nodeId, now);
    const [n] = await this.db
      .select({ subnetBase: nodes.subnetBase })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!n?.subnetBase) {
      this.log.error(`node "${nodeId}" has no subnetBase — remote sandboxes on it are NOT covered by a supernet`);
      return;
    }
    const check = await this.hardening.verifySupernet(nodeId, n.subnetBase);
    if (!check) return; // unreadable → the reader already warned; fail open
    if (!check.ok)
      this.log.error(
        `node "${nodeId}" firewall DRIFT: ${check.missing.length}/${check.expected} rule(s) missing for ` +
          `${n.subnetBase}${check.stale.length ? `, ${check.stale.length} stale` : ''} — new servers are ` +
          `refused until node-setup.sh is re-run on it`,
      );
  }

  /**
   * Host-level disk guard. The fence below protects the node from a single
   * tenant; this protects the node from ITSELF (backups, images, logs): the
   * measurement is what the placement guard refuses new servers on, so the
   * log line explains an otherwise mysterious DISK_FULL. One df helper per
   * node per 10min, warned at most hourly.
   */
  private async warnIfDiskFull(nodeId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastDiskCheck.get(nodeId) ?? 0) < 10 * 60 * 1000) return;
    this.lastDiskCheck.set(nodeId, now);
    const disk = await this.docker.diskUsage(nodeId).catch(() => null);
    if (!disk || disk.percent < config.DISK_BLOCK_PCT) return;
    if (now - (this.lastDiskWarn.get(nodeId) ?? 0) < 60 * 60 * 1000) return;
    this.lastDiskWarn.set(nodeId, now);
    this.log.warn(
      `node "${nodeId}" disk is ${disk.percent}% full (${(disk.freeBytes / 1024 ** 3).toFixed(1)} GB free) — ` +
        `placement refuses new servers above ${config.DISK_BLOCK_PCT}%`,
    );
  }

  /**
   * Storage fence: volumes are plain Docker local volumes with no
   * filesystem quota, so converge usage against the plan cap here. A server
   * over quota is stopped and fenced to `error` (never silently deleted —
   * the data stays until the owner frees space or upgrades, then starts).
   * Staggered (hourly per server, bounded per tick) so fleet size never
   * stalls the tick: each check spawns one short-lived `du` helper.
   */
  private async enforceStorage(
    rows: Pick<typeof servers.$inferSelect, 'id' | 'runtime' | 'status' | 'lastError' | 'containerId' | 'volumeName' | 'storageGb' | 'nodeId'>[],
    nodeId: string,
  ): Promise<void> {
    if (this.lastStorageCheck.size > 10_000) this.lastStorageCheck.clear();
    const now = Date.now();
    let checked = 0;
    for (const row of rows) {
      if (checked >= STORAGE_CHECKS_PER_TICK) break;
      if (!row.volumeName || row.status === 'deleting' || row.status === 'provisioning') continue;
      if (row.status === 'error' && /storage quota exceeded/i.test(row.lastError ?? '')) continue;
      if (now - (this.lastStorageCheck.get(row.id) ?? 0) < STORAGE_CHECK_INTERVAL_MS) continue;
      this.lastStorageCheck.set(row.id, now);
      checked++;
      try {
        const used = await this.provisioner.volumeUsage(row.volumeName, runtimeImage(row.runtime).image, nodeId);
        if (used === null) continue;
        const cap = row.storageGb * 1024 ** 3;
        if (used > cap) {
          if (row.containerId) await this.docker.stop(row.containerId, 15, nodeId).catch(() => undefined);
          await this.db
            .update(servers)
            .set({
              status: 'error',
              lastError: `Storage quota exceeded (${(used / 1024 ** 3).toFixed(2)} GB used of ${row.storageGb} GB). Free space or upgrade your plan, then start the server.`,
            })
            .where(eq(servers.id, row.id));
          this.log.warn(`storage fence: server ${row.id} stopped at ${used} bytes (cap ${cap})`);
        }
      } catch (e) {
        this.log.debug(`storage check ${row.id}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Retention enforcement: login history, per-server events and the audit
   * trail grow with every action — delete rows older than their TTL, plus
   * refresh sessions already past expiry (logout-all/login rows stay).
   * Runs at most daily; each delete is a single indexed range statement.
   */
  private async pruneHistory(): Promise<void> {
    const now = Date.now();
    try {
      const cut = (ttl: number) => new Date(now - ttl);
      const s = await this.db.delete(sessions).where(lt(sessions.createdAt, cut(SESSIONS_TTL_MS))).returning({ id: sessions.id });
      const e = await this.db.delete(serverEvents).where(lt(serverEvents.createdAt, cut(EVENTS_TTL_MS))).returning({ id: serverEvents.id });
      const a = await this.db.delete(auditLogs).where(lt(auditLogs.createdAt, cut(AUDIT_TTL_MS))).returning({ id: auditLogs.id });
      const x = await this.db.delete(authSessions).where(lt(authSessions.expiresAt, new Date(now))).returning({ id: authSessions.id });
      const total = s.length + e.length + a.length + x.length;
      if (total) this.log.log(`pruned history: ${s.length} sessions, ${e.length} events, ${a.length} audit, ${x.length} expired refresh`);
    } catch (e) {
      this.log.debug(`prune ${(e as Error).message}`);
    }
  }

  /** Removes managed docker resources whose server row is gone (per node). */
  private async gcOrphans(nodeId: string): Promise<void> {
    const known = await this.db.select({ id: servers.id }).from(servers);
    const knownIds = new Set(known.map((r) => r.id));
    const { containers, networks, volumes } = await this.docker.listManaged(nodeId);

    for (const c of containers) {
      const ownerId = c.labels['troxe.server-id'];
      if (!ownerId || knownIds.has(ownerId)) continue;
      if (!oldEnough(c.labels)) continue;
      this.log.warn(`GC orphan container ${c.name}`);
      await this.docker.remove(c.id, true, nodeId).catch((e: Error) => this.log.warn(`gc container: ${e.message}`));
    }

    for (const n of networks) {
      const serverId = n.labels['troxe.server-id'];
      if (!serverId || knownIds.has(serverId)) continue;
      if (!oldEnough(n.labels)) continue;
      this.log.warn(`GC orphan network ${n.name}`);
      // remote coverage is static on the node host: never touch local
      // netfilter for another node's subnets.
      if (nodeId === 'local') {
        const info = await this.docker.networkInfo(n.name, nodeId).catch(() => null);
        await this.hardening.cleanup(info?.subnet ?? '', n.name).catch(() => undefined);
      }
      await this.docker.removeNetwork(n.id, nodeId).catch((e: Error) => this.log.warn(`gc network: ${e.message}`));
    }

    for (const v of volumes) {
      const serverId = v.labels['troxe.server-id'];
      if (!serverId || knownIds.has(serverId)) continue;
      if (!oldEnough(v.labels)) continue;
      this.log.warn(`GC orphan volume ${v.name}`);
      await this.docker.removeVolume(v.name, nodeId).catch((e: Error) => this.log.warn(`gc volume: ${e.message}`));
    }
  }

  /** Force a status refresh (admin/debug endpoint). Single-flight safe. */
  async refreshOnce(): Promise<void> {
    await this.tick();
  }
}

/** Grace period based on labels stamped at creation time (ISO epoch seconds). */
function oldEnough(labels: Record<string, string>): boolean {
  const created = labels['troxe.created-at'];
  if (!created) return false;
  const ts = Number(created);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > GRACE_MS;
}
