import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { Err } from '../../common/errors';
import { AdminService } from './admin.service';
import { NodesService } from '../nodes/nodes.service';
import { ProvisionerService } from '../servers/provisioning/provisioner.service';
import { CreateNodeDto, UpdateNodeDto } from '../nodes/dto';
import {
  AdminAuditQuery,
  AdminCreateServerDto,
  AdminServerListQuery,
  AdminSetPasswordDto,
  AdminSuspendDto,
  AdminUpdateServerDto,
  AdminUserListQuery,
  CreatePlanDto,
  UpdatePlanDto,
  UpdateRoleDto,
  UpdateUserPlanDto,
} from './dto';
import { ctxOf } from '../../common/request-context';

const UUID = new ParseUUIDPipe({ version: '4' });
const LIFECYCLE_ACTIONS = ['start', 'stop', 'restart', 'reinstall'] as const;

@Controller({ path: 'admin', version: '1' })
@UseGuards(JwtAuthGuard, AdminGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminController {
  constructor(
    private admin: AdminService,
    private nodes: NodesService,
    private provisioner: ProvisionerService,
  ) {}

  // ============ USERS ============

  @Get('users')
  listUsers(@Query() params: AdminUserListQuery) {
    return this.admin.listUsers(params);
  }

  @Get('users/:id')
  getUser(@Param('id', UUID) id: string) {
    return this.admin.getUser(id);
  }

  @Patch('users/:id/role')
  @HttpCode(200)
  updateUserRole(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() u: ReqUser,
  ) {
    return this.admin.updateUserRole(id, dto.role, u.sub, u.email);
  }

  @Patch('users/:id/plan')
  @HttpCode(200)
  updateUserPlan(
    @Param('id', UUID) id: string,
    @Body() dto: UpdateUserPlanDto,
    @CurrentUser() u: ReqUser,
  ) {
    return this.admin.updateUserPlan(id, dto.planId, u.sub, u.email);
  }

  @Post('users/:id/reset-failed-logins')
  @HttpCode(200)
  resetFailedLogins(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.admin.resetUserFailedLogins(id, u.sub, u.email);
  }

  @Post('users/:id/password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setUserPassword(@Param('id', UUID) id: string, @Body() dto: AdminSetPasswordDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.setUserPassword(id, dto.password, u.sub, u.email, ctxOf(req).ip);
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  suspendUser(@Param('id', UUID) id: string, @Body() dto: AdminSuspendDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.suspendUser(id, u.sub, u.email, dto.reason, ctxOf(req).ip);
  }

  @Post('users/:id/unsuspend')
  @HttpCode(200)
  unsuspendUser(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.unsuspendUser(id, u.sub, u.email, ctxOf(req).ip);
  }

  @Post('users/:id/restore')
  @HttpCode(200)
  restoreUser(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.restoreUser(id, u.sub, u.email, ctxOf(req).ip);
  }

  @Delete('users/:id')
  @HttpCode(200)
  deleteUser(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.deleteUser(id, u.sub, u.email, ctxOf(req).ip);
  }

  // NOTE: impersonation exists in AdminService but is intentionally NOT
  // exposed here — it mints a live session for another account and needs a
  // dedicated security review (ticket scoping, banner, forced expiry) before
  // any UI is built on top of it.

  // ============ SERVERS (global) ============

  @Get('servers')
  listServers(@Query() params: AdminServerListQuery) {
    return this.admin.listServers(params);
  }

  /** Create a server on behalf of a user (ownerId required and explicit). */
  @Post('servers')
  @HttpCode(201)
  createServer(@Body() dto: AdminCreateServerDto, @CurrentUser() u: ReqUser) {
    const { ownerId, ...serverDto } = dto;
    return this.admin.adminCreateServer(ownerId, serverDto, u.sub, u.email);
  }

  @Get('servers/:id')
  getServer(@Param('id', UUID) id: string) {
    return this.admin.getServer(id);
  }

  @Patch('servers/:id')
  @HttpCode(200)
  updateServer(
    @Param('id', UUID) id: string,
    @Body() dto: AdminUpdateServerDto,
    @CurrentUser() u: ReqUser,
  ) {
    return this.admin.adminUpdateServer(id, dto, u.sub, u.email);
  }

  @Post('servers/:id/:action')
  @HttpCode(200)
  adminLifecycle(
    @Param('id', UUID) id: string,
    @Param('action') action: (typeof LIFECYCLE_ACTIONS)[number],
    @CurrentUser() u: ReqUser,
  ) {
    if (!LIFECYCLE_ACTIONS.includes(action)) throw Err.invalid('ACTION_UNSUPPORTED', 'Unknown lifecycle action');
    return this.admin.adminLifecycle(id, action, u.sub, u.email);
  }

  @Delete('servers/:id')
  @HttpCode(200)
  deleteServer(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.admin.adminDeleteServer(id, u.sub, u.email);
  }

  @Post('servers/:id/access')
  @HttpCode(200)
  openServer(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.openServer(id, u.sub, u.email, ctxOf(req).ip);
  }

  @Post('servers/:id/suspend')
  @HttpCode(200)
  suspendServer(@Param('id', UUID) id: string, @Body() dto: AdminSuspendDto, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.suspendServer(id, u.sub, dto.reason, ctxOf(req).ip);
  }

  @Post('servers/:id/unsuspend')
  @HttpCode(200)
  unsuspendServer(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.unsuspendServer(id, u.sub, ctxOf(req).ip);
  }

  @Get('servers/:id/stats')
  serverStats(@Param('id', UUID) id: string) {
    return this.admin.adminServerStats(id);
  }

  @Get('servers/:id/usage')
  serverUsage(@Param('id', UUID) id: string) {
    return this.admin.adminServerUsage(id);
  }

  @Get('servers/:id/logs')
  serverLogs(@Param('id', UUID) id: string, @Query('tail') tail?: string) {
    return this.admin.adminServerLogs(id, Math.min(Math.max(Number(tail) || 200, 1), 2000));
  }

  @Get('servers/:id/events')
  serverEvents(@Param('id', UUID) id: string, @Query('limit') limit?: string) {
    return this.admin.adminServerEvents(id, Math.min(Math.max(Number(limit) || 20, 1), 50));
  }

  @Get('servers/:id/activity')
  serverActivity(@Param('id', UUID) id: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.admin.adminServerActivity(id, Number(page) || 1, Number(limit) || 30);
  }

  @Get('servers/:id/backups')
  serverBackups(@Param('id', UUID) id: string) {
    return this.admin.adminServerBackups(id);
  }

  @Get('servers/:id/backups/quota')
  serverBackupQuota(@Param('id', UUID) id: string) {
    return this.admin.adminServerBackupQuota(id);
  }

  @Post('servers/:id/backups')
  @HttpCode(201)
  serverBackupCreate(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.adminServerBackupCreate(id, u.sub, u.email, ctxOf(req).ip);
  }

  @Delete('servers/:id/backups/:backupId')
  @HttpCode(200)
  serverBackupDelete(@Param('id', UUID) id: string, @Param('backupId', UUID) backupId: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.adminServerBackupDelete(id, backupId, u.sub, u.email, ctxOf(req).ip);
  }

  @Post('servers/:id/backups/:backupId/restore')
  @HttpCode(202)
  serverBackupRestore(@Param('id', UUID) id: string, @Param('backupId', UUID) backupId: string, @CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.admin.adminServerBackupRestore(id, backupId, u.sub, u.email, ctxOf(req).ip);
  }

  @Get('servers/:id/files')
  serverFiles(@Param('id', UUID) id: string, @Query('path') path?: string) {
    return this.admin.adminServerFiles(id, path);
  }

  @Get('servers/:id/files/content')
  serverFileContent(@Param('id', UUID) id: string, @Query('path') path?: string) {
    return this.admin.adminServerFileContent(id, path);
  }

  @Get('servers/:id/files/download')
  async serverFileDownload(@Param('id', UUID) id: string, @Query('path') path: string, @Res() res: Response) {
    const { filename, data } = await this.admin.adminServerFileDownload(id, path);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '_')}"`,
      'Content-Length': String(data.length),
    });
    res.send(data);
  }

  // ============ PLANS ============

  @Get('plans')
  listPlans() {
    return this.admin.listPlans();
  }

  @Post('plans')
  @HttpCode(201)
  createPlan(@Body() dto: CreatePlanDto, @CurrentUser() u: ReqUser) {
    return this.admin.createPlan(dto, u.sub, u.email);
  }

  @Patch('plans/:id')
  @HttpCode(200)
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() u: ReqUser,
  ) {
    return this.admin.updatePlan(id, dto, u.sub, u.email);
  }

  @Delete('plans/:id')
  @HttpCode(200)
  deletePlan(@Param('id') id: string, @CurrentUser() u: ReqUser) {
    return this.admin.deletePlan(id, u.sub, u.email);
  }

  // ============ AUDIT LOGS ============

  @Get('audit')
  listAuditLogs(@Query() params: AdminAuditQuery) {
    return this.admin.listAuditLogs(params);
  }

  // ============ NODES ============

  @Get('nodes')
  listNodes() {
    return this.nodes.list();
  }

  @Post('nodes')
  @HttpCode(201)
  createNode(@Body() dto: CreateNodeDto, @CurrentUser() u: ReqUser) {
    return this.nodes.create(dto, u.sub, u.email);
  }

  @Get('nodes/:id')
  getNode(@Param('id') id: string) {
    return this.nodes.get(id);
  }

  @Patch('nodes/:id')
  @HttpCode(200)
  updateNode(@Param('id') id: string, @Body() dto: UpdateNodeDto, @CurrentUser() u: ReqUser) {
    return this.nodes.update(id, dto, u.sub, u.email);
  }

  @Delete('nodes/:id')
  @HttpCode(200)
  deleteNode(@Param('id') id: string, @CurrentUser() u: ReqUser) {
    return this.nodes.remove(id, u.sub, u.email);
  }

  @Post('nodes/:id/check')
  @HttpCode(200)
  async checkNode(@Param('id') id: string) {
    // liveness + isolation in one round trip: `firewall.ok === null` means
    // "could not read the ruleset" — deliberately NOT the same as `false`
    // (confirmed drift), so an admin can tell a broken reader from a broken
    // firewall.
    const status = await this.nodes.check(id);
    const firewall = await this.provisioner
      .firewallReport(id)
      .catch((e) => ({ mode: 'error' as const, ok: null, expected: 0, found: 0, missing: [(e as Error).message], stale: [] }));
    return { ...status, firewall };
  }

  // ============ SYSTEM HEALTH ============

  @Get('system/stats')
  getSystemStats() {
    return this.admin.getSystemStats();
  }

  @Post('users/:id/impersonate')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async impersonateUser(
    @Param('id', UUID) id: string,
    @CurrentUser() u: ReqUser,
  ) {
    const result = await this.admin.impersonateUser(id, u.sub);
    return { token: result.token, expiresAt: result.expiresAt, user: result.user };
  }
}
