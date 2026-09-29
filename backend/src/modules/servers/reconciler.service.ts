import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { DB, Db } from '../../db/db.module';
import { servers } from '../../db/schema';
import { DockerService } from './provisioning/docker.service';
import { NetworkHardeningService } from './provisioning/network-hardening.service';
import { BackupsService } from './backups.service';

const GRACE_MS = 5 * 60 * 1000; // never GC a resource that is seconds old
const STUCK_PROVISIONING_MS = 15 * 60 * 1000;

/**
 * Background reconciler — the source of truth is the database, Docker is
 * expected to converge to it:
 *
 *  • DB status is corrected from the real container state (after host reboots,
 *    manual docker commands, OOM kills, …)
 *  • containers/networks/volumes labelled `troxe.managed` whose server row no
 *    longer exists are garbage collected (with the matching iptables rules)
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

  constructor(
    @Inject(DB) private db: Db,
    private docker: DockerService,
    private hardening: NetworkHardeningService,
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
    try {
      if (!(await this.docker.ping())) return;
      await this.syncStatuses();
      await this.gcOrphans();
      await this.backups.createAutoIfDue();
    } catch (e) {
      this.log.warn(`reconcile failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async syncStatuses(): Promise<void> {
    const rows = await this.db.select().from(servers);
    const now = Date.now();

    for (const row of rows) {
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

        const state = await this.docker.inspect(row.containerId);
        if (!state) {
          if (row.status !== 'error') {
            await this.db
              .update(servers)
              .set({ status: 'error', lastError: 'container missing — start the server to rebuild it' })
              .where(eq(servers.id, row.id));
          }
          continue;
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
  }

  /** Removes managed docker resources whose server row is gone. */
  private async gcOrphans(): Promise<void> {
    const known = await this.db.select({ id: servers.id }).from(servers);
    const knownIds = new Set(known.map((r) => r.id));
    const { containers, networks, volumes } = await this.docker.listManaged();

    for (const c of containers) {
      const ownerId = c.labels['troxe.server-id'];
      if (!ownerId || knownIds.has(ownerId)) continue;
      if (!oldEnough(c.labels)) continue;
      this.log.warn(`GC orphan container ${c.name}`);
      await this.docker.remove(c.id).catch((e: Error) => this.log.warn(`gc container: ${e.message}`));
    }

    for (const n of networks) {
      const serverId = n.labels['troxe.server-id'];
      if (!serverId || knownIds.has(serverId)) continue;
      if (!oldEnough(n.labels)) continue;
      this.log.warn(`GC orphan network ${n.name}`);
      const info = await this.docker.networkInfo(n.name).catch(() => null);
      await this.hardening.cleanup(info?.subnet ?? '', n.name).catch(() => undefined);
      await this.docker.removeNetwork(n.id).catch((e: Error) => this.log.warn(`gc network: ${e.message}`));
    }

    for (const v of volumes) {
      const serverId = v.labels['troxe.server-id'];
      if (!serverId || knownIds.has(serverId)) continue;
      if (!oldEnough(v.labels)) continue;
      this.log.warn(`GC orphan volume ${v.name}`);
      await this.docker.removeVolume(v.name).catch((e: Error) => this.log.warn(`gc volume: ${e.message}`));
    }
  }

  /** Force a status refresh (admin/debug endpoint). */
  async refreshOnce(): Promise<void> {
    this.busy = false;
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
