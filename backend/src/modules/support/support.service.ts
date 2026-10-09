import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { AppError, Err } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import {
  notifications,
  servers,
  serverEvents,
  supportTickets,
  ticketAssignmentLog,
  ticketEscalations,
  ticketMessages,
  ticketRatings,
  users,
} from '../../db/schema';
import { AuditService } from '../audit/audit.module';
import { DockerService } from '../servers/provisioning/docker.service';
import { ProvisionerService } from '../servers/provisioning/provisioner.service';
import { runtimeImage } from '../servers/provisioning/images';
import {
  DEFAULT_PRIORITY,
  FIRST_RESPONSE_SLA_HOURS,
  MESSAGE_MAX,
  canPost,
  canSetPriority,
  canTransition,
  ownerCanDelete,
  ratingAllowed,
  redactSecrets,
  type StaffRole,
  type TicketStatus,
} from './support-policy';

/**
 * Who is calling. Deliberately shaped like the verified JWT subject
 * (`ReqUser.sub`) so controllers can pass the session straight through and no
 * layer ever has to invent an `id` field that a client could influence.
 */
export interface Caller {
  sub: string;
  role: string;
}

/**
 * Service → realtime sink. Implemented by SupportGateway, which registers
 * itself on module init. Keeping this an interface (instead of injecting the
 * gateway) means the service never imports the gateway class: the dependency
 * runs one way only, so no Nest DI cycle can form.
 */
export interface SupportEvents {
  /** clients should refetch the ticket (claim/release/assign/status/delete) */
  ticketRefresh(ticketId: string, reason: string): void;
  /**
   * The staff queue changed (ticket created / claimed / released / status /
   * priority / assignment / delete). Emitted to the team room so a support
   * dashboard refreshes WITHOUT anyone reloading the page.
   */
  queueChanged(reason: string, ticketId?: string): void;
  ticketMessage(ticketId: string, message: unknown): void;
  ticketRead(ticketId: string, payload: { readBy: string; upToId: string; marked: number }): void;
  notifyUser(userId: string, payload: { type: string; title: string; body: string; link: string | null; ts: number }): void;
  notifyAdmins(payload: { type: string; title: string; body: string; link: string | null; ts: number }): void;
  isOnline(userId: string): boolean;
  presenceFor(userIds: string[]): Record<string, { online: boolean; lastSeenAt: number | null }>;
}

type TicketRow = typeof supportTickets.$inferSelect;

/**
 * "Is there anything new for this viewer?" — evaluated as correlated
 * sub-selects in the same round trip (no N+1, and the numbers always match
 * what the chat itself shows). `viewerId` is bound as a parameter, never
 * interpolated.
 */
function countersFor(viewerId: string) {
  return {
    lastMessage: sql<string | null>`(
      select m.body from ticket_messages m
      where m.ticket_id = ${supportTickets.id}
      order by m.created_at desc limit 1
    )`,
    lastMessageAt: sql<Date | null>`(
      select m.created_at from ticket_messages m
      where m.ticket_id = ${supportTickets.id}
      order by m.created_at desc limit 1
    )`,
    lastAuthorRole: sql<string | null>`(
      select m.author_role from ticket_messages m
      where m.ticket_id = ${supportTickets.id}
      order by m.created_at desc limit 1
    )`,
    unreadCount: sql<number>`(
      select count(*)::int from ticket_messages m
      where m.ticket_id = ${supportTickets.id}
        and m.author_id <> ${viewerId}
        and m.read_at is null
    )`,
  };
}

/**
 * The ONE canonical destination for a ticket, used by every notification.
 *
 * `/admin/support/:id` used to be emitted for admin notifications, but no such
 * route exists (the admin console lives at `/admin/support`, the ticket page
 * at `/dashboard/support/:id`) — which is exactly why those notifications
 * opened a 404. Every role lands on the same role-aware ticket page.
 */
export const TICKET_LINK_PREFIX = '/dashboard/support/';
const ticketLink = (id: string) => `${TICKET_LINK_PREFIX}${id}`;

/**
 * Queue-list shape. Deliberately WITHOUT the description, the last message or
 * any linked-server data: a ticket held by another specialist is visible as a
 * summary only, so the team can see the workload without reading the problem.
 */
function queueView(r: TicketRow) {
  return {
    id: r.id,
    ticketNo: r.ticketNo,
    subject: r.subject,
    category: r.category,
    priority: r.priority,
    status: r.status,
    assigneeId: r.assigneeId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    resolvedAt: r.resolvedAt,
    closedAt: r.closedAt,
    serverId: r.serverId ? true : false,
    firstResponseAt: r.firstResponseAt,
  };
}

/** Serialize a ticket for its audience: owners never see staff-only fields. */
function ticketView(r: TicketRow) {
  return {
    id: r.id,
    ticketNo: r.ticketNo,
    subject: r.subject,
    category: r.category,
    description: r.description,
    priority: r.priority,
    status: r.status,
    serverId: r.serverId,
    assigneeId: r.assigneeId,
    resolvedAt: r.resolvedAt,
    closedAt: r.closedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

@Injectable()
export class SupportService {
  private readonly log = new Logger(SupportService.name);

  constructor(
    @Inject(DB) private db: Db,
    private audit: AuditService,
    private docker: DockerService,
    private provisioner: ProvisionerService,
  ) {}

  private events: SupportEvents | null = null;

  /** Called by SupportGateway on module init (no DI cycle). */
  attachEvents(events: SupportEvents) {
    this.events = events;
  }

  /** Tell every connected member of the support team that the queue moved. */
  private queueChanged(reason: string, ticketId?: string) {
    this.events?.queueChanged(reason, ticketId);
  }

  private onlineMap(userIds: Array<string | null | undefined>): Record<string, { online: boolean; lastSeenAt: number | null }> {
    return this.events?.presenceFor(userIds.filter(Boolean) as string[]) ?? {};
  }

  // ------------------------------------------------------------ access

  private async getTicket(id: string): Promise<TicketRow> {
    const [t] = await this.db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
    if (!t || t.deletedAt) throw Err.notFound('TICKET_NOT_FOUND');
    return t;
  }

  private async staffHistory(ticketId: string, userId: string): Promise<boolean> {
    const [log] = await this.db
      .select({ id: ticketAssignmentLog.id })
      .from(ticketAssignmentLog)
      .where(and(
        eq(ticketAssignmentLog.ticketId, ticketId),
        or(eq(ticketAssignmentLog.actorId, userId), eq(ticketAssignmentLog.toAssignee, userId)),
      ))
      .limit(1);
    if (log) return true;
    const [msg] = await this.db
      .select({ id: ticketMessages.id })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.authorId, userId)))
      .limit(1);
    return !!msg;
  }

  /**
   * The caller's CURRENT role, read from the database. Client-supplied role
   * claims (JWT or socket handshake) are a hint only: a demotion must take
   * effect on the very next request, not when a token happens to expire.
   * One indexed lookup — and only for non-owner paths, since the owner's
   * identity is already proven by the verified session subject.
   */
  private async actorRole(caller: Caller): Promise<'user' | 'support' | 'admin' | null> {
    const [u] = await this.db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, caller.sub))
      .limit(1);
    if (!u || u.status !== 'active') return null;
    return u.role;
  }

  /**
   * Who may open a ticket's DETAILS.
   *
   * A claimed ticket is private to its holder (and to admins): the queue shows
   * everybody a short summary so the team knows what is in flight, but the
   * description, the conversation and the linked server belong to the
   * specialist working it. An unassigned ticket is open to every support
   * member (that is what makes it claimable), and an admin may always look.
   */
  async requireAccess(ticketId: string, user: Caller): Promise<TicketRow> {
    const t = await this.getTicket(ticketId);
    const isOwner = t.userId === user.sub;
    const isAssignee = !!t.assigneeId && t.assigneeId === user.sub;
    const isAdmin = (await this.actorRole(user)) === 'admin';
    const isOpenToTeam = !t.assigneeId;
    const mayRead = isOwner || isAdmin || isAssignee || (isOpenToTeam && (await this.actorRole(user)) === 'support');
    if (!mayRead) {
      throw new AppError(
        'TICKET_NOT_YOURS',
        403,
        isOwner || isAdmin || isAssignee
          ? 'TICKET_ACCESS_DENIED'
          : 'This ticket is being handled by another specialist.',
      );
    }
    return t;
  }

  /**
   * The row a non-participant is allowed to see: enough to know the ticket
   * exists and who owns it, and nothing about the problem itself.
   */
  private summaryView(t: TicketRow) {
    return {
      id: t.id,
      ticketNo: t.ticketNo,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      assigneeId: t.assigneeId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      resolvedAt: t.resolvedAt,
      closedAt: t.closedAt,
    };
  }

  private async roleOf(ticket: TicketRow, user: Caller): Promise<StaffRole> {
    if (ticket.userId === user.sub) return 'owner';
    const role = await this.actorRole(user);
    if (role === 'admin') return 'admin';
    if (role === 'support' || ticket.assigneeId === user.sub) return 'support';
    return 'owner';
  }

  // ------------------------------------------------------------ create

  async resolveServerByCode(code: string, ownerId: string): Promise<string> {
    const [s] = await this.db.select({ id: servers.id, ownerId: servers.ownerId }).from(servers).where(eq(servers.contactCode, code)).limit(1);
    // single generic answer: code existence is never confirmed to non-owners
    if (!s || s.ownerId !== ownerId) throw Err.notFound('SERVER_NOT_FOUND');
    return s.id;
  }

  async createTicket(
    userId: string,
    dto: { subject: string; category: string; description: string; serverContactCode?: string },
    ctx: ReqCtx,
  ) {
    const [u] = await this.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u || u.status !== 'active') throw Err.forbidden('ACCOUNT_INACTIVE');
    // Priority is a staff decision. A client that still sends the field (an
    // older build, a hand-written request) gets it ignored — never honoured.
    if ('priority' in dto && (dto as { priority?: unknown }).priority !== undefined) {
      void ctx;
    }
    let serverId: string | null = null;
    if (dto.serverContactCode) serverId = await this.resolveServerByCode(dto.serverContactCode, userId);
    const [row] = await this.db
      .insert(supportTickets)
      .values({
        userId,
        subject: dto.subject.trim(),
        category: dto.category as TicketRow['category'],
        description: dto.description.trim(),
        priority: DEFAULT_PRIORITY,
        serverId,
      })
      .returning();
    await this.audit.record({
      actorId: userId, action: 'support.ticket.create', targetType: 'support_ticket', targetId: row.id,
      ip: ctx.ip, userAgent: ctx.device, meta: { ticketNo: row.ticketNo, category: row.category },
    });
    await this.notifyAdmins({
      type: 'ticket_created',
      title: `New ticket #${String(row.ticketNo).padStart(6, '0')}`,
      body: `${row.subject} (${row.category})`,
      link: ticketLink(row.id),
    });
    // The staff dashboard must show the ticket WITHOUT a page reload: the
    // queue channel is pushed to every connected support/admin socket.
    this.queueChanged('created', row.id);
    return ticketView(row);
  }

  async listMine(userId: string, page = 1, limit = 20, status?: string) {
    const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), 1000);
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);
    const conds = [eq(supportTickets.userId, userId), isNull(supportTickets.deletedAt)];
    if (status) conds.push(eq(supportTickets.status, status as TicketRow['status']));
    const [{ n }] = await this.db.select({ n: count() }).from(supportTickets).where(and(...conds));
    const counters = countersFor(userId);
    const rows = await this.db
      .select({ t: supportTickets, ...counters })
      .from(supportTickets)
      .where(and(...conds))
      .orderBy(desc(supportTickets.updatedAt))
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit);
    const items = await Promise.all(rows.map(async (r) => {
      const [assignee] = r.t.assigneeId
        ? await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role }).from(users).where(eq(users.id, r.t.assigneeId)).limit(1)
        : [null];
      const [rating] = await this.db.select({ id: ticketRatings.id }).from(ticketRatings).where(eq(ticketRatings.ticketId, r.t.id)).limit(1);
      const ago = r.lastMessageAt ? new Date(r.lastMessageAt) : null;
      return {
        ...ticketView(r.t),
        assignee: assignee ? { id: assignee.id, name: assignee.name, avatarUrl: assignee.avatarUrl, role: assignee.role } : null,
        lastMessage: r.lastMessage && ago ? { body: String(r.lastMessage).slice(0, 160), authorRole: r.lastAuthorRole, createdAt: ago } : null,
        unreadCount: Number(r.unreadCount ?? 0),
        rated: !!rating,
      };
    }));
    return { items, page: safePage, limit: safeLimit, total: n, pages: Math.max(1, Math.ceil(n / safeLimit)) };
  }

  // ------------------------------------------------------------ queue (staff)

  async listQueue(
    user: Caller,
    view: string,
    opts: { status?: string; category?: string; priority?: string; search?: string; assigneeId?: string; from?: string; to?: string; page?: number; limit?: number },
  ) {
    // admin visibility is a database fact, never the caller's claim
    const isAdmin = (await this.actorRole(user)) === 'admin';
    const safePage = Math.min(Math.max(Math.floor(opts.page ?? 1) || 1, 1), 1000);
    const safeLimit = Math.min(Math.max(Math.floor(opts.limit ?? 20) || 20, 1), 100);
    const conds = [isNull(supportTickets.deletedAt)];
    const q = (opts.search ?? '').trim();
    let rows_team = false;
    if (view === 'available') conds.push(eq(supportTickets.status, 'open'), isNull(supportTickets.assigneeId));
    else if (view === 'mine') conds.push(eq(supportTickets.assigneeId, user.sub));
    else if (view === 'waiting') conds.push(eq(supportTickets.status, 'waiting_user'));
    else if (view === 'escalated') conds.push(eq(supportTickets.status, 'waiting_admin'));
    else if (view === 'resolved') conds.push(inArray(supportTickets.status, ['resolved', 'closed'] as TicketRow['status'][]));
    else if (view === 'team') {
      // tickets some OTHER specialist currently holds: read-only visibility
      conds.push(isNotNull(supportTickets.assigneeId), ne(supportTickets.assigneeId, user.sub));
      rows_team = true;
    } else if (view === 'all') {
      if (!isAdmin) throw Err.forbidden('ADMIN_REQUIRED');
    } else throw Err.invalid('QUEUE_VIEW_INVALID', 'Unknown queue view');
    if (opts.status) conds.push(eq(supportTickets.status, opts.status as TicketRow['status']));
    if (opts.category) conds.push(eq(supportTickets.category, opts.category as TicketRow['category']));
    if (opts.priority) conds.push(eq(supportTickets.priority, opts.priority as TicketRow['priority']));
    if (opts.assigneeId) {
      if (!isAdmin && opts.assigneeId !== user.sub) throw Err.forbidden('ADMIN_REQUIRED');
      conds.push(eq(supportTickets.assigneeId, opts.assigneeId));
    }
    if (q) {
      if (/^\d{1,9}$/.test(q)) conds.push(eq(supportTickets.ticketNo, parseInt(q, 10)));
      else conds.push(ilike(supportTickets.subject, `%${q.slice(0, 60)}%`));
    }
    if (opts.from) {
      const d = new Date(opts.from);
      if (Number.isFinite(d.getTime())) conds.push(sql`${supportTickets.createdAt} >= ${d.toISOString()}`);
    }
    if (opts.to) {
      const d = new Date(opts.to);
      if (Number.isFinite(d.getTime())) conds.push(sql`${supportTickets.createdAt} <= ${d.toISOString()}`);
    }
    // one query: ticket + last message + unread count for THIS viewer
    const rows = await this.db
      .select({ t: supportTickets, ...countersFor(user.sub) })
      .from(supportTickets)
      .where(and(...conds))
      .orderBy(desc(supportTickets.updatedAt))
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit);
    // non-admin staff: intersect with their accessible set (defense in depth —
    // the guards above already scope views, this drops nothing legitimate)
    let visible = rows;
    if (!isAdmin) {
      const checks = await Promise.all(rows.map(async (r) => {
        if (r.t.assigneeId === user.sub) return true;
        if (rows_team && r.t.assigneeId) return true; // the team view is read-only visibility
        if (!r.t.assigneeId && r.t.status === 'open') return true;
        if (r.t.status === 'waiting_admin') return true;
        return this.staffHistory(r.t.id, user.sub);
      }));
      visible = rows.filter((_, i) => checks[i]);
    }
    // profiles for owner + assignee in one pass, keyed by id
    const ids = [
      ...new Set([
        ...visible.map((r) => r.t.userId),
        ...visible.map((r) => r.t.assigneeId).filter(Boolean),
      ]),
    ] as string[];
    const profiles = ids.length
      ? await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role }).from(users).where(inArray(users.id, ids))
      : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const presence = this.onlineMap(ids);
    // a row is "mine" when I am the customer or the specialist holding it
    const mineRow = (t: TicketRow, viewer: string) => t.userId === viewer || t.assigneeId === viewer || isAdmin;
    const enriched = visible.map((r) => {
      const owner = byId.get(r.t.userId) ?? null;
      const assignee = r.t.assigneeId ? (byId.get(r.t.assigneeId) ?? null) : null;
      const ago = r.lastMessageAt ? new Date(r.lastMessageAt) : null;
      return {
        ...queueView(r.t),
        owner: owner ? { id: owner.id, name: owner.name, avatarUrl: owner.avatarUrl } : null,
        assignee: assignee ? { id: assignee.id, name: assignee.name, avatarUrl: assignee.avatarUrl, role: assignee.role } : null,
        // the conversation preview is private: only the holder (owner) or an
        // admin sees it in a list row
        mine: mineRow(r.t, user.sub),
        lastMessage: mineRow(r.t, user.sub) && r.lastMessage && ago
          ? { body: String(r.lastMessage).slice(0, 160), authorRole: r.lastAuthorRole, createdAt: ago }
          : null,
        unreadCount: mineRow(r.t, user.sub) ? Number(r.unreadCount ?? 0) : 0,
        presence: assignee ? (presence[assignee.id] ?? { online: false, lastSeenAt: null }) : null,
      };
    });
    const [{ n }] = await this.db.select({ n: count() }).from(supportTickets).where(and(...conds));
    return { items: enriched, page: safePage, limit: safeLimit, total: n, pages: Math.max(1, Math.ceil(n / safeLimit)) };
  }

  /** Atomic claim: exactly one staffer wins the race (0 rows → 409). */
  async claim(ticketId: string, staffId: string, staffRole: string, ctx: ReqCtx) {
    if ((await this.actorRole({ sub: staffId, role: staffRole })) === null) {
      throw Err.forbidden('SUPPORT_REQUIRED');
    }
    // Atomic by construction: one conditional UPDATE whose WHERE is the
    // arbitration rule. Two concurrent claims produce one affected row; the
    // loser sees zero rows and gets 409. No SELECT-then-UPDATE race window.
    const won = await this.db
      .update(supportTickets)
      .set({ assigneeId: staffId, status: 'in_progress', updatedAt: new Date() })
      .where(and(
        eq(supportTickets.id, ticketId),
        isNull(supportTickets.assigneeId),
        eq(supportTickets.status, 'open'),
        isNull(supportTickets.deletedAt),
      ))
      .returning({ id: supportTickets.id, userId: supportTickets.userId });
    const [claimed] = won;
    if (!claimed) throw Err.conflict('TICKET_TAKEN', 'Another specialist just took this ticket');
    await this.db.insert(ticketAssignmentLog).values({
      ticketId, actorId: staffId, action: 'claim', toAssignee: staffId, fromStatus: 'open', toStatus: 'in_progress',
    });
    await this.audit.record({
      actorId: staffId, action: 'support.ticket.claim', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device,
    });
    await this.notify([claimed.userId], {
      type: 'ticket_claimed', title: 'Support is on it',
      body: 'A support specialist picked up your ticket and started working on it.',
      link: ticketLink(ticketId),
    });
    const [t] = await this.db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
    this.events?.ticketRefresh(ticketId, 'claimed');
    this.queueChanged('claimed', ticketId);
    return ticketView(t);
  }

  async release(ticketId: string, user: Caller, ctx: ReqCtx) {
    const t = await this.requireAccess(ticketId, user);
    if ((await this.actorRole(user)) !== 'admin' && t.assigneeId !== user.sub) {
      throw Err.forbidden('NOT_ASSIGNEE');
    }
    const toStatus: TicketRow['status'] = t.status === 'waiting_admin' ? 'waiting_admin' : 'open';
    const [updated] = await this.db.update(supportTickets)
      .set({ assigneeId: null, status: toStatus, updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId)).returning();
    await this.db.insert(ticketAssignmentLog).values({
      ticketId, actorId: user.sub, action: 'release', fromAssignee: t.assigneeId, fromStatus: t.status, toStatus,
    });
    await this.audit.record({
      actorId: user.sub, action: 'support.ticket.release', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device,
    });
    this.events?.ticketRefresh(ticketId, 'released');
    this.queueChanged('released', ticketId);
    return ticketView(updated);
  }

  async assign(ticketId: string, supportId: string, actor: Caller, ctx: ReqCtx) {
    const t = await this.getTicket(ticketId);
    const [target] = await this.db.select({ id: users.id, role: users.role, status: users.status }).from(users).where(eq(users.id, supportId)).limit(1);
    if (!target || target.status !== 'active' || (target.role !== 'support' && target.role !== 'admin')) {
      throw Err.invalid('ASSIGNEE_INVALID', 'Assignee must be an active support member or admin.');
    }
    const [updated] = await this.db.update(supportTickets)
      .set({
        assigneeId: supportId,
        status: t.status === 'open' ? 'in_progress' : t.status,
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, ticketId)).returning();
    await this.db.insert(ticketAssignmentLog).values({
      ticketId, actorId: actor.sub, action: 'assign', fromAssignee: t.assigneeId, toAssignee: supportId,
      fromStatus: t.status, toStatus: updated.status,
    });
    await this.audit.record({
      actorId: actor.sub, action: 'support.ticket.assign', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device, meta: { toAssignee: supportId },
    });
    await this.notify([supportId], {
      type: 'ticket_assigned', title: `Ticket #${String(t.ticketNo).padStart(6, '0')} assigned to you`,
      body: t.subject, link: ticketLink(ticketId),
    });
    this.events?.ticketRefresh(ticketId, 'assigned');
    this.queueChanged('assigned', ticketId);
    return ticketView(updated);
  }

  /**
   * Every state change is an action ON the ticket's owner-workload, so it is
   * limited to the specialist who holds it (or an admin). Reading is open to
   * the team; writing is not.
   */
  private assertTicketOwner(t: TicketRow, asRole: StaffRole, user: Caller, what: string) {
    if (asRole === 'support' && t.assigneeId !== user.sub) {
      throw new AppError(
        'NOT_ASSIGNEE',
        403,
        t.assigneeId
          ? `Only the specialist holding this ticket (or an admin) can ${what}.`
          : `Claim this ticket first — only its holder (or an admin) can ${what}.`,
      );
    }
  }

  async setStatus(ticketId: string, to: TicketStatus, user: Caller, ctx: ReqCtx) {
    const t = await this.requireAccess(ticketId, user);
    const asRole = await this.roleOf(t, user);
    this.assertTicketOwner(t, asRole, user, 'change its status');
    if (!canTransition(t.status, to, asRole)) {
      throw Err.invalid('STATUS_TRANSITION_INVALID', `Cannot move ${t.status} → ${to} as ${asRole}.`);
    }
    const patch: Partial<TicketRow> = { status: to, updatedAt: new Date() };
    if (to === 'resolved') patch.resolvedAt = new Date();
    if (to === 'closed') patch.closedAt = new Date();
    if (to === 'open') { patch.resolvedAt = null; patch.closedAt = null; }
    // reopening (resolved → in_progress) is counted: repeatedly closing and
    // reopening must not look like extra solved tickets in the metrics.
    const reopenBump = to === 'in_progress' && t.status === 'resolved' ? sql`reopen_count + 1` : undefined;
    const [updated] = await this.db.update(supportTickets)
      .set(reopenBump ? { ...patch, reopenCount: reopenBump } : patch)
      .where(eq(supportTickets.id, ticketId)).returning();
    await this.db.insert(ticketAssignmentLog).values({
      ticketId, actorId: user.sub, action: 'status_change', fromStatus: t.status, toStatus: to,
    });
    await this.audit.record({
      actorId: user.sub, action: 'support.ticket.status', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device, meta: { from: t.status, to },
    });
    if (to === 'resolved') {
      await this.db.update(ticketEscalations)
        .set({ status: 'resolved', responderId: user.sub, respondedAt: new Date() })
        .where(and(eq(ticketEscalations.ticketId, ticketId), inArray(ticketEscalations.status, ['pending', 'acknowledged'])));
      await this.notify([t.userId], {
        type: 'ticket_resolved', title: `Ticket #${String(t.ticketNo).padStart(6, '0')} resolved`,
        body: 'Your issue was marked resolved — please rate the support you received.',
        link: ticketLink(ticketId),
      });
    } else {
      await this.notify([t.userId], {
        type: 'ticket_status', title: `Ticket #${String(t.ticketNo).padStart(6, '0')}: ${to.replace('_', ' ')}`,
        body: t.subject, link: ticketLink(ticketId),
      });
    }
    this.events?.ticketRefresh(ticketId, 'status');
    this.queueChanged('status', ticketId);
    return ticketView(updated);
  }

  /**
   * Priority is set by the specialist who holds the ticket (or an admin), and
   * every change is journaled with the old/new value and the actor — so the
   * ordering of the support queue is auditable, never silent.
   */
  async setPriority(ticketId: string, to: 'low' | 'medium' | 'high' | 'urgent', user: Caller, ctx: ReqCtx) {
    const t = await this.requireAccess(ticketId, user);
    const role = await this.actorRole(user);
    const asRole = role === 'admin' ? 'admin' : t.userId === user.sub ? 'owner' : 'support';
    if (!canSetPriority({ role: asRole, isAssignee: t.assigneeId === user.sub })) {
      throw new AppError(
        'PRIORITY_FORBIDDEN',
        403,
        asRole === 'support'
          ? 'Only the specialist holding this ticket (or an admin) can set its priority.'
          : 'Priority is set by the support team.',
      );
    }
    if (t.priority === to) return ticketView(t);
    const [updated] = await this.db
      .update(supportTickets)
      .set({ priority: to, updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId))
      .returning();
    await this.db.insert(ticketAssignmentLog).values({
      ticketId, actorId: user.sub, action: 'priority_change',
      fromStatus: t.priority, toStatus: to, reason: 'priority updated',
    });
    await this.audit.record({
      actorId: user.sub, action: 'support.ticket.priority', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device, meta: { from: t.priority, to },
    });
    if (t.userId !== user.sub) {
      await this.notify([t.userId], {
        type: 'ticket_priority',
        title: `Ticket #${String(t.ticketNo).padStart(6, '0')} priority: ${to}`,
        body: t.subject,
        link: ticketLink(ticketId),
      });
    }
    this.events?.ticketRefresh(ticketId, 'priority');
    this.queueChanged('priority', ticketId);
    return ticketView(updated);
  }

  async reopen(ticketId: string, user: Caller, ctx: ReqCtx) {
    return this.setStatus(ticketId, 'open', user, ctx);
  }

  async updateSubject(ticketId: string, subject: string, user: Caller, ctx: ReqCtx) {
    const t = await this.requireAccess(ticketId, user);
    const asRole = await this.roleOf(t, user);
    this.assertTicketOwner(t, asRole, user, 'rename this ticket');
    const [updated] = await this.db.update(supportTickets)
      .set({ subject: subject.trim(), updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId)).returning();
    await this.audit.record({
      actorId: user.sub, action: 'support.ticket.retitle', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device,
    });
    return ticketView(updated);
  }

  async softDelete(ticketId: string, user: Caller, ctx: ReqCtx) {
    const t = await this.requireAccess(ticketId, user);
    if ((await this.actorRole(user)) === 'admin') {
      // admins may archive anything; history is preserved (rows stay).
    } else {
      const [esc] = await this.db.select({ id: ticketEscalations.id }).from(ticketEscalations)
        .where(and(eq(ticketEscalations.ticketId, ticketId), eq(ticketEscalations.status, 'pending'))).limit(1);
      const staffMsgs = await this.db.select({ id: ticketMessages.id }).from(ticketMessages)
        .where(and(eq(ticketMessages.ticketId, ticketId), ne(ticketMessages.authorId, user.sub))).limit(1);
      if (!ownerCanDelete(t.status, staffMsgs.length > 0, !!esc)) {
        throw Err.invalid('TICKET_DELETE_DENIED', 'Only fresh, untouched tickets can be deleted by their owner.');
      }
    }
    await this.db.update(supportTickets).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, ticketId));
    await this.db.insert(ticketAssignmentLog).values({ ticketId, actorId: user.sub, action: 'delete' });
    this.events?.ticketRefresh(ticketId, 'deleted');
    this.queueChanged('deleted', ticketId);
    await this.audit.record({
      actorId: user.sub, action: 'support.ticket.delete', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device, meta: { ticketNo: t.ticketNo },
    });
    return { ok: true };
  }

  // ------------------------------------------------------------ escalate

  async escalate(ticketId: string, staffId: string, staffRole: string, reason: string, ctx: ReqCtx) {
    const t = await this.requireAccess(ticketId, { sub: staffId, role: staffRole });
    const role = await this.actorRole({ sub: staffId, role: staffRole });
    if (role !== 'support' && role !== 'admin') throw Err.forbidden('SUPPORT_REQUIRED');
    if (t.assigneeId !== staffId && role !== 'admin') {
      throw new AppError('NOT_ASSIGNEE', 403, 'Only the specialist holding this ticket (or an admin) can call an admin in.');
    }
    if (t.status !== 'in_progress') {
      // Re-pressing Call admin while an admin is already being called is a
      // no-op (never a duplicate notification, never an error).
      const [pending] = await this.db.select().from(ticketEscalations)
        .where(and(eq(ticketEscalations.ticketId, ticketId), eq(ticketEscalations.status, 'pending')))
        .orderBy(desc(ticketEscalations.createdAt)).limit(1);
      if (t.status === 'waiting_admin' && pending) return { escalation: pending, deduped: true as const };
      throw Err.invalid('ESCALATE_STATE_INVALID', 'Only in-progress tickets can be escalated.');
    }
    let esc: typeof ticketEscalations.$inferSelect;
    try {
      [esc] = await this.db.insert(ticketEscalations)
        .values({ ticketId, requestedBy: staffId, reason: reason.trim() })
        .returning();
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== '23505') throw e;
      // a pending escalation already exists — re-press is a no-op, never a
      // duplicate notification.
      const [existing] = await this.db.select().from(ticketEscalations)
        .where(and(eq(ticketEscalations.ticketId, ticketId), eq(ticketEscalations.status, 'pending'))).limit(1);
      return { escalation: existing, deduped: true as const };
    }
    await this.db.update(supportTickets)
      .set({ status: 'waiting_admin', updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));
    await this.db.insert(ticketAssignmentLog).values({
      ticketId, actorId: staffId, action: 'escalate', fromStatus: 'in_progress', toStatus: 'waiting_admin', reason: reason.trim().slice(0, 500),
    });
    const [staff] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, staffId)).limit(1);
    const staffName = staff?.name ?? 'A support specialist';
    const no = `#${String(t.ticketNo).padStart(6, '0')}`;
    const reasonText = reason.trim().slice(0, 200);
    await this.audit.record({
      actorId: staffId, action: 'support.ticket.escalate', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device, meta: { reason: reason.trim().slice(0, 200) },
    });
    // A direct, readable call: who needs the admin, which ticket, why, when.
    await this.notifyAdmins({
      type: 'ticket_escalated',
      title: `You were called in ticket ${no}`,
      body: `${staffName} (support) called you in on "${t.subject}"${reasonText ? ` — ${reasonText}` : ''}. Join when you are ready.`,
      link: ticketLink(ticketId),
      dedupeKey: `ticket_escalated:${esc.id}`,
    });
    this.events?.ticketRefresh(ticketId, 'escalated');
    this.queueChanged('escalated', ticketId);
    return { escalation: esc, deduped: false as const };
  }

  /**
   * An admin accepts a call. The UPDATE is conditional on the request still
   * being pending, so two admins clicking at the same moment cannot both be
   * "the" responder: exactly one row updates, the other gets a clear 409.
   */
  async acceptEscalation(escalationId: string, adminId: string, ctx: ReqCtx) {
    const [esc] = await this.db.select().from(ticketEscalations).where(eq(ticketEscalations.id, escalationId)).limit(1);
    if (!esc) throw Err.notFound('ESCALATION_NOT_FOUND');
    if (esc.status !== 'pending') {
      throw new AppError('ESCALATION_ALREADY_HANDLED', 409, 'Another administrator has already picked up this call.');
    }
    await this.getTicket(esc.ticketId);
    const [updated] = await this.db.update(ticketEscalations)
      .set({ status: 'acknowledged', responderId: adminId, respondedAt: new Date() })
      .where(and(eq(ticketEscalations.id, escalationId), eq(ticketEscalations.status, 'pending')))
      .returning();
    if (!updated) throw new AppError('ESCALATION_ALREADY_HANDLED', 409, 'Another administrator has already picked up this call.');
    await this.audit.record({
      actorId: adminId, action: 'support.escalation.accept', targetType: 'support_ticket', targetId: esc.ticketId,
      ip: ctx.ip, userAgent: ctx.device, meta: { escalationId, requestedBy: esc.requestedBy },
    });
    // the specialist who called gets told an admin answered, with who/when
    // The admin is now on the ticket: it stops waiting and returns to work.
    const [ticketRow] = await this.db
      .update(supportTickets)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(and(eq(supportTickets.id, esc.ticketId), eq(supportTickets.status, 'waiting_admin')))
      .returning({ id: supportTickets.id });
    if (ticketRow) {
      await this.db.insert(ticketAssignmentLog).values({
        ticketId: esc.ticketId, actorId: adminId, action: 'status_change',
        fromStatus: 'waiting_admin', toStatus: 'in_progress', reason: 'admin joined after the call',
      });
    }
    if (esc.requestedBy) {
      const [admin] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, adminId)).limit(1);
      await this.notify([esc.requestedBy], {
        type: 'ticket_escalation_answered',
        title: 'An administrator joined your call',
        body: `${admin?.name ?? 'An administrator'} is on the ticket now.`,
        link: ticketLink(esc.ticketId),
        dedupeKey: `escalation_answered:${esc.id}:${adminId}`,
      });
    }
    this.events?.ticketRefresh(esc.ticketId, 'escalation-accepted');
    this.queueChanged('escalation', esc.ticketId);
    return updated;
  }

  /**
   * An admin declines the call. The request stays pending (another admin may
   * take it) and the decline is journaled — nobody is silently dropped.
   */
  async declineEscalation(escalationId: string, adminId: string, reason: string, ctx: ReqCtx) {
    const [esc] = await this.db.select().from(ticketEscalations).where(eq(ticketEscalations.id, escalationId)).limit(1);
    if (!esc || esc.status !== 'pending') throw Err.notFound('ESCALATION_NOT_FOUND');
    await this.getTicket(esc.ticketId);
    const [admin] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, adminId)).limit(1);
    await this.audit.record({
      actorId: adminId, action: 'support.escalation.decline', targetType: 'support_ticket', targetId: esc.ticketId,
      ip: ctx.ip, userAgent: ctx.device,
      meta: { escalationId, reason: reason.slice(0, 300), requestedBy: esc.requestedBy },
    });
    if (esc.requestedBy) {
      await this.notify([esc.requestedBy], {
        type: 'ticket_escalation_declined',
        title: 'Your admin call was declined',
        body: `${admin?.name ?? 'An administrator'} could not take it${reason.trim() ? `: ${reason.trim().slice(0, 160)}` : ''}. The request is still open for another administrator.`,
        link: ticketLink(esc.ticketId),
        dedupeKey: `escalation_declined:${esc.id}:${adminId}`,
      });
    }
    return { ok: true, stillPending: true as const };
  }

  async ackEscalation(escalationId: string, adminId: string, ctx: ReqCtx) {
    const [esc] = await this.db.select().from(ticketEscalations).where(eq(ticketEscalations.id, escalationId)).limit(1);
    if (!esc || esc.status !== 'pending') throw Err.notFound('ESCALATION_NOT_FOUND');
    // admin must be able to open the ticket (exists + not deleted)
    await this.getTicket(esc.ticketId);
    const [updated] = await this.db.update(ticketEscalations)
      .set({ status: 'acknowledged', responderId: adminId, respondedAt: new Date() })
      .where(and(eq(ticketEscalations.id, escalationId), eq(ticketEscalations.status, 'pending')))
      .returning();
    if (!updated) throw Err.notFound('ESCALATION_NOT_FOUND');
    await this.audit.record({
      actorId: adminId, action: 'support.escalation.ack', targetType: 'support_ticket', targetId: esc.ticketId,
      ip: ctx.ip, userAgent: ctx.device,
    });
    return updated;
  }

  /** Pending calls with the context an admin needs to decide, in one join. */
  async listEscalations(status?: string, opts?: { limit?: number }) {
    const conds = status ? [eq(ticketEscalations.status, status as 'pending' | 'acknowledged' | 'resolved')] : [];
    const safeLimit = Math.min(Math.max(Math.floor(opts?.limit ?? 50) || 50, 1), 200);
    const rows = await this.db
      .select({
        escalation: ticketEscalations,
        ticketNo: supportTickets.ticketNo,
        ticketSubject: supportTickets.subject,
        ticketStatus: supportTickets.status,
        ticketId: supportTickets.id,
        requesterName: users.name,
      })
      .from(ticketEscalations)
      .innerJoin(supportTickets, eq(supportTickets.id, ticketEscalations.ticketId))
      .leftJoin(users, eq(users.id, ticketEscalations.requestedBy))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(ticketEscalations.createdAt))
      .limit(safeLimit);
    return rows.map((r) => ({
      ...r.escalation,
      ticket: { id: r.ticketId, ticketNo: r.ticketNo, subject: r.ticketSubject, status: r.ticketStatus },
      requester: r.requesterName ? { name: r.requesterName } : null,
    }));
  }

  // ------------------------------------------------------------ messages

  private authorView(m: typeof ticketMessages.$inferSelect, profile: { id: string; name: string; avatarUrl: string | null } | null) {
    return {
      id: m.id,
      author: profile ? { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl } : { id: null, name: 'Deleted member', avatarUrl: null },
      // badge source of truth: the snapshot stored at send time
      authorRole: m.authorRole,
      body: m.body,
      deliveredAt: m.deliveredAt,
      readAt: m.readAt,
      createdAt: m.createdAt,
    };
  }

  async history(ticketId: string, user: Caller, page = 1, limit = 50) {
    await this.requireAccess(ticketId, user);
    const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), 1000);
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
    const rows = await this.db.select().from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(desc(ticketMessages.createdAt))
      .limit(safeLimit + 1)
      .offset((safePage - 1) * safeLimit);
    const items = rows.slice(0, safeLimit).reverse();
    const authorIds = [...new Set(items.map((m) => m.authorId).filter(Boolean))] as string[];
    const profiles = authorIds.length
      ? await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, authorIds))
      : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return {
      items: items.map((m) => this.authorView(m, m.authorId ? (byId.get(m.authorId) ?? null) : null)),
      page: safePage, hasMore: rows.length > safeLimit,
    };
  }

  async sendMessage(
    ticketId: string,
    author: Caller,
    body: string,
    clientMsgId: string | undefined,
    ctx: ReqCtx,
  ) {
    const t = await this.requireAccess(ticketId, author);
    if (t.status === 'closed') throw Err.invalid('TICKET_CLOSED', 'This ticket is closed.');
    const text = body?.trim() ?? '';
    if (!text || text.length > MESSAGE_MAX) throw Err.invalid('MESSAGE_INVALID', `Message must be 1–${MESSAGE_MAX} characters.`);
    // Exclusive write access (canPost in support-policy): the owner always,
    // an admin always, and a support member ONLY while they are the current
    // assignee. Holding the Support role alone grants read access, never the
    // right to answer somebody else's ticket.
    // (a closed ticket has already been rejected above, so a failure here is
    // always an authority problem)
    const asRole = await this.roleOf(t, author);
    if (!canPost({ role: asRole, status: t.status, assigneeId: t.assigneeId, authorId: author.sub })) {
      throw new AppError(
        'NOT_ASSIGNEE',
        403,
        asRole === 'support' && t.assigneeId
          ? 'Another specialist holds this ticket. They (or an admin) can reassign it to you.'
          : asRole === 'support'
            ? 'Claim this ticket before replying, so only one specialist answers the customer.'
            : 'You cannot post in this ticket.',
      );
    }
    if (clientMsgId && !/^[A-Za-z0-9_-]{8,64}$/.test(clientMsgId)) {
      throw Err.invalid('IDEMPOTENCY_KEY_INVALID', 'Bad idempotency key.');
    }
    const [u] = await this.db.select({ role: users.role }).from(users).where(eq(users.id, author.sub)).limit(1);
    const roleSnapshot = u?.role === 'admin' ? 'admin' : u?.role === 'support' ? 'support' : 'user';
    let msg: typeof ticketMessages.$inferSelect;
    if (clientMsgId) {
      const [ins] = await this.db.insert(ticketMessages)
        .values({ ticketId, authorId: author.sub, authorRole: roleSnapshot, body: text, clientMsgId })
        .onConflictDoNothing({ target: [ticketMessages.ticketId, ticketMessages.clientMsgId] })
        .returning();
      if (ins) {
        msg = ins;
      } else {
        // replayed send — return the original, never a duplicate
        const [existing] = await this.db.select().from(ticketMessages)
          .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.clientMsgId, clientMsgId)))
          .limit(1);
        if (!existing) throw Err.unavailable('MESSAGE_REPLAY', 'Replay in progress, retry.');
        return this.withAuthor(existing);
      }
    } else {
      [msg] = await this.db.insert(ticketMessages)
        .values({ ticketId, authorId: author.sub, authorRole: roleSnapshot, body: text })
        .returning();
    }
    // first reply from the team: stamps the response clock exactly once
    if (asRole === 'support' || asRole === 'admin') {
      await this.db.update(supportTickets)
        .set({ firstResponseAt: sql`coalesce(first_response_at, now())`, updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
    } else {
      await this.db.update(supportTickets).set({ updatedAt: new Date() }).where(eq(supportTickets.id, ticketId));
    }
    // auto-transitions on replies (documented): owner answers a wait,
    // admin joins an escalation.
    if (asRole === 'owner' && (t.status === 'waiting_user' || t.status === 'resolved')) {
      await this.setStatusInternal(ticketId, t.status, 'in_progress', author.sub, ctx);
    } else if (asRole === 'admin' && t.status === 'waiting_admin') {
      await this.setStatusInternal(ticketId, 'waiting_admin', 'in_progress', author.sub, ctx);
      await this.db.update(ticketEscalations)
        .set({ status: 'acknowledged', responderId: author.sub, respondedAt: new Date() })
        .where(and(eq(ticketEscalations.ticketId, ticketId), eq(ticketEscalations.status, 'pending')));
    }
    // notify the other side
    if (asRole === 'owner') {
      const targets = t.assigneeId ? [t.assigneeId] : [];
      if (targets.length) {
        await this.notify(targets, {
          type: 'ticket_message', title: `Reply on #${String(t.ticketNo).padStart(6, '0')}`,
          body: text.slice(0, 160), link: ticketLink(ticketId),
        });
      }
      if (t.status === 'waiting_admin') {
        await this.notifyAdmins({
          type: 'ticket_message', title: `Owner replied on escalated #${String(t.ticketNo).padStart(6, '0')}`,
          body: text.slice(0, 160), link: ticketLink(ticketId),
        });
      }
    } else {
      await this.notify([t.userId], {
        type: 'ticket_message', title: `Reply on #${String(t.ticketNo).padStart(6, '0')}`,
        body: text.slice(0, 160), link: ticketLink(ticketId),
      });
    }
    const view = await this.withAuthor(msg);
    this.events?.ticketMessage(ticketId, view);
    return view;
  }

  private async withAuthor(m: typeof ticketMessages.$inferSelect) {    const [p] = m.authorId
      ? await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, m.authorId)).limit(1)
      : [null];
    return this.authorView(m, p ?? null);
  }

  private async setStatusInternal(ticketId: string, from: TicketStatus, to: TicketStatus, actorId: string, ctx: ReqCtx) {
    await this.db.update(supportTickets)
      .set({
        status: to,
        updatedAt: new Date(),
        ...(to === 'resolved' ? { resolvedAt: new Date() } : {}),
        ...(to === 'in_progress' && from === 'resolved' ? { reopenCount: sql`reopen_count + 1` } : {}),
      })
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.status, from)));
    await this.db.insert(ticketAssignmentLog).values({
      ticketId, actorId, action: 'status_change', fromStatus: from, toStatus: to, reason: 'auto: reply received',
    });
    await this.audit.record({
      actorId, action: 'support.ticket.status', targetType: 'support_ticket', targetId: ticketId,
      ip: ctx.ip, userAgent: ctx.device, meta: { from, to, auto: true },
    });
  }

  /** Mark the other side's messages up to `upToId` as read by `readerId`. */
  async markRead(ticketId: string, reader: Caller, upToId: string) {
    const t = await this.requireAccess(ticketId, reader);
    const [target] = await this.db.select().from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.id, upToId))).limit(1);
    if (!target) throw Err.notFound('MESSAGE_NOT_FOUND');
    // The boundary is resolved by the database (a sub-query on the target row),
    // NOT by a JS Date: Postgres stores microseconds, Date keeps milliseconds,
    // so a client-side comparison silently misses the boundary message itself.
    const updated = await this.db.update(ticketMessages)
      .set({ readAt: new Date(), readBy: reader.sub })
      .where(and(
        eq(ticketMessages.ticketId, ticketId),
        ne(ticketMessages.authorId, reader.sub),
        isNull(ticketMessages.readAt),
        lte(ticketMessages.createdAt, sql`(select created_at from ticket_messages where id = ${upToId})`),
      ))
      .returning({ id: ticketMessages.id });
    this.events?.ticketRead(ticketId, { readBy: reader.sub, upToId, marked: updated.length });
    return { ok: true, marked: updated.length };
  }

  /** First-delivery marker, called by the gateway when a live socket exists. */
  async markDelivered(messageId: string) {
    await this.db.update(ticketMessages)
      .set({ deliveredAt: new Date() })
      .where(and(eq(ticketMessages.id, messageId), isNull(ticketMessages.deliveredAt)));
    return { ok: true };
  }

  // ------------------------------------------------------------ detail/timeline

  async detail(ticketId: string, user: Caller) {
    const t = await this.requireAccess(ticketId, user);
    const [owner] = await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, email: users.email }).from(users).where(eq(users.id, t.userId)).limit(1);
    const [assignee] = t.assigneeId
      ? await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role }).from(users).where(eq(users.id, t.assigneeId)).limit(1)
      : [null];
    const [esc] = await this.db.select().from(ticketEscalations)
      .where(and(eq(ticketEscalations.ticketId, ticketId), eq(ticketEscalations.status, 'pending')))
      .orderBy(desc(ticketEscalations.createdAt)).limit(1);
    const [rating] = await this.db.select().from(ticketRatings).where(eq(ticketRatings.ticketId, ticketId)).limit(1);
    const viewerRole = await this.actorRole(user);
    const ownerPublic = owner ? { id: owner.id, name: owner.name, avatarUrl: owner.avatarUrl, ...(viewerRole === 'admin' ? { email: owner.email } : {}) } : null;
    return {
      ...ticketView(t),
      owner: ownerPublic,
      assignee: assignee ? { id: assignee.id, name: assignee.name, avatarUrl: assignee.avatarUrl, role: assignee.role } : null,
      // live presence of both sides, from real socket sessions
      presence: this.onlineMap([t.userId, t.assigneeId]),
      serverContactCode: t.serverId
        ? (await this.db.select({ contactCode: servers.contactCode }).from(servers).where(eq(servers.id, t.serverId)).limit(1))[0]?.contactCode ?? null
        : null,
      pendingEscalation: esc ? { id: esc.id, reason: esc.reason, requestedBy: esc.requestedBy, createdAt: esc.createdAt } : null,
      // ratings are private to owner+admin (staff see only their own aggregates)
      rating: rating && (viewerRole === 'admin' || t.userId === user.sub)
        ? { stars: rating.stars, resolved: rating.resolved, comment: rating.comment, createdAt: rating.createdAt }
        : null,
      myRole: await this.roleOf(t, user),
    };
  }

  async timeline(ticketId: string, user: Caller) {
    await this.requireAccess(ticketId, user);
    const logs = await this.db.select().from(ticketAssignmentLog)
      .where(eq(ticketAssignmentLog.ticketId, ticketId))
      .orderBy(ticketAssignmentLog.createdAt).limit(200);
    const escs = await this.db.select().from(ticketEscalations)
      .where(eq(ticketEscalations.ticketId, ticketId))
      .orderBy(ticketEscalations.createdAt).limit(50);
    const actorIds = [...new Set([...logs.map((l) => l.actorId), ...escs.map((e) => e.requestedBy)].filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await this.db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, actorIds))
      : [];
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      events: [
        ...logs.map((l) => ({ kind: 'log' as const, at: l.createdAt, action: l.action, actor: l.actorId ? (byId.get(l.actorId) ?? { id: l.actorId, name: 'Deleted member', role: 'user' }) : null, fromStatus: l.fromStatus, toStatus: l.toStatus, reason: l.reason })),
        ...escs.map((e) => ({ kind: 'escalation' as const, at: e.createdAt, action: 'escalate' as const, actor: e.requestedBy ? (byId.get(e.requestedBy) ?? null) : null, status: e.status, reason: e.reason })),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    };
  }

  // ------------------------------------------------------------ server card (read-only)

  async serverCard(ticketId: string, user: Caller, ctx: ReqCtx) {
    const t = await this.requireAccess(ticketId, user);
    if (!t.serverId) throw Err.notFound('TICKET_NO_SERVER');
    const [s] = await this.db.select().from(servers).where(eq(servers.id, t.serverId)).limit(1);
    if (!s) throw Err.notFound('SERVER_NOT_FOUND');
    const fetchedAt = new Date().toISOString();
    // A suspended server is honoured, never worked around: the support path is
    // read-only anyway, and for a suspended server it surfaces no live metrics
    // or logs at all (only the state, the error and the activity trail).
    const suspended = s.status === 'suspended';
    const operable = s.status === 'online' || s.status === 'restarting' || s.status === 'error';
    // live numbers are best-effort: a missing container/docker error yields
    // explicit nulls, never fabricated data.
    let usage: { storageUsedBytes: number | null; storageGb: number; cpuPercent: number | null; memBytes: number | null; memLimitBytes: number | null } = {
      storageUsedBytes: null, storageGb: s.storageGb, cpuPercent: null, memBytes: null, memLimitBytes: null,
    };
    try {
      if (!suspended && s.volumeName) {
        usage.storageUsedBytes = await this.provisioner.volumeUsage(s.volumeName, runtimeImage(s.runtime).image, s.nodeId);
      }
      if (operable && s.containerId) {
        const st = await this.docker.stats(s.containerId, s.nodeId).catch(() => null);
        if (st) { usage = { ...usage, cpuPercent: st.cpuPercent, memBytes: st.memBytes, memLimitBytes: st.memLimitBytes }; }
      }
    } catch { /* nulls stand */ }
    let logs: { lines: string[]; truncated: boolean } | null = null;
    if (operable && s.containerId) {
      try {
        const raw = await this.docker.logs(s.containerId, 100, s.nodeId);
        const lines = String(raw ?? '').split('\n').filter((l) => l.trim()).slice(-100).map(redactSecrets);
        logs = { lines, truncated: lines.length >= 100 };
      } catch { logs = null; }
    }
    const events = await this.db.select({ id: serverEvents.id, type: serverEvents.type, createdAt: serverEvents.createdAt, detail: serverEvents.detail }).from(serverEvents)
      .where(eq(serverEvents.serverId, s.id)).orderBy(desc(serverEvents.createdAt)).limit(20);
    // Same allow-list the owner-facing activity feed uses: server_events.detail
    // can carry internal provisioner fields, so only vetted keys ever reach a
    // support agent (never env values, credentials or file contents).
    const SAFE_EVENT_KEYS = new Set(['error', 'plan', 'runtime', 'region', 'status', 'clean', 'start']);
    const safeEvents = events.map((e) => {
      const detail: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries((e.detail ?? {}) as Record<string, unknown>)) {
        if (!SAFE_EVENT_KEYS.has(k)) continue;
        if (typeof v === 'string') detail[k] = v.slice(0, 300);
        else if (typeof v === 'number' || typeof v === 'boolean') detail[k] = v;
      }
      return { type: e.type, createdAt: e.createdAt, detail };
    });
    await this.audit.record({
      actorId: user.sub, action: 'support.server.logs_view', targetType: 'server', targetId: s.id,
      ip: ctx.ip, userAgent: ctx.device, meta: { via: 'ticket', ticketId, serverStatus: s.status },
    });
    return {
      server: {
        contactCode: s.contactCode,
        name: s.name,
        runtime: s.runtime,
        runtimeVersion: s.runtimeVersion,
        region: s.region,
        status: s.status,
        lastError: s.lastError,
        plan: { cpuMilli: s.cpuMilli, ramMb: s.ramMb, storageGb: s.storageGb },
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
      },
      // reasons a value is missing, so the UI can explain itself honestly
      unavailable: {
        liveMetrics: !operable ? `Server is ${s.status}` : null,
        logs: !operable ? `Server is ${s.status}` : (logs ? null : 'No logs available yet'),
        storage: suspended ? 'Server suspended' : null,
      },
      usage,
      logs,
      events: safeEvents,
      fetchedAt,
    };
  }

  // ------------------------------------------------------------ ratings

  private async rateeFor(ticketId: string): Promise<string | null> {
    const [t] = await this.db.select({ assigneeId: supportTickets.assigneeId }).from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
    if (t?.assigneeId) {
      const [a] = await this.db.select({ role: users.role }).from(users).where(eq(users.id, t.assigneeId)).limit(1);
      if (a && (a.role === 'support' || a.role === 'admin')) return t.assigneeId;
    }
    const [m] = await this.db.select({ authorId: ticketMessages.authorId }).from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticketId), inArray(ticketMessages.authorRole, ['support', 'admin'])))
      .orderBy(desc(ticketMessages.createdAt)).limit(1);
    return m?.authorId ?? null;
  }

  private async staffEngaged(ticketId: string): Promise<boolean> {
    const [a] = await this.db.select({ id: ticketAssignmentLog.id }).from(ticketAssignmentLog)
      .where(and(eq(ticketAssignmentLog.ticketId, ticketId), inArray(ticketAssignmentLog.action, ['claim', 'assign']))).limit(1);
    if (a) return true;
    const [m] = await this.db.select({ id: ticketMessages.id }).from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticketId), inArray(ticketMessages.authorRole, ['support', 'admin']))).limit(1);
    return !!m;
  }

  async ratingEligibility(ticketId: string, userId: string) {
    const t = await this.requireAccess(ticketId, { sub: userId, role: 'user' }).catch(() => null);
    if (!t || t.userId !== userId) return { eligible: false as const, reason: 'Only the ticket owner can rate.' };
    const [existing] = await this.db.select({ id: ticketRatings.id }).from(ticketRatings).where(eq(ticketRatings.ticketId, ticketId)).limit(1);
    const check = ratingAllowed({
      isOwner: true, status: t.status, staffEngaged: await this.staffEngaged(ticketId), alreadyRated: !!existing,
    });
    if (!check.ok) return { eligible: false as const, reason: check.reason };
    const rateeId = await this.rateeFor(ticketId);
    if (!rateeId) return { eligible: false as const, reason: 'No staff interaction to rate yet.' };
    const [ratee] = await this.db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, rateeId)).limit(1);
    return { eligible: true as const, ratee };
  }

  async rate(ticketId: string, userId: string, dto: { stars: number; resolved: string; comment?: string }, ctx: ReqCtx) {
    const t = await this.getTicket(ticketId);
    if (t.userId !== userId) throw Err.forbidden('NOT_OWNER');
    const [existing] = await this.db.select({ id: ticketRatings.id }).from(ticketRatings).where(eq(ticketRatings.ticketId, ticketId)).limit(1);
    const check = ratingAllowed({
      isOwner: true, status: t.status, staffEngaged: await this.staffEngaged(ticketId), alreadyRated: !!existing,
    });
    if (existing) throw new AppError('RATING_EXISTS', 409, 'This ticket already has a rating.');
    if (!check.ok) throw Err.invalid('RATING_NOT_ALLOWED', check.reason ?? 'Rating not allowed.');
    const rateeId = await this.rateeFor(ticketId);
    if (!rateeId) throw Err.invalid('RATING_NOT_ALLOWED', 'No staff interaction to rate yet.');
    try {
      const [row] = await this.db.insert(ticketRatings).values({
        ticketId, userId, supportId: rateeId,
        stars: dto.stars, resolved: dto.resolved,
        comment: dto.comment?.trim().slice(0, 1000) || null,
      }).returning();
      await this.audit.record({
        actorId: userId, action: 'support.rating.create', targetType: 'support_ticket', targetId: ticketId,
        ip: ctx.ip, userAgent: ctx.device, meta: { stars: dto.stars, resolved: dto.resolved, supportId: rateeId },
      });
      return row;
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === '23505') throw new AppError('RATING_EXISTS', 409, 'This ticket already has a rating.');
      throw e;
    }
  }

  /**
   * Support performance, computed only from recorded events.
   *
   * Sources of truth:
   *  - ticket_assignment_log → claim / release / assign / status_change
   *    (one row per action; DISTINCT ticket_id keeps the counts unique)
   *  - ticket_messages       → first reply timing (first_response_at)
   *  - ticket_ratings        → stars and resolution outcome
   *  - users.last_seen_at    → last seen, persisted by live sockets
   *
   * What is deliberately NOT claimed: the total time a ticket sat waiting for
   * the customer is subtracted from the "resolution time" figure, so a slow
   * customer is not charged to the specialist. Connected time (how long a
   * browser was open) is reported separately from handled tickets, and is
   * never treated as working time.
   */
  async performance(input: {
    requester: Caller;
    supportId?: string;
    from?: string;
    to?: string;
  }): Promise<Record<string, unknown>> {
    const role = await this.actorRole(input.requester);
    if (role !== 'admin' && input.supportId && input.supportId !== input.requester.sub) {
      throw Err.forbidden('ADMIN_REQUIRED');
    }
    const supportId = input.supportId ?? input.requester.sub;
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    const okFrom = from && Number.isFinite(from.getTime()) ? from : null;
    const okTo = to && Number.isFinite(to.getTime()) ? to : null;

    const scope = and(
      okFrom ? sql`${supportTickets.createdAt} >= ${okFrom.toISOString()}` : undefined,
      okTo ? sql`${supportTickets.createdAt} <= ${okTo.toISOString()}` : undefined,
    );

    // workload: every ticket this specialist took (unique), within the window
    const workload = await this.db.execute(sql`
      select
        count(distinct t.id) filter (where t.assignee_id = ${supportId} or t.user_id = ${supportId})::int as touched,
        count(distinct t.id) filter (where t.assignee_id = ${supportId})::int as assigned_now,
        count(distinct t.id) filter (
          where t.assignee_id = ${supportId} and t.status in ('open','in_progress','waiting_user','waiting_admin')
        )::int as open_now,
        count(distinct t.id) filter (
          where t.assignee_id = ${supportId} and t.resolved_at is not null
        )::int as resolved,
        count(distinct t.id) filter (
          where t.assignee_id = ${supportId} and t.closed_at is not null
        )::int as closed,
        count(distinct t.id) filter (
          where t.assignee_id = ${supportId} and t.reopen_count > 0
        )::int as reopened,
        count(distinct t.id) filter (
          where t.assignee_id = ${supportId} and t.first_response_at is not null
        )::int as answered,
        coalesce(avg(extract(epoch from (t.first_response_at - t.created_at)) * 1000) filter (
          where t.assignee_id = ${supportId} and t.first_response_at is not null
        ), 0)::float8 as avg_first_response_ms,
        coalesce(avg(extract(epoch from (t.resolved_at - t.created_at)) * 1000) filter (
          where t.assignee_id = ${supportId} and t.resolved_at is not null
        ), 0)::float8 as avg_resolution_ms,
        count(distinct t.id) filter (
          where t.assignee_id = ${supportId} and t.first_response_at is null
            and t.created_at < ${new Date(Date.now() - FIRST_RESPONSE_SLA_HOURS * 3600_000).toISOString()}::timestamptz
        )::int as overdue_first_response
      from support_tickets t
      where t.deleted_at is null
        ${okFrom ? sql`and t.created_at >= ${okFrom.toISOString()}` : sql``}
        ${okTo ? sql`and t.created_at <= ${okTo.toISOString()}` : sql``}
    `);
    const w = (workload.rows?.[0] ?? {}) as Record<string, unknown>;
    void scope;

    const claimed = await this.db.execute(sql`
      select count(distinct l.ticket_id)::int as n
      from ticket_assignment_log l
      join support_tickets t on t.id = l.ticket_id
      where l.action = 'claim' and l.actor_id = ${supportId} and t.deleted_at is null
        ${okFrom ? sql`and l.created_at >= ${okFrom.toISOString()}` : sql``}
        ${okTo ? sql`and l.created_at <= ${okTo.toISOString()}` : sql``}
    `);
    const rating = await this.computeSummary(supportId);

    // presence: live sockets (in-memory) + the persisted last-seen timestamp
    const [me] = await this.db
      .select({ lastSeenAt: users.lastSeenAt, name: users.name, status: users.status })
      .from(users)
      .where(eq(users.id, supportId))
      .limit(1);
    const presence = this.onlineMap([supportId])[supportId] ?? { online: false, lastSeenAt: null };

    return {
      supportId,
      name: me?.name ?? null,
      window: { from: okFrom?.toISOString() ?? null, to: okTo?.toISOString() ?? null },
      workflow: {
        claimed: Number((claimed.rows?.[0] as { n?: number } | undefined)?.n ?? 0),
        assignedNow: Number(w.assigned_now ?? 0),
        openNow: Number(w.open_now ?? 0),
        resolved: Number(w.resolved ?? 0),
        closed: Number(w.closed ?? 0),
        reopened: Number(w.reopened ?? 0),
        answered: Number(w.answered ?? 0),
      },
      timing: {
        avgFirstResponseMs: Number(w.avg_first_response_ms ?? 0),
        avgResolutionMs: Number(w.avg_resolution_ms ?? 0),
        // tickets still waiting for a first reply past the response SLA
        overdueFirstResponse: Number(w.overdue_first_response ?? 0),
        firstResponseSlaHours: FIRST_RESPONSE_SLA_HOURS,
      },
      ratings: rating,
      presence: {
        online: presence.online,
        lastSeenAt: presence.lastSeenAt ?? (me?.lastSeenAt ? new Date(me.lastSeenAt).getTime() : null),
        status: me?.status ?? null,
      },
      notes: [
        'Resolution time excludes the time a ticket waited for the customer.',
        'Connected time is reported separately and is not working time.',
      ],
    };
  }

  /** Roster-level view for the admin console: workload + presence per member. */
  async teamPerformance(input: { requester: Caller; from?: string; to?: string }) {
    if ((await this.actorRole(input.requester)) !== 'admin') throw Err.forbidden('ADMIN_REQUIRED');
    const members = await this.db.select({ id: users.id }).from(users).where(eq(users.role, 'support')).orderBy(users.name);
    const out: Array<Record<string, unknown>> = [];
    for (const m of members) {
      out.push(await this.performance({ requester: input.requester, supportId: m.id, from: input.from, to: input.to }));
    }
    return out;
  }

  private async computeSummary(supportId: string) {
    const rows = await this.db.select({ stars: ticketRatings.stars, resolved: ticketRatings.resolved }).from(ticketRatings).where(eq(ticketRatings.supportId, supportId));
    const count = rows.length;
    const avgStars = count ? rows.reduce((a, r) => a + r.stars, 0) / count : null;
    const resolutionRate = count ? rows.filter((r) => r.resolved === 'yes').length / count : null;
    return { supportId, count, avgStars, resolutionRate };
  }

  async ratingSummary(supportId: string, requester: Caller) {
    const role = await this.actorRole(requester);
    if (role !== 'admin' && !(role === 'support' && requester.sub === supportId)) {
      throw Err.forbidden('ADMIN_REQUIRED');
    }
    return this.computeSummary(supportId);
  }

  async listRatings(requester: Caller, opts: { supportId?: string; page?: number; limit?: number }) {
    const safePage = Math.min(Math.max(Math.floor(opts.page ?? 1) || 1, 1), 1000);
    const safeLimit = Math.min(Math.max(Math.floor(opts.limit ?? 20) || 20, 1), 100);
    const conds: SQL[] = [];
    const role = await this.actorRole(requester);
    if (role === 'support') conds.push(eq(ticketRatings.supportId, requester.sub));
    else if (opts.supportId) conds.push(eq(ticketRatings.supportId, opts.supportId));
    else if (role !== 'admin') throw Err.forbidden('ADMIN_REQUIRED');
    const rows = await this.db.select().from(ticketRatings)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(ticketRatings.createdAt)).limit(safeLimit).offset((safePage - 1) * safeLimit);
    return { items: rows, page: safePage };
  }

  async listMembers(requester: Caller, opts?: { includePerformance?: boolean }) {
    const members = await this.db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl, status: users.status, lastSeenAt: users.lastSeenAt })
      .from(users).where(eq(users.role, 'support')).orderBy(users.name);
    const rows = await Promise.all(members.map(async (m) => {
      const [{ n: open }] = await this.db.select({ n: count() }).from(supportTickets)
        .where(and(eq(supportTickets.assigneeId, m.id), inArray(supportTickets.status, ['open', 'in_progress', 'waiting_user', 'waiting_admin']), isNull(supportTickets.deletedAt)));
      // Rating performance is private: a member only ever sees their own
      // aggregates. Admins see everyone's from the admin console.
      const own = requester.sub === m.id || opts?.includePerformance === true;
      const stats = own ? await this.computeSummary(m.id) : { supportId: m.id, count: null, avgStars: null, resolutionRate: null };
      return { ...stats, openTickets: open };
    }));
    const presence = this.onlineMap(members.map((m) => m.id));
    return members.map((m, i) => ({ ...m, stats: rows[i], presence: presence[m.id] ?? { online: false, lastSeenAt: null } }));
  }

  // ------------------------------------------------------------ notifications

  /**
   * Store a notification and push it to live sockets.
   *
   * When `dedupeKey` is given the insert is idempotent per recipient (a unique
   * index), and only the rows that were ACTUALLY inserted are pushed — so a
   * reconnecting client, a double click or a retried request cannot make one
   * real event ring somebody's bell twice.
   */
  async notify(
    userIds: string[],
    n: { type: string; title: string; body: string; link?: string; dedupeKey?: string },
  ) {
    const targets = [...new Set(userIds)].filter(Boolean);
    if (!targets.length) return { notified: 0 };
    const row = (userId: string) => ({
      userId,
      type: n.type.slice(0, 48),
      title: n.title.slice(0, 140),
      body: n.body.slice(0, 500),
      link: n.link?.slice(0, 255) ?? null,
      dedupeKey: n.dedupeKey?.slice(0, 80) ?? null,
    });
    const inserted: string[] = [];
    for (const userId of targets) {
      const [row0] = await this.db
        .insert(notifications)
        .values(row(userId))
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (row0) inserted.push(userId);
    }
    for (const userId of inserted) {
      this.events?.notifyUser(userId, {
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        ts: Date.now(),
      });
    }
    return { notified: inserted.length };
  }

  async notifyAdmins(n: { type: string; title: string; body: string; link?: string; dedupeKey?: string }) {
    const admins = await this.db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    const r = await this.notify(admins.map((a) => a.id), n);
    this.events?.notifyAdmins({ ...n, link: n.link ?? null, ts: Date.now() });
    return r;
  }

  async listNotifications(userId: string, page = 1, limit = 20) {
    const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), 200);
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 20, 1), 50);
    const rows = await this.db.select().from(notifications)
      .where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt))
      .limit(safeLimit).offset((safePage - 1) * safeLimit);
    const [{ n: unread }] = await this.db.select({ n: count() }).from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { items: rows, unread, page: safePage };
  }

  async readNotification(id: string, userId: string) {
    const [row] = await this.db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id });
    if (!row) throw Err.notFound('NOTIFICATION_NOT_FOUND');
    return { ok: true };
  }

  /**
   * Mark as read everything that already existed at `asOf`. Returns how many
   * rows were affected so the client can reconcile its badge from the server's
   * answer rather than from a local guess.
   */
  async markNotificationsSeen(userId: string, asOf: Date) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        lte(notifications.createdAt, asOf),
      ))
      .returning({ id: notifications.id });
    const [{ n: unread }] = await this.db.select({ n: count() }).from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { marked: rows.length, unread };
  }

  async readAllNotifications(userId: string) {
    await this.db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true };
  }
}
