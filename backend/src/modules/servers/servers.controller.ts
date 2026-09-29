import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ctxOf } from '../../common/request-context';
import { CurrentUser } from '../auth/current-user';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { BackupsService } from './backups.service';
import { CreateServerDto, UpdateServerDto } from './dto';
import { ServerOwnerGuard } from './server-owner.guard';
import { ServersService } from './servers.service';

/** Routes → /api/v1/servers ... */
@Controller({ path: 'servers', version: '1' })
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(
    private svc: ServersService,
    private backups: BackupsService,
  ) {}

  @Get()
  list(@CurrentUser() u: ReqUser) {
    return this.svc.list(u.sub);
  }

  // provisioning is expensive → stricter burst limit
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(201)
  create(@CurrentUser() u: ReqUser, @Body() dto: CreateServerDto, @Req() req: Request) {
    return this.svc.create(u.sub, dto, ctxOf(req));
  }

  @Get(':id')
  @UseGuards(ServerOwnerGuard)
  getOne(@Param('id') id: string, @CurrentUser() u: ReqUser) {
    return this.svc.getOne(u.sub, id);
  }

  @Patch(':id')
  @UseGuards(ServerOwnerGuard)
  update(@Param('id') id: string, @Body() dto: UpdateServerDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.update(u.sub, id, dto, ctxOf(req));
  }

  @Delete(':id')
  @UseGuards(ServerOwnerGuard)
  remove(@Param('id') id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.remove(u.sub, id, ctxOf(req));
  }

  @Post(':id/start')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  start(@Param('id') id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'start', ctxOf(req));
  }

  @Post(':id/stop')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  stop(@Param('id') id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'stop', ctxOf(req));
  }

  @Post(':id/restart')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  restart(@Param('id') id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'restart', ctxOf(req));
  }

  /** Wipes data and provisions a clean sandbox. */
  @Post(':id/reinstall')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  reinstall(@Param('id') id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'reinstall', ctxOf(req));
  }

  // ---- observability --------------------------------------------------------

  @Get(':id/stats')
  @UseGuards(ServerOwnerGuard)
  stats(@Param('id') id: string, @CurrentUser() u: ReqUser) {
    return this.svc.stats(u.sub, id);
  }

  @Get(':id/usage')
  @UseGuards(ServerOwnerGuard)
  usage(@Param('id') id: string, @CurrentUser() u: ReqUser) {
    return this.svc.usage(u.sub, id);
  }

  @Get(':id/logs')
  @UseGuards(ServerOwnerGuard)
  logs(
    @Param('id') id: string,
    @CurrentUser() u: ReqUser,
    @Query('tail', new DefaultValuePipe(200), ParseIntPipe) tail: number,
  ) {
    return this.svc.logs(u.sub, id, tail);
  }

  // ---- backups --------------------------------------------------------------

  @Get(':id/backups')
  @UseGuards(ServerOwnerGuard)
  listBackups(@Param('id') id: string, @CurrentUser() u: ReqUser) {
    return this.backups.list(u.sub, id);
  }

  @Post(':id/backups')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  createBackup(@Param('id') id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.backups.create(u.sub, id, { type: 'manual' }, ctxOf(req));
  }

  @Delete(':id/backups/:backupId')
  @UseGuards(ServerOwnerGuard)
  deleteBackup(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
    @CurrentUser() u: ReqUser,
    @Req() req: Request,
  ) {
    return this.backups.remove(u.sub, id, backupId, ctxOf(req));
  }

  @Post(':id/backups/:backupId/restore')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  restoreBackup(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
    @CurrentUser() u: ReqUser,
    @Req() req: Request,
  ) {
    return this.backups.restore(u.sub, id, backupId, ctxOf(req));
  }
}
