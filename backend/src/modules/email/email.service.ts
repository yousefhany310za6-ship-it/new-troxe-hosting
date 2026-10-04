import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { config } from '../../config/env';
import { AppError, Err } from '../../common/errors';
import { newLoginEmail, passwordResetEmail, sanitizeCampaignHtml, verificationEmail, type LoginDetails } from './email.templates';
import { buildSendPayload, validateSendOpts, type SendOpts } from './email.send';

export type { EmailKind, SendOpts } from './email.send';

const SEND_TIMEOUT_MS = 15_000;

/**
 * The ONLY gateway to outgoing mail. Controllers, auth services and the admin
 * console build their content via the template builders and call the typed
 * senders below — nobody touches the Resend SDK directly.
 *
 * Failure contract: every send throws EMAIL_DISABLED (not configured) or
 * EMAIL_UPSTREAM (provider/timeout) with no provider internals and no PII in
 * the message. Callers decide what a failure means (login stays successful,
 * signup stays created, campaigns mark the recipient failed).
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly resend: Resend | null;

  constructor() {
    this.resend = config.EMAIL_ENABLED ? new Resend(config.RESEND_API_KEY) : null;
  }

  get enabled(): boolean {
    return this.resend !== null;
  }

  get sender(): string {
    return `${config.RESEND_FROM_NAME} <${config.RESEND_FROM_EMAIL}>`;
  }

  /** Campaign HTML as authored by an admin, reduced to a safe email subset. */
  sanitizeCampaignHtml(html: string): string {
    return sanitizeCampaignHtml(html);
  }

  async sendEmail(opts: SendOpts): Promise<{ id: string }> {
    if (!this.resend) throw Err.unavailable('EMAIL_DISABLED', 'Email is not configured — please try again later');
    validateSendOpts(opts);

    const headers: Record<string, string> = { 'X-Troxe-Kind': opts.kind };
    if (opts.unsubscribeUrl) headers['List-Unsubscribe'] = `<${opts.unsubscribeUrl}>`;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const send = this.resend.emails.send(
        buildSendPayload(this.sender, opts, headers),
      );
      const raced = await Promise.race([
        send,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('send timeout')), SEND_TIMEOUT_MS);
        }),
      ]);
      if (raced.error) {
        // provider internals stay in the log (truncated, no recipient PII)
        this.log.warn(`resend send failed (${opts.kind}): ${String(raced.error?.message ?? raced.error).slice(0, 160)}`);
        throw Err.unavailable('EMAIL_UPSTREAM', 'Could not send email — please try again');
      }
      const id = (raced.data as { id?: string } | null)?.id;
      if (!id) throw Err.unavailable('EMAIL_UPSTREAM', 'Could not send email — please try again');
      return { id };
    } catch (e) {
      if (e instanceof AppError) throw e;
      this.log.warn(`resend send threw (${opts.kind}): ${(e as Error).message.slice(0, 160)}`);
      throw Err.unavailable('EMAIL_UPSTREAM', 'Could not send email — please try again');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async sendVerificationEmail(to: string, name: string, code: string): Promise<{ id: string }> {
    const t = verificationEmail(name, code);
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, kind: 'verification' });
  }

  async sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<{ id: string }> {
    const t = passwordResetEmail(name, resetUrl);
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, kind: 'password_reset' });
  }

  async sendNewLoginEmail(to: string, details: LoginDetails): Promise<{ id: string }> {
    const t = newLoginEmail(details);
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, kind: 'new_login' });
  }

  async sendPromotionalEmail(
    to: string,
    subject: string,
    html: string,
    text: string | undefined,
    unsubscribeUrl: string,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    return this.sendEmail({
      to,
      subject,
      html: this.sanitizeCampaignHtml(html),
      text,
      kind: 'promotional',
      unsubscribeUrl,
      idempotencyKey,
    });
  }
}
