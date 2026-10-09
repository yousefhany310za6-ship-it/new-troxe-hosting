import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  audienceMatches,
  canDismiss,
  isActive,
  isValidActionUrl,
  shouldShow,
} from '../../src/modules/announcements/announcement-policy.ts';

const base = {
  status: 'published' as const,
  publishAt: null,
  expiresAt: null,
  policy: 'once' as const,
  requireAck: false,
  intervalHours: null,
  contentVersion: 1,
};

const ix = (over = {}) => ({
  version: 1,
  lastShownAt: null,
  ackedAt: null,
  dismissedAt: null,
  ...over,
});

describe('isActive', () => {
  it('draft/scheduled/paused/archived are never active', () => {
    for (const status of ['draft', 'scheduled', 'paused', 'archived'] as const) {
      assert.equal(isActive({ ...base, status }), false, status);
    }
  });

  it('published with no window is active', () => {
    assert.equal(isActive(base), true);
  });

  it('future publishAt is inactive, past expiry is inactive', () => {
    const now = Date.now();
    assert.equal(isActive({ ...base, publishAt: new Date(now + 3600_000) }), false);
    assert.equal(isActive({ ...base, expiresAt: new Date(now - 1000) }), false);
    assert.equal(
      isActive({ ...base, publishAt: new Date(now - 1000), expiresAt: new Date(now + 3600_000) }),
      true,
    );
  });
});

describe('once policy', () => {
  it('shows with no interaction', () => {
    assert.equal(shouldShow(base, null), true);
  });

  it('hides after dismiss or ack (same version)', () => {
    assert.equal(shouldShow(base, ix({ dismissedAt: new Date() })), false);
    assert.equal(shouldShow(base, ix({ ackedAt: new Date() })), false);
  });

  it('resurfaces after a content-version bump', () => {
    const v2 = { ...base, contentVersion: 2 };
    assert.equal(shouldShow(v2, ix({ dismissedAt: new Date() })), true);
  });
});

describe('every_visit policy', () => {
  const a = { ...base, policy: 'every_visit' as const };
  it('always shows while active', () => {
    assert.equal(shouldShow(a, null), true);
    assert.equal(shouldShow(a, ix({ dismissedAt: new Date() })), true);
  });

  it('with requireAck, hides only after ack', () => {
    const m = { ...a, requireAck: true };
    assert.equal(shouldShow(m, null), true);
    assert.equal(shouldShow(m, ix({ dismissedAt: new Date() })), true);
    assert.equal(shouldShow(m, ix({ ackedAt: new Date() })), false);
  });
});

describe('interval policy', () => {
  const a = { ...base, policy: 'interval' as const, intervalHours: 24 };
  const now = Date.now();

  it('shows when never shown', () => {
    assert.equal(shouldShow(a, null, now), true);
  });

  it('hides inside the window, shows after', () => {
    assert.equal(shouldShow(a, ix({ lastShownAt: new Date(now - 3600_000) }), now), false);
    assert.equal(shouldShow(a, ix({ lastShownAt: new Date(now - 25 * 3600_000) }), now), true);
  });

  it('old-version rows do not suppress the new version', () => {
    const v2 = { ...a, contentVersion: 2 };
    assert.equal(shouldShow(v2, ix({ lastShownAt: new Date(now - 1000) }), now), true);
  });
});

describe('until_ack policy', () => {
  const a = { ...base, policy: 'until_ack' as const };
  it('shows until acked, dismiss never suppresses', () => {
    assert.equal(shouldShow(a, null), true);
    assert.equal(shouldShow(a, ix({ dismissedAt: new Date() })), true);
    assert.equal(shouldShow(a, ix({ ackedAt: new Date() })), false);
  });
});

describe('canDismiss (mandatory gate)', () => {
  it('free banners always dismissible', () => {
    assert.equal(canDismiss(base, null), true);
  });

  it('mandatory banners need ack first', () => {
    const m = { ...base, requireAck: true };
    assert.equal(canDismiss(m, null), false);
    assert.equal(canDismiss(m, ix({ dismissedAt: new Date() })), false);
    assert.equal(canDismiss(m, ix({ ackedAt: new Date() })), true);
  });
});

describe('audienceMatches', () => {
  const user = { id: 'u1', planId: 'pro' };
  it('all/empty matches everyone', () => {
    assert.equal(audienceMatches({ type: 'all' }, user), true);
    assert.equal(audienceMatches(null, user), true);
    assert.equal(audienceMatches(undefined, user), true);
  });

  it('plans and users slices match exactly', () => {
    assert.equal(audienceMatches({ type: 'plans', plans: ['pro'] }, user), true);
    assert.equal(audienceMatches({ type: 'plans', plans: ['free'] }, user), false);
    assert.equal(audienceMatches({ type: 'users', userIds: ['u1'] }, user), true);
    assert.equal(audienceMatches({ type: 'users', userIds: ['u2'] }, user), false);
  });
});

describe('isValidActionUrl', () => {
  it('accepts site paths and http(s)', () => {
    assert.equal(isValidActionUrl('/pricing'), true);
    assert.equal(isValidActionUrl('/dashboard/servers'), true);
    assert.equal(isValidActionUrl('https://example.com/x'), true);
    assert.equal(isValidActionUrl('http://example.com/x'), true);
  });

  it('rejects dangerous schemes and shapes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<h1>x</h1>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.com/x',
      '/has space',
      '/has<angle>',
      '',
    ]) {
      assert.equal(isValidActionUrl(bad), false, bad || '(empty)');
    }
  });
});
