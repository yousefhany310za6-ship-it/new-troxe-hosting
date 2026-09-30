import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, rm, stat } from 'fs/promises';
import path from 'path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { config } from '../../config/env';
import { AppError, Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { backups, plans, servers, users, type Server } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { DockerService } from './provisioning/docker.service';
import { ProvisionerService } from './provisioning/provisioner.service';
import { runtimeImage } from './provisioning/images';
import { ServersService } from './servers.service';
import { backupDirFor } from './backup-paths';

/**
 * Volume backups: a `tar.gz` of the sandbox's /data, produced by a
 * network-less helper container and stored outside Docker's control.
 *
 * File names are server-generated UUIDs (never client input), and every path
 * is anchored under BACKUP_DIR/<ownerId>/<serverId>/ — traversal is
 * structurally impossible.
 */
@Injectable()
export class BackupsService {
  private readonly log = new Logger(BackupsService.name);

  constructor(
    @Inject(DB) private db: Db,
    private docker: DockerService,
    private provisioner: ProvisionerService,
    private serversSvc: ServersService,
    private audit: AuditService,
  ) {}

  private dirFor(ownerId: string, serverId: string): string {
    return backupDirFor(ownerId, serverId);
  }

  /**
   * Defense in depth: storageKey/dir come from OUR rows (parameterized
   * queries), but a corrupted/migrated row must never turn into an
   * arbitrary host delete or container bind. Assert containment under
   * BACKUP_DIR/<owner>/<server>/ before any rm/mount.
   */
  private assertContained(ownerId: string, serverId: string, p: string, what: string): void {
    const base = backupDirFor(ownerId, serverId) + path.sep;
    const resolved = path.resolve(p);
    if (resolved !== base.slice(0, -1) && !resolved.startsWith(base))
      throw Err.invalid('BACKUP_PATH', `${what} is outside backup storage`);
  }

  private fileFor(ownerId: string, serverId: string, backupId: string): string {
    return path.join(this.dirFor(ownerId, serverId), `${backupId}.tar.gz`);
  }

  async list(ownerId: string, serverId: string) {
    await this.serversSvc.requireOwned(ownerId, serverId);
    const rows = await this.db
      .select()
      .from(backups)
      .where(eq(backups.serverId, serverId))
      .orderBy(desc(backups.createdAt))
      .limit(100);
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      sizeBytes: b.sizeBytes,
      status: b.status,
      type: b.type,
      error: b.error,
      createdAt: b.createdAt,
    }));
  }

  async create(ownerId: string, serverId: string, opts: { name?: string; type?: 'manual' | 'auto' }, ctx?: ReqCtx) {
    const server = await this.serversSvc.requireOwned(ownerId, serverId);
    const slots = await this.backupSlots(server);

    if (!this.docker.available)
      throw new AppError('DOCKER_UNAVAILABLE', 503, 'Container runtime is not available');

    // slot count + space cap + insert are ONE transaction holding a row lock
    // on the server: concurrent creates cannot both pass the checks (TOCTOU).
    // The tar run stays outside (saga: failed rows are marked, files rm'd).
    const id = randomUUID();
    const dir = this.dirFor(ownerId, serverId);
    const file = this.fileFor(ownerId, serverId, id);
    const [row] = await this.db.transaction(async (tx) => {
      const locked = await tx.select({ id: servers.id }).from(servers).where(eq(servers.id, serverId)).for('update').limit(1);
      if (!locked.length) throw Err.notFound('SERVER_NOT_FOUND');

      const existing = await tx.select({ id: backups.id }).from(backups).where(eq(backups.serverId, serverId));
      if (slots <= 0)
        throw Err.quota('QUOTA_BACKUPS', 'Your plan does not include backup slots. Upgrade to keep backups.');
      if (existing.length >= slots)
        throw Err.quota('QUOTA_BACKUPS', `Your plan allows ${slots} backup(s). Delete one to make room.`);

      // total backup bytes per owner — BACKUP_MAX_TOTAL_MB is a real cap, not
      // a display value: reject before spending a helper run + disk on tar.
      const ownedIds = (await tx.select({ id: servers.id }).from(servers).where(eq(servers.ownerId, ownerId))).map(
        (r) => r.id,
      );
      if (ownedIds.length) {
        const sizes = await tx
          .select({ sizeBytes: backups.sizeBytes })
          .from(backups)
          .where(inArray(backups.serverId, ownedIds));
        const usedBytes = sizes.reduce((acc, r) => acc + (r.sizeBytes ?? 0), 0);
        if (usedBytes >= config.BACKUP_MAX_TOTAL_MB * 1024 * 1024)
          throw Err.quota(
            'QUOTA_BACKUP_SPACE',
            `Backup storage is full (${config.BACKUP_MAX_TOTAL_MB} MB). Delete old backups to make room.`,
          );
      }

      return tx
        .insert(backups)
        .values({
          id,
          serverId,
          name: (opts.name ?? `backup-${new Date().toISOString().slice(0, 19)}`).replace(/[^\w. -]/g, '').slice(0, 128),
          storageKey: file,
          status: 'pending',
          type: opts.type ?? 'manual',
        } as never)
        .returning();
    });
    await mkdir(dir, { recursive: true, mode: 0o700 });

    try {
      await this.docker.ensureImage(config.HELPER_IMAGE);
      const res = await this.docker.runHelper({
        image: config.HELPER_IMAGE,
        cmd: [`tar -czf /backup/${id}.tar.gz -C /data . 2>/tmp/err || { cat /tmp/err >&2; exit 1; }`],
        binds: [`${server.volumeName}:/data:ro`, `${dir}:/backup`],
        user: '0:0',
        timeoutMs: 120_000,
        memoryMb: 512,
        captureLogs: true, // failure diagnostics come from out
      });
      if (res.code !== 0) throw new Error(res.out.slice(0, 300) || `tar exited ${res.code}`);

      const size = (await stat(file)).size;
      await this.db.update(backups).set({ sizeBytes: size, status: 'ready' }).where(eq(backups.id, id));
      await this.audit.record({
        actorId: ownerId,
        action: 'server.backup.create',
        targetType: 'server',
        targetId: serverId,
        ip: ctx?.ip,
        meta: { backupId: id, sizeBytes: size },
      });
      this.log.log(`backup ${id} for server ${serverId} (${size} bytes)`);
      return { id, name: row.name, sizeBytes: size, status: 'ready', createdAt: row.createdAt };
    } catch (e) {
      const message = (e as Error).message.slice(0, 500);
      this.log.warn(`backup ${id} for server ${serverId} failed: ${message}`);
      await this.db.update(backups).set({ status: 'failed', error: 'Backup failed' }).where(eq(backups.id, id));
      await rm(file, { force: true }).catch(() => undefined);
      throw new AppError('BACKUP_FAILED', 502, 'Backup failed');
    }
  }

  async remove(ownerId: string, serverId: string, backupId: string, ctx?: ReqCtx) {
    await this.serversSvc.requireOwned(ownerId, serverId);
    const [row] = await this.db
      .select()
      .from(backups)
      .where(and(eq(backups.id, backupId), eq(backups.serverId, serverId)))
      .limit(1);
    if (!row) throw Err.notFound('BACKUP_NOT_FOUND');

    this.assertContained(ownerId, serverId, row.storageKey, 'backup archive');
    await rm(row.storageKey, { force: true }).catch(() => undefined);
    await this.db.delete(backups).where(eq(backups.id, backupId));
    await this.audit.record({
      actorId: ownerId,
      action: 'server.backup.delete',
      targetType: 'server',
      targetId: serverId,
      ip: ctx?.ip,
      meta: { backupId },
    });
    return { ok: true };
  }

  /**
   * Restore stops the sandbox, unpacks the archive and restores the prior
   * running state. Guardrails (all learned from incident-class bugs):
   *  - runs inside the per-server lock: no lifecycle/update can interleave
   *  - best-effort pre-restore safety backup (rollback net for a bad archive)
   *  - storage check: archive size + current usage must fit the plan cap
   *  - tar runs `--no-same-owner --no-same-permissions` and every symlink is
   *    purged after unpack (a hostile archive's `x -> /etc` + `x/passwd`
   *    would otherwise write outside /data as root)
   *  - prior online state is restored (was: always left offline + DB drift)
   */
  async restore(ownerId: string, serverId: string, backupId: string, ctx?: ReqCtx) {
    const server = await this.serversSvc.requireOwned(ownerId, serverId);
    const [row] = await this.db
      .select()
      .from(backups)
      .where(and(eq(backups.id, backupId), eq(backups.serverId, serverId)))
      .limit(1);
    if (!row) throw Err.notFound('BACKUP_NOT_FOUND');
    if (row.status !== 'ready') throw Err.invalid('BACKUP_NOT_READY', 'Backup is not ready');
    if (!this.docker.available) throw new AppError('DOCKER_UNAVAILABLE', 503, 'Container runtime is not available');
    this.assertContained(ownerId, serverId, path.dirname(row.storageKey), 'backup directory');

    const release = await this.serversSvc.acquire(serverId);
    try {
      const wasOnline = server.containerId
        ? (await this.docker.inspect(server.containerId).catch(() => null))?.running ?? false
        : false;

      // safety net first (best effort: quota-full accounts still restore)
      let safetyBackupId: string | null = null;
      try {
        const existing = await this.db.select({ id: backups.id }).from(backups).where(eq(backups.serverId, serverId));
        if ((await this.backupSlots(server)) > existing.length) {
          const sb = await this.create(ownerId, serverId, { name: `pre-restore-${new Date().toISOString().slice(0, 19)}` });
          safetyBackupId = sb.id;
        }
      } catch {
        safetyBackupId = null;
      }

      // storage check: current usage + archive bytes must fit the plan cap
      const used = await this.provisioner.volumeUsage(server.volumeName ?? '', runtimeImage(server.runtime).image);
      const cap = server.storageGb * 1024 ** 3;
      if (used !== null && used + (row.sizeBytes ?? 0) > cap)
        throw Err.quota('QUOTA_STORAGE', 'Not enough storage headroom to unpack this backup. Free space or upgrade.');

      if (server.containerId) await this.docker.stop(server.containerId);

      await this.docker.ensureImage(config.HELPER_IMAGE);
      const res = await this.docker.runHelper({
        image: config.HELPER_IMAGE,
        cmd: [
          [
            'set -e',
            `tar --no-same-owner --no-same-permissions -xzf /backup/${path.basename(row.storageKey)} -C /data`,
            'SYMS=$(find /data -type l | wc -l)',
            'if [ "$SYMS" -gt 0 ]; then find /data -type l -delete; fi',
            'echo "symlinks_removed=$SYMS"',
            'chown -R 1000:1000 /data && chmod 750 /data',
          ].join('\n'),
        ],
        binds: [`${server.volumeName}:/data`, `${path.dirname(row.storageKey)}:/backup:ro`],
        user: '0:0',
        timeoutMs: 120_000,
        memoryMb: 512,
        captureLogs: true, // symlinks_removed count + failure diagnostics
      });
      if (res.code !== 0) {
        await this.serversSvc.setStatus(serverId, { status: 'error', lastError: 'Restore failed — data may be partial' });
        this.log.warn(`restore ${backupId} for server ${serverId} failed: ${res.out.slice(0, 300)}`);
        throw new AppError('RESTORE_FAILED', 502, 'Restore failed');
      }
      const symlinksRemoved = Number(/symlinks_removed=(\d+)/.exec(res.out)?.[1] ?? 0);

      let status: 'online' | 'offline' = 'offline';
      if (wasOnline && server.containerId) {
        await this.docker.start(server.containerId).catch(() => undefined);
        const state = await this.docker.inspect(server.containerId).catch(() => null);
        status = state?.running ? 'online' : 'offline';
      }
      await this.serversSvc.setStatus(serverId, { status, lastError: null });

      await this.audit.record({
        actorId: ownerId,
        action: 'server.backup.restore',
        targetType: 'server',
        targetId: serverId,
        ip: ctx?.ip,
        meta: { backupId, wasOnline, status, safetyBackupId, symlinksRemoved },
      });
      return { ok: true, status, safetyBackupId, symlinksRemoved };
    } finally {
      release();
    }
  }

  /**
   * Backup slots come from the owner's LIVE account plan — same source as
   * server creation. The snapshot `servers.plan_id` records provisioned
   * resources (display), but authorization must follow the account: otherwise
   * a downgraded user keeps pro backup slots on old servers forever.
   */
  private async backupSlots(server: Server): Promise<number> {
    const [owner] = await this.db
      .select({ planId: users.planId })
      .from(users)
      .where(eq(users.id, server.ownerId))
      .limit(1);
    if (!owner?.planId) return 0;
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, owner.planId)).limit(1);
    return plan?.maxBackupSlots ?? 0;
  }

  /**
   * One auto-backup per server per day (called by the reconciler).
   * Due-ness is evaluated PER SERVER (last auto backup of that server):
   * the old global "any auto backup in 24h" check starved every server
   * but one. Deterministic oldest-first order, bounded per tick.
   */
  async createAutoIfDue(): Promise<void> {
    const rows = await this.db
      .select({ id: servers.id, ownerId: servers.ownerId, createdAt: servers.createdAt })
      .from(servers)
      .where(eq(servers.autoBackup, true))
      .orderBy(servers.createdAt)
      .limit(200);

    for (const s of rows) {
      try {
        const [last] = await this.db
          .select({ at: backups.createdAt })
          .from(backups)
          .where(and(eq(backups.serverId, s.id), eq(backups.type, 'auto')))
          .orderBy(desc(backups.createdAt))
          .limit(1);
        if (last && Date.now() - last.at.getTime() < 24 * 3600 * 1000) continue;
        await this.create(s.ownerId, s.id, { type: 'auto' });
      } catch (e) {
        const code = e instanceof AppError ? (e.getResponse() as { code?: string }).code : undefined;
        // quota exhaustion is expected — not an error worth waking anyone up
        if (code !== 'QUOTA_BACKUPS' && code !== 'QUOTA_BACKUP_SPACE')
          this.log.warn(`auto backup skipped for ${s.id}: ${(e as Error).message}`);
      }
    }
  }
}
