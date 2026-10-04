import { Err } from '../../common/errors';

export type EmailKind = 'verification' | 'password_reset' | 'new_login' | 'promotional';

export interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text?: string;
  kind: EmailKind;
  /** List-Unsubscribe URL — required for promotional mail */
  unsubscribeUrl?: string;
  /** per-recipient idempotency: Resend dedupes retries with the same key */
  idempotencyKey?: string;
}

/**
 * Pure send-payload pipeline (no NestJS decorators, unit-tested directly).
 * The EmailService method is thin glue (enabled check + timeout race).
 */
export function validateSendOpts(opts: SendOpts): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.to)) throw Err.invalid('EMAIL_INVALID');
  if (!opts.subject || opts.subject.length > 255) throw Err.invalid('EMAIL_SUBJECT');
  if (!opts.html || opts.html.length > 512 * 1024) throw Err.invalid('EMAIL_BODY');
  if (opts.kind === 'promotional' && !opts.unsubscribeUrl)
    throw Err.invalid('EMAIL_UNSUBSCRIBE_REQUIRED', 'Promotional mail requires an unsubscribe URL');
}

export interface SendPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers: Record<string, string>;
  idempotencyKey?: string;
}

export function buildSendPayload(sender: string, opts: SendOpts, headers: Record<string, string>): SendPayload {
  return {
    from: sender,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    headers,
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
  };
}

/** Provider failures become a generic 503 — internals stay in the log only. */
export function sendError(e: unknown): never {
  void e;
  throw Err.unavailable('EMAIL_UPSTREAM', 'Could not send email — please try again');
}
