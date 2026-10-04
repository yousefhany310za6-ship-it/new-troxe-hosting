import {
  Controller,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Webhook } from 'svix';
import { config } from '../../config/env';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { emailCampaignRecipients, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { eq } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { deliveryFor, extractEmailId } from './webhook-events';

/**
 * Resend event webhooks. PUBLIC by necessity (called by Resend, no session):
 * trust comes solely from the Svix signature over the raw body. Anything
 * unsigned, mis-signed, or for an unknown message id is rejected/ignored
 * without touching the database.
 *
 * Routes → /api/v1/email/webhooks/resend
 */
@Controller({ path: 'email/webhooks', version: '1' })
export class EmailWebhookController {
  private readonly log = new Logger(EmailWebhookController.name);

  constructor(
    @Inject(DB) private db: Db,
    private audit: AuditService,
  ) {}

  @Post('resend')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  async resend(@Req() req: Request): Promise<{ ok: boolean }> {
    if (!config.RESEND_WEBHOOK_SECRET) throw new ServiceUnavailableException('WEBHOOK_DISABLED');
    const raw = (req as unknown as { body?: unknown }).body;
    if (!Buffer.isBuffer(raw)) {
      // raw-body middleware missing or misordered — fail closed, loudly
      this.log.error('webhook reached controller without a raw Buffer body');
      throw new InternalServerErrorException('WEBHOOK_ERROR');
    }
    let event: { type?: unknown; data?: unknown };
    try {
      const wh = new Webhook(config.RESEND_WEBHOOK_SECRET);
      // v2 verify() returns void and throws on mismatch — the event itself
      // comes from parsing the same raw bytes afterwards (never trust a
      // re-serialized object: the signature covered THESE bytes).
      wh.verify(raw, {
        'svix-id': String(req.headers['svix-id'] ?? ''),
        'svix-timestamp': String(req.headers['svix-timestamp'] ?? ''),
        'svix-signature': String(req.headers['svix-signature'] ?? ''),
      });
      event = JSON.parse(raw.toString('utf8')) as { type?: unknown; data?: unknown };
    } catch (e) {
      if (e instanceof SyntaxError) throw new InternalServerErrorException('WEBHOOK_ERROR');
      throw new UnauthorizedException('WEBHOOK_BAD_SIGNATURE');
    }

    const type = typeof event?.type === 'string' ? event.type : '';
    const delivery = deliveryFor(type);
    if (!delivery) return { ok: true }; // forward-compatible: ignore unknown events
    const emailId = extractEmailId(event?.data);
    if (!emailId) return { ok: true };

    const [row] = await this.db
      .select({ id: emailCampaignRecipients.id, userId: emailCampaignRecipients.userId })
      .from(emailCampaignRecipients)
      .where(eq(emailCampaignRecipients.resendId, emailId))
      .limit(1);
    if (!row) return { ok: true }; // not one of ours (transactional mail carries no row)

    await this.db
      .update(emailCampaignRecipients)
      .set({ delivery })
      .where(eq(emailCampaignRecipients.id, row.id))
      .catch(() => undefined);

    const ctx: ReqCtx = {
      ip: String(req.ip ?? 'unknown').slice(0, 45),
      device: String(req.headers?.['user-agent'] ?? 'resend-webhook').slice(0, 255),
    };
    // a spam complaint is consent withdrawn: marketing stops immediately.
    // A hard bounce is recorded on the recipient row only (deliverability
    // signal, not an opt-out — the address may be fixed by its owner).
    if (type === 'email.complained') {
      await this.db.update(users).set({ notifyMarketing: false }).where(eq(users.id, row.userId)).catch(() => undefined);
      await this.audit
        .record({ actorId: row.userId, action: 'email.complained', targetType: 'email_campaign_recipient', targetId: row.id, ip: ctx.ip, userAgent: ctx.device })
        .catch(() => undefined);
    }
    return { ok: true };
  }
}
