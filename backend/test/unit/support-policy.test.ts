import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  CONTACT_CODE_RE,
  DEFAULT_PRIORITY,
  MESSAGE_MAX,
  PRIORITIES,
  canPost,
  canSetPriority,
  canTransition,
  isValidContactCode,
  ownerCanDelete,
  ratingAllowed,
  redactSecrets,
} from '../../src/modules/support/support-policy.ts';

describe('ticket transitions (staff-only lifecycle)', () => {
  it('the owner can never change the status', () => {
    assert.equal(canTransition('open', 'closed', 'owner'), false);
    assert.equal(canTransition('open', 'resolved', 'owner'), false);
    assert.equal(canTransition('resolved', 'open', 'owner'), false);
    assert.equal(canTransition('waiting_user', 'in_progress', 'owner'), false);
    assert.equal(canTransition('closed', 'open', 'owner'), false);
  });

  it('staff can progress, wait, resolve and close', () => {
    assert.equal(canTransition('open', 'in_progress', 'support'), true);
    assert.equal(canTransition('open', 'resolved', 'support'), true);
    assert.equal(canTransition('in_progress', 'closed', 'support'), true);
    assert.equal(canTransition('waiting_user', 'closed', 'admin'), true);
    assert.equal(canTransition('resolved', 'closed', 'support'), true);
  });

  it('waiting_admin clears back to in_progress only by an admin', () => {
    assert.equal(canTransition('waiting_admin', 'in_progress', 'admin'), true);
    assert.equal(canTransition('waiting_admin', 'in_progress', 'support'), false);
    assert.equal(canTransition('waiting_admin', 'resolved', 'support'), true);
  });

  it('resolved can be reworked by staff, reopened by admin only', () => {
    assert.equal(canTransition('resolved', 'in_progress', 'support'), true);
    assert.equal(canTransition('resolved', 'open', 'admin'), true);
    assert.equal(canTransition('resolved', 'open', 'support'), false);
  });

  it('closed reopens for admin only', () => {
    assert.equal(canTransition('closed', 'open', 'admin'), true);
    assert.equal(canTransition('closed', 'open', 'support'), false);
    assert.equal(canTransition('closed', 'resolved', 'admin'), false);
  });

  it('unknown targets are rejected', () => {
    assert.equal(canTransition('open', 'archived' as never, 'admin'), false);
  });

  it('a transition to the same state is a no-op', () => {
    assert.equal(canTransition('open', 'open', 'owner'), true);
  });
});

describe('exclusive posting', () => {
  const base = { status: 'in_progress' as const, assigneeId: 'staff-a', authorId: 'staff-a' };

  it('the assigned specialist can post', () => {
    assert.equal(canPost({ ...base, role: 'support' }), true);
  });

  it('another support member cannot, even while unassigned', () => {
    assert.equal(canPost({ ...base, authorId: 'staff-b' }), false);
    assert.equal(canPost({ ...base, assigneeId: null, authorId: 'staff-b' }), false);
  });

  it('an admin can always post', () => {
    assert.equal(canPost({ ...base, authorId: 'admin-x', role: 'admin' }), true);
  });

  it('the owner posts while the ticket is open to conversation', () => {
    assert.equal(canPost({ ...base, role: 'owner', authorId: 'user-x' }), true);
    assert.equal(canPost({ ...base, role: 'owner', authorId: 'user-x', status: 'resolved' }), true);
  });

  it('nobody posts into a closed ticket', () => {
    assert.equal(canPost({ ...base, status: 'closed', role: 'admin' }), false);
    assert.equal(canPost({ ...base, status: 'closed', role: 'owner', authorId: 'user-x' }), false);
  });
});

describe('priority authority', () => {
  it('only the assignee or an admin may set it', () => {
    assert.equal(canSetPriority({ role: 'support', isAssignee: true }), true);
    assert.equal(canSetPriority({ role: 'support', isAssignee: false }), false);
    assert.equal(canSetPriority({ role: 'admin', isAssignee: false }), true);
    assert.equal(canSetPriority({ role: 'owner', isAssignee: true }), false);
  });

  it('users never pick a priority: tickets open at the default', () => {
    assert.equal(DEFAULT_PRIORITY, 'medium');
    assert.equal(PRIORITIES.includes(DEFAULT_PRIORITY), true);
  });
});

describe('owner delete rule', () => {
  it('only fresh untouched open tickets', () => {
    assert.equal(ownerCanDelete('open', false, false), true);
    assert.equal(ownerCanDelete('open', true, false), false);
    assert.equal(ownerCanDelete('open', false, true), false);
    assert.equal(ownerCanDelete('closed', false, false), false);
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
