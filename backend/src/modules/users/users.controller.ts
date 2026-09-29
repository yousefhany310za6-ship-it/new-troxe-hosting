import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { sessions, servers, users } from '../../db/schema';
import { Inject } from '@nestjs/common';
import { CurrentUser, ReqUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { UpdateNotificationsDto, UpdatePasswordDto, UpdateProfileDto } from './dto';
import { UsersService } from './users.service';

// Routes → /api/v1/users/me ...
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersSvc: UsersService, @Inject(DB) private db: Db) {}

  @Get('me')
  me(@CurrentUser() u: ReqUser) {
    return this.usersSvc.me(u.sub);
  }

  @Patch('me')
  updateProfile(@CurrentUser() u: ReqUser, @Body() dto: UpdateProfileDto) {
    return this.usersSvc.updateProfile(u.sub, dto);
  }

  @Post('me/password')
  password(@CurrentUser() u: ReqUser, @Body() dto: UpdatePasswordDto) {
    return this.usersSvc.updatePassword(u.sub, dto);
  }

  @Patch('me/notifications')
  notifications(@CurrentUser() u: ReqUser, @Body() dto: UpdateNotificationsDto) {
    return this.usersSvc.updateNotifications(u.sub, dto);
  }

  @Delete('me')
  async delete(@CurrentUser() u: ReqUser) {
    await this.db.delete(sessions).where(eq(sessions.userId, u.sub));
    await this.db.delete(servers).where(eq(servers.ownerId, u.sub));
    await this.db.delete(users).where(eq(users.id, u.sub));
    return { ok: true };
  }
}
