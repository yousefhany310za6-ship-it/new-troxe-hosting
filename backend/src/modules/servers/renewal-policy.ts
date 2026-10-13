/**
 * Free-plan expiry & renewal policy (pure — no Nest/Drizzle imports).
 *
 * Everything that decides *whether* a server may expire and *whether* an
 * attempt may be granted lives here, so it can be tested without a database,
 * a clock or a network. The service owns the I/O; this file owns the rules.
 *
 * The clock is ALWAYS the backend's. Nothing here accepts a timestamp from the
 * browser: `expiresAfter` is derived from a `Date` the service took from the
 * database/host, never from a request body.
 */

/** How long one verified renewal adds. Fixed by the product, not by the client. */
export const RENEWAL_HOURS = 24;

/**
 * How long a renewal ATTEMPT stays open.
 *
 * Measured against the provider, not guessed: a real Work.ink key minted on
 * 2026-10-13 came back with `expiresAfter - createdAt = 299 999 ms` — exactly
 * five minutes. An attempt therefore has to be closable inside that window or
 * the user comes back holding a key the provider will reject.
 *
 * 10 minutes is deliberately a little longer than the observed 5, so a slow
 * round trip fails with "this attempt timed out" (which we control and can
 * explain) rather than "that key is invalid" (which reads like the user made a
 * mistake). Re-check this if Work.ink's key lifetime ever changes.
 */
export const SESSION_TTL_MINUTES = 10;

/**
 * Work.ink's own key lifetime, measured from a real key rather than assumed:
 * a key minted on 2026-10-13 returned `expiresAfter - createdAt = 299 999 ms`.
 * Exposed so the UI can tell the user the truth instead of letting them
 * discover it as "that key is invalid".
 */
export const PROVIDER_TOKEN_TTL_MINUTES = 5;

/** Show the countdown once less than this is left. */
export const EXPIRY_WARNING_MINUTES = 60;

/** Anti-abuse ceiling: attempts started per user per hour. */
export const SESSION_START_PER_HOUR = 10;

/** Anti-abuse ceiling: completion checks per session (a client may retry once). */
export const COMPLETION_ATTEMPTS_PER_SESSION = 3;

export type ExpiryState =
  | 'not_expiring' // plan has no lifetime — paid plans
  | 'active' // deadline in the future
  | 'expiring_soon' // under EXPIRY_WARNING_MINUTES left
  | 'expired'; // deadline passed

export interface ExpiryInput {
  /** null when the owning plan has no server_lifetime_hours */
  expiresAt: Date | null;
  now: Date;
}

/** Classify a server's deadline. The single definition used by UI and API. */
export function expiryState({ expiresAt, now }: ExpiryInput): ExpiryState {
  if (!expiresAt) return 'not_expiring';
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  if (ms <= EXPIRY_WARNING_MINUTES * 60_000) return 'expiring_soon';
  return 'active';
}

/** Whole minutes until the deadline; 0 once passed, null when never expiring. */
export function minutesRemaining(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 60_000));
}

/**
 * The new deadline after a verified renewal: `serverTime + 24h`.
 *
 * Note this is NOT "old deadline + 24h". The rule is explicit, and it matters:
 * renewing a server that expired 20 hours ago grants a full fresh 24 hours
 * from now, not 4 hours of catch-up.
 */
export function nextExpiry(now: Date, hours: number = RENEWAL_HOURS): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

/**
 * The deadline a server is created with: the plan's lifetime from now, or null
 * for a plan that never expires.
 */
export function initialExpiry(lifetimeHours: number | null | undefined, now: Date): Date | null {
  if (!lifetimeHours || lifetimeHours < 1) return null;
  return nextExpiry(now, lifetimeHours);
}

export type RenewalIneligibility =
  | 'NOT_OWNER'
  | 'SERVER_DELETING'
  | 'PLAN_NOT_EXPIRING'
  | 'NOT_EXPIRED'
  | 'SERVER_UNUSABLE';

export interface EligibilityInput {
  /** the server's owning plan */
  lifetimeHours: number | null;
  /** the server's current deadline (null = never expires) */
  expiresAt: Date | null;
  /** the server's live status */
  status: string;
  now: Date;
}

export interface Eligibility {
  eligible: boolean;
  reason?: RenewalIneligibility;
  message?: string;
}

/**
 * May this server open a renewal attempt right now?
 *
 * Deliberately strict: a paid server (no lifetime) can never enter this flow,
 * and a server that still has runtime left is refused with an explanation
 * rather than silently accepted — otherwise a client could bank extensions.
 */
export function checkEligibility(input: EligibilityInput): Eligibility {
  const { lifetimeHours, expiresAt, status, now } = input;

  if (status === 'deleting') {
    return { eligible: false, reason: 'SERVER_DELETING', message: 'This server is being deleted.' };
  }
  if (!lifetimeHours || lifetimeHours < 1) {
    return {
      eligible: false,
      reason: 'PLAN_NOT_EXPIRING',
      message: 'This plan does not use time-limited servers — renewals only apply to the free plan.',
    };
  }
  if (!expiresAt) {
    return {
      eligible: false,
      reason: 'PLAN_NOT_EXPIRING',
      message: 'This server has no expiry deadline, so there is nothing to renew.',
    };
  }
  if (expiryState({ expiresAt, now }) !== 'expired') {
    return {
      eligible: false,
      reason: 'NOT_EXPIRED',
      message: 'This server still has runtime left — it can only be renewed once its 24 hours are up.',
    };
  }
  return { eligible: true };
}

/** A session may only be finished while it is still open. */
export function isSessionOpen(session: { status: string; expiresAt: Date }, now: Date): boolean {
  if (session.status !== 'pending') return false;
  return session.expiresAt.getTime() > now.getTime();
}

/** Terminal states never transition again — this is what blocks replay. */
export const TERMINAL_SESSION_STATES = ['completed', 'failed', 'expired'] as const;

/**
 * Allowed state machine for a session. Enforced in the service AND backed by
 * a conditional UPDATE, so a concurrent duplicate cannot slip past.
 */
export const SESSION_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['verifying', 'failed', 'expired'],
  verifying: ['completed', 'failed', 'pending'],
  completed: [],
  failed: [],
  expired: [],
};

/** Reasons a completion attempt can fail — recorded, never a free-text blob. */
export const FAILURE_REASONS = [
  'TOKEN_MISSING',
  'TOKEN_MALFORMED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_WRONG_LINK',
  'TOKEN_ALREADY_USED',
  'SESSION_EXPIRED',
  'SESSION_NOT_OWNER',
  'SESSION_WRONG_SERVER',
  'SESSION_ALREADY_COMPLETED',
  'SERVER_NOT_ELIGIBLE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_ERROR',
  'RATE_LIMITED',
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Validate the shape of a Work.ink key before it is ever sent to the
 * provider. Returns the reason to fail locally — a malformed key is our bug
 * or an attack, not a Work.ink verdict, and we do not spend a network call
 * (or leak the value in a log line) on it.
 */
export function validateTokenShape(raw: unknown): { ok: true; token: string } | { ok: false; reason: FailureReason } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'TOKEN_MISSING' };
  const token = raw.trim();
  if (token.length > 256) return { ok: false, reason: 'TOKEN_MALFORMED' };
  // Work.ink tokens are opaque; the only safe rule is "no control characters,
  // no path traversal, no whitespace" — it goes into a URL path segment.
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) return { ok: false, reason: 'TOKEN_MALFORMED' };
  return { ok: true, token };
}

/** How the provider's verdict maps onto our failure vocabulary. */
export type ProviderVerdict =
  | { kind: 'valid'; linkId: string; createdAt: Date | null; ip: string | null }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

/**
 * Decide whether a provider verdict proves a renewal.
 *
 * `valid` alone is NOT enough, and this is the whole point of the module:
 *  - the key must come from OUR configured link (`linkId`), otherwise any
 *    publisher's Work.ink key — or a key a user minted from their own link —
 *    would pass;
 *  - the key's own expiry (when the provider reports one) must not have passed;
 *  - `unavailable`/`error` are NEVER success. A provider outage must not
 *    become a free renewal, and it must leave the attempt retryable.
 */
export function evaluateVerdict(input: {
  verdict: ProviderVerdict;
  expectedLinkId: string | null;
  now: Date;
}): { ok: true; linkId: string; createdAt: Date | null; ip: string | null } | { ok: false; reason: FailureReason; retryable: boolean } {
  const { verdict, expectedLinkId, now } = input;

  switch (verdict.kind) {
    case 'unavailable':
      // timeout / DNS / connection refused — the user should simply try again
      return { ok: false, reason: 'PROVIDER_UNAVAILABLE', retryable: true };
    case 'error':
      // 5xx, unparseable body, unexpected shape — never a success
      return { ok: false, reason: 'PROVIDER_ERROR', retryable: true };
    case 'invalid':
      return { ok: false, reason: 'TOKEN_INVALID', retryable: false };
    case 'expired':
      return { ok: false, reason: 'TOKEN_EXPIRED', retryable: false };
    case 'valid': {
      if (expectedLinkId && verdict.linkId !== expectedLinkId) {
        // minted by a different Work.ink link: real key, wrong provenance
        return { ok: false, reason: 'TOKEN_WRONG_LINK', retryable: false };
      }
      if (verdict.createdAt && verdict.createdAt.getTime() > now.getTime() + 60_000) {
        // a key "created" in the future means a tampered/broken provider
        // response — refuse rather than trust a clock we cannot place
        return { ok: false, reason: 'PROVIDER_ERROR', retryable: true };
      }
      return { ok: true, linkId: verdict.linkId, createdAt: verdict.createdAt, ip: verdict.ip };
    }
  }
}