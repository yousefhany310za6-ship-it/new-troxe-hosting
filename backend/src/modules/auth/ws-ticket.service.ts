import { Injectable, UnauthorizedException } from '@nestjs/common';
import { config } from '../../config/env';
import * as crypto from 'crypto';

export interface WsTicketPayload {
  sub: string;      // user id
  iat: number;      // issued at
  exp: number;      // expires at (Unix seconds)
  typ: 'ws_ticket';
}

@Injectable()
export class WsTicketService {
  private readonly secret: Buffer;
  private readonly ttlSec = 30;

  constructor() {
    const raw = config.WS_TICKET_SECRET ?? config.JWT_ACCESS_SECRET;
    if (!raw) throw new Error('WS_TICKET_SECRET or JWT_ACCESS_SECRET must be set');
    this.secret = Buffer.from(raw, 'base64');
  }

  /** Issue a short-lived WS ticket (HMAC-SHA256, base64url). */
  issue(userId: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: WsTicketPayload = {
      sub: userId,
      iat: now,
      exp: now + this.ttlSec,
      typ: 'ws_ticket',
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = this.sign(body);
    return `${body}.${sig}`;
  }

  /** Verify and decode a ticket. Throws if invalid/expired. */
  verify(ticket: string): WsTicketPayload {
    const [body, sig] = ticket.split('.');
    if (!body || !sig) throw new UnauthorizedException('WS_TICKET_MALFORMED');
    if (!this.timingSafeEqual(sig, this.sign(body))) {
      throw new UnauthorizedException('WS_TICKET_INVALID_SIGNATURE');
    }
    let payload: WsTicketPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      throw new UnauthorizedException('WS_TICKET_INVALID_PAYLOAD');
    }
    if (payload.typ !== 'ws_ticket') throw new UnauthorizedException('WS_TICKET_WRONG_TYPE');
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new UnauthorizedException('WS_TICKET_EXPIRED');
    return payload;
  }

  private sign(data: string): string {
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }
}