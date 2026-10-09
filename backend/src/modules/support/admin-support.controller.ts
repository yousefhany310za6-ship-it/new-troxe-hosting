import {
  Body,
  Controller,
  Get,
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
  tickets(@Query() q: QueueQueryDto) {
    return this.support.listQueue({ sub: '', role: 'admin' }, q.view ?? 'all', q);
  }

  @Get('escalations')
  escalations(@Query('status') status?: string) {
    return this.support.listEscalations(status);
  }

  @Post('escalations/:id/ack')
  ack(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.ackEscalation(id, u.sub, ctxOf(req));
  }

  @Get('team')
  team(@CurrentUser() u: ReqUser) {
    // admins may see every member's rating performance
    return this.support.listMembers(u, { includePerformance: true });
  }

  /** Assign (or reassign) a ticket to a support member / admin. */
  @Post('tickets/:id/assign')
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
