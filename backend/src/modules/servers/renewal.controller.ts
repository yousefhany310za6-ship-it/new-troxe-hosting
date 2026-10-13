import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ctxOf } from '../../common/request-context';
import { CurrentUser } from '../auth/current-user';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { ServerOwnerGuard } from './server-owner.guard';
import { RenewalService } from './renewal.service';
import { CompleteRenewalDto, RenewalCallbackQueryDto } from './renewal.dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/** How often the expiry sweep runs. The backend gate is the real guarantee. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Drives the expiry sweep.
 *
 * Separate from the renewal endpoints on purpose: it is the only place with a
 * timer, and it holds no business logic beyond "run the sweep". Restart-safe
 * (a missed sweep is caught by the next tick, and by `assertOperable` in the
 * meantime) and single-flight, so a slow tick cannot overlap the next one.
 */
@Injectable()
export class ExpiryRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ExpirySweep');
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private renewals: RenewalService) {}

  onModuleInit() {
    this.first = setTimeout(() => void this.tick(), 10_000);
    this.first.unref?.();
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  /** Public so an operator can force a sweep; the UPDATE fence makes it safe. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const { suspended, failed } = await this.renewals.sweepExpired();
      if (suspended || failed) this.log.log(`expiry sweep: ${suspended} suspended, ${failed} stop errors`);
    } catch (e) {
      this.log.warn(`expiry sweep failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}

/**
 * Free-plan renewal (Work.ink).
 *
 * Security posture, in order of importance:
 *  - OWNER-ONLY. `@UseGuards(ServerOwnerGuard)` reads `:id` from the verified
 *    JWT, so a foreign server id is indistinguishable from a missing one.
 *  - The browser never decides anything: not the duration, not the target, not
 *    the clock, not the destination URL. It receives a work.ink URL and a key.
 *  - Returning from work.ink proves nothing. `complete` re-validates the key
 *    with the provider and additionally requires it to have been minted by OUR
 *    link, then binds it to this one session.
 */
@Controller({ path: 'renewal', version: '1' })
@UseGuards(JwtAuthGuard)
export class RenewalController {
  constructor(private renewals: RenewalService) {}

  /** Everything the renewal panel needs for one server. */
  @Get('servers/:id/renewal')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  status(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.renewals.statusFor(u.sub, id);
  }

  /** Start an attempt. Tight limit: one per server per session. */
  @Post('servers/:id/renewal-sessions')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UseGuards(ServerOwnerGuard)
  open(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.renewals.open(u.sub, id, ctxOf(req));
  }

  /**
   * Submit the key for verification.
   *
   * A higher limit than the rest because a legitimate user may mistype or lose
   * the redirect; the session TTL and the unique token index bound the real
   * cost of retries.
   */
  @Post('renewal-sessions/:sessionId/complete')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  complete(
    @Param('sessionId', UUID) sessionId: string,
    @Body() dto: CompleteRenewalDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.renewals.complete(u.sub, sessionId, dto.token, ctxOf(req));
  }

  /** Poll a session's state. Owner-only; never leaks another account's data. */
  @Get('renewal-sessions/:sessionId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async session(@Param('sessionId', UUID) sessionId: string, @CurrentUser() u: ReqUser) {
    const row = await this.renewals.requireOwnSession(u.sub, sessionId);
    return {
      id: row.id,
      serverId: row.serverId,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      failureReason: row.failureReason ?? null,
    };
  }

  /** What has been granted on this server, newest first. */
  @Get('servers/:id/renewal-history')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  history(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.renewals.history(u.sub, id);
  }

  /**
   * The page Work.ink sends the user back to.
   *
   * GET only and side-effect free: arriving here must NOT renew anything —
   * the key in the query string is verified by the POST above. This endpoint
   * exists so the browser has a real same-origin URL to land on, and echoes
   * the session id back for display. It reveals nothing without the session.
   */
  @Get('renewal/return')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async callback(@Query() q: RenewalCallbackQueryDto, @CurrentUser() u: ReqUser) {
    // ownership is checked here too, so the landing page cannot probe other
    // people's session ids (a foreign id is simply "not yours")
    let sessionKnown = false;
    if (q.session) {
      sessionKnown = await this.renewals
        .requireOwnSession(u.sub, q.session)
        .then(() => true)
        .catch(() => false);
    }
    return { hasSession: !!q.session, hasKey: !!q.key, sessionKnown, next: '/dashboard/servers' };
  }
}