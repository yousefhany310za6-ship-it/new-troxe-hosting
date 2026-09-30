import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ctxOf } from '../../common/request-context';
import { CurrentUser } from '../auth/current-user';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { BackupsService } from './backups.service';
import { FilesService } from './files.service';
import { ParseUuidPipe } from '../../common/pipes/uuid.pipe';
import { CreateServerDto, UpdateServerDto } from './dto';
import { MkdirDto, RenameDto, WriteFileDto, FilesQuery, ArchiveDto, ExtractDto } from './files.dto';
import { ServerOwnerGuard } from './server-owner.guard';
import { ServersService } from './servers.service';

/** Routes → /api/v1/servers ... */
@Controller({ path: 'servers', version: '1' })
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(
    private svc: ServersService,
    private backups: BackupsService,
    private files: FilesService,
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
  getOne(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser) {
    return this.svc.getOne(u.sub, id);
  }

  @Patch(':id')
  @UseGuards(ServerOwnerGuard)
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateServerDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.update(u.sub, id, dto, ctxOf(req));
  }

  @Delete(':id')
  @UseGuards(ServerOwnerGuard)
  remove(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.remove(u.sub, id, ctxOf(req));
  }

  @Post(':id/start')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  start(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'start', ctxOf(req));
  }

  @Post(':id/stop')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  stop(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'stop', ctxOf(req));
  }

  @Post(':id/restart')
  @HttpCode(202)
  @UseGuards(ServerOwnerGuard)
  restart(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'restart', ctxOf(req));
  }

  /** Wipes data and provisions a clean sandbox. */
  @Post(':id/reinstall')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  reinstall(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.svc.lifecycle(u.sub, id, 'reinstall', ctxOf(req));
  }

  // ---- observability --------------------------------------------------------

  @Get(':id/stats')
  @UseGuards(ServerOwnerGuard)
  stats(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser) {
    return this.svc.stats(u.sub, id);
  }

  @Get(':id/usage')
  @UseGuards(ServerOwnerGuard)
  usage(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser) {
    return this.svc.usage(u.sub, id);
  }

  @Get(':id/logs')
  @UseGuards(ServerOwnerGuard)
  logs(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Query('tail', new DefaultValuePipe(200), ParseIntPipe) tail: number,
  ) {
    return this.svc.logs(u.sub, id, tail);
  }

  // ---- backups --------------------------------------------------------------

  @Get(':id/backups')
  @UseGuards(ServerOwnerGuard)
  listBackups(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser) {
    return this.backups.list(u.sub, id);
  }

  @Post(':id/backups')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  createBackup(@Param('id', ParseUuidPipe) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.backups.create(u.sub, id, { type: 'manual' }, ctxOf(req));
  }

  @Delete(':id/backups/:backupId')
  @UseGuards(ServerOwnerGuard)
  deleteBackup(
    @Param('id', ParseUuidPipe) id: string,
    @Param('backupId', ParseUuidPipe) backupId: string,
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
    @Param('id', ParseUuidPipe) id: string,
    @Param('backupId', ParseUuidPipe) backupId: string,
    @CurrentUser() u: ReqUser,
    @Req() req: Request,
  ) {
    return this.backups.restore(u.sub, id, backupId, ctxOf(req));
  }

  // ---- files (volume browser; helper-container backed) -----------------------

  @Get(':id/files')
  @UseGuards(ServerOwnerGuard)
  listFiles(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Query() q: FilesQuery,
  ) {
    return this.files.list(u.sub, id, q.path);
  }

  @Get(':id/files/content')
  @UseGuards(ServerOwnerGuard)
  readFile(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Query() q: FilesQuery,
  ) {
    return this.files.read(u.sub, id, q.path);
  }

  @Put(':id/files/content')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  writeFile(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Body() dto: WriteFileDto,
  ) {
    return this.files.write(u.sub, id, dto.path, dto.content, dto.contentBase64);
  }

  @Post(':id/files/mkdir')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  mkdir(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Body() dto: MkdirDto,
  ) {
    return this.files.mkdir(u.sub, id, dto.path);
  }

  @Delete(':id/files')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  deleteFile(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Query() q: FilesQuery,
  ) {
    return this.files.remove(u.sub, id, q.path);
  }

  @Post(':id/files/rename')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  renameFile(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Body() dto: RenameDto,
  ) {
    return this.files.rename(u.sub, id, dto.from, dto.to);
  }

  @Post(':id/files/archive')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  archiveFiles(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Body() dto: ArchiveDto,
  ) {
    return this.files.archive(u.sub, id, dto.sources, dto.dest);
  }

  @Post(':id/files/extract')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  extractFiles(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Body() dto: ExtractDto,
  ) {
    return this.files.extract(u.sub, id, dto.file, dto.dest);
  }

  @Get(':id/files/download')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(ServerOwnerGuard)
  async downloadFile(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() u: ReqUser,
    @Query() q: FilesQuery,
    @Res() res: Response,
  ) {
    const { filename, data } = await this.files.download(u.sub, id, q.path);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '_')}"`,
      'Content-Length': String(data.length),
    });
    res.send(data);
  }
}
