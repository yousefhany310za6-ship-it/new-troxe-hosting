import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { emailCampaignRecipients, emailCampaigns, plans, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { EmailService } from '../email/email.service';
import { SETTING_NEW_LOGIN_EMAILS, EmailSettingsService } from '../email/email-settings.service';
import { renderSafe, renderText, htmlToText } from '../email/email.templates';
import { signUnsubscribe } from '../email/email.tokens';

export interface RecipientFilters {
  audience?: 'all' | 'verified' | 'unverified';
  planId?: string;
  role?: 'user' | 'admin';
  search?: string;
  ids?: string[];
}

const BATCH_SIZE = 10;
const TICK_MS = 5_000;
const APP_NAME = 'Troxe';

/**
 * Admin marketing campaigns. The request never sends mail: `send()` only
 * snapshots the recipient set (marketing opt-in enforced at snapshot time)
 * and flips the campaign to `sending`; a 5s in-process tick delivers in small
 * batches with per-recipient idempotency keys, so a crash or a retry can
 * never double-send. Unique (campaign, user) is the backstop.
 */
@Injectable()
export class EmailCampaignService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EmailCampaignService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    @Inject(DB) private db: Db,
    private email: EmailService,
    private settings: EmailSettingsService,
    private audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn(`campaign tick: ${(e as Error).message.slice(0, 120)}`)), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- status / settings -----------------------------------------------------

  async status() {
    const newLoginEmails = (await this.settings.get(SETTING_NEW_LOGIN_EMAILS, 'true').catch(() => 'true')) === 'true';
    let domainStatus: 'verified' | 'pending' | 'unknown' | 'disabled' = config.EMAIL_ENABLED ? 'unknown' : 'disabled';
    if (config.EMAIL_ENABLED) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(config.RESEND_API_KEY);
        const { data, error } = await Promise.race([
          resend.domains.list(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
        ]);
        if (!error && data?.data) {
          const domain = config.RESEND_FROM_EMAIL.split('@')[1]?.toLowerCase();
          const row = (data.data as Array<{ name?: string; status?: string }>).find((d) => d.name?.toLowerCase() === domain);
          domainStatus = row?.status === 'verified' ? 'verified' : row ? 'pending' : 'unknown';
        }
      } catch {
        domainStatus = 'unknown';
      }
    }
    return {
      emailEnabled: config.EMAIL_ENABLED,
      resendConnected: config.EMAIL_ENABLED,
      senderName: config.RESEND_FROM_NAME,
      senderEmail: config.RESEND_FROM_EMAIL || null,
      domainStatus,
      newLoginEmails,
    };
  }

  async setSettings(newLoginEmails: boolean, ctx: ReqCtx, actorId: string) {
    await this.settings.set(SETTING_NEW_LOGIN_EMAILS, newLoginEmails ? 'true' : 'false');
    await this.audit
      .record({
        actorId,
        action: 'admin.email.settings',
        targetType: 'email_settings',
        targetId: 'security.new_login_emails',
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: { newLoginEmails },
      })
      .catch(() => undefined);
    return { newLoginEmails };
  }

  // ---- campaigns ------------------------------------------------------------------

  async create(createdBy: string, dto: { name: string; subject: string; html: string; text?: string }, ctx: ReqCtx) {
    this.requireEmail();
    const name = dto.name.trim().slice(0, 128);
    const subject = dto.subject.trim().slice(0, 255);
    if (!name || !subject) throw Err.invalid('CAMPAIGN_FIELDS');
    if (!dto.html || dto.html.length > 256 * 1024) throw Err.invalid('CAMPAIGN_HTML');
    // validate now (admin gets immediate feedback), store raw, sanitize at send
    const probe = this.email.sanitizeCampaignHtml(dto.html);
    if (!probe.replace(/<[^>]*>/g, '').trim()) throw Err.invalid('CAMPAIGN_HTML_EMPTY');
    const text = dto.text?.slice(0, 64 * 1024) || undefined;
    const [row] = await this.db
      .insert(emailCampaigns)
      .values({ name, subject, html: dto.html, text, createdBy })
      .returning({ id: emailCampaigns.id });
    await this.audit
      .record({ actorId: createdBy, action: 'admin.email.campaign.create', targetType: 'email_campaign', targetId: row.id, ip: ctx.ip, userAgent: ctx.device, meta: { name } })
      .catch(() => undefined);
    return { id: row.id };
  }

  async list() {
    const rows = await this.db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt)).limit(100);
    const out: Array<Record<string, unknown>> = [];
    for (const r of rows) out.push({ ...r, counts: await this.counts(r.id) });
    return out;
  }

  async detail(id: string) {
    const [row] = await this.db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    if (!row) throw Err.notFound('CAMPAIGN_NOT_FOUND');
    return { ...row, counts: await this.counts(id) };
  }

  async update(id: string, dto: { name?: string; subject?: string; html?: string; text?: string | null }, ctx: ReqCtx, actorId: string) {
    const [row] = await this.db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    if (!row) throw Err.notFound('CAMPAIGN_NOT_FOUND');
    if (row.status !== 'draft') throw Err.conflict('CAMPAIGN_LOCKED', 'Only drafts can be edited');
    const patch: Partial<{ name: string; subject: string; html: string; text: string | null }> = {};
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw Err.invalid('CAMPAIGN_FIELDS');
      patch.name = dto.name.trim().slice(0, 128);
    }
    if (dto.subject !== undefined) {
      if (!dto.subject.trim()) throw Err.invalid('CAMPAIGN_FIELDS');
      patch.subject = dto.subject.trim().slice(0, 255);
    }
    if (dto.html !== undefined) {
      if (!dto.html || dto.html.length > 256 * 1024) throw Err.invalid('CAMPAIGN_HTML');
      const probe = this.email.sanitizeCampaignHtml(dto.html);
      if (!probe.replace(/<[^>]*>/g, '').trim()) throw Err.invalid('CAMPAIGN_HTML_EMPTY');
      patch.html = dto.html;
    }
    if (dto.text !== undefined) patch.text = dto.text ? dto.text.slice(0, 64 * 1024) : null;
    if (!Object.keys(patch).length) return { ok: true };
    await this.db.update(emailCampaigns).set(patch).where(eq(emailCampaigns.id, id));
    await this.audit
      .record({ actorId, action: 'admin.email.campaign.update', targetType: 'email_campaign', targetId: id, ip: ctx.ip, userAgent: ctx.device })
      .catch(() => undefined);
    return { ok: true };
  }

  private async counts(campaignId: string) {
    const rows = await this.db
      .select({ status: emailCampaignRecipients.status, n: count() })
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.campaignId, campaignId))
      .groupBy(emailCampaignRecipients.status);
    const c: Record<string, number> = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const r of rows) c[r.status] = Number(r.n);
    c.total = Object.values(c).reduce((a, b) => a + b, 0);
    return c;
  }

  // ---- recipients -------------------------------------------------------------------

  private async recipientWhere(f: RecipientFilters) {
    // suspended/deleted accounts never receive campaigns, even if still opted in
    const conds = [eq(users.notifyMarketing, true), eq(users.status, 'active')];
    if (f.audience === 'verified') conds.push(eq(users.emailVerified, true));
    else if (f.audience === 'unverified') conds.push(eq(users.emailVerified, false));
    if (f.planId) {
      const [p] = await this.db.select({ id: plans.id }).from(plans).where(eq(plans.id, f.planId)).limit(1);
      if (!p) throw Err.notFound('PLAN_NOT_FOUND');
      conds.push(eq(users.planId, f.planId));
    }
    if (f.role) conds.push(eq(users.role, f.role));
    if (f.search) {
      const like = `%${f.search.trim().slice(0, 128)}%`;
      conds.push(or(ilike(users.email, like), ilike(users.name, like))!);
    }
    if (f.ids?.length) conds.push(inArray(users.id, f.ids));
    return and(...conds);
  }

  async previewRecipients(f: RecipientFilters): Promise<{ count: number }> {
    const where = await this.recipientWhere(f);
    const [row] = await this.db.select({ n: count() }).from(users).where(where);
    return { count: Number(row?.n ?? 0) };
  }

  async send(id: string, f: RecipientFilters, ctx: ReqCtx, actorId: string) {
    this.requireEmail();
    if (!config.APP_URL) throw Err.invalid('APP_URL_MISSING', 'APP_URL is required to build unsubscribe links');
    const [row] = await this.db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    if (!row) throw Err.notFound('CAMPAIGN_NOT_FOUND');
    if (row.status !== 'draft') throw Err.conflict('CAMPAIGN_LOCKED', 'Only drafts can be sent');
    const where = await this.recipientWhere(f);
    // snapshot the audience in chunks; unique(campaign,user) makes a retried
    // send idempotent (conflicts are skipped, never duplicated)
    let inserted = 0;
    let offset = 0;
    for (;;) {
      const batch = await this.db
        .select({ id: users.id })
        .from(users)
        .where(where)
        .orderBy(users.id)
        .limit(500)
        .offset(offset);
      if (!batch.length) break;
      offset += batch.length;
      await this.db
        .insert(emailCampaignRecipients)
        .values(batch.map((u) => ({ campaignId: id, userId: u.id })))
        .onConflictDoNothing({ target: [emailCampaignRecipients.campaignId, emailCampaignRecipients.userId] });
      inserted += batch.length;
      if (batch.length < 500) break;
    }
    await this.db.update(emailCampaigns).set({ status: 'sending' }).where(eq(emailCampaigns.id, id));
    await this.audit
      .record({
        actorId,
        action: 'admin.email.campaign.send',
        targetType: 'email_campaign',
        targetId: id,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: { recipients: inserted },
      })
      .catch(() => undefined);
    return { recipients: inserted };
  }

  async cancel(id: string, ctx: ReqCtx, actorId: string) {
    const [row] = await this.db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    if (!row) throw Err.notFound('CAMPAIGN_NOT_FOUND');
    if (row.status !== 'draft' && row.status !== 'sending') throw Err.conflict('CAMPAIGN_LOCKED');
    await this.db.transaction(async (tx) => {
      await tx.update(emailCampaigns).set({ status: 'cancelled' }).where(eq(emailCampaigns.id, id));
      await tx
        .update(emailCampaignRecipients)
        .set({ status: 'skipped', failureReason: 'cancelled' })
        .where(and(eq(emailCampaignRecipients.campaignId, id), eq(emailCampaignRecipients.status, 'pending')));
    });
    await this.audit
      .record({ actorId, action: 'admin.email.campaign.cancel', targetType: 'email_campaign', targetId: id, ip: ctx.ip, userAgent: ctx.device })
      .catch(() => undefined);
    return { ok: true };
  }

  async recipients(id: string, opts: { status?: string; limit: number; offset: number }) {
    const [row] = await this.db.select({ id: emailCampaigns.id }).from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
    if (!row) throw Err.notFound('CAMPAIGN_NOT_FOUND');
    const conds = [eq(emailCampaignRecipients.campaignId, id)];
    if (opts.status && ['pending', 'sending', 'sent', 'failed', 'skipped'].includes(opts.status))
      conds.push(eq(emailCampaignRecipients.status, opts.status as never));
    const rows = await this.db
      .select({
        id: emailCampaignRecipients.id,
        status: emailCampaignRecipients.status,
        resendId: emailCampaignRecipients.resendId,
        delivery: emailCampaignRecipients.delivery,
        failureReason: emailCampaignRecipients.failureReason,
        sentAt: emailCampaignRecipients.sentAt,
        email: users.email,
        name: users.name,
      })
      .from(emailCampaignRecipients)
      .innerJoin(users, eq(users.id, emailCampaignRecipients.userId))
      .where(and(...conds))
      .orderBy(emailCampaignRecipients.id)
      .limit(Math.min(Math.max(opts.limit, 1), 200))
      .offset(Math.max(opts.offset, 0));
    return rows;
  }

  // ---- background delivery ---------------------------------------------------------------

  private requireEmail(): void {
    if (!config.EMAIL_ENABLED) throw Err.unavailable('EMAIL_DISABLED', 'Email is not configured');
  }

  async tick(): Promise<void> {
    if (this.running || !config.EMAIL_ENABLED) return;
    this.running = true;
    try {
      const due = await this.db
        .select({ id: emailCampaignRecipients.id, campaignId: emailCampaignRecipients.campaignId, userId: emailCampaignRecipients.userId })
        .from(emailCampaignRecipients)
        .where(eq(emailCampaignRecipients.status, 'pending'))
        .orderBy(emailCampaignRecipients.id)
        .limit(BATCH_SIZE);
      for (const r of due) {
        // claim exactly one row: concurrent ticks (or a second instance one
        // day) serialize here, so a recipient is never sent twice
        const claimed = await this.db
          .update(emailCampaignRecipients)
          .set({ status: 'sending' })
          .where(and(eq(emailCampaignRecipients.id, r.id), eq(emailCampaignRecipients.status, 'pending')))
          .returning({ id: emailCampaignRecipients.id });
        if (!claimed.length) continue;
        await this.deliverOne(r.campaignId, r.userId, r.id).catch((e) =>
          this.log.warn(`deliver ${r.id}: ${(e as Error).message.slice(0, 120)}`),
        );
      }
      // close out campaigns with nothing left in flight
      const active = await this.db
        .select({ id: emailCampaigns.id })
        .from(emailCampaigns)
        .where(eq(emailCampaigns.status, 'sending'))
        .limit(20);
      for (const c of active) {
        const [left] = await this.db
          .select({ n: count() })
          .from(emailCampaignRecipients)
          .where(
            and(
              eq(emailCampaignRecipients.campaignId, c.id),
              or(eq(emailCampaignRecipients.status, 'pending'), eq(emailCampaignRecipients.status, 'sending'))!,
            ),
          );
        if (Number(left?.n ?? 0) === 0) {
          await this.db.update(emailCampaigns).set({ status: 'done', sentAt: new Date() }).where(eq(emailCampaigns.id, c.id));
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async deliverOne(campaignId: string, userId: string, recipientId: string): Promise<void> {
    const fail = async (reason: string) => {
      await this.db
        .update(emailCampaignRecipients)
        .set({ status: 'failed', failureReason: reason.slice(0, 255) })
        .where(eq(emailCampaignRecipients.id, recipientId));
    };
    const skip = async (reason: string) => {
      await this.db
        .update(emailCampaignRecipients)
        .set({ status: 'skipped', failureReason: reason.slice(0, 255) })
        .where(eq(emailCampaignRecipients.id, recipientId));
    };
    const [camp] = await this.db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).limit(1);
    if (!camp || camp.status !== 'sending') {
      await skip('cancelled');
      return;
    }
    const [u] = await this.db
      .select({ id: users.id, email: users.email, name: users.name, notifyMarketing: users.notifyMarketing, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) {
      await skip('user gone');
      return;
    }
    // opt-out AND account status are re-checked at send time: unsubscribing
    // mid-campaign stops it, as does a suspension/deletion that landed after
    // the audience snapshot
    if (!u.notifyMarketing) {
      await skip('unsubscribed');
      return;
    }
    if (u.status !== 'active') {
      await skip('inactive');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) {
      await skip('bad email');
      return;
    }
    if (!config.APP_URL) {
      await fail('no_app_url');
      return;
    }
    const unsub = `${config.APP_URL}/api/v1/auth/email-preferences/unsubscribe?token=${encodeURIComponent(signUnsubscribe(u.id, config.JWT_ACCESS_SECRET))}`;
    const user = { name: u.name, email: u.email };
    const subject = renderText(camp.subject, user, APP_NAME);
    const html = renderSafe(camp.html, user, APP_NAME);
    const text = camp.text ? renderText(camp.text, user, APP_NAME) : undefined;
    try {
      const { id } = await this.email.sendPromotionalEmail(u.email, subject, html, text, unsub, `campaign:${campaignId}:user:${userId}`);
      await this.db
        .update(emailCampaignRecipients)
        .set({ status: 'sent', resendId: id, sentAt: new Date() })
        .where(eq(emailCampaignRecipients.id, recipientId));
    } catch (e) {
      await fail(appErrorCode(e));
    }
  }
}

function appErrorCode(e: unknown): string {
  const r = (e as { getResponse?: () => unknown })?.getResponse?.();
  const code = (r as { code?: unknown })?.code;
  return typeof code === 'string' && code ? code.slice(0, 64) : 'send_failed';
}
