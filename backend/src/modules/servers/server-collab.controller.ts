import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user';
import { ctxOf } from '../../common/request-context';
import { ServerOwnerGuard } from './server-owner.guard';
import { ServerAccessGuard } from './server-access.guard';
import { ServerAccessService } from './server-access.service';
import { ServerUsersService } from './server-users.service';
import { ServerSchedulesService } from './server-schedules.service';
import { AddSubuserDto, CreateScheduleDto, PreviewCronDto, UpdateScheduleDto, UpdateSubuserDto } from './collab.dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * Sharing + schedules. Two different gates on purpose:
 *  - subuser management is OWNER-ONLY (a subuser never learns who else has
 *    access, let alone changes it);
 *  - schedules need `schedule.manage` for writes and `server.view` for reads.
 */
@Controller({ path: 'servers', version: '1' })
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class ServerCollabController {
  constructor(
    private users: ServerUsersService,
    private schedules: ServerSchedulesService,
    private access: ServerAccessService,
  ) {}

  // ------------------------------------------------------------ subusers

  @Get(':id/users')
  @UseGuards(ServerOwnerGuard)
  subusers(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.users.list(id, u.sub);
  }

  @Post(':id/users')
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  addSubuser(
    @Param('id', UUID) id: string,
    @Body() dto: AddSubuserDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.users.add(id, u.sub, dto.email, dto.permissions, ctxOf(req));
  }

  @Patch(':id/users/:userId')
  @UseGuards(ServerOwnerGuard)
  updateSubuser(
    @Param('id', UUID) id: string,
    @Param('userId', UUID) userId: string,
    @Body() dto: UpdateSubuserDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.users.update(id, u.sub, userId, dto.permissions, ctxOf(req));
  }

  @Delete(':id/users/:userId')
  @UseGuards(ServerOwnerGuard)
  removeSubuser(
    @Param('id', UUID) id: string,
    @Param('userId', UUID) userId: string,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.users.remove(id, u.sub, userId, ctxOf(req));
  }

  /** What may I do here? Drives which tabs and buttons the UI shows. */
  @Get(':id/grant')
  @UseGuards(ServerAccessGuard)
  myGrant(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.access.myGrant(id, u.sub);
  }

  // ------------------------------------------------------------ schedules

  @Get(':id/schedules')
  @UseGuards(ServerAccessGuard)
  schedulesList(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.schedules.list(id, u.sub);
  }

  @Post(':id/schedules')
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(ServerAccessGuard)
  scheduleCreate(
    @Param('id', UUID) id: string,
    @Body() dto: CreateScheduleDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.schedules.create(id, u.sub, dto, ctxOf(req));
  }

  @Post(':id/schedules/preview')
  @HttpCode(200)
  @UseGuards(ServerAccessGuard)
  schedulePreview(@Param('id', UUID) id: string, @Body() dto: PreviewCronDto, @CurrentUser() u: ReqUser) {
    return this.schedules.preview(id, u.sub, dto.cron, 5);
  }

  @Patch(':id/schedules/:scheduleId')
  @UseGuards(ServerAccessGuard)
  scheduleUpdate(
    @Param('id', UUID) id: string,
    @Param('scheduleId', UUID) scheduleId: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.schedules.update(id, u.sub, scheduleId, dto, ctxOf(req));
  }

  @Delete(':id/schedules/:scheduleId')
  @UseGuards(ServerAccessGuard)
  scheduleDelete(
    @Param('id', UUID) id: string,
    @Param('scheduleId', UUID) scheduleId: string,
    @CurrentUser() u: ReqUser,
    @Req() req: { ip?: string; headers: Record<string, unknown> },
  ) {
    return this.schedules.remove(id, u.sub, scheduleId, ctxOf(req));
  }
}
