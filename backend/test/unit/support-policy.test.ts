import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  CONTACT_CODE_RE,
  MESSAGE_MAX,
  canTransition,
  isValidContactCode,
  ownerCanDelete,
  ratingAllowed,
  redactSecrets,
} from '../../src/modules/support/support-policy.ts';

describe('ticket transitions', () => {
  it('open accepts staff progress + owner close', () => {
    assert.equal(canTransition('open', 'in_progress', 'support'), true);
    assert.equal(canTransition('open', 'closed', 'owner'), true);
    assert.equal(canTransition('open', 'closed', 'support'), false);
    assert.equal(canTransition('open', 'open', 'owner'), true);
  });

  it('waiting_admin only clears toward in_progress by admin', () => {
    assert.equal(canTransition('waiting_admin', 'in_progress', 'admin'), true);
    assert.equal(canTransition('waiting_admin', 'in_progress', 'support'), false);
    assert.equal(canTransition('waiting_admin', 'resolved', 'support'), true);
  });

  it('resolved reopens for owner, reworks for support, closes for both', () => {
    assert.equal(canTransition('resolved', 'open', 'owner'), true);
    assert.equal(canTransition('resolved', 'open', 'support'), false);
    assert.equal(canTransition('resolved', 'in_progress', 'support'), true);
    assert.equal(canTransition('resolved', 'closed', 'owner'), true);
  });

  it('closed reopens for admin only', () => {
    assert.equal(canTransition('closed', 'open', 'admin'), true);
    assert.equal(canTransition('closed', 'open', 'owner'), false);
    assert.equal(canTransition('closed', 'resolved', 'admin'), false);
  });

  it('unknown targets are rejected', () => {
    assert.equal(canTransition('open', 'archived' as never, 'admin'), false);
  });
});

describe('owner delete rule', () => {
  it('only fresh untouched open tickets', () => {
    assert.equal(ownerCanDelete('open', false, false), true);
    assert.equal(ownerCanDelete('open', true, false), false);
    assert.equal(ownerCanDelete('open', false, true), false);
    assert.equal(ownerCanDelete('resolved', false, false), false);
  });
});

describe('rating eligibility', () => {
  const eligible = { isOwner: true, status: 'resolved' as const, staffEngaged: true, alreadyRated: false };
  it('owner of resolved+engaged ticket, once', () => {
    assert.equal(ratingAllowed(eligible).ok, true);
  });

  it('rejects non-owner, open tickets, no-engagement, and doubles', () => {
    assert.equal(ratingAllowed({ ...eligible, isOwner: false }).ok, false);
    assert.equal(ratingAllowed({ ...eligible, status: 'in_progress' }).ok, false);
    assert.equal(ratingAllowed({ ...eligible, staffEngaged: false }).ok, false);
    assert.equal(ratingAllowed({ ...eligible, alreadyRated: true }).ok, false);
  });

  it('closed tickets are rateable too', () => {
    assert.equal(ratingAllowed({ ...eligible, status: 'closed' }).ok, true);
  });
});

describe('contact codes', () => {
  it('exactly 8 digits, leading zeros kept', () => {
    assert.equal(isValidContactCode('58310472'), true);
    assert.equal(isValidContactCode('00120345'), true);
    assert.equal(isValidContactCode('1234567'), false);
    assert.equal(isValidContactCode('123456789'), false);
    assert.equal(isValidContactCode('1234abcd'), false);
    assert.equal(isValidContactCode(''), false);
    assert.ok(CONTACT_CODE_RE.test('00000000'));
  });

  it('message cap is sane', () => {
    assert.equal(MESSAGE_MAX, 4000);
  });
});

describe('log redaction (secrets never reach a support agent)', () => {
  it('masks key=value secrets and bearer tokens', () => {
    const a = redactSecrets(' connecting with password=hunter2 now');
    assert.ok(!a.includes('hunter2'), 'password value leaked');
    assert.match(a, /password=\*\*\*REDACTED\*\*\*/i);

    const b = redactSecrets('Authorization: Bearer abcdefghijklmnop');
    assert.ok(!b.includes('abcdefghijklmnop'), 'bearer token leaked');
    assert.match(b, /REDACTED/);

    const c = redactSecrets('DB_URL=postgres://tina:s3cret@db:5432/app');
    assert.ok(!c.includes('s3cret'), 'db password leaked');
    assert.match(c, /tina:\*\*\*REDACTED\*\*\*@db/);

    assert.match(redactSecrets('key sk_live_abcdef1234567890 rejected'), /REDACTED/);
  });

  it('is case-insensitive and keeps the readable context', () => {
    const out = redactSecrets('PASSWORD: "topsecret!" user=tina');
    assert.match(out, /PASSWORD=\*\*\*REDACTED\*\*\*/);
    assert.match(out, /user=tina/);
  });

  it('leaves harmless lines untouched', () => {
    const clean = 'Server started on port 3000 (node v20)';
    assert.equal(redactSecrets(clean), clean);
  });

  it('caps absurdly long lines', () => {
    assert.equal(redactSecrets('x'.repeat(5000)).length, 2000);
  });
});
