import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed one-click unsubscribe tokens. The link in a marketing email must work
 * without a login, so the token itself is the credential: user id + long
 * expiry, HMAC-signed. It can only ever flip `notifyMarketing` off — a
 * separate, narrowly-scoped action that cannot touch verification, password
 * reset, or security mail.
 */

const UNSUB_CTX = 'troxe-email-unsub-v1';
export const UNSUB_TOKEN_TTL_SEC = 2 * 365 * 24 * 3600; // emails live in inboxes for years

export function signUnsubscribe(uid: string, secret: string): string {
  const body = Buffer.from(JSON.stringify({ v: 1, uid, exp: Math.floor(Date.now() / 1000) + UNSUB_TOKEN_TTL_SEC })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(`${UNSUB_CTX}.${body}`).digest('hex')}`;
}

export function verifyUnsubscribe(token: string, secret: string): string | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac('sha256', secret).update(`${UNSUB_CTX}.${body}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return null;
  }
  if (!timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { v?: number; uid?: unknown; exp?: unknown };
    if (o?.v !== 1 || typeof o.uid !== 'string' || typeof o.exp !== 'number') return null;
    if (o.exp <= Math.floor(Date.now() / 1000)) return null;
    return o.uid;
  } catch {
    return null;
  }
}
