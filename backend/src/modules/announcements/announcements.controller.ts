import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user';
import { AnnouncementsService } from './announcements.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * User-facing announcements. Everything here is enforced server-side:
 * only active, published, in-window, audience-matching banners are ever
 * returned, and interactions always bind to the authenticated user.
 */
@Controller({ path: 'announcements', version: '1' })
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AnnouncementsController {
  constructor(private announcements: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() u: ReqUser) {
    return this.announcements.listForUser(u.sub);
  }

  /** Idempotent impression (stats + interval policy). Never a read-receipt. */
  @Post(':id/shown')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  shown(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.announcements.recordShown(id, u.sub);
  }

  @Post(':id/ack')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  ack(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.announcements.ack(id, u.sub);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  dismiss(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.announcements.dismiss(id, u.sub);
  }
}
