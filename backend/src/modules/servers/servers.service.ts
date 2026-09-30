import { Inject, Injectable, Logger } from '@nestjs/common';
import { rm } from 'fs/promises';
import { and, desc, eq, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { decryptEnv, encryptEnv, maskEnv } from '../../common/crypto';
import { Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { plans, servers, serverEvents, users, type EnvVar, type Server } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { DockerService } from './provisioning/docker.service';
import { ProvisionerService, type ProvisionResult } from './provisioning/provisioner.service';
import { runtimeImage, type Runtime } from './provisioning/images';
import { CreateServerDto, UpdateServerDto } from './dto';
import { backupDirFor, backupOwnerDir } from './backup-paths';

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

@Injectable()
export class ServersService {
  private readonly log = new Logger(ServersService.name);

  constructor(
    @Inject(DB) private db: Db,
    private provisioner: ProvisionerService,
    private docker: DockerService,
    private audit: AuditService,
  ) {}

  // ---- reads ----------------------------------------------------------------

  async list(ownerId: string) {
    const rows = await this.db
      .select()
      .from(servers)
      .where(eq(servers.ownerId, ownerId))
      .orderBy(desc(servers.createdAt));
    return rows.map((r) => this.toPublic(r));
  }

  /** Owner-scoped single read — never trusts an id alone. */
  async getOne(ownerId: string, id: string) {
    const row = await this.requireOwned(ownerId, id);
    return this.toPublic(row);
  }

  async requireOwned(ownerId: string, id: string): Promise<Server> {
    const rows = await this.db
      .select()
      .from(servers)
      .where(and(eq(servers.id, id), eq(servers.ownerId, ownerId)))
      .limit(1);
    if (!rows.length) throw Err.notFound('SERVER_NOT_FOUND');
    return rows[0];
  }

  // ---- create ---------------------------------------------------------------

  async create(ownerId: string, dto: CreateServerDto, ctx: ReqCtx) {
    // The plan comes from the account, never from the request body: otherwise
    // any client could claim "enterprise" and escalate its quotas (CVE-class).
    const region = dto.region ?? config.REGIONS[0];
    if (!config.REGIONS.includes(region)) throw Err.invalid('REGION_UNSUPPORTED', `Allowed regions: ${config.REGIONS.join(', ')}`);

    const env = this.cleanEnv(dto.env);
    const startup = this.cleanStartup(dto.startup) || runtimeImage(dto.runtime).defaultStartup;

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
          name: dto.name,
          runtime: dto.runtime,
          runtimeVersion: runtimeImage(dto.runtime).image,
          status: 'provisioning',
          region,
          planId: plan.id,
          cpuMilli: plan.cpuMilli,
          ramMb: plan.ramMb,
          storageGb: plan.storageGb,
          startup,
          envEncrypted: env.length ? encryptEnv(env) : null,
          autoRestart: dto.autoRestart ?? true,
          autoBackup: dto.autoBackup ?? true,
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
        runtime: dto.runtime as Runtime,
        startup,
        env,
        cpuMilli: plan.cpuMilli,
        ramMb: plan.ramMb,
        autoRestart: row.autoRestart,
      });
      const updated = await this.persistProvision(row.id, result, { start: config.AUTO_START_ON_CREATE });
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
      const message = (e as Error).message.slice(0, 500);
      await this.db
        .update(servers)
        .set({ status: 'error', lastError: message })
        .where(eq(servers.id, row.id))
        .catch(() => undefined);
      await this.event(row.id, ownerId, 'provision_error', { error: message });
      throw e;
    }
  }

  // ---- update ---------------------------------------------------------------

  async update(ownerId: string, id: string, dto: UpdateServerDto, ctx: ReqCtx) {
    const row = await this.requireOwned(ownerId, id);
    const patch: Partial<typeof servers.$inferInsert> = {};
    let rebuild = false;

    if (dto.name !== undefined && dto.name !== row.name) patch.name = dto.name;
    if (dto.startup !== undefined && dto.startup !== row.startup) {
      patch.startup = this.cleanStartup(dto.startup);
      rebuild = true;
    }
    if (dto.env !== undefined) {
      const env = this.cleanEnv(dto.env);
      patch.envEncrypted = env.length ? encryptEnv(env) : null;
      rebuild = true;
    }
    if (dto.autoRestart !== undefined && dto.autoRestart !== row.autoRestart) {
      patch.autoRestart = dto.autoRestart;
      rebuild = true; // restart policy is baked into the container config
    }
    if (dto.autoBackup !== undefined) patch.autoBackup = dto.autoBackup;

    if (!Object.keys(patch).length) return this.toPublic(row);

    const [updated] = await this.db
      .update(servers)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(servers.id, id), eq(servers.ownerId, ownerId)))
      .returning()
      .catch((e: { code?: string }) => {
        if (e?.code === '23505') throw Err.conflict('SERVER_NAME_TAKEN', 'You already have a server with this name');
        throw e;
      });

    if (rebuild && updated.containerId) {
      // env/startup/restart-policy changes require a fresh container
      const wasRunning = (await this.docker.inspect(updated.containerId))?.running ?? false;
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
      actorId: ownerId,
      action: 'server.update',
      targetType: 'server',
      targetId: updated.id,
      ip: ctx.ip,
      userAgent: ctx.device,
      meta: { fields: Object.keys(patch) },
    });
    return this.toPublic(await this.requireOwned(ownerId, id));
  }

  // ---- delete ---------------------------------------------------------------

  async remove(ownerId: string, id: string, ctx: ReqCtx) {
    const row = await this.requireOwned(ownerId, id);
    await this.db.update(servers).set({ status: 'deleting' }).where(eq(servers.id, id)).catch(() => undefined);

    const errors = await this.provisioner.destroy({
      containerId: row.containerId,
      containerName: row.containerName,
      networkName: row.networkName,
      networkSubnet: row.networkSubnet,
      volumeName: row.volumeName,
    });

    // backup rows cascade with the server row, but archive files on disk do
    // not — remove them so deleted servers (and their PII) leave nothing.
    await rm(backupDirFor(ownerId, id), { recursive: true, force: true }).catch(() => undefined);

    // rows go away regardless; the reconciler GCs any resource that failed
    await this.db.delete(servers).where(and(eq(servers.id, id), eq(servers.ownerId, ownerId)));

    await this.audit.record({
      actorId: ownerId,
      action: 'server.delete',
      targetType: 'server',
      targetId: id,
      ip: ctx.ip,
      userAgent: ctx.device,
      meta: { name: row.name, cleanupErrors: errors.length },
    });
    this.log.log(`server ${row.name} (${id}) deleted by ${ownerId}; cleanup errors: ${errors.length}`);
    return { ok: true, cleanupErrors: errors };
  }

  // ---- lifecycle ------------------------------------------------------------

  async lifecycle(ownerId: string, id: string, action: 'start' | 'stop' | 'restart' | 'reinstall', ctx: ReqCtx) {
    let row = await this.requireOwned(ownerId, id);
    const actor = { actorId: ownerId, targetType: 'server', targetId: id, ip: ctx.ip, userAgent: ctx.device };

    if (action === 'reinstall') {
      await this.db.update(servers).set({ status: 'restarting', lastError: null }).where(eq(servers.id, id));
      // wipe container + network + volume, then provision a clean sandbox
      await this.provisioner.destroy({
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
        runtime: row.runtime as Runtime,
        startup: row.startup,
        env,
        cpuMilli: row.cpuMilli,
        ramMb: row.ramMb,
        autoRestart: row.autoRestart,
      });
      const updated = await this.persistProvision(id, result, { start: true });
      await this.event(id, ownerId, 'reinstall', { clean: true });
      await this.audit.record({ ...actor, action: 'server.reinstall' });
      return { status: updated.status };
    }

    if (!row.containerId || !(await this.docker.inspect(row.containerId))) {
      // container vanished (host reboot, manual rm) → repair it first
      const env = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
      const result = await this.provisioner.provision({
        id: row.id,
        ownerId,
        runtime: row.runtime as Runtime,
        startup: row.startup,
        env,
        cpuMilli: row.cpuMilli,
        ramMb: row.ramMb,
        autoRestart: row.autoRestart,
      });
      row = await this.persistProvision(id, result, { start: false });
    }

    try {
      if (action === 'start') {
        await this.setField(id, { status: 'restarting', lastError: null });
        await this.docker.start(row.containerId!);
      } else if (action === 'stop') {
        await this.docker.stop(row.containerId!);
      } else {
        await this.setField(id, { status: 'restarting', lastError: null });
        await this.docker.restart(row.containerId!);
      }

      const state = await this.docker.inspect(row.containerId!);
      const status = state?.running ? 'online' : 'offline';
      await this.setField(id, { status });
      await this.event(id, ownerId, action, { status });
      await this.audit.record({ ...actor, action: `server.${action}` });
      return { status };
    } catch (e) {
      await this.markError(id, (e as Error).message);
      await this.event(id, ownerId, `${action}_error`, { error: (e as Error).message.slice(0, 300) });
      throw Err.unavailable('DOCKER_ERROR', `Could not ${action} the server`);
    }
  }

  /** Account deletion hook: destroys every sandbox of a user. */
  async purgeAllForUser(ownerId: string): Promise<number> {
    const rows = await this.db.select().from(servers).where(eq(servers.ownerId, ownerId));
    for (const row of rows) {
      await this.provisioner.destroy({
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
    const stats = row.containerId ? await this.docker.stats(row.containerId) : null;
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
    return { logs: await this.docker.logs(row.containerId, tail) };
  }

  async usage(ownerId: string, id: string) {
    const row = await this.requireOwned(ownerId, id);
    const bytes = await this.provisioner.volumeUsage(row.volumeName ?? '', runtimeImage(row.runtime).image);
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

  private async persistProvision(id: string, result: ProvisionResult, opts: { start: boolean }): Promise<Server> {
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
        await this.docker.start(result.containerId);
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
    const result = await this.provisioner.provision({
      id: row.id,
      ownerId: row.ownerId,
      runtime: row.runtime as Runtime,
      startup: row.startup,
      env,
      cpuMilli: row.cpuMilli,
      ramMb: row.ramMb,
      autoRestart: row.autoRestart,
    });
    await this.persistProvision(row.id, result, { start });
    await this.event(row.id, row.ownerId, 'rebuild', { start });
  }

  private async setField(id: string, patch: Partial<typeof servers.$inferInsert>) {
    await this.db.update(servers).set({ ...patch, updatedAt: new Date() } as never).where(eq(servers.id, id));
  }

  private async markError(id: string, message: string) {
    await this.setField(id, { status: 'error', lastError: message.slice(0, 500) }).catch(() => undefined);
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
      const value = String(v).slice(0, 5000);
      total += k.length + value.length;
      if (total > 64 * 1024) throw Err.invalid('ENV_TOO_LARGE', 'Combined environment size exceeds 64KB');
      seen.add(k);
      out.push({ k, v: value });
    }
    return [...seen].map((k) => out.find((e) => e.k === k)!);
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
      hasContainer: !!row.containerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      provisionedAt: row.provisionedAt,
    };
  }
}
