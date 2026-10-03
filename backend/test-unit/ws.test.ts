import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import { WsTicketService } from '../src/modules/auth/ws-ticket.service';
import { config } from '../src/config/env';

export function testWsTicket() {
  const svc = new WsTicketService();

  // ---- issue / verify round trip
  const t = svc.issue('u-1');
  const p = svc.verify(t);
  assert.equal(p.sub, 'u-1');
  assert.equal(p.typ, 'ws_ticket');
  assert.ok(p.exp > p.iat, 'expiry after issue');
  assert.ok(p.exp - p.iat <= 30, 'ttl is 30s or less');

  const [body, sig] = t.split('.');

  // ---- rejections
  assert.throws(() => svc.verify('not-a-ticket'), /WS_TICKET_MALFORMED/);
  assert.throws(() => svc.verify(`${body}tampered.${sig}`), /WS_TICKET_INVALID_SIGNATURE/);
  const wrongType = Buffer.from(JSON.stringify({ sub: 'u-1', iat: 1, exp: 9_999_999_999, typ: 'jwt' })).toString('base64url');
  assert.throws(() => svc.verify(`${wrongType}.${sig}`), /WS_TICKET_INVALID_SIGNATURE/);

  // ---- KEY SEPARATION (the fix): the ticket key must not be the JWT key,
  // and a signature produced in another context must not transfer.
  assert.notEqual(config.WS_TICKET_SECRET, config.JWT_ACCESS_SECRET, 'ticket key is derived, not the JWT secret');
  const cross = crypto
    .createHmac('sha256', Buffer.from(config.WS_TICKET_SECRET, 'utf8'))
    .update(body)
    .digest('base64url'); // old behaviour: HMAC(master, body) with no context label
  assert.notEqual(cross, sig, 'context label changes the signature');
  assert.throws(() => svc.verify(`${body}.${cross}`), /WS_TICKET_INVALID_SIGNATURE/, 'cross-context signature rejected');

  // deterministic across "restarts": same secret -> same key for the process
  const svc2 = new WsTicketService();
  assert.ok(svc2.verify(svc.issue('u-2')).sub === 'u-2');
}
