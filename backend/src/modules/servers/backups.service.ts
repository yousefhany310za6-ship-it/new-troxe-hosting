import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, rm, stat } from 'fs/promises';
import path from 'path';
import { and, desc, eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { AppError, Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { backups, plans, servers, type Server } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { DockerService } from './provisioning/docker.service';
import { ServersService } from './servers.service';

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
    private serversSvc: ServersService,
    private audit: AuditService,
  ) {}

  private dirFor(ownerId: string, serverId: string): string {
    return path.resolve(config.BACKUP_DIR, ownerId, serverId);
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

    const existing = await this.db.select({ id: backups.id }).from(backups).where(eq(backups.serverId, serverId));
    if (slots <= 0)
      throw Err.quota('QUOTA_BACKUPS', 'Your plan does not include backup slots. Upgrade to keep backups.');
    if (existing.length >= slots)
      throw Err.quota('QUOTA_BACKUPS', `Your plan allows ${slots} backup(s). Delete one to make room.`);

    if (!this.docker.available)
      throw new AppError('DOCKER_UNAVAILABLE', 503, 'Container runtime is not available');

    const id = randomUUID();
    const dir = this.dirFor(ownerId, serverId);
    const file = this.fileFor(ownerId, serverId, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });

    const [row] = await this.db
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

    try {
      await this.docker.ensureImage(config.HELPER_IMAGE);
      const res = await this.docker.runHelper({
        image: config.HELPER_IMAGE,
        cmd: [`tar -czf /backup/${id}.tar.gz -C /data . 2>/tmp/err || { cat /tmp/err >&2; exit 1; }`],
        binds: [`${server.volumeName}:/data:ro`, `${dir}:/backup`],
        user: '0:0',
        timeoutMs: 120_000,
        memoryMb: 512,
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
      await this.db.update(backups).set({ status: 'failed', error: message }).where(eq(backups.id, id));
      await rm(file, { force: true }).catch(() => undefined);
      throw new AppError('BACKUP_FAILED', 502, `Backup failed: ${message}`);
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

  /** Restore stops the sandbox, unpacks the archive and leaves it stopped. */
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

    if (server.containerId) await this.docker.stop(server.containerId);

    await this.docker.ensureImage(config.HELPER_IMAGE);
    const res = await this.docker.runHelper({
      image: config.HELPER_IMAGE,
      cmd: [`tar -xzf /backup/${path.basename(row.storageKey)} -C /data && chown -R 1000:1000 /data && chmod 750 /data`],
      binds: [`${server.volumeName}:/data`, `${path.dirname(row.storageKey)}:/backup:ro`],
      user: '0:0',
      timeoutMs: 120_000,
      memoryMb: 512,
    });
    if (res.code !== 0) throw new AppError('RESTORE_FAILED', 502, `Restore failed: ${res.out.slice(0, 300)}`);

    await this.audit.record({
      actorId: ownerId,
      action: 'server.backup.restore',
      targetType: 'server',
      targetId: serverId,
      ip: ctx?.ip,
      meta: { backupId },
    });
    return { ok: true, status: 'offline' };
  }

  private async backupSlots(server: Server): Promise<number> {
    if (!server.planId) return 0;
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, server.planId)).limit(1);
    return plan?.maxBackupSlots ?? 0;
  }

  /** One auto-backup per day (called by the reconciler). */
  async createAutoIfDue(): Promise<void> {
    const [last] = await this.db
      .select({ at: backups.createdAt })
      .from(backups)
      .where(eq(backups.type, 'auto'))
      .orderBy(desc(backups.createdAt))
      .limit(1);
    if (last && Date.now() - last.at.getTime() < 24 * 3600 * 1000) return;

    const rows = await this.db
      .select({ id: servers.id, ownerId: servers.ownerId })
      .from(servers)
      .where(eq(servers.autoBackup, true))
      .limit(50);

    for (const s of rows) {
      try {
        await this.create(s.ownerId, s.id, { type: 'auto' });
      } catch (e) {
        const code = e instanceof AppError ? (e.getResponse() as { code?: string }).code : undefined;
        // quota exhaustion is expected — not an error worth waking anyone up
        if (code !== 'QUOTA_BACKUPS') this.log.warn(`auto backup skipped for ${s.id}: ${(e as Error).message}`);
      }
    }
  }
}
