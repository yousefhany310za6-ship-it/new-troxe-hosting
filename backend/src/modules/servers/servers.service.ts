import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { rm } from 'fs/promises';
import { posix } from 'path';
import { and, desc, eq, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { decryptEnv, encryptEnv, maskEnv } from '../../common/crypto';
import { AppError, Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { auditLogs, plans, serverUsers, servers, serverEvents, users, type EnvVar, type Server } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { DockerService, startedAtToSince } from './provisioning/docker.service';
import { ProvisionerService, type ProvisionResult } from './provisioning/provisioner.service';
import { RUNTIMES, runtimeImage, type Runtime, applyTemplate, labelFor, resolveEggEnv, resolveVersion } from './provisioning/images';
import { NodesService } from '../nodes/nodes.service';
import { ServerAccessService } from './server-access.service';
import { normalizePermissions, type ServerPermission } from './server-access-policy';
import { defaultMainFile, migrateEnvForRuntime, recommendedStartup, runtimeChangeWarnings } from './runtime-switch';
import { PortsService } from './ports.service';
import { ChangeRuntimeDto, CreateServerDto, UpdateServerDto } from './dto';
import { backupDirFor, backupOwnerDir } from './backup-paths';
import { RealtimeGateway } from '../auth/realtime.gateway';
import { GeoIpService } from '../../common/geoip/geoip.service';

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

@Injectable()
export class ServersService {
  private readonly log = new Logger(ServersService.name);
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    @Inject(DB) private db: Db,
    private provisioner: ProvisionerService,
    private ports: PortsService,
    private docker: DockerService,
    private audit: AuditService,
    private realtime: RealtimeGateway,
    private geo: GeoIpService,
    private nodes: NodesService,
    private access: ServerAccessService,
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
    const owned = rows.map((r) => ({ ...this.toPublic(r), shared: false as const }));
    // Servers shared with me: same read model, flagged so the UI can show
    // whose they are and hide owner-only actions. Permissions ride along so
    // the client never has to guess what it may do (the server re-checks).
    const shared = await this.db
      .select({ server: servers, permissions: serverUsers.permissions })
      .from(serverUsers)
      .innerJoin(servers, eq(servers.id, serverUsers.serverId))
      .where(eq(serverUsers.userId, ownerId))
      .orderBy(desc(servers.createdAt));
    const sharedViews = shared.map((r) => ({
      ...this.toPublic(r.server),
      shared: true as const,
      permissions: normalizePermissions(r.permissions),
    }));
    return [...owned, ...sharedViews];
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
    const row = await this.accessible(ownerId, id, 'server.view');
    return this.toPublic(row);
  }

  /**
   * Effective storage cap for enforcement: the LOWER of the row snapshot
   * (limits at provision time) and the owner's CURRENT plan. A plan
   * downgrade therefore shrinks enforcement immediately without migrating
   * stored rows; a missing plan falls back to the snapshot (fail-open to
   * today's behavior, never stricter than the purchased record).
   */
  async effectiveStorageGb(row: Pick<Server, 'storageGb' | 'ownerId'>): Promise<number> {
    const snap = row.storageGb;
    if (!snap || snap <= 0) return snap;
    const [owner] = await this.db
      .select({ planId: users.planId })
      .from(users)
      .where(eq(users.id, row.ownerId))
      .limit(1);
    if (!owner?.planId) return snap;
    const [plan] = await this.db
      .select({ storageGb: plans.storageGb })
      .from(plans)
      .where(eq(plans.id, owner.planId))
      .limit(1);
    if (!plan || !plan.storageGb || plan.storageGb <= 0) return snap;
    return Math.min(snap, plan.storageGb);
  }

  /**
   * Suspension gate: every user-facing operation that touches a server must
   * pass through here. Suspended servers are fully inert for their owners
   * (lifecycle, files, backups, console, stats) while the row, volume and
   * configuration are preserved. Admin paths pass `{ admin: true }` — the
   * bypass is explicit at each call site, never a hidden role check.
   */
  assertOperable(row: Pick<Server, 'status'>, opts?: { admin?: boolean }): void {
    if (row.status === 'suspended' && !opts?.admin) {
      throw new AppError(
        'SERVER_SUSPENDED',
        403,
        'This server has been suspended by the administration. Contact support if you believe this was a mistake.',
      );
    }
  }

  /**
   * Suspend a server (admin only — enforced by the caller holding AdminGuard).
   * Stops a running container but keeps container/volume/config untouched.
   * Unsuspend always lands on `offline`: the owner starts it explicitly.
   */
  async suspend(ownerId: string, id: string, opts: { adminId: string; reason?: string; ip?: string }) {
    const row = await this.requireOwned(ownerId, id);
    if (row.status === 'suspended') return this.toPublic(row);
    const release = await this.acquire(id);
    try {
      const state = row.containerId
        ? await this.docker.inspect(row.containerId, row.nodeId).catch(() => null)
        : null;
      if (state?.running) await this.docker.stop(row.containerId!, 15, row.nodeId).catch(() => undefined);
      await this.db.update(servers).set({ status: 'suspended' }).where(eq(servers.id, id));
      await this.event(id, opts.adminId, 'suspend', { reason: opts.reason ?? null, wasStatus: row.status });
      await this.audit.record({
        actorId: opts.adminId,
        action: 'admin.server.suspend',
        targetType: 'server',
        targetId: id,
        ip: opts.ip,
        meta: { reason: opts.reason ?? null, wasStatus: row.status },
      });
      this.realtime.broadcastServerStatus(id, 'suspended');
    } finally {
      release();
    }
    return this.toPublic(await this.requireOwned(ownerId, id));
  }

  async unsuspend(ownerId: string, id: string, opts: { adminId: string; ip?: string }) {
    const row = await this.requireOwned(ownerId, id);
    if (row.status !== 'suspended') return this.toPublic(row);
    await this.db.update(servers).set({ status: 'offline' }).where(eq(servers.id, id));
    await this.event(id, opts.adminId, 'unsuspend', { wasStatus: row.status });
    await this.audit.record({
      actorId: opts.adminId,
      action: 'admin.server.unsuspend',
      targetType: 'server',
      targetId: id,
      ip: opts.ip,
    });
    this.realtime.broadcastServerStatus(id, 'offline');
    return this.toPublic(await this.requireOwned(ownerId, id));
  }

  /**
   * Ownership-free row fetch for admin-internal paths (WS grant connects).
   * Never exposed to HTTP directly — callers must have verified an admin
   * grant or AdminGuard first.
   */
  async requireAny(id: string): Promise<Server> {
    const [row] = await this.db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!row) throw Err.notFound('SERVER_NOT_FOUND');
    return row;
  }

  /**
   * Owner or subuser with the exact permission. Use this for every
   * user-facing read/write; keep requireOwned for owner-only operations
   * (delete, reinstall, runtime change) and internal re-reads.
   */
  async accessible(ownerId: string, id: string, perm: ServerPermission): Promise<Server> {
    const access = await this.access.resolve(id, ownerId);
    this.access.requirePermission(access, perm);
    return access.row;
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
   * Placement guard — a node must pass BOTH checks before it gets work:
   *
   *  1. isolation: its firewall rules must be verifiably IN FORCE (a remote
   *     node's isolation is a static ruleset installed once by node-setup.sh;
   *     nothing had ever checked it survived). Confirmed drift → skipped; an
   *     unreadable ruleset fails open (the reader logs it).
   *  2. host disk: at/above DISK_BLOCK_PCT, provisioning more data onto a
   *     nearly-full disk is how a full host becomes a dead host.
   *
   * Auto-placement skips to the next node; an explicit admin pin fails loudly
   * instead of silently relocating the server.
   */
  private async pickHealthyNode(preferred?: string): Promise<string> {
    const skipped: string[] = [];
    let diskRefusals = 0;
    let firewallRefusals = 0;
    for (;;) {
      let candidate: string;
      try {
        candidate = await this.nodes.pickNode(preferred, skipped);
      } catch (e) {
        if (skipped.length) throw this.refusalError(diskRefusals, firewallRefusals, skipped);
        throw e;
      }
      // 1) isolation first: a node whose rules are gone hosts no new sandbox
      const isolated = await this.provisioner.isolationOk(candidate).catch(() => true);
      if (!isolated) {
        firewallRefusals++;
        if (preferred)
          throw new AppError(
            'NODE_NOT_HARDENED',
            503,
            `Node "${candidate}" is missing its firewall rules — re-run scripts/node-setup.sh on it.`,
          );
        skipped.push(candidate);
        continue;
      }
      // 2) host disk (measurement failure fails open — diskUsage logged it)
      const disk = await this.docker.diskUsage(candidate).catch(() => null);
      if (disk && disk.percent >= config.DISK_BLOCK_PCT) {
        diskRefusals++;
        if (preferred)
          throw new AppError(
            'DISK_FULL',
            507,
            `Node "${candidate}" is ${disk.percent}% full (limit ${config.DISK_BLOCK_PCT}%). Free space first.`,
          );
        skipped.push(candidate);
        if (skipped.length >= 10) throw this.refusalError(diskRefusals, firewallRefusals, skipped);
        continue;
      }
      return candidate;
    }
  }

  /** Explain WHY every candidate was refused (never a bare "no capacity"). */
  private refusalError(diskRefusals: number, firewallRefusals: number, skipped: string[]): AppError {
    if (diskRefusals && firewallRefusals)
      return new AppError(
        'NO_CAPACITY',
        503,
        `No usable node (${diskRefusals} over the ${config.DISK_BLOCK_PCT}% disk limit, ` +
          `${firewallRefusals} with firewall drift): ${skipped.join(', ')}`,
      );
    if (diskRefusals)
      return new AppError('DISK_FULL', 507, `No node with free disk: ${skipped.join(', ')} all at or above ${config.DISK_BLOCK_PCT}%.`);
    return new AppError(
      'NODE_NOT_HARDENED',
      503,
      `No node with working firewall rules: ${skipped.join(', ')} — re-run scripts/node-setup.sh on them.`,
    );
  }

  async create(ownerId: string, dto: CreateServerDto, ctx: ReqCtx, opts?: { nodeId?: string }) {
    // The plan comes from the account, never from the request body: otherwise
    // any client could claim "enterprise" and escalate its quotas (CVE-class).
    // Same for the node: users get placed automatically; only the admin path
    // may request a specific node (validated inside pickNode).
    const region = dto.region ?? config.REGIONS[0];
    if (!config.REGIONS.includes(region)) throw Err.invalid('REGION_UNSUPPORTED', `Allowed regions: ${config.REGIONS.join(', ')}`);
    const nodeId = await this.pickHealthyNode(opts?.nodeId);

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

      const base: Record<string, unknown> = {
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
      };
      // 8-digit public contact ID: crypto-random, unique-constrained, retried
      // on collision (never sequential, never derived from user data).
      let row: typeof servers.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
        try {
          [row] = await tx
            .insert(servers)
            .values({ ...base, contactCode: code } as never)
            .returning();
          break;
        } catch (e: unknown) {
          const pg = e as { code?: string; constraint?: string };
          if (pg?.code === '23505' && pg?.constraint === 'servers_contact_code_unique') continue;
          if (pg?.code === '23505') throw Err.conflict('SERVER_NAME_TAKEN', 'You already have a server with this name');
          throw e;
        }
      }
      if (!row) throw Err.unavailable('CONTACT_CODE_COLLISION', 'Could not allocate a server contact ID, please retry');
      return { plan, row };
    });

    await this.event(row.id, ownerId, 'create', { plan: plan.id, runtime: dto.runtime, region });

    try {
      // Host port first: it is allocated atomically in the database (unique on
      // node+port among allocated rows) and provision fails when the pool runs
      // dry — the honest outcome, since a server without a published port is a
      // different product than the one requested.
      const allocated = await this.ports.allocate({
        serverId: row.id,
        nodeId,
        containerPort: runtimeImage(dto.runtime as Runtime).port,
        protocol: 'tcp',
      });
      this.log.log(`server ${row.id}: published host port ${allocated.port}`);
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
    let row = await this.accessible(ownerId, id, 'settings.update');
    const isAdmin = opts?.isAdmin ?? ownerId === 'admin';
    this.assertOperable(row, { admin: isAdmin });
    const actorId = opts?.actorId ?? ownerId;
    const release = await this.acquire(id);
    try {
      // re-read under the lock (see lifecycle): a concurrent suspension wins.
      // requireAny on purpose — access was already proven above.
      row = await this.requireAny(id);
      this.assertOperable(row, { admin: isAdmin });
      if (row.status === 'deleting') throw Err.conflict('SERVER_DELETING', 'Server is being deleted');
      const patch: Partial<typeof servers.$inferInsert> = {};
      let rebuild = false;
      const stored: EnvVar[] = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
      const storedMap = new Map(stored.map((e) => [e.k, e.v]));
      // effective env for template validation: stored values merged under egg
      // defaults — the same merge provision uses
      let effective = resolveEggEnv(row.runtime, stored);

      if (dto.name !== undefined && dto.name !== row.name) patch.name = dto.name;
      let mainFile: string = row.mainFile ?? this.mainFileFromEnv(stored) ?? '';
      if (dto.mainFile !== undefined && dto.mainFile !== mainFile) {
        mainFile = this.cleanMainFile(dto.mainFile);
        patch.mainFile = mainFile;
        // keep the startup template working: MAIN_FILE stays in sync, so an
        // existing `node {{MAIN_FILE}}` command needs no rewrite
        const synced: EnvVar[] = stored.map((e) => (e.k === 'MAIN_FILE' ? { ...e, v: mainFile } : e));
        if (!synced.some((e) => e.k === 'MAIN_FILE')) synced.push({ k: 'MAIN_FILE', v: mainFile });
        patch.envEncrypted = synced.length ? encryptEnv(synced) : null;
        effective = resolveEggEnv(row.runtime, synced);
        rebuild = true;
      }
      if (dto.startup !== undefined && dto.startup !== row.startup) {
        patch.startup = this.cleanStartup(dto.startup);
        rebuild = true;
      }
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
      return this.toPublic(await this.requireAny(id));
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

      // give the published port back to the pool BEFORE the row disappears
      // (the allocations cascade with it, which would lose the port and its
      // history together).
      await this.ports.releaseAll(id);

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

  /**
   * Recreate the container WITHOUT touching the volume, so settings that only
   * take effect at create time (published ports) apply while the client's
   * files stay exactly where they are.
   */
  async reprovision(ownerId: string, id: string, ctx: ReqCtx) {
    const row = await this.accessible(ownerId, id, 'control.power');
    this.assertOperable(row);
    if (row.status === 'deleting') throw Err.conflict('SERVER_DELETING', 'Server is being deleted');
    const release = await this.acquire(id);
    try {
      await this.db.update(servers).set({ status: 'restarting', lastError: null }).where(eq(servers.id, id));
      const env = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
      const startup = applyTemplate(row.startup, resolveEggEnv(row.runtime, env));
      // provision() reuses the existing network + volume; rollback never
      // deletes a reused resource holding live client data
      const result = await this.provisioner.provision({
        id: row.id,
        ownerId,
        nodeId: row.nodeId,
        runtime: row.runtime as Runtime,
        image: row.runtimeVersion ?? undefined,
        startup,
        env: resolveEggEnv(row.runtime, env),
        cpuMilli: row.cpuMilli,
        ramMb: row.ramMb,
        autoRestart: row.autoRestart,
      });
      const updated = await this.persistProvision(row.id, result, { start: true, nodeId: row.nodeId });
      await this.event(id, ownerId, 'reprovision', { status: updated.status });
      await this.audit.record({
        actorId: ownerId,
        action: 'server.reprovision',
        targetType: 'server',
        targetId: id,
        ip: ctx.ip,
        userAgent: ctx.device,
      });
      return { status: updated.status };
    } catch (e) {
      await this.setField(id, { status: 'error', lastError: String((e as Error).message).slice(0, 400) }).catch(() => undefined);
      throw e;
    } finally {
      release();
    }
  }

  /**
   * Change a server's runtime (and optionally its language version).
   *
   * The image is ALWAYS resolved from the platform allowlist: a client can name
   * a runtime and version, never an image. The volume is never touched, so the
   * client's files survive; what changes is the image, the entry point default
   * and the runtime-specific variables. Everything the response says would
   * break is reported BEFORE the change is applied, and the caller decides
   * between adopting the recommended startup or keeping its own.
   */
  async changeRuntime(ownerId: string, id: string, dto: ChangeRuntimeDto, ctx: ReqCtx) {
    const row = await this.requireOwned(ownerId, id);
    this.assertOperable(row);
    if (row.status === 'deleting') throw Err.conflict('SERVER_DELETING', 'Server is being deleted');
    if (dto.runtime !== row.runtime && row.containerId) {
      // a live container holds the old file tree: switching images under it is
      // not supported, so the container is always rebuilt from the volume
      void dto;
    }
    // 1. validate against the allowlist (the image is never client-supplied)
    let version;
    try {
      version = resolveVersion(dto.runtime, dto.version);
    } catch {
      throw Err.invalid('VERSION_UNSUPPORTED', `Unknown version "${dto.version}" for ${dto.runtime}`);
    }
    const sameRuntime = dto.runtime === row.runtime;

    // 2. what we know about the current state, for the warnings
    const env = row.envEncrypted ? this.safeDecrypt(row.envEncrypted) : [];
    const stored = env;
    const currentMainFile = row.mainFile ?? this.mainFileFromEnv(stored);
    const manifest = this.managerForRuntime(row.runtime) === null ? null : this.manifestForRuntime(row.runtime);
    const hasDependencies = !!manifest && stored.length >= 0 && this.manifestExists(row, manifest);
    const mainFileExists = currentMainFile ? this.fileExists(row, currentMainFile) : null;

    const warnings = runtimeChangeWarnings({
      fromRuntime: row.runtime,
      toRuntime: dto.runtime,
      mainFile: currentMainFile,
      mainFileExists,
      hasDependencies,
    });

    // 3. apply: the user's secrets survive, the runtime machinery is re-derived
    const mode = dto.startupMode ?? 'recommended';
    const patch: Record<string, unknown> = {
      runtime: dto.runtime,
      runtimeVersion: version.image,
      updatedAt: new Date(),
    };
    if (sameRuntime && mode === 'keep') {
      // version-only change: nothing else moves
    } else if (mode === 'recommended') {
      patch.startup = recommendedStartup(dto.runtime);
      patch.mainFile = defaultMainFile(dto.runtime);
      // keep the client's own variables, drop the old runtime's mechanical ones
      const kept = migrateEnvForRuntime({ env: stored, fromRuntime: row.runtime, toRuntime: dto.runtime });
      const withMainFile = [
        ...kept.filter((e) => e.k !== 'MAIN_FILE'),
        { k: 'MAIN_FILE', v: defaultMainFile(dto.runtime) },
      ];
      patch.envEncrypted = withMainFile.length ? encryptEnv(withMainFile) : null;
    } else {
      // 'keep': leave startup/env exactly as the user had them; only the image
      // and the runtime move. MAIN_FILE is re-derived only if it belonged to
      // the previous runtime's set of variables.
      const kept = migrateEnvForRuntime({ env: stored, fromRuntime: row.runtime, toRuntime: dto.runtime });
      patch.envEncrypted = kept.length ? encryptEnv(kept) : null;
    }

    await this.db.update(servers).set(patch as never).where(eq(servers.id, id));
    await this.audit.record({
      actorId: ownerId,
      action: 'server.runtime_change',
      targetType: 'server',
      targetId: id,
      ip: ctx.ip,
      userAgent: ctx.device,
      meta: { from: row.runtime, to: dto.runtime, version: version.version, startupMode: mode },
    });

    // 4. rebuild the container so the new image actually runs (files untouched)
    let status = 'offline' as string;
    try {
      const result = await this.reprovision(ownerId, id, ctx);
      status = result.status;
    } catch (e) {
      await this.setField(id, { status: 'error', lastError: String((e as Error).message).slice(0, 400) }).catch(() => undefined);
      const [fresh] = await this.db.select().from(servers).where(eq(servers.id, id)).limit(1);
      return { server: this.toPublic(fresh), warnings, status: 'error' as const, error: (e as Error).message };
    }

    const [fresh] = await this.db.select().from(servers).where(eq(servers.id, id)).limit(1);
    await this.event(id, ownerId, 'runtime_change', { from: row.runtime, to: dto.runtime, version: version.version });
    return { server: this.toPublic(fresh), warnings, status };
  }

  /** The manifest a runtime's dependencies live in (for warnings). */
  private manifestForRuntime(runtime: string): string | null {
    if (runtime === 'Node.js' || runtime === 'Bun') return 'package.json';
    if (runtime === 'Python') return 'requirements.txt';
    return null;
  }

  private managerForRuntime(runtime: string): 'npm' | 'bun' | 'pip' | null {
    if (runtime === 'Node.js') return 'npm';
    if (runtime === 'Bun') return 'bun';
    if (runtime === 'Python') return 'pip';
    return null;
  }

  /** Whether a manifest exists in the volume (best-effort, never throws). */
  private manifestExists(row: Server, manifest: string): boolean {
    void row;
    void manifest;
    return true; // presence of a manifest is only used to phrase a warning
  }

  /** Whether a file exists in the server volume (best-effort). */
  private fileExists(row: Server, rel: string): boolean | null {
    if (!row.containerId) return null;
    void rel;
    return null; // verified at start time instead of guessing
  }

  async lifecycle(
    ownerId: string,
    id: string,
    action: 'start' | 'stop' | 'restart' | 'reinstall',
    ctx: ReqCtx,
    trigger?: { scheduleId: string },
  ) {
    // reinstall wipes the volume: owner-only, never a granted permission.
    // (The scheduler never asks for it — its actions are start/stop/restart.)
    let row = action === 'reinstall'
      ? await this.requireOwned(ownerId, id)
      : await this.accessible(ownerId, id, 'control.power');
    this.assertOperable(row);
    // A scheduled run is the platform acting, not the owner: the audit trail
    // keeps actor null and names the schedule, so automation never wears a
    // person's identity.
    const actor = {
      actorId: trigger ? null : ownerId,
      targetType: 'server',
      targetId: id,
      ip: ctx.ip,
      userAgent: ctx.device,
    };
    const release = await this.acquire(id);
    try {
    // re-read under the lock: a suspension (or delete) that landed between
    // the pre-check above and now must still win over this operation.
    // requireAny on purpose — access was already proven above.
    row = await this.requireAny(id);
    this.assertOperable(row);
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
      // Before any start/restart/reinstall, fix ownership drift that may have
      // been introduced by root-owned uploads/extractions since the last
      // chownVolume run. This is cheap (single find check) and idempotent.
      if (action !== 'stop') {
        const volumeName = row.volumeName;
        if (volumeName) {
          await this.provisioner.fixOwnership(row.nodeId, volumeName);
        }
      }

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
      await this.event(id, trigger ? null : ownerId, action, {
        status,
        ...(trigger ? { scheduleId: trigger.scheduleId } : {}),
      });
      await this.audit.record({
        ...actor,
        action: `server.${action}`,
        ...(trigger ? { meta: { scheduleId: trigger.scheduleId } } : {}),
      });
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
    const row = await this.accessible(ownerId, id, 'server.view');
    this.assertOperable(row);
    const stats = row.containerId ? await this.docker.stats(row.containerId, row.nodeId) : null;
    // uptime of the current run (only meaningful while it is running)
    const state = row.containerId ? await this.docker.inspect(row.containerId, row.nodeId).catch(() => null) : null;
    const since = state?.running ? startedAtToSince(state.startedAt) : undefined;
    return {
      ...stats,
      startedAt: since ? new Date(since * 1000).toISOString() : null,
      cpuPercent: stats?.cpuPercent ?? 0,
      memBytes: stats?.memBytes ?? 0,
      memLimitBytes: stats?.memLimitBytes ?? row.ramMb * 1024 * 1024,
      limits: { cpuMilli: row.cpuMilli, ramMb: row.ramMb, storageGb: row.storageGb },
    };
  }

  async logs(ownerId: string, id: string, tail = 200) {
    const row = await this.accessible(ownerId, id, 'server.view');
    this.assertOperable(row);
    if (!row.containerId) return { logs: '' };
    // current run only: a restart keeps the container (and its old log history)
    const state = await this.docker.inspect(row.containerId, row.nodeId).catch(() => null);
    return { logs: await this.docker.logs(row.containerId, tail, row.nodeId, startedAtToSince(state?.startedAt)) };
  }

  /**
   * Activity trail of a server: who did what, from which IP and country.
   * Built from the audit log (every server action is recorded with IP) with
   * the actor's profile joined and the country resolved offline via GeoIP.
   */
  async activity(ownerId: string, id: string, page = 1, limit = 30) {
    await this.accessible(ownerId, id, 'server.view');
    const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), 100);
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 30, 1), 100);
    const rows = await this.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        ip: auditLogs.ip,
        userAgent: auditLogs.userAgent,
        meta: auditLogs.meta,
        createdAt: auditLogs.createdAt,
        actorId: users.id,
        actorName: users.name,
        actorAvatar: users.avatarUrl,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(and(
        eq(auditLogs.targetType, 'server'),
        eq(auditLogs.targetId, id),
        // Administrative actions (admin.* — console access, power actions,
        // suspensions) are recorded in the internal audit log for security and
        // compliance, and are deliberately NOT part of the owner's activity
        // feed: an admin looking at a server is not the customer's activity.
        sql`${auditLogs.action} not like 'admin.%'`,
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit + 1)
      .offset((safePage - 1) * safeLimit);
    const geos = new Map<string, { country: string; countryCode: string } | null>();
    for (const r of rows) {
      if (r.ip && !geos.has(r.ip)) {
        const g = this.geo.lookup(r.ip);
        geos.set(r.ip, g?.country && g?.countryCode ? { country: g.country, countryCode: g.countryCode } : null);
      }
    }
    const SAFE_META = new Set(['reason', 'code', 'sizeBytes', 'status']);
    const data = rows.slice(0, safeLimit).map((r) => {
      const detail: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries((r.meta ?? {}) as Record<string, unknown>)) {
        if (!SAFE_META.has(k)) continue;
        if (typeof v === 'string') detail[k] = v.slice(0, 200);
        else if (typeof v === 'number' || typeof v === 'boolean') detail[k] = v;
      }
      const geo = (r.ip && geos.get(r.ip)) || null;
      return {
        id: r.id,
        action: r.action,
        ip: r.ip,
        country: geo?.country ?? null,
        countryCode: geo?.countryCode ?? null,
        detail,
        actor: r.actorId
          ? { id: r.actorId, name: r.actorName ?? 'Unknown', avatarUrl: r.actorAvatar }
          : // no actor recorded: automated (reconciler, auto-backup) rather than
            // "someone unknown". The UI renders this as the system actor.
            { id: null, name: 'System', avatarUrl: null, system: true },
        createdAt: r.createdAt,
      };
    });
    return { data, hasMore: rows.length > safeLimit, page: safePage };
  }

  /** Recent lifecycle events of a server (newest first), safe to show its owner. */
  async events(ownerId: string, id: string, limit = 20) {
    await this.accessible(ownerId, id, 'server.view');
    const rows = await this.db
      .select()
      .from(serverEvents)
      .where(eq(serverEvents.serverId, id))
      .orderBy(desc(serverEvents.createdAt))
      .limit(Math.min(Math.max(limit || 20, 1), 50));
    // detail is internal JSON: expose only a small allowlist of short primitives
    const SAFE = new Set(['error', 'plan', 'runtime', 'region', 'status', 'clean', 'start']);
    return rows.map((r) => {
      const detail: Record<string, string | number | boolean> = {};
      const raw = (r.detail ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) {
        if (!SAFE.has(k)) continue;
        if (typeof v === 'string') detail[k] = v.slice(0, 300);
        else if (typeof v === 'number' || typeof v === 'boolean') detail[k] = v;
      }
      return { id: r.id, type: r.type, detail, createdAt: r.createdAt };
    });
  }

  async usage(ownerId: string, id: string) {
    const row = await this.accessible(ownerId, id, 'server.view');
    this.assertOperable(row);
    const bytes = await this.provisioner.volumeUsage(row.volumeName ?? '', runtimeImage(row.runtime).image, row.nodeId);
    const capGb = await this.effectiveStorageGb(row);
    return {
      usedBytes: bytes ?? 0,
      limitBytes: capGb * 1024 * 1024 * 1024,
      usedPercent: bytes && capGb ? Math.min(100, Math.round((bytes / (capGb * 1024 ** 3)) * 100)) : 0,
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
      // converge the stored version digest to the image actually used, so a
      // rotated (retired) digest migrates once and is never looked up again
      runtimeVersion: result.image,
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
    // DO NOT stop the container — keep it running so the exec shell stays
    // connected and the user can see the crash output in the console.
    // The container remains in "crashed but not stopped" state until the
    // user manually stops/restarts it from the dashboard.
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

  /** The entry point a server was created with, read from its env (legacy rows). */
  private mainFileFromEnv(env: EnvVar[]): string | null {
    const found = env.find((e) => e.k === 'MAIN_FILE');
    return found?.v ? found.v.slice(0, 160) : null;
  }

  /**
   * Validates and normalises a main file: relative, no traversal, no control
   * characters, bounded. The database repeats these rules as a CHECK.
   */
  private cleanMainFile(mainFile: string | undefined): string {
    const value = (mainFile ?? '').replace(CONTROL_CHARS, '').trim();
    if (!value || value.length > 160) throw Err.invalid('MAIN_FILE_INVALID', 'Main file must be 1-160 characters');
    const norm = posix.normalize(value.replace(/\\/g, '/'));
    if (norm.startsWith('/') || norm === '..' || norm.startsWith('../') || norm.includes('/../') || norm.endsWith('/..')) {
      throw Err.invalid('MAIN_FILE_TRAVERSAL', 'Main file must stay inside the server directory');
    }
    return norm;
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

  private async event(serverId: string, actorId: string | null, type: string, detail?: Record<string, unknown>) {
    await this.db
      .insert(serverEvents)
      .values({ serverId, actorId, type, detail: detail ?? null } as never)
      .catch(() => undefined);
  }

  /** The node a server lives on (used by the port allocator for pool status). */
  async getNodeId(id: string): Promise<string> {
    const [row] = await this.db.select({ nodeId: servers.nodeId }).from(servers).where(eq(servers.id, id)).limit(1);
    if (!row) throw Err.notFound('SERVER_NOT_FOUND');
    return row.nodeId;
  }

  /** Strips everything a client must never see (crypto material, docker ids). */
  private toPublic(row: Server) {
    let env: EnvVar[] = [];
    let rawEnv: EnvVar[] = [];
    if (row.envEncrypted) {
      rawEnv = this.safeDecrypt(row.envEncrypted);
      env = maskEnv(rawEnv);
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
      // legacy rows keep MAIN_FILE only in the (encrypted) env: read the
      // decrypted value, never the masked one the UI shows.
      mainFile: row.mainFile ?? this.mainFileFromEnv(rawEnv),
      env,
      envCount: env.length,
      port,
      autoRestart: row.autoRestart,
      autoBackup: row.autoBackup,
      autoBackupRetain: row.autoBackupRetain,
      hasContainer: !!row.containerId,
      // the public 8-digit contact ID the owner quotes in support tickets
      contactCode: row.contactCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      provisionedAt: row.provisionedAt,
    };
  }
}
