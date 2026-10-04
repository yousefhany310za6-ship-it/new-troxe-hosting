import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { signUnsubscribe, verifyUnsubscribe } from '../../src/modules/email/email.tokens.ts';
import { deliveryFor, extractEmailId } from '../../src/modules/email/webhook-events.ts';
import { Webhook } from 'svix';

const SECRET = 'whsec_' + 'a'.repeat(32);

describe('unsubscribe tokens', () => {
  it('round-trips a user id', () => {
    const t = signUnsubscribe('user-123', SECRET);
    assert.equal(verifyUnsubscribe(t, SECRET), 'user-123');
  });
  it('rejects tampering, wrong secret and garbage', () => {
    const t = signUnsubscribe('user-123', SECRET);
    assert.equal(verifyUnsubscribe(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'), SECRET), null);
    assert.equal(verifyUnsubscribe(t, SECRET + 'x'), null);
    assert.equal(verifyUnsubscribe('garbage', SECRET), null);
    assert.equal(verifyUnsubscribe('', SECRET), null);
  });
});

describe('webhook delivery mapping', () => {
  it('maps known Resend events and ignores the rest', () => {
    assert.equal(deliveryFor('email.delivered'), 'delivered');
    assert.equal(deliveryFor('email.bounced'), 'bounced');
    assert.equal(deliveryFor('email.complained'), 'complained');
    assert.equal(deliveryFor('email.opened'), 'opened');
    assert.equal(deliveryFor('email.clicked'), 'clicked');
    assert.equal(deliveryFor('email.whatever_future'), undefined);
    assert.equal(deliveryFor(42), undefined);
  });
  it('extracts email ids defensively', () => {
    assert.equal(extractEmailId({ email_id: 'abc' }), 'abc');
    assert.equal(extractEmailId({}), null);
    assert.equal(extractEmailId(null), null);
    assert.equal(extractEmailId({ email_id: 'x'.repeat(200) }), null);
  });
  it('svix accepts the exact raw bytes and rejects any alteration (proves rawBody is required)', () => {
    const wh = new Webhook(SECRET);
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc' } });
    const id = 'msg_test123';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = wh.sign(id, new Date(Number(ts) * 1000), payload);
    const headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig };
    assert.doesNotThrow(() => wh.verify(payload, headers));
    // a single altered byte fails verification (this is why the controller
    // must see the raw body, never a re-serialized object)
    assert.throws(() => wh.verify(payload + ' ', headers));
    assert.throws(() => wh.verify(payload, { ...headers, 'svix-signature': 'v1,AAAA' }));
  });
});
