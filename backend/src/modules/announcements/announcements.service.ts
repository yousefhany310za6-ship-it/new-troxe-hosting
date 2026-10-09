import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { AppError, Err } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { announcementInteractions, announcements, plans, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import {
  MATERIAL_FIELDS,
  audienceMatches,
  canDismiss,
  isActive,
  isValidActionUrl,
  shouldShow,
  type AnnouncementAudience,
} from './announcement-policy';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto';

type Row = typeof announcements.$inferSelect;

/** Fields the USER api may ever see — never name/audience internals/createdBy. */
function publicView(r: Row) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    policy: r.policy,
    requireAck: r.requireAck,
    intervalHours: r.intervalHours,
    actionLabel: r.actionLabel,
    actionUrl: r.actionUrl,
    eventStart: r.eventStart,
    eventEnd: r.eventEnd,
    publishAt: r.publishAt,
    expiresAt: r.expiresAt,
    contentVersion: r.contentVersion,
  };
}

const sameTime = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

@Injectable()
export class AnnouncementsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AnnouncementsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private db: Db,
    private audit: AuditService,
  ) {}

  onModuleInit() {
    // Promote due `scheduled` rows to `published` (single-instance tick, same
    // pattern as the servers reconciler). <=60s after publishAt, never before.
    this.timer = setInterval(() => void this.promoteDue().catch((e) => this.log.warn(`promoteDue: ${e}`)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------ internals

  private async getRow(id: string): Promise<Row> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    if (!row) throw Err.notFound('ANNOUNCEMENT_NOT_FOUND');
    return row;
  }

  private async checkAudience(audience: AnnouncementAudience | undefined): Promise<AnnouncementAudience> {
    const a = audience ?? { type: 'all' as const };
    if (a.type === 'plans') {
      const ids = [...new Set(a.plans ?? [])];
      if (!ids.length) throw Err.invalid('AUDIENCE_EMPTY', 'Plans audience needs at least one plan');
      const rows = await this.db.select({ id: plans.id }).from(plans).where(inArray(plans.id, ids));
      if (rows.length !== ids.length) throw Err.invalid('AUDIENCE_PLAN_UNKNOWN', 'Unknown plan in audience');
      return { type: 'plans', plans: ids };
    }
    if (a.type === 'users') {
      const ids = [...new Set(a.userIds ?? [])];
      if (!ids.length) throw Err.invalid('AUDIENCE_EMPTY', 'Users audience needs at least one user');
      const rows = await this.db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
      if (rows.length !== ids.length) throw Err.invalid('AUDIENCE_USER_UNKNOWN', 'Unknown user in audience');
      return { type: 'users', userIds: ids };
    }
    return { type: 'all' };
  }

  private checkWindow(publishAt?: Date | null, expiresAt?: Date | null) {
    if (publishAt && expiresAt && publishAt.getTime() >= expiresAt.getTime()) {
      throw Err.invalid('WINDOW_INVALID', 'publishAt must be before expiresAt');
    }
  }

  private checkActionUrl(url?: string | null) {
    if (url != null && !isValidActionUrl(url)) {
      throw Err.invalid('ACTION_URL_INVALID', 'Action URL must be a site path or http(s) URL');
    }
  }

  private eligibleWhere(audience: AnnouncementAudience) {
    const conds = [eq(users.status, 'active')];
    if (audience.type === 'plans') conds.push(inArray(users.planId, audience.plans ?? []));
    if (audience.type === 'users') conds.push(inArray(users.id, audience.userIds ?? []));
    return and(...conds);
  }

  // ---------------------------------------------------------------- admin

  async listAdmin(page = 1, limit = 20, status?: string) {
    const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), 1000);
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);
    const where = status === 'active'
      ? eq(announcements.status, 'published')
      : status
        ? eq(announcements.status, status as Row['status'])
        : undefined;
    const rows = await this.db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(desc(announcements.updatedAt))
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit);
    const [{ n }] = await this.db.select({ n: count() }).from(announcements).where(where);
    return { items: rows, page: safePage, limit: safeLimit, total: n, pages: Math.max(1, Math.ceil(n / safeLimit)) };
  }

  async getAdmin(id: string) {
    const row = await this.getRow(id);
    const createdByEmail = row.createdBy
      ? (await this.db.select({ email: users.email }).from(users).where(eq(users.id, row.createdBy)).limit(1))[0]?.email ?? null
      : null;
    return { ...row, createdByEmail };
  }

  async create(dto: CreateAnnouncementDto, actorId: string, ctx: ReqCtx) {
    if (dto.policy === 'interval' && !dto.intervalHours) {
      throw Err.invalid('INTERVAL_REQUIRED', 'intervalHours is required for the interval policy');
    }
    this.checkWindow(dto.publishAt, dto.expiresAt);
    this.checkActionUrl(dto.actionUrl);
    const audience = await this.checkAudience(dto.audience);
    if (dto.eventStart && dto.eventEnd && dto.eventStart.getTime() >= dto.eventEnd.getTime()) {
      throw Err.invalid('EVENT_WINDOW_INVALID', 'eventStart must be before eventEnd');
    }
    const [row] = await this.db
      .insert(announcements)
      .values({
        name: dto.name.trim(),
        title: dto.title.trim(),
        body: dto.body,
        kind: dto.kind ?? 'info',
        status: 'draft',
        policy: dto.policy ?? 'once',
        requireAck: dto.requireAck ?? false,
        intervalHours: dto.intervalHours ?? null,
        audience,
        actionLabel: dto.actionLabel?.trim() || null,
        actionUrl: dto.actionUrl?.trim() || null,
        eventStart: dto.eventStart ?? null,
        eventEnd: dto.eventEnd ?? null,
        publishAt: dto.publishAt ?? null,
        expiresAt: dto.expiresAt ?? null,
        createdBy: actorId,
      })
      .returning();
    await this.audit.record({
      actorId, action: 'admin.announcement.create', targetType: 'announcement', targetId: row.id,
      ip: ctx.ip, userAgent: ctx.device, meta: { name: row.name },
    });
    return row;
  }

  async update(id: string, dto: UpdateAnnouncementDto, actorId: string, ctx: ReqCtx) {
    const row = await this.getRow(id);
    if (row.status === 'archived') throw Err.invalid('ANNOUNCE_ARCHIVED', 'Archived announcements are read-only');
    if (dto.policy === 'interval' && !dto.intervalHours && !row.intervalHours) {
      throw Err.invalid('INTERVAL_REQUIRED', 'intervalHours is required for the interval policy');
    }
    const publishAt = dto.publishAt !== undefined ? dto.publishAt : row.publishAt;
    const expiresAt = dto.expiresAt !== undefined ? dto.expiresAt : row.expiresAt;
    this.checkWindow(publishAt ?? null, expiresAt ?? null);
    this.checkActionUrl(dto.actionUrl !== undefined ? dto.actionUrl : row.actionUrl);
    const audience = dto.audience !== undefined ? await this.checkAudience(dto.audience) : row.audience as AnnouncementAudience;
    const eventStart = dto.eventStart !== undefined ? dto.eventStart : row.eventStart;
    const eventEnd = dto.eventEnd !== undefined ? dto.eventEnd : row.eventEnd;
    if (eventStart && eventEnd && eventStart.getTime() >= eventEnd.getTime()) {
      throw Err.invalid('EVENT_WINDOW_INVALID', 'eventStart must be before eventEnd');
    }

    // Material edits bump the content version → the banner resurfaces per
    // policy. Admin-only edits (name/audience/timing/policy) never do.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    const setIf = (k: string, v: unknown) => { if (v !== undefined) patch[k] = v; };
    setIf('name', dto.name?.trim());
    setIf('title', dto.title?.trim());
    if (dto.body !== undefined) patch.body = dto.body;
    setIf('kind', dto.kind);
    setIf('policy', dto.policy);
    setIf('requireAck', dto.requireAck);
    setIf('intervalHours', dto.intervalHours ?? null);
    if (dto.audience !== undefined) patch.audience = audience;
    setIf('actionLabel', dto.actionLabel?.trim() || null);
    setIf('actionUrl', dto.actionUrl?.trim() || null);
    if (dto.eventStart !== undefined) patch.eventStart = dto.eventStart;
    if (dto.eventEnd !== undefined) patch.eventEnd = dto.eventEnd;
    if (dto.publishAt !== undefined) patch.publishAt = dto.publishAt;
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt;

    const materialChanged = MATERIAL_FIELDS.some((f) => {
      if (patch[f] === undefined) return false;
      const a = patch[f];
      const b = (row as Record<string, unknown>)[f];
      if (f === 'eventStart' || f === 'eventEnd') return !sameTime(a as Date | null, b as Date | null);
      return (a ?? null) !== (b ?? null);
    });
    const nextVersion = materialChanged ? row.contentVersion + 1 : row.contentVersion;
    patch.contentVersion = nextVersion;

    const [updated] = await this.db.update(announcements).set(patch).where(eq(announcements.id, id)).returning();

    // Enabling the mandate clears prior dismissals (acks are kept) so the
    // explicit-ack rule applies to everyone going forward.
    if (dto.requireAck === true && row.requireAck === false) {
      await this.db
        .update(announcementInteractions)
        .set({ dismissedAt: null, updatedAt: new Date() })
        .where(and(eq(announcementInteractions.announcementId, id), isNull(announcementInteractions.ackedAt)));
    }

    await this.audit.record({
      actorId, action: 'admin.announcement.update', targetType: 'announcement', targetId: id,
      ip: ctx.ip, userAgent: ctx.device,
      meta: { versionBump: materialChanged, contentVersion: nextVersion },
    });
    return updated;
  }

  private async transition(id: string, to: Row['status'], from: Row['status'][], actorId: string | null, ctx: ReqCtx, action: string) {
    const row = await this.getRow(id);
    if (!from.includes(row.status)) {
      throw Err.invalid('ANNOUNCE_BAD_TRANSITION', `Cannot move ${row.status} → ${to}`);
    }
    const patch: Record<string, unknown> = { status: to, updatedAt: new Date() };
    if (to === 'published') {
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
        throw Err.invalid('ANNOUNCE_EXPIRED', 'Cannot publish an already-expired announcement');
      }
      patch.publishedAt = new Date();
      if (!row.publishAt) patch.publishAt = new Date();
    }
    const [updated] = await this.db.update(announcements).set(patch).where(eq(announcements.id, id)).returning();
    await this.audit.record({
      actorId, action, targetType: 'announcement', targetId: id,
      ip: ctx.ip, userAgent: ctx.device, meta: { from: row.status, to },
    });
    return updated;
  }

  schedule(id: string, publishAt: Date, actorId: string, ctx: ReqCtx) {
    if (!(publishAt instanceof Date) || !Number.isFinite(publishAt.getTime()) || publishAt.getTime() <= Date.now()) {
      throw Err.invalid('SCHEDULE_INVALID', 'publishAt must be a future time');
    }
    return this.transition(id, 'scheduled', ['draft', 'paused'], actorId, ctx, 'admin.announcement.schedule')
      .then(async (row) => {
        const [updated] = await this.db.update(announcements).set({ publishAt, updatedAt: new Date() }).where(eq(announcements.id, id)).returning();
        return updated ?? row;
      });
  }

  publish(id: string, actorId: string, ctx: ReqCtx) {
    return this.transition(id, 'published', ['draft', 'scheduled', 'paused'], actorId, ctx, 'admin.announcement.publish');
  }

  pause(id: string, actorId: string, ctx: ReqCtx) {
    return this.transition(id, 'paused', ['published', 'scheduled'], actorId, ctx, 'admin.announcement.pause');
  }

  archive(id: string, actorId: string, ctx: ReqCtx) {
    return this.transition(id, 'archived', ['draft', 'scheduled', 'published', 'paused'], actorId, ctx, 'admin.announcement.archive');
  }

  async remove(id: string, actorId: string, ctx: ReqCtx) {
    const row = await this.getRow(id);
    // Published banners die loudly: pause/archive first so the removal is
    // deliberate, and past stats stay attached to an archived row instead.
    if (row.status === 'published') {
      throw Err.invalid('ANNOUNCE_MUST_PAUSE', 'Pause or archive a published announcement before deleting it');
    }
    await this.db.delete(announcements).where(eq(announcements.id, id));
    await this.audit.record({
      actorId, action: 'admin.announcement.delete', targetType: 'announcement', targetId: id,
      ip: ctx.ip, userAgent: ctx.device, meta: { name: row.name, status: row.status },
    });
    return { ok: true };
  }

  async stats(id: string) {
    const row = await this.getRow(id);
    const audience = row.audience as AnnouncementAudience;
    const [{ n: eligible }] = await this.db.select({ n: count() }).from(users).where(this.eligibleWhere(audience));
    const ix = await this.db
      .select()
      .from(announcementInteractions)
      .where(and(eq(announcementInteractions.announcementId, id), eq(announcementInteractions.version, row.contentVersion)));
    return {
      id: row.id,
      contentVersion: row.contentVersion,
      eligible,
      shown: ix.filter((r) => r.lastShownAt).length,
      acked: ix.filter((r) => r.ackedAt).length,
      dismissed: ix.filter((r) => r.dismissedAt).length,
    };
  }

  /** Promote due `scheduled` rows. Runs every 60s; never early. */
  async promoteDue(now: number = Date.now()) {
    const due = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(and(eq(announcements.status, 'scheduled'), lte(announcements.publishAt, new Date(now))));
    for (const d of due) {
      await this.db
        .update(announcements)
        .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(announcements.id, d.id), eq(announcements.status, 'scheduled')));
      await this.audit.record({
        action: 'admin.announcement.autopublish', targetType: 'announcement', targetId: d.id,
        meta: { at: new Date(now).toISOString() },
      });
    }
    return { promoted: due.length };
  }

  // ----------------------------------------------------------------- user

  async listForUser(userId: string) {
    const [u] = await this.db
      .select({ id: users.id, planId: users.planId, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    // Suspended/deleted accounts see nothing (defense in depth — the guard
    // normally rejects them first).
    if (!u || u.status !== 'active') return [];
    const now = Date.now();
    const rows = await this.db.select().from(announcements).where(eq(announcements.status, 'published'));
    if (!rows.length) return [];
    const ixRows = await this.db
      .select()
      .from(announcementInteractions)
      .where(and(eq(announcementInteractions.userId, userId), inArray(announcementInteractions.announcementId, rows.map((r) => r.id))));
    const ixById = new Map(ixRows.map((r) => [r.announcementId, r]));
    const me = { id: u.id, planId: u.planId };
    const out: (ReturnType<typeof publicView> & { interaction: { ackedAt: Date | null; dismissedAt: Date | null } | null })[] = [];
    for (const r of rows) {
      if (!audienceMatches(r.audience as AnnouncementAudience, me)) continue;
      const ix = ixById.get(r.id);
      const state = ix
        ? { version: ix.version, lastShownAt: ix.lastShownAt, ackedAt: ix.ackedAt, dismissedAt: ix.dismissedAt }
        : null;
      if (!shouldShow({ ...r, publishAt: r.publishAt, expiresAt: r.expiresAt }, state, now)) continue;
      out.push({
        ...publicView(r),
        interaction: state ? { ackedAt: state.ackedAt, dismissedAt: state.dismissedAt } : null,
      });
    }
    // Critical first, then newest — criticals are never silently buried.
    const rank = { critical: 0, warning: 1, success: 2, info: 3 } as const;
    out.sort((a, b) => rank[a.kind as keyof typeof rank] - rank[b.kind as keyof typeof rank]
      || new Date(b.publishAt ?? 0).getTime() - new Date(a.publishAt ?? 0).getTime());
    return out;
  }

  private async activeForUser(announcementId: string, userId: string): Promise<{ row: Row; me: { id: string; planId: string } }> {
    const row = await this.getRow(announcementId);
    const [u] = await this.db
      .select({ id: users.id, planId: users.planId, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u || u.status !== 'active') throw Err.forbidden('ACCOUNT_INACTIVE');
    const me = { id: u.id, planId: u.planId };
    if (!isActive(row, Date.now()) || !audienceMatches(row.audience as AnnouncementAudience, me)) {
      throw Err.notFound('ANNOUNCEMENT_NOT_FOUND');
    }
    return { row, me };
  }

  private async myInteraction(announcementId: string, userId: string, version: number) {
    const [ix] = await this.db
      .select()
      .from(announcementInteractions)
      .where(and(
        eq(announcementInteractions.announcementId, announcementId),
        eq(announcementInteractions.userId, userId),
        eq(announcementInteractions.version, version),
      ))
      .limit(1);
    return ix ?? null;
  }

  /** Idempotent impression (powers stats + interval policy). Not a read-receipt. */
  async recordShown(announcementId: string, userId: string) {
    const { row } = await this.activeForUser(announcementId, userId);
    const now = new Date();
    await this.db
      .insert(announcementInteractions)
      .values({ announcementId, userId, version: row.contentVersion, lastShownAt: now, showCount: 1 })
      .onConflictDoUpdate({
        target: [announcementInteractions.announcementId, announcementInteractions.userId, announcementInteractions.version],
        set: {
          lastShownAt: now,
          showCount: sql`${announcementInteractions.showCount} + 1`,
          updatedAt: now,
        },
      });
    return { ok: true };
  }

  async ack(announcementId: string, userId: string) {
    const { row } = await this.activeForUser(announcementId, userId);
    const now = new Date();
    await this.db
      .insert(announcementInteractions)
      .values({ announcementId, userId, version: row.contentVersion, ackedAt: now, lastShownAt: now, showCount: 0 })
      .onConflictDoUpdate({
        target: [announcementInteractions.announcementId, announcementInteractions.userId, announcementInteractions.version],
        set: { ackedAt: now, updatedAt: now },
      });
    return { ok: true };
  }

  async dismiss(announcementId: string, userId: string) {
    const { row } = await this.activeForUser(announcementId, userId);
    const ix = await this.myInteraction(announcementId, userId, row.contentVersion);
    const state = ix
      ? { version: ix.version, lastShownAt: ix.lastShownAt, ackedAt: ix.ackedAt, dismissedAt: ix.dismissedAt }
      : null;
    // Mandatory banners cannot be hidden before explicit ack.
    if (!canDismiss(row, state)) {
      throw new AppError('ANNOUNCE_ACK_REQUIRED', 403, 'This notice requires explicit acknowledgement before it can be dismissed.');
    }
    const now = new Date();
    await this.db
      .insert(announcementInteractions)
      .values({ announcementId, userId, version: row.contentVersion, dismissedAt: now, lastShownAt: now, showCount: 0 })
      .onConflictDoUpdate({
        target: [announcementInteractions.announcementId, announcementInteractions.userId, announcementInteractions.version],
        set: { dismissedAt: now, lastShownAt: now, updatedAt: now },
      });
    return { ok: true };
  }
}
