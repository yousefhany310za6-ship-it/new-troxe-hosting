import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import { sessions } from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { EmailService } from './email.service';
import { SETTING_NEW_LOGIN_EMAILS, EmailSettingsService } from './email-settings.service';
import { parseUserAgent } from './useragent';

export type LoginMethod = 'password' | 'google' | 'discord';

const METHOD_LABEL: Record<LoginMethod, string> = {
  password: 'Email + password',
  google: 'Google',
  discord: 'Discord',
};

/**
 * New-IP security notifications. Called on real authentication events only
 * (signup's first login is exempt — an empty history is not a "new IP").
 * A failed email never fails the login: it is recorded in the audit trail.
 */
@Injectable()
export class LoginNotifyService {
  private readonly log = new Logger(LoginNotifyService.name);

  constructor(
    @Inject(DB) private db: Db,
    private email: EmailService,
    private settings: EmailSettingsService,
    private audit: AuditService,
  ) {}

  /** IPs this user has successfully logged in from (recent, bounded). */
  async knownIps(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ ip: sessions.ip })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.status, 'success' as never)))
      .limit(100)
      .catch(() => []);
    return rows.map((r) => r.ip).filter((ip): ip is string => !!ip);
  }

  async maybeNotify(
    user: { id: string; email: string; name: string },
    ctx: ReqCtx,
    method: LoginMethod,
  ): Promise<'sent' | 'known' | 'disabled' | 'failed'> {
    if (!this.email.enabled) return 'disabled';
    if ((await this.settings.get(SETTING_NEW_LOGIN_EMAILS, 'true').catch(() => 'true')) !== 'true') return 'disabled';
    const known = await this.knownIps(user.id).catch(() => [] as string[]);
    if (known.length === 0 || known.includes(ctx.ip)) return 'known';
    const ua = parseUserAgent(ctx.device);
    const secureUrl = config.APP_URL ? `${config.APP_URL}/dashboard/settings` : '';
    try {
      await this.email.sendNewLoginEmail(user.email, {
        name: user.name,
        ip: ctx.ip,
        date: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
        browser: ua.browser,
        os: ua.os,
        device: ua.device,
        method: METHOD_LABEL[method],
        secureUrl,
      });
      await this.audit
        .record({
          actorId: user.id,
          actorEmail: user.email,
          action: 'auth.login.new_ip_email',
          targetType: 'user',
          targetId: user.id,
          ip: ctx.ip,
          userAgent: ctx.device,
          meta: { method },
        })
        .catch(() => undefined);
      return 'sent';
    } catch (e) {
      this.log.warn(`new-login email failed for ${user.id}: ${(e as Error).message.slice(0, 120)}`);
      await this.audit
        .record({
          actorId: user.id,
          actorEmail: user.email,
          action: 'auth.login.new_ip_email_failed',
          targetType: 'user',
          targetId: user.id,
          ip: ctx.ip,
          userAgent: ctx.device,
          meta: { method },
        })
        .catch(() => undefined);
      return 'failed';
    }
  }
}
