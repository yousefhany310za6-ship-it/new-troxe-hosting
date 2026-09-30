import { Injectable, UnauthorizedException } from '@nestjs/common';
import { WsTicketService } from './ws-ticket.service';

@Injectable()
export class WsAuthGuard {
  constructor(private wsTicket: WsTicketService) {}

  /** Validate ticket from handshake query: `?ticket=...` */
  validate(ticket?: string): { userId: string } {
    if (!ticket) throw new UnauthorizedException('WS_TICKET_MISSING');
    const payload = this.wsTicket.verify(ticket);
    return { userId: payload.sub };
  }
}