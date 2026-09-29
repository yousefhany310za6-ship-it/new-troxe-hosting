import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, ReqUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CreateServerDto, UpdateServerDto } from './dto';
import { ServerOwnerGuard } from './server-owner.guard';
import { ServersService } from './servers.service';

// Routes → /api/v1/servers ...
@Controller({ path: 'servers', version: '1' })
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(private svc: ServersService) {}

  @Get()
  list(@CurrentUser() u: ReqUser) {
    return this.svc.list(u.sub);
  }

  @Post()
  create(@CurrentUser() u: ReqUser, @Body() dto: CreateServerDto) {
    return this.svc.create(u.sub, dto);
  }

  @Get(':id')
  @UseGuards(ServerOwnerGuard)
  getOne(@Param('id') id: string, @CurrentUser() u: ReqUser) {
    return this.svc.list(u.sub).then((all) => all.find((s) => s.id === id));
  }

  @Patch(':id')
  @UseGuards(ServerOwnerGuard)
  update(@Param('id') id: string, @Body() dto: UpdateServerDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(ServerOwnerGuard)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/start')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  start(@Param('id') id: string) {
    return this.svc.lifecycle(id, 'start');
  }

  @Post(':id/stop')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  stop(@Param('id') id: string) {
    return this.svc.lifecycle(id, 'stop');
  }

  @Post(':id/restart')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  restart(@Param('id') id: string) {
    return this.svc.lifecycle(id, 'restart');
  }

  @Post(':id/reinstall')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  reinstall(@Param('id') id: string) {
    return this.svc.lifecycle(id, 'reinstall');
  }
}
