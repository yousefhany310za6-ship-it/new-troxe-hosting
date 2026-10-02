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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { Err } from '../../common/errors';
import { AdminService } from './admin.service';
import { NodesService } from '../nodes/nodes.service';
import { CreateNodeDto, UpdateNodeDto } from '../nodes/dto';
import {
  AdminAuditQuery,
  AdminCreateServerDto,
  AdminServerListQuery,
  AdminUpdateServerDto,
  AdminUserListQuery,
  CreatePlanDto,
  UpdatePlanDto,
  UpdateRoleDto,
  UpdateUserPlanDto,
} from './dto';

const UUID = new ParseUUIDPipe({ version: '4' });
const LIFECYCLE_ACTIONS = ['start', 'stop', 'restart', 'reinstall'] as const;

@Controller({ path: 'admin', version: '1' })
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private admin: AdminService,
    private nodes: NodesService,
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

  @Delete('users/:id')
  @HttpCode(200)
  deleteUser(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.admin.deleteUser(id, u.sub, u.email);
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
  checkNode(@Param('id') id: string) {
    return this.nodes.check(id);
  }

  // ============ SYSTEM HEALTH ============

  @Get('system/stats')
  getSystemStats() {
    return this.admin.getSystemStats();
  }
}
