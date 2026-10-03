import { Inject, Injectable, Logger } from '@nestjs/common';
import { rm } from 'fs/promises';
import { and, desc, eq, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { decryptEnv, encryptEnv, maskEnv } from '../../common/crypto';
import { AppError, Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { plans, servers, serverEvents, users, type EnvVar, type Server } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { DockerService } from './provisioning/docker.service';
import { ProvisionerService, type ProvisionResult } from './provisioning/provisioner.service';
import { RUNTIMES, runtimeImage, type Runtime, applyTemplate, labelFor, resolveEggEnv, resolveVersion } from './provisioning/images';
import { NodesService } from '../nodes/nodes.service';
import { CreateServerDto, UpdateServerDto } from './dto';
import { backupDirFor, backupOwnerDir } from './backup-paths';
import { RealtimeGateway } from '@auth/realtime.gateway';

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

@Injectable()
export class ServersService {
  private readonly log = new Logger(ServersService.name);
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    @Inject(DB) private db: Db,
    private provisioner: ProvisionerService,
    private docker: DockerService,
    private audit: AuditService,
    private realtime: RealtimeGateway,
    private nodes: NodesService,
  ) {}

  /**
   * Per-server async mutex (single instance owns Docker + iptables, so an
   * in-process lock is sufficient). Lifecycle / update / remove / restore
   * on the SAME server serialize; different servers proceed in parallel.
   * Without this, double-click reinstall races destroy-then-provision and
   * the loser's persist overwrites the winner's containerId (orphans +
   * phantom `error` state), or one flow deletes a volume mid-chown.
   *
   * Usage: `const release = await this.acquire(id); try { ... } finally { release(); }`
   * Public so BackupsService.restore (stop + rewrite /data) joins the lock.
   */
  async acquire(serverId: string): Promise<() => void> {
    const prev = this.locks.get(serverId) ?? Promise.resolve();
    let done!: () => void;
    const gate = new Promise<void>((resolve) => (done = resolve));
    const chained = prev.catch(() => undefined).then(() => gate);
    this.locks.set(serverId, chained);
    await prev.catch(() => undefined);
    return () => {
      done();
      if (this.locks.get(serverId) === chained) this.locks.delete(serverId);
    };
  }

  /** Owner-scoped status write for sibling services (restore fencing). */
  async setStatus(id: string, patch: Partial<typeof servers.$inferInsert>): Promise<void> {
    await this.setField(id, patch);
    if (patch.status) this.realtime.broadcastServerStatus(id, patch.status);
  }

  // ---- reads ----------------------------------------------------------------

  async list(ownerId: string) {
    const rows = await this.db
      .select()
      .from(servers)
      .where(eq(servers.ownerId, ownerId))
      .orderBy(desc(servers.createdAt));
    return rows.map((r) => this.toPublic(r));
  }

  /** Egg catalog: versions + variables per runtime (no digests leak). */
  catalog() {
    return RUNTIMES.map((r) => {
      const img = runtimeImage(r);
      return {
        runtime: img.runtime,
        label: img.label,
        versions: img.versions.map((v) => ({ version: v.version, label: v.label })),
        variables: img.variables,
        defaultStartup: img.defaultStartup,
      };
    });
  }

  /** Owner-scoped single read — never trusts an id alone. */
  async getOne(ownerId: string, id: string) {
    const row = await this.requireOwned(ownerId, id);
    return this.toPublic(row);
  }

  async requireOwned(ownerId: string, id: string): Promise<Server> {
    // Admin bypass: 'admin' ownerId skips ownership check
    const where = ownerId === 'admin'
      ? eq(servers.id, id)
      : and(eq(servers.id, id), eq(servers.ownerId, ownerId));
    const rows = await this.db.select().from(servers).where(where).limit(1);
    if (!rows.length) throw Err.notFound('SERVER_NOT_FOUND');
    return rows[0];
  }

  // ---- create ---------------------------------------------------------------

  /**
   * Placement + host-disk guard. A node at/above DISK_BLOCK_PCT is never
   * given new work: provisioning more data onto a nearly-full disk is how a
   * full host turns into a dead host (every tenant's containers then fail to
   * write). Auto-placement skips to the next node; an explicit admin pin
   * fails loudly (507) instead of silently relocating the server. A failed
   * measurement fails OPEN — provisioning must never break because `df` was
   * unreachable (the per-server storage fence and the health probe still hold).
   */
  private async pickWithDiskGuard(preferred?: string): Promise<string> {
    const skipped: string[] = [];
    for (;;) {
      let candidate: string;
      try {
        candidate = await this.nodes.pickNode(preferred, skipped);
      } catch (e) {
        if (skipped.length)
          throw new AppError(
            'DISK_FULL',
            507,
            `No node with free disk: ${skipped.join(', ')} all at or above ${config.DISK_BLOCK_PCT}%.`,
          );
        throw e;
      }
      const disk = await this.docker.diskUsage(candidate).catch(() => null);
      if (!disk) return candidate; // unknown → fail open (diskUsage logged it)
      if (disk.percent < config.DISK_BLOCK_PCT) return candidate;
      if (preferred)
        throw new AppError(
          'DISK_FULL',
          507,
          `Node "${candidate}" is ${disk.percent}% full (limit ${config.DISK_BLOCK_PCT}%). Free space first.`,
        );
      skipped.push(candidate);
      if (skipped.length >= 10)
        throw new AppError('DISK_FULL', 507, `No node with free disk: ${skipped.join(', ')} are full.`);
    }
  }

  async create(ownerId: string, dto: CreateServerDto, ctx: ReqCtx, opts?: { nodeId?: string }) {
    // The plan comes from the account, never from the request body: otherwise
    // any client could claim "enterprise" and escalate its quotas (CVE-class).
    // Same for the node: users get placed automatically; only the admin path
    // may request a specific node (validated inside pickNode).
    const region = dto.region ?? config.REGIONS[0];
    if (!config.REGIONS.includes(region)) throw Err.invalid('REGION_UNSUPPORTED', `Allowed regions: ${config.REGIONS.join(', ')}`);
    const nodeId = await this.pickWithDiskGuard(opts?.nodeId);

    const storedEnv = this.cleanEnv(dto.env);
    // egg defaults apply at RESOLVE time only — storage keeps exactly what
    // the user set (no surprise rows in the API/UI); missing variables fall
    // back to their defaults when the startup template is rendered.
    const env = resolveEggEnv(dto.runtime, storedEnv);
    // row.startup keeps the RAW template ({{VAR}} re-resolves on every
    // provision, so later variable edits apply); `startup` is the resolved
    // command actually executed.
    const startupRaw = this.cleanStartup(dto.startup) || runtimeImage(dto.runtime).defaultStartup;
    let version;
    try {
      version = resolveVersion(dto.runtime, dto.version);
    } catch {
      throw Err.invalid('VERSION_UNSUPPORTED', `Unknown version "${dto.version}" for ${dto.runtime}`);
    }
    let startup: string;
    try {
      startup = applyTemplate(startupRaw, env);
    } catch (e) {
      throw Err.invalid('STARTUP_VAR_UNKNOWN', (e as Error).message);
    }

    // quota + insert are ONE transaction holding a row lock on the owner:
    // two concurrent creates cannot both pass the count check (TOCTOU).
    // Docker provisioning stays outside (saga: reconciler heals orphans).
    const { plan, row } = await this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ planId: users.planId })
        .from(users)
        .where(eq(users.id, ownerId))
        .for('update')
        .limit(1);
      if (!owner) throw Err.notFound('USER_NOT_FOUND');
      const [plan] = await tx.select().from(plans).where(eq(plans.id, owner.planId)).limit(1);
      if (!plan) throw Err.invalid('PLAN_INVALID', 'Unknown plan');

      const owned = await tx.select({ id: servers.id }).from(servers).where(eq(servers.ownerId, ownerId));
      if (owned.length >= plan.maxServers)
        throw Err.quota('QUOTA_SERVERS', `Your "${plan.name}" plan allows ${plan.maxServers} server(s). Upgrade to add more.`);
      if (owned.length >= config.MAX_SERVERS_PER_USER)
        throw Err.quota('QUOTA_SERVERS', `Account limit of ${config.MAX_SERVERS_PER_USER} servers reached.`);

      const [row] = await tx
        .insert(servers)
        .values({
          ownerId,
          nodeId,
          name: dto.name,
          runtime: dto.runtime,
          runtimeVersion: version.image,
          status: 'provisioning',
          region,
          planId: plan.id,
          cpuMilli: plan.cpuMilli,
          ramMb: plan.ramMb,
          storageGb: plan.storageGb,
          startup: startupRaw,
          envEncrypted: storedEnv.length ? encryptEnv(storedEnv) : null,
          autoRestart: dto.autoRestart ?? true,
          autoBackup: dto.autoBackup ?? true,
          autoBackupRetain: dto.autoBackupRetain ?? 7,
        } as never)
        .returning()
        .catch((e: { code?: string }) => {
          if (e?.code === '23505') throw Err.conflict('SERVER_NAME_TAKEN', 'You already have a server with this name');
          throw e;
        });
      return { plan, row };
    });

    await this.event(row.id, ownerId, 'create', { plan: plan.id, runtime: dto.runtime, region });

    try {
      const result = await this.provisioner.provision({
        id: row.id,
        ownerId,
        nodeId,
        runtime: dto.runtime as Runtime,
        image: version.image,
        startup,
        env,
        cpuMilli: plan.cpuMilli,
        ramMb: plan.ramMb,
        autoRestart: row.autoRestart,
      });
      const updated = await this.persistProvision(row.id, result, { start: config.AUTO_START_ON_CREATE, nodeId });
      // same fast-fail as start/: a doomed entry file must surface as an
      // error state right away, not as a phantom "online".
      if (config.AUTO_START_ON_CREATE && updated.containerId) {
        await this.settled(updated.containerId, row.id, ownerId, 'start', nodeId);
        return this.toPublic(await this.requireOwned(ownerId, row.id));
      }
      await this.audit.record({
        actorId: ownerId,
        action: 'server.create',
        targetType: 'server',
        targetId: row.id,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: { name: row.name, runtime: row.runtime, plan: plan.id, region },
      });
      return this.toPublic(updated);
    } catch (e) {
      // client-facing state stays generic (daemon internals aid recon);
      // the raw error is in server logs + requestId-correlated access line.
      const detail = (e as Error).message;
      this.log.error(`provision ${row.id} failed: ${detail.slice(0, 500)}`);
      await this.db
        .update(servers)
        .set({ status: 'error', lastError: 'Provisioning failed' })
        .where(eq(servers.id, row.id))
        .catch(() => undefined);
      await this.event(row.id, ownerId, 'provision_error', { error: 'Provisioning failed' });
      throw e;
    }
  }

  // ---- update ---------------------------------------------------------------

  async update(
    ownerId: string,
    id: string,
    dto: UpdateServerDto,
    ctx: ReqCtx,
    opts?: { actorId?: string; actorEmail?: string | null; isAdmin?: boolean },
  ) {
    const row = await this.requireOwned(ownerId, id);
    const isAdmin = opts?.isAdmin ?? ownerId === 'admin';
    const actorId = opts?.actorId ?? ownerId;
    const release = await this.acquire(id);
    try {
      if (row.status === 'deleting') throw Err.conflict('SERVER_DELETING', 'Server is being deleted');
      const patch: Partial<typeof servers.$inferInsert> = {};
      let rebuild = false;

      if (dto.name !== undefined && dto.name !== row.name) patch.name = dto.name;
      if (dto.startup !== undefined && dto.startup !== row.startup) {
        patch.startup = this.cleanStartup(dto.startup);
        rebuild = true;
      }
      // effective env for template validation: stored values (with masked
      // round-trip) merged under egg defaults — same merge provision uses.
      const stored = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
      const storedMap = new Map(stored.map((e) => [e.k, e.v]));
      let effective = resolveEggEnv(row.runtime, stored);
      if (dto.env !== undefined) {
        const env = this.cleanEnv(dto.env);
        // toPublic masks values (••••) — a masked value sent back means
        // "keep the stored one", never "store bullets". Without this, any
        // settings save would silently destroy all secrets.
        for (const e of env) {
          if (/^•+$/.test(e.v) && storedMap.has(e.k)) e.v = storedMap.get(e.k)!;
        }
        patch.envEncrypted = env.length ? encryptEnv(env) : null;
        effective = resolveEggEnv(row.runtime, env);
        rebuild = true;
      }
      if (patch.startup !== undefined || dto.env !== undefined) {
        // fail fast on unknown {{VAR}} instead of booting wrong later
        try {
          applyTemplate((patch.startup ?? row.startup) as string, effective);
        } catch (e) {
          throw Err.invalid('STARTUP_VAR_UNKNOWN', (e as Error).message);
        }
      }
      if (dto.autoRestart !== undefined && dto.autoRestart !== row.autoRestart) {
        patch.autoRestart = dto.autoRestart;
        rebuild = true; // restart policy is baked into the container config
      }
      if (dto.autoBackup !== undefined) patch.autoBackup = dto.autoBackup;
      if (dto.autoBackupRetain !== undefined) patch.autoBackupRetain = dto.autoBackupRetain;

      if (!Object.keys(patch).length) return this.toPublic(row);

      const where = isAdmin ? eq(servers.id, id) : and(eq(servers.id, id), eq(servers.ownerId, ownerId));
      const [updated] = await this.db
        .update(servers)
        .set({ ...patch, updatedAt: new Date() })
        .where(where)
        .returning()
        .catch((e: { code?: string }) => {
          if (e?.code === '23505') throw Err.conflict('SERVER_NAME_TAKEN', 'You already have a server with this name');
          throw e;
        });
      // the row can vanish between the guard read and this write (parallel
      // delete) — 404, not a 500 TypeError on `updated.containerId`.
      if (!updated) throw Err.notFound('SERVER_NOT_FOUND');

      if (rebuild) {
        const wasRunning = updated.containerId ? (await this.docker.inspect(updated.containerId, updated.nodeId))?.running ?? false : false;
        await this.rebuild(updated, wasRunning).catch(async (e: Error) => {
          await this.markError(updated.id, e.message);
          throw e;
        });
      }

      await this.event(updated.id, ownerId, 'update', {
        fields: Object.keys(patch),
        rebuilt: rebuild,
      });
      await this.audit.record({
        actorId,
        actorEmail: opts?.actorEmail ?? null,
        action: 'server.update',
        targetType: 'server',
        targetId: updated.id,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: { fields: Object.keys(patch), isAdmin },
      });
      return this.toPublic(await this.requireOwned(ownerId, id));
    } finally {
      release();
    }
  }

  // ---- delete ---------------------------------------------------------------

  async remove(ownerId: string, id: string, ctx: ReqCtx) {
    const row = await this.requireOwned(ownerId, id);
    const isAdmin = ownerId === 'admin';
    const release = await this.acquire(id);
    try {
      await this.db.update(servers).set({ status: 'deleting' }).where(eq(servers.id, id)).catch(() => undefined);

      const errors = await this.provisioner.destroy({
        nodeId: row.nodeId,
        containerId: row.containerId,
        containerName: row.containerName,
        networkName: row.networkName,
        networkSubnet: row.networkSubnet,
        volumeName: row.volumeName,
      });

      // backup rows cascade with the server row, but archive files on disk do
      // not — remove them so deleted servers (and their PII) leave nothing.
      const backupOwner = isAdmin ? row.ownerId : ownerId;
      await rm(backupDirFor(backupOwner, id), { recursive: true, force: true }).catch(() => undefined);

      // rows go away regardless; the reconciler GCs any resource that failed
      const where = isAdmin ? eq(servers.id, id) : and(eq(servers.id, id), eq(servers.ownerId, ownerId));
      await this.db.delete(servers).where(where);

      await this.audit.record({
        actorId: ownerId,
        action: 'server.delete',
        targetType: 'server',
        targetId: id,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: { name: row.name, cleanupErrors: errors.length, isAdmin },
      });
      this.log.log(`server ${row.name} (${id}) deleted by ${ownerId}; cleanup errors: ${errors.length}`);
      return { ok: true, cleanupErrors: errors };
    } finally {
      release();
    }
  }

  // ---- lifecycle ------------------------------------------------------------

  async lifecycle(ownerId: string, id: string, action: 'start' | 'stop' | 'restart' | 'reinstall', ctx: ReqCtx) {
    let row = await this.requireOwned(ownerId, id);
    const actor = { actorId: ownerId, targetType: 'server', targetId: id, ip: ctx.ip, userAgent: ctx.device };
    const release = await this.acquire(id);
    try {
    if (row.status === 'deleting') throw Err.conflict('SERVER_DELETING', 'Server is being deleted');

    if (action === 'reinstall') {
      await this.db.update(servers).set({ status: 'restarting', lastError: null }).where(eq(servers.id, id));
      // wipe container + network + volume, then provision a clean sandbox
      await this.provisioner.destroy({
        nodeId: row.nodeId,
        containerId: row.containerId,
        containerName: row.containerName,
        networkName: row.networkName,
        networkSubnet: row.networkSubnet,
        volumeName: row.volumeName,
      });
      const env = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
      const result = await this.provisioner.provision({
        id: row.id,
        ownerId,
        nodeId: row.nodeId,
        runtime: row.runtime as Runtime,
        image: row.runtimeVersion ?? undefined,
        startup: applyTemplate(row.startup, resolveEggEnv(row.runtime, env)),
        // container sees the merged env (egg defaults included); storage
        // keeps exactly what the user set (see create)
        env: resolveEggEnv(row.runtime, env),
        cpuMilli: row.cpuMilli,
        ramMb: row.ramMb,
        autoRestart: row.autoRestart,
      });
      const updated = await this.persistProvision(id, result, { start: true, nodeId: row.nodeId });
      await this.event(id, ownerId, 'reinstall', { clean: true });
      await this.audit.record({ ...actor, action: 'server.reinstall' });
      return { status: updated.status };
    }

    if (!row.containerId || !(await this.docker.inspect(row.containerId, row.nodeId))) {
      // container vanished (host reboot, manual rm) → repair it first
      const env = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
      const result = await this.provisioner.provision({
        id: row.id,
        ownerId,
        nodeId: row.nodeId,
        runtime: row.runtime as Runtime,
        image: row.runtimeVersion ?? undefined,
        startup: applyTemplate(row.startup, resolveEggEnv(row.runtime, env)),
        // container sees the merged env (egg defaults included); storage
        // keeps exactly what the user set (see create)
        env: resolveEggEnv(row.runtime, env),
        cpuMilli: row.cpuMilli,
        ramMb: row.ramMb,
        autoRestart: row.autoRestart,
      });
      row = await this.persistProvision(id, result, { start: false, nodeId: row.nodeId });
    }

    try {
      if (action === 'start') {
        await this.setField(id, { status: 'restarting', lastError: null });
        await this.docker.start(row.containerId!, row.nodeId);
      } else if (action === 'stop') {
        await this.docker.stop(row.containerId!, 15, row.nodeId);
      } else {
        await this.setField(id, { status: 'restarting', lastError: null });
        await this.docker.restart(row.containerId!, 10, row.nodeId);
      }

      const state = await this.docker.inspect(row.containerId!, row.nodeId);
      // fast-fail: a missing entry file (or any instant crash) exits in
      // milliseconds — report it NOW with the real stderr tail instead of
      // claiming "online" and letting the user discover the loop in logs.
      if ((action === 'start' || action === 'restart') && !(await this.settled(row.containerId!, id, ownerId, action, row.nodeId))) {
        return { status: 'error' };
      }
      const fresh = await this.docker.inspect(row.containerId!, row.nodeId);
      const status = fresh?.running ? 'online' : 'offline';
      await this.setField(id, { status });
      await this.event(id, ownerId, action, { status });
      await this.audit.record({ ...actor, action: `server.${action}` });
      return { status };
    } catch (e) {
      await this.markError(id, (e as Error).message);
      await this.event(id, ownerId, `${action}_error`, { error: (e as Error).message.slice(0, 300) });
      throw Err.unavailable('DOCKER_ERROR', `Could not ${action} the server`);
    }
    } finally {
      release();
    }
  }

  /** Account deletion hook: destroys every sandbox of a user. */
  async purgeAllForUser(ownerId: string): Promise<number> {
    const rows = await this.db.select().from(servers).where(eq(servers.ownerId, ownerId));
    for (const row of rows) {
      await this.provisioner.destroy({
        nodeId: row.nodeId,
        containerId: row.containerId,
        containerName: row.containerName,
        networkName: row.networkName,
        networkSubnet: row.networkSubnet,
        volumeName: row.volumeName,
      });
    }
    await this.db.delete(servers).where(eq(servers.ownerId, ownerId));
    // backup files are not cascade-deleted — remove the whole owner tree.
    await rm(backupOwnerDir(ownerId), { recursive: true, force: true }).catch(() => undefined);
    if (rows.length) this.log.log(`purged ${rows.length} sandbox(es) for user ${ownerId}`);
    return rows.length;
  }

  // ---- observability --------------------------------------------------------

  async stats(ownerId: string, id: string) {
    const row = await this.requireOwned(ownerId, id);
    const stats = row.containerId ? await this.docker.stats(row.containerId, row.nodeId) : null;
    return {
      ...stats,
      cpuPercent: stats?.cpuPercent ?? 0,
      memBytes: stats?.memBytes ?? 0,
      memLimitBytes: stats?.memLimitBytes ?? row.ramMb * 1024 * 1024,
      limits: { cpuMilli: row.cpuMilli, ramMb: row.ramMb, storageGb: row.storageGb },
    };
  }

  async logs(ownerId: string, id: string, tail = 200) {
    const row = await this.requireOwned(ownerId, id);
    if (!row.containerId) return { logs: '' };
    return { logs: await this.docker.logs(row.containerId, tail, row.nodeId) };
  }

  async usage(ownerId: string, id: string) {
    const row = await this.requireOwned(ownerId, id);
    const bytes = await this.provisioner.volumeUsage(row.volumeName ?? '', runtimeImage(row.runtime).image, row.nodeId);
    return {
      usedBytes: bytes ?? 0,
      limitBytes: row.storageGb * 1024 * 1024 * 1024,
      usedPercent: bytes && row.storageGb ? Math.min(100, Math.round((bytes / (row.storageGb * 1024 ** 3)) * 100)) : 0,
    };
  }

  /** Server count of a user (used by quota checks elsewhere). */
  async countFor(ownerId: string): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(servers).where(eq(servers.ownerId, ownerId));
    return r?.n ?? 0;
  }

  // ---- internals ------------------------------------------------------------

  private async persistProvision(id: string, result: ProvisionResult, opts: { start: boolean; nodeId: string }): Promise<Server> {
    const patch: Record<string, unknown> = {
      containerId: result.containerId || null,
      containerName: result.containerName,
      networkName: result.networkName || null,
      networkSubnet: result.networkSubnet || null,
      volumeName: result.volumeName || null,
      image: result.image,
      status: 'offline' as const,
      lastError: null,
      updatedAt: new Date(),
      provisionedAt: new Date(),
    };

    if (opts.start && result.containerId) {
      try {
        await this.docker.start(result.containerId, opts.nodeId);
        patch.status = 'online';
      } catch (e) {
        patch.status = 'error';
        patch.lastError = `start failed: ${(e as Error).message}`.slice(0, 500);
      }
    }

    const [updated] = await this.db.update(servers).set(patch as never).where(eq(servers.id, id)).returning();
    return updated;
  }

  /** Remove the old container and re-provision from the current row. */
  private async rebuild(row: Server, start: boolean) {
    const env = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
    // stored startup is the raw template — resolve with current variables;
    // the image stays pinned to the version chosen at creation.
    const result = await this.provisioner.provision({
      id: row.id,
      ownerId: row.ownerId,
      nodeId: row.nodeId,
      runtime: row.runtime as Runtime,
      image: row.runtimeVersion ?? undefined,
      startup: applyTemplate(row.startup, resolveEggEnv(row.runtime, env)),
      // container sees the merged env (egg defaults included); storage
      // keeps exactly what the user set (see create)
      env: resolveEggEnv(row.runtime, env),
      cpuMilli: row.cpuMilli,
      ramMb: row.ramMb,
      autoRestart: row.autoRestart,
    });
    await this.persistProvision(row.id, result, { start, nodeId: row.nodeId });
    await this.event(row.id, row.ownerId, 'rebuild', { start });
  }

  private async setField(id: string, patch: Partial<typeof servers.$inferInsert>) {
    await this.db.update(servers).set({ ...patch, updatedAt: new Date() } as never).where(eq(servers.id, id));
    if (patch.status) this.realtime.broadcastServerStatus(id, patch.status);
  }

  private async markError(id: string, message: string) {
    await this.setField(id, { status: 'error', lastError: message.slice(0, 500) }).catch(() => undefined);
  }

  /**
   * Waits for a freshly started container to prove it stays up: 3 consecutive
   * clean 1s polls (running, zero new restarts). A single "running" snapshot
   * proves nothing — the daemon may relaunch a doomed process between polls.
   * Instant crash (missing entry file, syntax error, clean immediate exit)
   * or any new restart inside the window → stop it, record status=error
   * with the last stderr lines, return false.
   */
  private async settled(containerId: string, serverId: string, ownerId: string, action: string, nodeId = 'local'): Promise<boolean> {
    const base = await this.docker.inspect(containerId, nodeId).catch(() => null);
    const baseRest = base?.restartCount ?? 0;
    const baseStarted = base?.startedAt ?? '';
    let clean = 0;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = await this.docker.inspect(containerId, nodeId).catch(() => null);
      if (!s) return true; // vanished mid-check — the reconciler owns this case
      // StartedAt changes on EVERY (re)start — the airtight incarnation
      // check (counters/snapshots can straddle a restart boundary).
      if (s.restartCount > baseRest || (baseStarted && s.startedAt !== baseStarted)) {
        return this.failStart(containerId, serverId, ownerId, action,
          `Process crashed ${Math.max(1, s.restartCount - baseRest)}x in seconds`, undefined, nodeId);
      }
      if (!s.running) {
        if (s.exitCode !== 0 || i >= 3) {
          return this.failStart(containerId, serverId, ownerId, action, null, s.exitCode, nodeId);
        }
        continue; // exited 0 in the first seconds — keep watching the gap
      }
      if (++clean >= 3) return true;
    }
    const s = await this.docker.inspect(containerId, nodeId).catch(() => null);
    return !!s?.running && (s.restartCount <= baseRest) && (!baseStarted || s.startedAt === baseStarted);
  }

  private async failStart(
    containerId: string,
    serverId: string,
    ownerId: string,
    action: string,
    msg: string | null,
    exitCode?: number,
    nodeId = 'local',
  ): Promise<boolean> {
    // the user may have hit stop while we were watching — never overwrite a
    // deliberate offline/deleting state with our error.
    const [cur] = await this.db
      .select({ status: servers.status })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    if (!cur || (cur.status !== 'restarting' && cur.status !== 'online' && cur.status !== 'provisioning')) return true;
    await this.docker.stop(containerId, 15, nodeId).catch(() => undefined);
    let detail = msg;
    if (!detail) {
      const tail = await this.docker.logs(containerId, 20, nodeId).catch(() => '');
      detail =
        tail.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' / ').slice(0, 300) ||
        `Process exited with code ${exitCode ?? 'unknown'}`;
    }
    await this.setField(serverId, { status: 'error', lastError: `Startup failed: ${detail}` });
    await this.event(serverId, ownerId, `${action}_error`, { error: detail });
    return false;
  }

  private async resolvePlan(planId: string) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan) throw Err.invalid('PLAN_INVALID', 'Unknown plan');
    return plan;
  }

  private cleanStartup(startup: string | undefined): string {
    return (startup ?? '').replace(CONTROL_CHARS, '').slice(0, 500);
  }

  private cleanEnv(env: EnvVar[] | undefined): EnvVar[] {
    if (!env?.length) return [];
    if (env.length > config.MAX_ENV_VARS)
      throw Err.invalid('ENV_TOO_MANY', `At most ${config.MAX_ENV_VARS} variables are allowed`);
    let total = 0;
    const out: EnvVar[] = [];
    const seen = new Set<string>();
    for (const { k, v } of env) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw Err.invalid('ENV_KEY_INVALID', `Invalid variable name: ${k}`);
      // duplicates are rejected, not silently first-wins: a typo'd second
      // entry otherwise vanishes and the client debugs a phantom value.
      if (seen.has(k)) throw Err.invalid('ENV_DUP_KEY', `Duplicate variable: ${k}`);
      const value = String(v).slice(0, 5000);
      total += k.length + value.length;
      if (total > 64 * 1024) throw Err.invalid('ENV_TOO_LARGE', 'Combined environment size exceeds 64KB');
      seen.add(k);
      out.push({ k, v: value });
    }
    return out;
  }

  private safeDecrypt(payload: string): EnvVar[] {
    try {
      return decryptEnv(payload);
    } catch {
      this.log.warn('environment could not be decrypted (key rotation?) — ignoring stored vars');
      return [];
    }
  }

  private async event(serverId: string, actorId: string, type: string, detail?: Record<string, unknown>) {
    await this.db
      .insert(serverEvents)
      .values({ serverId, actorId, type, detail: detail ?? null } as never)
      .catch(() => undefined);
  }

  /** Strips everything a client must never see (crypto material, docker ids). */
  private toPublic(row: Server) {
    let env: EnvVar[] = [];
    if (row.envEncrypted) {
      const raw = this.safeDecrypt(row.envEncrypted);
      env = maskEnv(raw);
    }
    const port = runtimeImage(row.runtime).port;
    return {
      id: row.id,
      name: row.name,
      runtime: row.runtime,
      nodeId: row.nodeId,
      // digest refs must never reach clients — the label is the display name
      runtimeLabel: labelFor(row.runtime, row.runtimeVersion),
      runtimeVersion: row.runtimeVersion,
      status: row.status,
      lastError: row.lastError,
      region: row.region,
      planId: row.planId,
      cpuMilli: row.cpuMilli,
      ramMb: row.ramMb,
      storageGb: row.storageGb,
      startup: row.startup,
      env,
      envCount: env.length,
      port,
      autoRestart: row.autoRestart,
      autoBackup: row.autoBackup,
      autoBackupRetain: row.autoBackupRetain,
      hasContainer: !!row.containerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      provisionedAt: row.provisionedAt,
    };
  }
}
