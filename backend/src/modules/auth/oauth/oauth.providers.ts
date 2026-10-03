import {
  DISCORD_ME_URL,
  DISCORD_TOKEN_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  OAUTH_BODY_MAX,
  discordAvatarUrl,
  googleAvatarOk,
} from './oauth.helpers';
import { Err } from '../../../common/errors';

/**
 * Provider HTTP exchanges (Google / Discord), server-side only. All network
 * goes through an injectable `fetchImpl` so the decision matrix is unit
 * testable without touching the real providers; production passes global
 * fetch. Provider access tokens are returned to the caller for immediate use
 * (Discord guild join) and must never be persisted.
 */

export interface ProviderProfile {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

export interface ProviderCfg {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type FetchImpl = typeof fetch;

const FETCH_TIMEOUT_MS = 10_000;

async function readJsonCapped(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  if (text.length > OAUTH_BODY_MAX) throw Err.unavailable('OAUTH_UPSTREAM', `${what} response too large`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw Err.unavailable('OAUTH_UPSTREAM', `Invalid ${what} response`);
  }
}

async function postForm(
  url: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
  basicAuth?: string,
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (basicAuth) headers.Authorization = `Basic ${basicAuth}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw Err.unavailable('OAUTH_UPSTREAM', 'Provider unreachable');
  }
  if (!res.ok) throw Err.unavailable('OAUTH_UPSTREAM', `Token exchange failed (${res.status})`);
  return readJsonCapped(res, 'token');
}

async function getJson(url: string, accessToken: string, fetchImpl: FetchImpl, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw Err.unavailable('OAUTH_UPSTREAM', 'Provider unreachable');
  }
  if (!res.ok) throw Err.unavailable('OAUTH_UPSTREAM', `${what} failed (${res.status})`);
  return readJsonCapped(res, what);
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

function emailOk(v: unknown): string | null {
  const s = str(v, 255)?.toLowerCase();
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/** Client-visible name: trimmed, single-spaced, no angle brackets, ≤30. */
function displayName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').replace(/[<>{}]/g, '').slice(0, 30) : '';
  return s.length >= 2 ? s : 'Troxe User';
}

export async function googleProfile(
  code: string,
  verifier: string,
  cfg: ProviderCfg,
  fetchImpl: FetchImpl = fetch,
): Promise<{ profile: ProviderProfile; userAccessToken: string }> {
  const tok = (await postForm(
    GOOGLE_TOKEN_URL,
    {
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    },
    fetchImpl,
  )) as Record<string, unknown>;
  const accessToken = str(tok.access_token, 4096);
  if (!accessToken) throw Err.unavailable('OAUTH_UPSTREAM', 'Token exchange failed');
  const me = (await getJson(GOOGLE_USERINFO_URL, accessToken, fetchImpl, 'userinfo')) as Record<string, unknown>;
  const sub = str(me.sub, 128);
  if (!sub) throw Err.unavailable('OAUTH_UPSTREAM', 'Invalid userinfo response');
  const email = emailOk(me.email);
  return {
    profile: {
      providerUserId: sub,
      email,
      emailVerified: email !== null && me.email_verified === true,
      name: displayName(me.name),
      avatarUrl: googleAvatarOk(me.picture),
    },
    userAccessToken: accessToken,
  };
}

export async function discordProfile(
  code: string,
  verifier: string,
  cfg: ProviderCfg,
  fetchImpl: FetchImpl = fetch,
): Promise<{ profile: ProviderProfile; userAccessToken: string }> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const tok = (await postForm(
    DISCORD_TOKEN_URL,
    { code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code_verifier: verifier },
    fetchImpl,
    basic,
  )) as Record<string, unknown>;
  const accessToken = str(tok.access_token, 4096);
  if (!accessToken) throw Err.unavailable('OAUTH_UPSTREAM', 'Token exchange failed');
  const me = (await getJson(DISCORD_ME_URL, accessToken, fetchImpl, 'userinfo')) as Record<string, unknown>;
  const id = typeof me.id === 'string' && /^\d{8,32}$/.test(me.id) ? me.id : null;
  if (!id) throw Err.unavailable('OAUTH_UPSTREAM', 'Invalid userinfo response');
  const email = emailOk(me.email);
  return {
    profile: {
      providerUserId: id,
      email,
      emailVerified: email !== null && me.verified === true,
      name: displayName(me.global_name ?? me.username),
      avatarUrl: discordAvatarUrl(
        id,
        typeof me.avatar === 'string' ? me.avatar : null,
        typeof me.discriminator === 'string' ? me.discriminator : null,
      ),
    },
    userAccessToken: accessToken,
  };
}
