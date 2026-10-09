import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user';
import { AdminGuard } from '../auth/admin.guard';
import { ctxOf } from '../../common/request-context';
import { SupportService } from './support.service';
import { AssignTicketDto, QueueQueryDto } from './dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * Admin support console: team management, every ticket, escalations and the
 * auditable rating data. All routes are admin-gated (JwtAuthGuard + AdminGuard)
 * — a support member hitting these gets 403, never partial data.
 */
@Controller({ path: 'admin/support', version: '1' })
@UseGuards(JwtAuthGuard, AdminGuard)
@Throttle({ default: { limit: 180, ttl: 60_000 } })
export class AdminSupportController {
  constructor(private support: SupportService) {}

  @Get('tickets')
  tickets(@Query() q: QueueQueryDto, @CurrentUser() u: ReqUser) {
    return this.support.listQueue(u, q.view ?? 'all', q);
  }

  @Get('escalations')
  escalations(@Query('status') status?: string) {
    return this.support.listEscalations(status);
  }

  @Post('escalations/:id/ack')
  @HttpCode(200)
  ack(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.ackEscalation(id, u.sub, ctxOf(req));
  }

  /**
   * Accept an admin call. Exactly one admin can be the responder: the update
   * only lands while the request is still pending, so a simultaneous click
   * from a second admin is refused with 409 instead of double-counting.
   */
  @Post('escalations/:id/accept')
  @HttpCode(200)
  accept(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.acceptEscalation(id, u.sub, ctxOf(req));
  }

  /** Decline the call; it stays open for another administrator and is journaled. */
  @Post('escalations/:id/decline')
  @HttpCode(200)
  decline(
    @Param('id', UUID) id: string,
    @Body() body: { reason?: string },
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.declineEscalation(id, u.sub, body?.reason ?? '', ctxOf(req));
  }

  /**
   * Support performance for the whole team (admin only). Every number comes
   * from recorded events in the window; the per-member figures are the same
   * ones the member sees about themselves, so nobody can curate them.
   */
  @Get('performance')
  performance(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() u: ReqUser,
  ) {
    return this.support.teamPerformance({ requester: u, from, to });
  }

  @Get('performance/:supportId')
  memberPerformance(
    @Param('supportId', UUID) supportId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() u: ReqUser,
  ) {
    return this.support.performance({ requester: u, supportId, from, to });
  }

  @Get('team')
  team(@CurrentUser() u: ReqUser) {
    // admins may see every member's rating performance
    return this.support.listMembers(u, { includePerformance: true });
  }

  /** Assign (or reassign) a ticket to a support member / admin. */
  @Post('tickets/:id/assign')
  @HttpCode(200)
  assign(
    @Param('id', UUID) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.assign(id, dto.supportId, u, ctxOf(req));
  }

  @Get('ratings')
  ratings(@Query('supportId') supportId: string, @Query('page') page: number, @CurrentUser() u: ReqUser) {
    return this.support.listRatings(u, { supportId, page });
  }

  @Get('ratings/:supportId')
  ratingSummary(@Param('supportId', UUID) supportId: string, @CurrentUser() u: ReqUser) {
    return this.support.ratingSummary(supportId, u);
  }
}
