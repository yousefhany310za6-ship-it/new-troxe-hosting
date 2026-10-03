import { Body, Controller, Delete, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ctxOf } from '../../common/request-context';
import { CurrentUser } from '../auth/current-user';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { UpdateNotificationsDto, UpdatePasswordDto, UpdateProfileDto, DeleteAccountDto, SetPasswordDto } from './dto';
import { UsersService } from './users.service';

/** Routes → /api/v1/users/me ... */
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersSvc: UsersService) {}

  @Get('me')
  me(@CurrentUser() u: ReqUser) {
    return this.usersSvc.me(u.sub);
  }

  /** Own audit trail (Activity page). */
  @Get('me/activity')
  activity(@CurrentUser() u: ReqUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.usersSvc.activity(u.sub, Number(page), Number(limit));
  }

  @Patch('me')
  updateProfile(@CurrentUser() u: ReqUser, @Body() dto: UpdateProfileDto) {
    return this.usersSvc.updateProfile(u.sub, dto);
  }

  @Post('me/password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  password(@CurrentUser() u: ReqUser, @Body() dto: UpdatePasswordDto, @Req() req: Request) {
    const ctx = ctxOf(req);
    return this.usersSvc.updatePassword(u.sub, dto, { ip: ctx.ip, userAgent: ctx.device });
  }

  @Post('me/password-set')
  setPassword(@CurrentUser() u: ReqUser, @Body() dto: SetPasswordDto, @Req() req: Request) {
    const ctx = ctxOf(req);
    return this.usersSvc.setPassword(u.sub, dto, { ip: ctx.ip, userAgent: ctx.device });
  }

  @Patch('me/notifications')
  notifications(@CurrentUser() u: ReqUser, @Body() dto: UpdateNotificationsDto) {
    return this.usersSvc.updateNotifications(u.sub, dto);
  }

  @Delete('me')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  delete(@CurrentUser() u: ReqUser, @Body() dto: DeleteAccountDto, @Req() req: Request) {
    const ctx = ctxOf(req);
    return this.usersSvc.deleteAccount(u.sub, dto, { ip: ctx.ip, userAgent: ctx.device });
  }
}
