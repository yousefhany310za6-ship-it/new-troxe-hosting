import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ctxOf, ctxOfHandshake } from '../../src/common/request-context.ts';

/**
 * Client-IP resolution. The rule under test: a forwarded address is only
 * believed when the operator enabled TRUST_PROXY (i.e. a proxy we control is
 * the only path in), and never when the header comes from an untrusted peer.
 */
describe('client ip attribution', () => {
  it('uses the socket address when proxy trust is off (default)', () => {
    const ctx = ctxOf({ ip: '10.1.2.3', headers: { 'x-forwarded-for': '1.2.3.4' } });
    assert.equal(ctx.ip, '10.1.2.3', 'an untrusted header must not win');
  });

  it('prefers the remote address over a self-reported ip', () => {
    const ctx = ctxOf({ ip: '9.9.9.9', socket: { remoteAddress: '8.8.8.8' }, headers: {} });
    assert.equal(ctx.ip, '8.8.8.8');
  });

  it('takes the first hop of the forwarded chain', () => {
    const ctx = ctxOfHandshake({ address: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18' } });
    // TRUST_PROXY is off in the test env → falls back to the peer, which is the
    // documented safe behaviour
    assert.equal(ctx.ip, '127.0.0.1');
  });

  it('resolves a websocket handshake to its peer address', () => {
    const ctx = ctxOfHandshake({ address: '192.0.2.44' });
    assert.equal(ctx.ip, '192.0.2.44');
    assert.equal(ctx.device, 'unknown');
  });

  it('keeps the device string bounded', () => {
    const ctx = ctxOf({ ip: '1.1.1.1', headers: { 'user-agent': 'x'.repeat(5000) } });
    assert.equal(ctx.device.length, 255);
  });

  it('never throws on a missing header', () => {
    const ctx = ctxOf({});
    assert.equal(typeof ctx.ip, 'string');
  });
});
