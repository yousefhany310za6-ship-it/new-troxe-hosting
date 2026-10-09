import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user';
import { ctxOf } from '../../common/request-context';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementListQuery, CreateAnnouncementDto, ScheduleAnnouncementDto, UpdateAnnouncementDto } from './dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/** Admin-only announcement management. Every mutation is audited. */
@Controller({ path: 'admin/announcements', version: '1' })
@UseGuards(JwtAuthGuard, AdminGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AnnouncementAdminController {
  constructor(private announcements: AnnouncementsService) {}

  @Get()
  list(@Query() q: AnnouncementListQuery) {
    return this.announcements.listAdmin(q.page, q.limit, q.status);
  }

  @Get(':id')
  detail(@Param('id', UUID) id: string) {
    return this.announcements.getAdmin(id);
  }

  @Get(':id/stats')
  stats(@Param('id', UUID) id: string) {
    return this.announcements.stats(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.announcements.create(dto, u.sub, ctxOf(req));
  }

  @Patch(':id')
  update(@Param('id', UUID) id: string, @Body() dto: UpdateAnnouncementDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.announcements.update(id, dto, u.sub, ctxOf(req));
  }

  @Post(':id/schedule')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  schedule(@Param('id', UUID) id: string, @Body() dto: ScheduleAnnouncementDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.announcements.schedule(id, dto.publishAt, u.sub, ctxOf(req));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  publish(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.announcements.publish(id, u.sub, ctxOf(req));
  }

  @Post(':id/pause')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pause(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.announcements.pause(id, u.sub, ctxOf(req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  archive(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.announcements.archive(id, u.sub, ctxOf(req));
  }

  @Delete(':id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  remove(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.announcements.remove(id, u.sub, ctxOf(req));
  }
}
