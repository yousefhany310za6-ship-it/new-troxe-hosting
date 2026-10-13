import { type ProviderVerdict } from './renewal-policy';

/**
 * Work.ink client contract — PURE (no Nest/Drizzle/fetch), so the parsing and
 * URL rules can be tested without a network or a DI container.
 *
 * Everything here is backed by Work.ink's own documentation AND by live probes
 * of the two public endpoints (verified 2026-10-13):
 *
 *  Token validation   GET https://work.ink/_api/v2/token/isValid/<token>
 *      → 200 {"valid":false}                       for an unknown token (probed)
 *      → 200 {"valid":true,"deleted":bool,"info":{token,createdAt,byIp,
 *                  linkId,expiresAfter}}           for a real one (documented)
 *      `?deleteToken=1` consumes the key, making it single-use.
 *
 *  Link override      GET https://work.ink/_api/v2/override?destination=<url>
 *      → 200 {"sr":"<blob>"}; append `?sr=<blob>` to a Work.ink link to make it
 *        redirect to that destination instead of the one in the dashboard
 *        (probed live).
 *
 * Both endpoints are UNAUTHENTICATED (they carry no API key). That shapes the
 * whole design: security cannot rest on "only we can call this". It rests on
 * `info.linkId` — the key must have been minted by OUR link — plus local
 * single-use bookkeeping. See `renewal-policy.evaluateVerdict`.
 */

/** Only these hosts are ever contacted. No user input reaches a URL. */
export const WORKINK_ALLOWED_HOSTS = ['work.ink', 'api.work.ink'] as const;

/**
 * Parse a configured base URL, refusing anything that is not an https
 * work.ink origin. This is the SSRF fence: it runs on the configured value AND
 * on every URL the client actually requests.
 */
export function parseWorkinkBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('workink: WORKINK_API_BASE_URL is not a valid URL');
  }
  if (url.protocol !== 'https:' || !WORKINK_ALLOWED_HOSTS.includes(url.hostname as never)) {
    throw new Error(`workink: refusing to call ${url.protocol}//${url.hostname}`);
  }
  return url.toString().replace(/\/+$/, '');
}

export interface WorkinkConfig {
  enabled: boolean;
  apiBaseUrl: string;
  /** the dashboard link, e.g. `https://work.ink/aBcD/renew` */
  linkUrl: string;
  /** Work.ink's numeric link id — the provenance binding */
  linkId: string | null;
  /** where Work.ink returns the user; `{TOKEN}` is substituted by them */
  returnUrlTemplate: string;
  /** consume the key after a successful check (single-use) */
  deleteToken: boolean;
}

export function workinkConfigFrom(input: {
  enabled: boolean;
  apiBaseUrl: string;
  linkUrl: string;
  linkId: string;
  returnUrlTemplate: string;
  deleteToken: boolean;
}): WorkinkConfig {
  return {
    enabled: input.enabled,
    apiBaseUrl: parseWorkinkBaseUrl(input.apiBaseUrl),
    linkUrl: input.linkUrl,
    linkId: input.linkId || null,
    returnUrlTemplate: input.returnUrlTemplate,
    deleteToken: input.deleteToken,
  };
}

/**
 * Is the integration configured well enough to be used at all? Every required
 * piece is checked so the API can answer "renewal unavailable" with a precise
 * reason instead of failing halfway through a flow.
 */
export function workinkReadiness(cfg: WorkinkConfig): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!cfg.enabled) missing.push('WORKINK_ENABLED');
  if (!cfg.linkUrl) missing.push('WORKINK_LINK_URL');
  if (!cfg.linkId) missing.push('WORKINK_LINK_ID');
  if (!cfg.returnUrlTemplate) missing.push('WORKINK_RETURN_URL');
  else if (!cfg.returnUrlTemplate.includes('{TOKEN}')) missing.push('WORKINK_RETURN_URL ({TOKEN} placeholder)');
  return { ready: missing.length === 0, missing };
}

/**
 * Build the URL the user is sent back to.
 *
 * The destination is composed from OUR OWN session id — the browser never
 * supplies one, so there is no open redirect and no SSRF vector (the
 * `destination` we hand to the override API is always this exact string).
 *
 * `{TOKEN}` MUST be preserved: it is Work.ink's placeholder and they replace
 * it with the actual key when they redirect the user back. Stripping it here
 * (which an earlier revision did) makes the user arrive with no key at all and
 * the renewal can never complete. `{SESSION}` is OURS — the provider has no
 * idea it exists, which is exactly why the session is still enforced
 * server-side rather than by the URL.
 */
export function buildReturnUrl(cfg: WorkinkConfig, sessionId: string): string {
  return cfg.returnUrlTemplate.replace(/\{SESSION\}/g, encodeURIComponent(sessionId));
}

/** The plain (non-overridden) dashboard link. */
export function plainLink(cfg: WorkinkConfig): string {
  return cfg.linkUrl;
}

/** The Work.ink URL once the provider has signed a destination. */
export function applyOverride(linkUrl: string, sr: string): string {
  const sep = linkUrl.includes('?') ? '&' : '?';
  return `${linkUrl}${sep}sr=${encodeURIComponent(sr)}`;
}

/** The `sr` value out of an override response, or null when unusable. */
export function parseOverride(body: unknown): string | null {
  const sr = (body as { sr?: unknown } | null)?.sr;
  return typeof sr === 'string' && sr.length > 0 && sr.length <= 512 ? sr : null;
}

/**
 * Translate a `isValid` response body into a verdict.
 *
 * The rule that matters: `valid: true` WITHOUT a `linkId` is treated as an
 * ERROR, never as success. Without provenance we cannot prove the key came from
 * our monetized link, and an unprovable proof must not grant runtime.
 */
export function parseTokenVerdict(body: unknown, now: Date = new Date()): ProviderVerdict {
  // A JSON array (or any non-plain object) is not this endpoint's contract.
// Fail closed as `error` rather than silently reading it as "not valid".
if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'error' };
  const b = body as Record<string, unknown>;
  // Distinguish "the provider said no" from "this isn't the provider's
  // contract". A non-boolean `valid` (e.g. the string "true") is malformed and
  // must never be read as a yes — and must not be blamed on the user either.
  if (typeof b.valid !== 'boolean') return { kind: 'error' };
  if (b.valid !== true) return { kind: 'invalid' };

  const info = (b.info ?? {}) as Record<string, unknown>;
  const linkId = info.linkId;
  if (linkId === undefined || linkId === null) return { kind: 'error' };

  const expiresAfter = typeof info.expiresAfter === 'number' ? info.expiresAfter : null;
  if (expiresAfter !== null && expiresAfter <= now.getTime()) return { kind: 'expired' };

  return {
    kind: 'valid',
    linkId: String(linkId),
    createdAt: typeof info.createdAt === 'number' ? new Date(info.createdAt) : null,
    ip: typeof info.byIp === 'string' ? info.byIp.slice(0, 45) : null,
  };
}

/** Full request URL for a key check. The key is only ever a path segment. */
export function tokenCheckUrl(cfg: WorkinkConfig, token: string, opts: { consume: boolean }): string {
  const suffix = opts.consume && cfg.deleteToken ? '?deleteToken=1' : '';
  return `${cfg.apiBaseUrl}/token/isValid/${encodeURIComponent(token)}${suffix}`;
}

/** Request URL for a signed destination. */
export function overrideUrl(cfg: WorkinkConfig, destination: string): string {
  return `${cfg.apiBaseUrl}/override?destination=${encodeURIComponent(destination)}`;
}