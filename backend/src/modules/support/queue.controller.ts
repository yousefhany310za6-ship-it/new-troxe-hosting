import {
  Body,
  Controller,
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
import { SupportGuard } from './support.guard';
import { AssignTicketDto, EscalateDto, QueueQueryDto, SetPriorityDto, UpdateSubjectDto } from './dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * Support-team endpoints. Every route is gated by BOTH guards: JwtAuthGuard
 * verifies the session, SupportGuard requires the verified role claim to be
 * `support` or `admin`. Staff never reach /admin/* routes (those keep their
 * own AdminGuard), so support privileges cannot drift into admin ones.
 */
@Controller({ path: 'support', version: '1' })
@UseGuards(JwtAuthGuard, SupportGuard)
@Throttle({ default: { limit: 180, ttl: 60_000 } })
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class QueueController {
  constructor(private support: SupportService) {}

  /** Queues: available | mine | waiting | escalated | (admin) all. */
  @Get('queue')
  queue(@Query() q: QueueQueryDto, @CurrentUser() u: ReqUser) {
    return this.support.listQueue(u, q.view, q);
  }

  /**
   * Atomic claim. The database does the arbitration (conditional UPDATE …
   * RETURNING), so two simultaneous claims cannot both succeed — the loser
   * gets 409 TICKET_TAKEN.
   */
  @Post('tickets/:id/claim')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  claim(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.claim(id, u.sub, u.role, ctxOf(req));
  }

  /** Return the ticket to the available queue; the event is logged. */
  @Post('tickets/:id/release')
  @HttpCode(200)
  release(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.release(id, u, ctxOf(req));
  }

  @Patch('tickets/:id/subject')
  retitle(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.updateSubject(id, dto.subject, u, ctxOf(req));
  }

  /**
   * Set the ticket priority. Only the current assignee (or an admin) passes:
   * the service re-checks authority against the database, never the claim.
   */
  @Patch('tickets/:id/priority')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  setPriority(
    @Param('id', UUID) id: string,
    @Body() dto: SetPriorityDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.setPriority(id, dto.priority, u, ctxOf(req));
  }

  /**
   * Call Admin: persists the escalation first (IMPORTANT: it stays saved even
   * when nobody is connected), flips the ticket to waiting_admin and notifies
   * every active admin. Re-pressing is deduplicated by a partial unique index.
   */
  @Post('tickets/:id/escalate')
  @HttpCode(200)
  @Throttle({ default: { limit: 12, ttl: 3_600_000 } })
  escalate(
    @Param('id', UUID) id: string,
    @Body() dto: EscalateDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.support.escalate(id, u.sub, u.role, dto.reason, ctxOf(req));
  }

  /**
   * Read-only linked-server panel. No power actions, no secrets, no env vars,
   * no file contents — and a suspended server is reported as suspended (the
   * support path can never bypass it).
   */
  @Get('tickets/:id/server')
  serverCard(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.support.serverCard(id, u, ctxOf(req));
  }

  @Get('tickets/:id/timeline')
  timeline(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.support.timeline(id, u);
  }

  // ------------------------------------------------------ team + own stats

  @Get('team')
  team(@CurrentUser() u: ReqUser) {
    return this.support.listMembers(u);
  }

  /** Staff see only their own aggregates — never a colleague's. */
  /**
   * My own performance. Deliberately NOT under /admin/support: a specialist
   * may see their own workload and response times (never a colleague's).
   */
  @Get('performance/me')
  myPerformance(@CurrentUser() u: ReqUser) {
    return this.support.performance({ requester: u, supportId: u.sub });
  }

  @Get('performance/ratings')
  myRatings(@Query('page') page: number, @CurrentUser() u: ReqUser) {
    return this.support.listRatings(u, { page });
  }
}
