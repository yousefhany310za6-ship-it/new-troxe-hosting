import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pure OAuth helpers (Google + Discord). Deliberately dependency-free so they
 * run under plain `node:test` — every security-sensitive string decision
 * (redirect allowlist, avatar URLs, state tokens) is unit-testable.
 */

export type OAuthProvider = 'google' | 'discord';
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ['google', 'discord'];
export function isOAuthProvider(v: unknown): v is OAuthProvider {
  return v === 'google' || v === 'discord';
}

/** Short-lived by design: a stolen start URL dies within minutes. */
export const OAUTH_STATE_TTL_SEC = 600;
export const OAUTH_LINK_TOKEN_TTL_SEC = 600;

const STATE_CTX = 'troxe-oauth-state-v1';
const LINK_CTX = 'troxe-oauth-link-v1';

// ---- redirect allowlist -----------------------------------------------------

/**
 * `next` after login. Only a same-origin relative path is ever honored —
 * anything else (absolute URL, `//host`, backslashes, control chars) falls
 * back to the dashboard. The backend re-checks this on the 302; the frontend
 * checks it again before navigating.
 */
export function sanitizeNext(v: unknown, fallback = '/dashboard'): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  if (s.length === 0 || s.length > 512) return fallback;
  if (!s.startsWith('/')) return fallback;
  if (s.startsWith('//')) return fallback;
  if (/[\\\r\n\t]/.test(s)) return fallback;
  return s;
}

// ---- PKCE -------------------------------------------------------------------

export function newCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

// ---- signed tokens (state cookie + link token) -------------------------------

export interface OAuthState {
  v: 1;
  /** random per-start value, matched against the cookie on callback */
  s: string;
  p: OAuthProvider;
  m: 'login' | 'link';
  n: string;
  cv: string;
  /** requester user id — link mode only */
  u?: string;
  exp: number;
}

export interface OAuthLinkToken {
  v: 1;
  uid: string;
  p: OAuthProvider;
  puid: string;
  /** provider snapshots so the confirm step can write a complete row */
  em: string | null;
  ev: boolean;
  av: string | null;
  exp: number;
}

function signBody(body: string, secret: string, ctx: string): string {
  return `${body}.${createHmac('sha256', secret).update(`${ctx}.${body}`).digest('hex')}`;
}

function splitSigned(token: string): { body: string; sig: string } | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  return { body: token.slice(0, i), sig: token.slice(i + 1) };
}

function verifySig(body: string, sig: string, secret: string, ctx: string): boolean {
  const expected = createHmac('sha256', secret).update(`${ctx}.${body}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function parseBody(body: string): Record<string, unknown> | null {
  try {
    const p: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p !== 'object' || p === null) return null;
    return p as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function newStateValue(): string {
  return randomBytes(32).toString('base64url');
}

export function signState(p: Omit<OAuthState, 'v'>, secret: string): string {
  const body = Buffer.from(JSON.stringify({ ...p, v: 1 })).toString('base64url');
  return signBody(body, secret, STATE_CTX);
}

export function verifyState(
  token: string,
  secret: string,
  provider: OAuthProvider,
  nowSec = Math.floor(Date.now() / 1000),
): OAuthState | null {
  const parts = splitSigned(token);
  if (!parts || !verifySig(parts.body, parts.sig, secret, STATE_CTX)) return null;
  const o = parseBody(parts.body);
  if (!o || o.v !== 1 || typeof o.s !== 'string' || o.s.length < 16) return null;
  if (o.p !== provider) return null;
  if (o.m !== 'login' && o.m !== 'link') return null;
  if (typeof o.n !== 'string' || typeof o.cv !== 'string') return null;
  if (typeof o.exp !== 'number' || o.exp <= nowSec) return null;
  if (o.m === 'link' && typeof o.u !== 'string') return null;
  return o as unknown as OAuthState;
}

export function signLinkToken(p: Omit<OAuthLinkToken, 'v'>, secret: string): string {
  const body = Buffer.from(JSON.stringify({ ...p, v: 1 })).toString('base64url');
  return signBody(body, secret, LINK_CTX);
}

export function verifyLinkToken(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): OAuthLinkToken | null {
  const parts = splitSigned(token);
  if (!parts || !verifySig(parts.body, parts.sig, secret, LINK_CTX)) return null;
  const o = parseBody(parts.body);
  if (!o || o.v !== 1) return null;
  if (typeof o.uid !== 'string' || !isOAuthProvider(o.p) || typeof o.puid !== 'string') return null;
  if (o.em !== null && typeof o.em !== 'string') return null;
  if (typeof o.ev !== 'boolean') return null;
  if (o.av !== null && typeof o.av !== 'string') return null;
  if (typeof o.exp !== 'number' || o.exp <= nowSec) return null;
  return o as unknown as OAuthLinkToken;
}

// ---- avatar URLs ---------------------------------------------------------------

const GOOGLE_IMG_SUFFIX = '.googleusercontent.com';

/**
 * Google `picture` is a full URL from the provider — accept it only when it is
 * https on Google's image hosts. Anything else → null (the account simply
 * keeps no OAuth avatar).
 */
export function googleAvatarOk(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.endsWith(GOOGLE_IMG_SUFFIX)) return null;
  return url;
}

/**
 * Build the canonical Discord avatar URL from the raw `avatar` hash.
 * - custom hash → cdn URL (`a_` prefix = animated → gif, else png)
 * - no custom avatar → default avatar: migrated accounts (`discriminator`
 *   "0") use `(userId >> 22) % 6`, legacy ones use `discriminator % 5`
 */
export function discordAvatarUrl(
  userId: string,
  avatar: string | null | undefined,
  discriminator?: string | null,
): string | null {
  if (!/^\d{8,32}$/.test(userId)) return null;
  if (typeof avatar === 'string' && (/^[0-9a-f]{32}$/.test(avatar) || /^a_[0-9a-f]{30}$/.test(avatar))) {
    const ext = avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=256`;
  }
  let idx = 0;
  if (typeof discriminator === 'string' && discriminator !== '0') {
    const n = Number.parseInt(discriminator, 10);
    idx = Number.isFinite(n) && n >= 0 ? n % 5 : 0;
  } else {
    try {
      idx = Number((BigInt(userId) >> 22n) % 6n);
    } catch {
      idx = 0;
    }
  }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

/**
 * Generic https-URL gate for user-supplied avatar URLs (settings page).
 * Same conservatism as the provider checks: https, no credentials, bounded.
 */
export function httpsUrlOk(url: unknown, max = 2048): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > max) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return url;
}

// ---- provider endpoints ----------------------------------------------------------

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_SCOPES = 'openid email profile';

export const DISCORD_AUTH_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
export const DISCORD_ME_URL = 'https://discord.com/api/users/@me';
export const DISCORD_API = 'https://discord.com/api';
/** minimal scopes: identity + email for auth, guilds.join for server auto-join */
export const DISCORD_SCOPES = 'identify email guilds.join';

/** Upper bound for any provider JSON body before parsing (rogue payloads). */
export const OAUTH_BODY_MAX = 256 * 1024;
