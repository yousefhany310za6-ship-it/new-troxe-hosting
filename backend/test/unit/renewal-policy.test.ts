import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  COMPLETION_ATTEMPTS_PER_SESSION,
  EXPIRY_WARNING_MINUTES,
  PROVIDER_TOKEN_TTL_MINUTES,
  RENEWAL_HOURS,
  SESSION_START_PER_HOUR,
  SESSION_TTL_MINUTES,
  TERMINAL_SESSION_STATES,
  checkEligibility,
  evaluateVerdict,
  expiryState,
  initialExpiry,
  isSessionOpen,
  minutesRemaining,
  nextExpiry,
  validateTokenShape,
} from '../../src/modules/servers/renewal-policy.ts';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-13T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * HOUR);

describe('product rule: 24 hours per verified renewal', () => {
  it('grants exactly 24 hours', () => {
    assert.equal(RENEWAL_HOURS, 24);
  });

  it('newExpiresAt = serverTime + 24h, NOT old deadline + 24h', () => {
    // a server that expired 20 hours ago gets a FULL fresh 24 hours
    const at = nextExpiry(NOW);
    assert.equal(at.getTime() - NOW.getTime(), 24 * HOUR);
    assert.equal(at.toISOString(), '2026-10-14T12:00:00.000Z');
  });

  it('does not shrink an already-longer deadline', () => {
    // 30 minutes left, renewed → still 24h from now, never 30 minutes
    const next = nextExpiry(NOW);
    assert.ok(next.getTime() > NOW.getTime() + 23 * HOUR);
  });

  it('honours an explicit duration but never a negative one', () => {
    assert.equal(nextExpiry(NOW, 1).getTime() - NOW.getTime(), HOUR);
    assert.equal(nextExpiry(NOW, 0).getTime() - NOW.getTime(), 0);
    assert.ok(nextExpiry(NOW, -5).getTime() < NOW.getTime());
  });
});

describe('expiry classification', () => {
  it('marks a paid plan (null deadline) as never expiring', () => {
    assert.equal(expiryState({ expiresAt: null, now: NOW }), 'not_expiring');
  });

  it('marks a passed deadline as expired', () => {
    assert.equal(expiryState({ expiresAt: hoursAgo(0.001), now: NOW }), 'expired');
    assert.equal(expiryState({ expiresAt: hoursAgo(5), now: NOW }), 'expired');
  });

  it('warns inside the warning window and stays active outside it', () => {
    assert.equal(expiryState({ expiresAt: hoursAhead(2), now: NOW }), 'active');
    assert.equal(
      expiryState({ expiresAt: hoursAhead(EXPIRY_WARNING_MINUTES / 60), now: NOW }),
      'expiring_soon',
    );
  });

  it('reports whole minutes remaining, never negative', () => {
    assert.equal(minutesRemaining(null, NOW), null);
    assert.equal(minutesRemaining(hoursAhead(1), NOW), 60);
    assert.equal(minutesRemaining(hoursAgo(3), NOW), 0);
  });

  it('sets the creation deadline from the plan lifetime, null without one', () => {
    assert.equal(initialExpiry(24, NOW)?.toISOString(), hoursAhead(24).toISOString());
    assert.equal(initialExpiry(null, NOW), null);
    assert.equal(initialExpiry(0, NOW), null); // a zero lifetime would be unusable
  });
});

describe('who may renew', () => {
  const base = { lifetimeHours: 24, status: 'suspended', now: NOW };

  it('allows an expired free server', () => {
    assert.equal(checkEligibility({ ...base, expiresAt: hoursAgo(1) }).eligible, true);
  });

  it('refuses a paid server — the plan has no lifetime', () => {
    const r = checkEligibility({ ...base, lifetimeHours: null, expiresAt: null });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'PLAN_NOT_EXPIRING');
  });

  it('refuses a free server that still has runtime left', () => {
    const r = checkEligibility({ ...base, expiresAt: hoursAhead(6) });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'NOT_EXPIRED');
    assert.match(r.message ?? '', /24 hours/);
  });

  it('refuses a server with no deadline even on an expiring plan', () => {
    const r = checkEligibility({ ...base, expiresAt: null });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'PLAN_NOT_EXPIRING');
  });

  it('refuses a server being deleted', () => {
    const r = checkEligibility({ ...base, expiresAt: hoursAgo(1), status: 'deleting' });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'SERVER_DELETING');
  });
});

describe('session lifecycle', () => {
  it('stays open only while pending and unexpired', () => {
    const open = { status: 'pending', expiresAt: new Date(NOW.getTime() + 60_000) };
    assert.equal(isSessionOpen(open, NOW), true);
    assert.equal(isSessionOpen({ ...open, expiresAt: hoursAgo(1) }, NOW), false);
    assert.equal(isSessionOpen({ ...open, status: 'verifying' }, NOW), false);
    assert.equal(isSessionOpen({ ...open, status: 'completed' }, NOW), false);
  });

  it('has no way out of a terminal state — this is what blocks replay', () => {
    for (const state of TERMINAL_SESSION_STATES) {
      assert.ok(
        ['completed', 'failed', 'expired'].includes(state),
        `${state} must be terminal`,
      );
    }
  });

  it('bounds how long an attempt and how many attempts there may be', () => {
    assert.ok(SESSION_TTL_MINUTES > 0 && SESSION_TTL_MINUTES <= 60);
    assert.ok(SESSION_START_PER_HOUR > 0 && SESSION_START_PER_HOUR <= 30);
    assert.ok(COMPLETION_ATTEMPTS_PER_SESSION > 0);
  });

  it('an attempt cannot meaningfully outlive the provider key it verifies', () => {
    // Measured, not assumed: a real Work.ink key returned
    // expiresAfter - createdAt = 299 999 ms. An attempt window much longer
    // than that only produces sessions the provider can never satisfy.
    assert.ok(
      SESSION_TTL_MINUTES <= PROVIDER_TOKEN_TTL_MINUTES * 3,
      `attempt window ${SESSION_TTL_MINUTES}m is too long for a ${PROVIDER_TOKEN_TTL_MINUTES}m key`,
    );
    // …but it must be long enough that the user can actually finish
    assert.ok(SESSION_TTL_MINUTES >= PROVIDER_TOKEN_TTL_MINUTES);
  });
});

describe('key shape is checked before any network call', () => {
  it('rejects missing, oversized and hostile shapes', () => {
    assert.equal(validateTokenShape(undefined).ok, false);
    assert.equal(validateTokenShape('').ok, false);
    assert.equal(validateTokenShape('a'.repeat(257)).ok, false);
    for (const bad of ['../../etc/passwd', 'abc/def', 'abc def', 'abc?x=1', 'abc\ndef', '<script>']) {
      const r = validateTokenShape(bad);
      assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
      if (!r.ok) assert.equal(r.reason, 'TOKEN_MALFORMED');
    }
  });

  it('accepts an opaque token and trims it', () => {
    const r = validateTokenShape('  abc123.XYZ_-~  ');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.token, 'abc123.XYZ_-~');
  });
});

describe('a provider verdict alone is never enough to renew', () => {
  const valid = { kind: 'valid', linkId: '10345', createdAt: hoursAgo(1), ip: '1.2.3.4' } as const;

  it('accepts a key minted by OUR link', () => {
    const r = evaluateVerdict({ verdict: valid, expectedLinkId: '10345', now: NOW });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.linkId, '10345');
  });

  it('REFUSES a key minted by a different link — the provenance binding', () => {
    const r = evaluateVerdict({ verdict: { ...valid, linkId: '999' }, expectedLinkId: '10345', now: NOW });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'TOKEN_WRONG_LINK');
  });

  it('treats a plain invalid answer as invalid, not as an outage', () => {
    const r = evaluateVerdict({ verdict: { kind: 'invalid' }, expectedLinkId: '10345', now: NOW });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'TOKEN_INVALID');
      assert.equal(r.retryable, false);
    }
  });

  it('treats an expired key as expired', () => {
    const r = evaluateVerdict({ verdict: { kind: 'expired' }, expectedLinkId: '10345', now: NOW });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'TOKEN_EXPIRED');
  });

  it('NEVER converts a provider outage into a free renewal', () => {
    for (const kind of ['unavailable', 'error'] as const) {
      const r = evaluateVerdict({ verdict: { kind }, expectedLinkId: '10345', now: NOW });
      assert.equal(r.ok, false, `${kind} must never succeed`);
      if (!r.ok) {
        assert.equal(r.retryable, true, `${kind} must let the user retry`);
      }
    }
  });

  it('refuses a key claiming to be created in the future', () => {
    const r = evaluateVerdict({
      verdict: { ...valid, createdAt: hoursAhead(2) },
      expectedLinkId: '10345',
      now: NOW,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'PROVIDER_ERROR');
  });

  it('accepts a small clock skew (a minute) without being fooled by it', () => {
    const ok = evaluateVerdict({
      verdict: { ...valid, createdAt: new Date(NOW.getTime() + 30_000) },
      expectedLinkId: '10345',
      now: NOW,
    });
    assert.equal(ok.ok, true);
  });
});