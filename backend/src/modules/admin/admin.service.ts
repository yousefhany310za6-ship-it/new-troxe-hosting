import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, gt, ilike, isNull, or, sql, count, type SQL } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { users, servers, plans, backups, auditLogs, sessions, authSessions } from '../../db/schema';
import { ServersService } from '../servers/servers.service';
import { AuditService } from '../audit/audit.module';
import { GeoIpService } from '../../common/geoip/geoip.service';
import { config } from '../../config/env';
import { Err } from '../../common/errors';
import type { CreateServerDto, UpdateServerDto } from '../servers/dto';
import * as crypto from 'crypto';

export interface AdminUserListParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: 'user' | 'admin';
  sortBy?: 'createdAt' | 'name' | 'email' | 'planId';
  sortOrder?: 'asc' | 'desc';
}

export interface AdminServerListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  ownerId?: string;
  sortBy?: 'createdAt' | 'name' | 'status' | 'runtime';
  sortOrder?: 'asc' | 'desc';
}

export interface AdminAuditParams {
  page?: number;
  limit?: number;
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private db: Db,
    private serversSvc: ServersService,
    private audit: AuditService,
    private jwt: JwtService,
    private geo: GeoIpService,
  ) {}

  /**
   * Country of the user's most recent geolocatable successful login.
   * Private/loopback IPs intentionally resolve to null ("Unknown" in UI).
   */
  private async lastKnownCountry(userId: string): Promise<{ location: string; countryCode: string } | null> {
    const rows = await this.db
      .select({ ip: sessions.ip, location: sessions.location, countryCode: sessions.countryCode })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.status, 'success')))
      .orderBy(desc(sessions.createdAt))
      .limit(10);
    for (const r of rows) {
      if (r.location && r.countryCode) return { location: r.location, countryCode: r.countryCode };
      const geo = this.geo.lookup(r.ip);
      if (geo?.countryCode) {
        const location = this.geo.formatLocation(geo) ?? geo.country ?? geo.countryCode;
        // persist so subsequent reads are cheap
        this.db
          .update(sessions)
          .set({ location, countryCode: geo.countryCode })
          .where(and(eq(sessions.userId, userId), eq(sessions.ip, r.ip!), isNull(sessions.countryCode)))
          .catch(() => undefined);
        return { location, countryCode: geo.countryCode };
      }
    }
    return null;
  }

  // ============ USERS ============

  async listUsers(params: AdminUserListParams = {}) {
    const {
      page = 1,
      limit = 20,
      search,
      role,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (search) {
      conditions.push(
        or(
          ilike(users.name, `%${search}%`),
          ilike(users.email, `%${search}%`),
        ) as SQL,
      );
    }
    if (role) {
      conditions.push(eq(users.role, role));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      this.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          planId: users.planId,
          avatarUrl: users.avatarUrl,
          failedLogins: users.failedLogins,
          lockedUntil: users.lockedUntil,
          createdAt: users.createdAt,
          serverCount: sql<number>`(
            select count(*)::int from ${servers} where ${servers.ownerId} = ${users.id}
          )`,
        })
        .from(users)
        .where(whereClause as SQL)
        .orderBy(sortOrder === 'asc' ? users[sortBy] : desc(users[sortBy]))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(users).where(whereClause as SQL),
    ]);

    const data = await Promise.all(
      rows.map(async (r) => ({ ...r, country: await this.lastKnownCountry(r.id) })),
    );

    return {
      data,
      pagination: {
        page,
        limit,
        total: totalResult[0]?.count ?? 0,
        pages: Math.ceil((totalResult[0]?.count ?? 0) / limit),
      },
    };
  }

  async getUser(userId: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        planId: users.planId,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
        failedLogins: users.failedLogins,
        lockedUntil: users.lockedUntil,
        notifyRestarts: users.notifyRestarts,
        notifyInvoices: users.notifyInvoices,
        notifyMarketing: users.notifyMarketing,
        createdAt: users.createdAt,
        passwordChangedAt: users.passwordChangedAt,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new NotFoundException('USER_NOT_FOUND');

    const [serverCount, activeSessions, recentLogins, country] = await Promise.all([
      this.db.select({ count: count() }).from(servers).where(eq(servers.ownerId, userId)),
      this.db
        .select({ count: count() })
        .from(authSessions)
        .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date()))),
      this.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.createdAt))
        .limit(10),
      this.lastKnownCountry(userId),
    ]);

    // lazily resolve geo for logins recorded before GeoIP existed
    const logins = recentLogins.map((s) => {
      if (s.location || !s.ip) return s;
      const geo = this.geo.lookup(s.ip);
      if (!geo) return s;
      const location = this.geo.formatLocation(geo);
      this.db
        .update(sessions)
        .set({ location, countryCode: geo.countryCode })
        .where(eq(sessions.id, s.id))
        .catch(() => undefined);
      return { ...s, location, countryCode: geo.countryCode };
    });

    return {
      ...user,
      serverCount: serverCount[0]?.count ?? 0,
      activeSessions: activeSessions[0]?.count ?? 0,
      country,
      recentLogins: logins,
    };
  }

  async updateUserRole(userId: string, role: 'user' | 'admin', actorId: string, actorEmail?: string) {
    if (userId === actorId) throw new ForbiddenException('CANNOT_CHANGE_OWN_ROLE');
    // bump the token generation together with the role: outstanding access
    // JWTs carry a stale `role` claim otherwise (guard trusts the claim),
    // so a demoted admin would keep /admin/* until token expiry.
    const [updated] = await this.db
      .update(users)
      .set({ role, tokenVersion: sql`token_version + 1` })
      .where(eq(users.id, userId))
      .returning({ id: users.id, role: users.role });
    if (!updated) throw new NotFoundException('USER_NOT_FOUND');
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.user.role_change',
      targetType: 'user',
      targetId: userId,
      meta: { newRole: role },
    });
    return updated;
  }

  async updateUserPlan(userId: string, planId: string, actorId: string, actorEmail?: string) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan) throw Err.invalid('PLAN_INVALID', 'Unknown plan');

    const [updated] = await this.db
      .update(users)
      .set({ planId })
      .where(eq(users.id, userId))
      .returning({ id: users.id, planId: users.planId });
    if (!updated) throw new NotFoundException('USER_NOT_FOUND');

    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.user.plan_change',
      targetType: 'user',
      targetId: userId,
      meta: { newPlan: planId },
    });
    return updated;
  }

  async resetUserFailedLogins(userId: string, actorId: string, actorEmail?: string) {
    const [updated] = await this.db
      .update(users)
      .set({ failedLogins: 0, lockedUntil: null, failedSince: null })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!updated) throw new NotFoundException('USER_NOT_FOUND');
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.user.reset_failed_logins',
      targetType: 'user',
      targetId: userId,
    });
    return { ok: true };
  }

  async deleteUser(userId: string, actorId: string, actorEmail?: string) {
    if (userId === actorId) throw new ForbiddenException('CANNOT_DELETE_SELF');
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException('USER_NOT_FOUND');

    // Delete all servers first (cascade will handle backups, etc.)
    await this.serversSvc.purgeAllForUser(userId);

    await this.db.delete(users).where(eq(users.id, userId));
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.user.delete',
      targetType: 'user',
      targetId: userId,
      meta: { email: user.email },
    });
    return { ok: true };
  }

  async impersonateUser(userId: string, actorId: string) {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, role: users.role, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException('USER_NOT_FOUND');
    if (user.role === 'admin') throw new ForbiddenException('CANNOT_IMPERSONATE_ADMIN');

    // Generate a short-lived impersonation JWT access token (5 min)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const impersonationToken = this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role, typ: 'access', v: user.tokenVersion, imp: actorId },
      { secret: config.JWT_ACCESS_SECRET, expiresIn: '5m', algorithm: 'HS256' },
    );

    await this.audit.record({
      actorId,
      actorEmail: 'admin',
      action: 'admin.user.impersonate',
      targetType: 'user',
      targetId: userId,
    });

    return { token: impersonationToken, expiresAt, user: { id: user.id, email: user.email, role: user.role } };
  }

  // ============ SERVERS (global) ============

  async listServers(params: AdminServerListParams = {}) {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      ownerId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (search) {
      conditions.push(
        or(
          ilike(servers.name, `%${search}%`),
          ilike(servers.runtime, `%${search}%`),
        ) as SQL,
      );
    }
    if (status) conditions.push(eq(servers.status, status as 'provisioning' | 'online' | 'offline' | 'restarting' | 'deleting' | 'error'));
    if (ownerId) conditions.push(eq(servers.ownerId, ownerId));

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      this.db
        .select({
          id: servers.id,
          name: servers.name,
          runtime: servers.runtime,
          runtimeVersion: servers.runtimeVersion,
          status: servers.status,
          lastError: servers.lastError,
          region: servers.region,
          planId: servers.planId,
          cpuMilli: servers.cpuMilli,
          ramMb: servers.ramMb,
          storageGb: servers.storageGb,
          autoRestart: servers.autoRestart,
          autoBackup: servers.autoBackup,
          containerId: servers.containerId,
          ownerId: servers.ownerId,
          createdAt: servers.createdAt,
          updatedAt: servers.updatedAt,
          provisionedAt: servers.provisionedAt,
        })
        .from(servers)
        .where(whereClause as SQL)
        .orderBy(sortOrder === 'asc' ? servers[sortBy] : desc(servers[sortBy]))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(servers).where(whereClause as SQL),
    ]);

    // Enrich with owner info
    const ownerIds = [...new Set(rows.map(r => r.ownerId))];
    const owners = ownerIds.length
      ? await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(or(...ownerIds.map(id => eq(users.id, id))))
      : [];
    const ownerMap = new Map(owners.map(o => [o.id, o]));

    return {
      data: rows.map(r => ({ ...r, owner: ownerMap.get(r.ownerId) })),
      pagination: {
        page,
        limit,
        total: totalResult[0]?.count ?? 0,
        pages: Math.ceil((totalResult[0]?.count ?? 0) / limit),
      },
    };
  }

  async getServer(serverId: string) {
    const rows = await this.db
      .select()
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    if (!rows.length) throw new NotFoundException('SERVER_NOT_FOUND');
    const row = rows[0];
    // envEncrypted is useless (and sensitive) outside the provisioning path —
    // never ship it to the dashboard. The update endpoint accepts the masked
    // placeholder back and keeps stored values (see ServersService.update).
    const { envEncrypted: _enc, ...safe } = row;
    const [owner] = row.ownerId
      ? await this.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, row.ownerId))
          .limit(1)
      : [];
    return { ...safe, owner: owner ?? null };
  }

  /**
   * Create a server ON BEHALF of a user. Quotas apply to the OWNER's plan
   * (ServersService.create resolves the plan server-side from the account),
   * never to the admin's — the admin cannot launder quota this way.
   */
  async adminCreateServer(ownerId: string, dto: CreateServerDto & { nodeId?: string }, actorId: string, actorEmail?: string) {
    const [owner] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
    if (!owner) throw new NotFoundException('OWNER_NOT_FOUND');
    const { nodeId: _node, ...serverDto } = dto;
    const created = await this.serversSvc.create(ownerId, serverDto, { ip: 'admin', device: 'admin-panel' }, { nodeId: dto.nodeId });
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.server.create',
      targetType: 'server',
      targetId: created.id,
      meta: { ownerId, runtime: dto.runtime, nodeId: created.nodeId },
    });
    return created;
  }

  async adminUpdateServer(serverId: string, dto: UpdateServerDto, actorId: string, actorEmail?: string) {
    const server = await this.getServer(serverId);
    const updated = await this.serversSvc.update(
      server.ownerId,
      serverId,
      dto,
      { ip: 'admin', device: 'admin-panel' },
      { actorId, actorEmail: actorEmail ?? null, isAdmin: true },
    );
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.server.update',
      targetType: 'server',
      targetId: serverId,
      meta: { ownerId: server.ownerId },
    });
    return updated;
  }

  async adminLifecycle(serverId: string, action: 'start' | 'stop' | 'restart' | 'reinstall', actorId: string, actorEmail?: string) {
    const server = await this.getServer(serverId);
    const result = await this.serversSvc.lifecycle(server.ownerId, serverId, action, { ip: 'admin', device: 'admin-panel' });
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: `admin.server.${action}`,
      targetType: 'server',
      targetId: serverId,
    });
    return result;
  }

  async adminDeleteServer(serverId: string, actorId: string, actorEmail?: string) {
    const server = await this.getServer(serverId);
    await this.serversSvc.remove(server.ownerId, serverId, { ip: 'admin', device: 'admin-panel' });
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.server.delete',
      targetType: 'server',
      targetId: serverId,
    });
    return { ok: true };
  }

  // ============ PLANS ============

  async listPlans() {
    return this.db.select().from(plans).orderBy(plans.id);
  }

  async createPlan(data: { id: string; name: string; priceCents?: number; cpuMilli?: number; ramMb?: number; storageGb?: number; maxServers?: number; maxBackupSlots?: number }, actorId: string, actorEmail?: string) {
    const [plan] = await this.db.insert(plans).values({
      id: data.id,
      name: data.name,
      priceCents: data.priceCents ?? 0,
      cpuMilli: data.cpuMilli ?? 250,
      ramMb: data.ramMb ?? 256,
      storageGb: data.storageGb ?? 1,
      maxServers: data.maxServers ?? 1,
      maxBackupSlots: data.maxBackupSlots ?? 0,
    }).returning();
    await this.audit.record({ actorId, actorEmail: actorEmail ?? null, action: 'admin.plan.create', targetType: 'plan', targetId: plan.id });
    return plan;
  }

  async updatePlan(planId: string, data: Partial<{ name: string; priceCents: number; cpuMilli: number; ramMb: number; storageGb: number; maxServers: number; maxBackupSlots: number }>, actorId: string, actorEmail?: string) {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (!Object.keys(clean).length) throw Err.invalid('PLAN_NO_CHANGES', 'Nothing to update');
    const [plan] = await this.db.update(plans).set(clean).where(eq(plans.id, planId)).returning();
    if (!plan) throw new NotFoundException('PLAN_NOT_FOUND');
    await this.audit.record({ actorId, actorEmail: actorEmail ?? null, action: 'admin.plan.update', targetType: 'plan', targetId: planId, meta: clean });
    return plan;
  }

  async deletePlan(planId: string, actorId: string, actorEmail?: string) {
    if (planId === 'free') throw new ForbiddenException('CANNOT_DELETE_FREE_PLAN');
    const usersOnPlan = await this.db.select({ count: count() }).from(users).where(eq(users.planId, planId));
    if ((usersOnPlan[0]?.count ?? 0) > 0) throw new ForbiddenException('PLAN_HAS_USERS');
    await this.db.delete(plans).where(eq(plans.id, planId));
    await this.audit.record({ actorId, actorEmail: actorEmail ?? null, action: 'admin.plan.delete', targetType: 'plan', targetId: planId });
    return { ok: true };
  }

  // ============ AUDIT LOGS ============

  async listAuditLogs(params: AdminAuditParams = {}) {
    const { page = 1, limit = 50, action, actorId, targetType, targetId, from, to } = params;
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (action) conditions.push(ilike(auditLogs.action, `%${action}%`));
    if (actorId) conditions.push(eq(auditLogs.actorId, actorId));
    if (targetType) conditions.push(eq(auditLogs.targetType, targetType));
    if (targetId) conditions.push(eq(auditLogs.targetId, targetId));
    if (from) conditions.push(sql`${auditLogs.createdAt} >= ${from}`);
    if (to) conditions.push(sql`${auditLogs.createdAt} <= ${to}`);

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(whereClause as SQL)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(auditLogs).where(whereClause as SQL),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total: totalResult[0]?.count ?? 0, pages: Math.ceil((totalResult[0]?.count ?? 0) / limit) },
    };
  }

  // ============ SYSTEM HEALTH ============

  async getSystemStats() {
    const [
      totalUsers,
      totalServers,
      onlineServers,
      errorServers,
      totalBackups,
      backupStorageBytes,
      pgStats,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(users),
      this.db.select({ count: count() }).from(servers),
      this.db.select({ count: count() }).from(servers).where(eq(servers.status, 'online')),
      this.db.select({ count: count() }).from(servers).where(eq(servers.status, 'error')),
      this.db.select({ count: count() }).from(backups).where(eq(backups.status, 'ready')),
      this.db.select({ total: sql<string>`coalesce(sum(size_bytes),0)` }).from(backups).where(eq(backups.status, 'ready')),
      this.getPostgresStats(),
    ]);

    return {
      users: { total: totalUsers[0]?.count ?? 0 },
      servers: {
        total: totalServers[0]?.count ?? 0,
        online: onlineServers[0]?.count ?? 0,
        error: errorServers[0]?.count ?? 0,
      },
      backups: { total: totalBackups[0]?.count ?? 0, storageBytes: Number(backupStorageBytes[0]?.total ?? 0) },
      postgres: pgStats,
    };
  }

  private async getPostgresStats() {
    try {
      const [size, connections, cacheHit] = await Promise.all([
        this.db.execute(sql`SELECT pg_database_size(current_database()) as size`),
        this.db.execute(sql`SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'`),
        this.db.execute(sql`SELECT sum(blks_hit)::float / nullif(sum(blks_hit) + sum(blks_read), 0) as ratio FROM pg_stat_database`),
      ]);
      return {
        sizeBytes: Number(size[0]?.size ?? 0),
        activeConnections: Number(connections[0]?.count ?? 0),
        cacheHitRatio: Number(cacheHit[0]?.ratio ?? 0),
      };
    } catch {
      return { sizeBytes: 0, activeConnections: 0, cacheHitRatio: 0 };
    }
  }
}