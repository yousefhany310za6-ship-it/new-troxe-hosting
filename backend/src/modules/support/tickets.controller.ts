import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user';
import { ctxOf } from '../../common/request-context';
import { SupportService } from './support.service';
import {
  CreateTicketDto,
  MyTicketsQueryDto,
  RateTicketDto,
  SendMessageDto,
  SetStatusDto,
} from './dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * User-facing ticket endpoints. Ownership is enforced from the authenticated
 * subject (never a body field): every handler resolves the ticket through
 * `requireAccess`, so a foreign ticket id is indistinguishable from a missing
 * one (404) unless the caller actually owns/sees it.
 */
@Controller({ path: 'support', version: '1' })
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class TicketsController {
  constructor(private support: SupportService) {}

  @Post('tickets')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  create(@Body() dto: CreateTicketDto, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.createTicket(u.sub, dto, ctxOf(req));
  }

  @Get('tickets')
  list(@Query() q: MyTicketsQueryDto, @CurrentUser() u: ReqUser) {
    return this.support.listMine(u.sub, q.page, q.limit, q.status);
  }

  @Get('tickets/:id')
  detail(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.support.detail(id, u);
  }

  @Get('tickets/:id/messages')
  messages(@Param('id', UUID) id: string, @Query('page') page: number, @CurrentUser() u: ReqUser) {
    return this.support.history(id, u, page);
  }

  @Post('tickets/:id/messages')
  @HttpCode(201)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  send(
    @Param('id', UUID) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.sendMessage(id, u, dto.body, dto.clientMsgId, ctxOf(req));
  }

  /**
   * Read receipt for the counterpart's messages up to `upToId`. The reader is
   * taken from the session — a client can never mark someone else's messages
   * as read, nor its own.
   */
  @Post('tickets/:id/read')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  read(@Param('id', UUID) id: string, @Body() body: { upToId: string }, @CurrentUser() u: ReqUser) {
    return this.support.markRead(id, u, body?.upToId);
  }

  /** Owner actions: close, reopen. Staff transitions live on the queue API. */
  @Patch('tickets/:id/status')
  setStatus(
    @Param('id', UUID) id: string,
    @Body() dto: SetStatusDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.setStatus(id, dto.status, u, ctxOf(req));
  }

  @Post('tickets/:id/rate')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  rate(
    @Param('id', UUID) id: string,
    @Body() dto: RateTicketDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.rate(id, u.sub, dto, ctxOf(req));
  }

  @Get('tickets/:id/rating')
  rating(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.support.ratingEligibility(id, u.sub);
  }

  /** Soft delete: history survives for dispute review. */
  @Delete('tickets/:id')
  remove(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.softDelete(id, u, ctxOf(req));
  }

  // ------------------------------------------------------ notifications
  // Shared inbox: users and staff both receive ticket notifications, each
  // scoped to their own userId.

  @Get('notifications')
  notifications(@Query('page') page: number, @CurrentUser() u: ReqUser) {
    return this.support.listNotifications(u.sub, page);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() u: ReqUser) {
    return this.support.readAllNotifications(u.sub);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  readOne(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.support.readNotification(id, u.sub);
  }
}
