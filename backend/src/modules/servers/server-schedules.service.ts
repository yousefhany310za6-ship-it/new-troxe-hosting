import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, lte } from 'drizzle-orm';
import { Err } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { auditLogs, serverEvents, serverSchedules, servers } from '../../db/schema';
import { BackupsService } from './backups.service';
import { nextRuns, parseCron } from './cron';
import { ServersService } from './servers.service';
import { ServerAccessService } from './server-access.service';

export type ScheduleAction = 'backup' | 'start' | 'stop' | 'restart';

/** A schedule never fires more than this far behind (no catch-up storms). */
const MAX_LATENESS_MS = 10 * 60_000;
/** At most this many schedules per tick (fleet safety, like the reconciler). */
const TICK_LIMIT = 20;

/**
 * Cron-driven tasks. Owners and holders of `schedule.manage` create them;
 * anyone with `server.view` reads them. Execution is attributed to the
 * platform (actor null, meta.scheduleId) — never to the owner — so the
 * activity feed honestly shows automation as automation.
 */
@Injectable()
export class ServerSchedulesService {
  private readonly log = new Logger(ServerSchedulesService.name);

  constructor(
    @Inject(DB) private db: Db,
    private access: ServerAccessService,
    private servers: ServersService,
    private backups: BackupsService,
  ) {}

  // ------------------------------------------------------------- manage

  async list(serverId: string, callerId: string) {
    const access = await this.access.resolve(serverId, callerId);
    this.access.requirePermission(access, 'server.view');
    const rows = await this.db
      .select()
      .from(serverSchedules)
      .where(eq(serverSchedules.serverId, serverId))
      .orderBy(serverSchedules.createdAt);
    return rows.map((r) => this.view(r));
  }

  async create(serverId: string, callerId: string, dto: { name: string; cron: string; action: ScheduleAction; enabled?: boolean }, ctx: ReqCtx) {
    const access = await this.access.resolve(serverId, callerId);
    this.access.requirePermission(access, 'schedule.manage');
    const cron = this.cleanCron(dto.cron);
    const now = new Date();
    const [row] = await this.db
      .insert(serverSchedules)
      .values({
        serverId,
        name: dto.name.trim().slice(0, 64),
        cron,
        action: dto.action,
        enabled: dto.enabled ?? true,
        createdBy: callerId,
        nextRunAt: nextRuns(cron, now, 1)[0] ?? null,
        updatedAt: now,
      })
      .returning();
    await this.journal(serverId, callerId, 'schedule_create', { scheduleId: row.id, cron, action: dto.action }, ctx);
    return this.view(row);
  }

  async update(serverId: string, callerId: string, scheduleId: string, dto: { name?: string; cron?: string; action?: ScheduleAction; enabled?: boolean }, ctx: ReqCtx) {
    const access = await this.access.resolve(serverId, callerId);
    this.access.requirePermission(access, 'schedule.manage');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim().slice(0, 64);
    if (dto.action !== undefined) patch.action = dto.action;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.cron !== undefined) {
      const cron = this.cleanCron(dto.cron);
      patch.cron = cron;
      patch.nextRunAt = nextRuns(cron, new Date(), 1)[0] ?? null;
      patch.lastRunAt = null;
      patch.lastStatus = null;
      patch.lastError = null;
    }
    const [row] = await this.db
      .update(serverSchedules)
      .set(patch)
      .where(and(eq(serverSchedules.id, scheduleId), eq(serverSchedules.serverId, serverId)))
      .returning();
    if (!row) throw Err.notFound('SCHEDULE_NOT_FOUND');
    await this.journal(serverId, callerId, 'schedule_update', { scheduleId, ...patch, nextRunAt: undefined }, ctx);
    return this.view(row);
  }

  async remove(serverId: string, callerId: string, scheduleId: string, ctx: ReqCtx) {
    const access = await this.access.resolve(serverId, callerId);
    this.access.requirePermission(access, 'schedule.manage');
    const [row] = await this.db
      .delete(serverSchedules)
      .where(and(eq(serverSchedules.id, scheduleId), eq(serverSchedules.serverId, serverId)))
      .returning({ id: serverSchedules.id });
    if (!row) throw Err.notFound('SCHEDULE_NOT_FOUND');
    await this.journal(serverId, callerId, 'schedule_delete', { scheduleId }, ctx);
    return { ok: true };
  }

  /** Next fire times for an expression (used by the form preview). */
  async preview(serverId: string, callerId: string, cron: string, count = 5) {
    const access = await this.access.resolve(serverId, callerId);
    this.access.requirePermission(access, 'server.view');
    const clean = this.cleanCron(cron);
    return { cron: clean, runs: nextRuns(clean, new Date(), Math.min(Math.max(count, 1), 10)) };
  }

  private cleanCron(cron: string): string {
    const value = (cron ?? '').trim().replace(/\s+/g, ' ');
    try {
      parseCron(value);
    } catch (e) {
      throw Err.invalid('CRON_INVALID', (e as Error).message);
    }
    return value;
  }

  private view(r: typeof serverSchedules.$inferSelect) {
    return {
      id: r.id,
      name: r.name,
      cron: r.cron,
      action: r.action,
      enabled: r.enabled,
      lastRunAt: r.lastRunAt,
      lastStatus: r.lastStatus,
      lastError: r.lastError,
      nextRunAt: r.nextRunAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private async journal(serverId: string, actorId: string | null, type: string, detail: Record<string, unknown>, ctx: ReqCtx) {
    await this.db.insert(serverEvents).values({ serverId, actorId, type, detail }).catch(() => undefined);
    await this.db
      .insert(auditLogs)
      .values({
        actorId,
        action: `server.${type}`,
        targetType: 'server',
        targetId: serverId,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: detail,
      } as never)
      .catch(() => undefined);
  }

  // ------------------------------------------------------------- runner

  /**
   * Fire every due schedule once. Single-flight per process (the deployment
   * runs one API instance; a second instance would need a DB advisory lock —
   * documented, not pretended).
   *
   * A schedule more than MAX_LATENESS_MS overdue still runs exactly once and
   * is then rescheduled from NOW, so downtime never causes a catch-up storm.
   * nextRunAt is always recomputed from the actual fire time, never by
   * stepping the old value (clock jumps can't pile up runs).
   */
  async tick(now = new Date()): Promise<{ fired: number; errors: number }> {
    const due = await this.db
      .select()
      .from(serverSchedules)
      .where(and(eq(serverSchedules.enabled, true), lte(serverSchedules.nextRunAt, now)))
      .orderBy(serverSchedules.nextRunAt)
      .limit(TICK_LIMIT);
    let fired = 0;
    let errors = 0;
    for (const s of due) {
      try {
        await this.fire(s, now);
        fired++;
      } catch (e) {
        errors++;
        this.log.warn(`schedule ${s.id} failed: ${(e as Error).message}`);
      }
    }
    return { fired, errors };
  }

  private async fire(s: typeof serverSchedules.$inferSelect, now: Date) {
    const [server] = await this.db.select().from(servers).where(eq(servers.id, s.serverId)).limit(1);
    const finish = async (status: 'ok' | 'failed' | 'skipped', error?: string) => {
      const next = nextRuns(s.cron, now, 1)[0] ?? null;
      await this.db
        .update(serverSchedules)
        .set({ lastRunAt: now, lastStatus: status, lastError: error?.slice(0, 500) ?? null, nextRunAt: next, updatedAt: new Date() })
        .where(eq(serverSchedules.id, s.id));
    };
    if (!server || server.status === 'suspended' || server.status === 'deleting') {
      await finish('skipped', !server ? 'server deleted' : `server ${server.status}`);
      return;
    }
    const late = now.getTime() - (s.nextRunAt?.getTime() ?? now.getTime()) > MAX_LATENESS_MS;
    const sys = { ip: 'scheduler', device: 'scheduler' };
    try {
      if (s.action === 'backup') {
        await this.backups.create(server.ownerId, server.id, { type: 'auto' }, sys, { scheduleId: s.id });
      } else {
        // power actions respect the live state: start only when stopped,
        // stop/restart only when running — never a blind toggle.
        const running = server.status === 'online';
        if (s.action === 'start' && running) {
          await finish('skipped', 'already running');
          return;
        }
        if ((s.action === 'stop' || s.action === 'restart') && !running) {
          await finish('skipped', `server is ${server.status}`);
          return;
        }
        await this.servers.lifecycle(server.ownerId, server.id, s.action, sys, { scheduleId: s.id });
      }
      await finish('ok');
      await this.journal(server.id, null, 'schedule_run', { scheduleId: s.id, action: s.action, late }, { ip: 'scheduler', device: 'scheduler' });
    } catch (e) {
      await finish('failed', (e as Error).message);
      throw e;
    }
  }
}

