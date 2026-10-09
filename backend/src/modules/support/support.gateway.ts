import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { config } from '../../config/env';
import { WsAuthGuard } from '../auth/ws-auth.guard';
import { DB, Db } from '../../db/db.module';
import { supportTickets, users } from '../../db/schema';
import { SupportService, SupportEvents } from './support.service';

interface SupportSocket extends Socket {
  userId?: string;
  role?: string;
  /** ticket rooms this socket is in (presence fan-out on disconnect) */
  tickets: Set<string>;
}

interface Presence {
  online: boolean;
  lastSeenAt: number | null;
}

const TICKET_ROOM = (id: string) => `ticket:${id}`;
const USER_ROOM = (id: string) => `user:${id}`;
const ADMIN_ROOM = 'admin:notifications';
/** every support member and admin is in this room: queue changes go here */
const TEAM_ROOM = 'support:team';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** per-socket send budgets (sliding window) */
const RATE: Record<'message' | 'typing', { limit: number; windowMs: number }> = {
  message: { limit: 30, windowMs: 60_000 },
  typing: { limit: 90, windowMs: 60_000 },
};
/** how often a live socket refreshes users.last_seen_at */
const PRESENCE_WRITE_MS = 30_000;
/** a heartbeat older than this no longer counts as online */
const HEARTBEAT_TTL_MS = 90_000;
const MAX_TICKET_ROOMS = 10;
const MESSAGE_MAX = 4000;

/**
 * Real-time support gateway (namespace `/ws-support`).
 *
 * It reuses the existing WS ticket auth (`/auth/ws/token`, HMAC, 5-minute TTL)
 * and the same handshake shape as the main `/ws` gateway, so the frontend hook
 * needs no new dependencies.
 *
 * Authorization is re-verified for EVERY room join and EVERY message — a valid
 * ticket id alone proves nothing: participants are resolved from the database,
 * so a user who loses the role, is suspended, or was never assigned is refused
 * mid-connection.
 *
 * The service never imports this class (it publishes through `SupportEvents`,
 * which the gateway registers on module init) — the dependency stays
 * one-directional and no Nest DI cycle forms.
 */
@WebSocketGateway({
  namespace: '/ws-support',
  cors: { origin: [...config.ALLOWED_ORIGINS], credentials: true },
  pingInterval: 20_000,
  pingTimeout: 10_000,
})
export class SupportGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, SupportEvents {
  @WebSocketServer()
  server: Server;

  private readonly log = new Logger(SupportGateway.name);

  /** userId → live socket ids. A user is online iff this set is non-empty. */
  private readonly live = new Map<string, Set<string>>();
  /** userId → last time any of their sockets was active (epoch ms) */
  private readonly lastSeen = new Map<string, number>();
  /** userId → last time last_seen_at was written to the database */
  private readonly lastPersisted = new Map<string, number>();
  /** sliding-window counters, kept off the socket object */
  private readonly hits = new WeakMap<Socket, Record<string, number[]>>();

  constructor(
    private authGuard: WsAuthGuard,
    @Inject(DB) private db: Db,
    private support: SupportService,
  ) {}

  onModuleInit() {
    // register as the service's event sink (service → gateway, no import back)
    this.support.attachEvents(this);
  }

  // ------------------------------------------------------------ connection

  async handleConnection(client: SupportSocket) {
    client.tickets = new Set();
    try {
      const ticket =
        (client.handshake.auth as { ticket?: string } | undefined)?.ticket ??
        (client.handshake.query.ticket as string | undefined);
      const { userId } = this.authGuard.validate(ticket);
      const [actor] = await this.db
        .select({ id: users.id, role: users.role, status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // suspended / deleted accounts must not be able to read or write tickets
      if (!actor || actor.status !== 'active') throw new Error('ACCOUNT_INACTIVE');
      client.userId = actor.id;
      client.role = actor.role;
      void client.join(USER_ROOM(actor.id));
      if (actor.role === 'admin') void client.join(ADMIN_ROOM);
      // support + admin sockets follow the shared queue, so a new ticket or a
      // status change shows up in every open support dashboard instantly.
      if (actor.role === 'support' || actor.role === 'admin') void client.join(TEAM_ROOM);
      this.touch(actor.id);
      this.markLive(actor.id, client.id);
      client.emit('connected', { userId: actor.id, role: actor.role });
      // everyone sharing a ticket with this user learns they are back
      void this.broadcastPresence(actor.id, true);
    } catch (e) {
      client.emit('error', { code: 'AUTH_FAILED', message: (e as Error).message });
      client.disconnect(true);
    }
  }

  /**
   * Drop every /ws-support socket of a user (role revoked, account suspended
   * or deleted). Mirrors RealtimeGateway.closeUserSockets on the main
   * namespace, so a privilege change never lingers in an open tab.
   */
  closeUserSockets(userId: string): void {
    const ids = this.live.get(userId);
    if (!ids) return;
    const sockets = this.server?.sockets as unknown as Map<string, SupportSocket> | undefined;
    if (!sockets) return;
    for (const [socketId] of ids) sockets.get(socketId)?.disconnect(true);
  }

  handleDisconnect(client: SupportSocket) {
    const userId = client.userId;
    if (!userId) return;
    const set = this.live.get(userId);
    if (set) {
      set.delete(client.id);
      if (set.size === 0) {
        this.live.delete(userId);
        this.lastSeen.set(userId, Date.now());
        void this.broadcastPresence(userId, false);
      }
    }
    // a dead socket must not leave a typing indicator behind
    for (const id of client.tickets) {
      this.server.to(TICKET_ROOM(id)).emit('ticket:typing', {
        ticketId: id,
        userId,
        typing: false,
        at: Date.now(),
      });
    }
    client.tickets.clear();
  }

  // ------------------------------------------------------------ presence

  private markLive(userId: string, socketId: string) {
    const set = this.live.get(userId) ?? new Set<string>();
    set.add(socketId);
    this.live.set(userId, set);
  }

  private touch(userId: string) {
    const now = Date.now();
    this.lastSeen.set(userId, now);
    const last = this.lastPersisted.get(userId) ?? 0;
    if (now - last < PRESENCE_WRITE_MS) return;
    this.lastPersisted.set(userId, now);
    void this.db
      .update(users)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(users.id, userId))
      .catch(() => undefined);
  }

  isOnline(userId: string): boolean {
    return (this.live.get(userId)?.size ?? 0) > 0;
  }

  /** Online flag + last-seen for a set of users (one live device is enough). */
  presenceFor(userIds: string[]): Record<string, Presence> {
    const out: Record<string, Presence> = {};
    const now = Date.now();
    for (const id of new Set(userIds)) {
      const online = this.isOnline(id);
      out[id] = { online, lastSeenAt: online ? now : (this.lastSeen.get(id) ?? null) };
    }
    return out;
  }

  /** Announce a presence change to every live ticket the user takes part in. */
  private async broadcastPresence(userId: string, online: boolean) {
    try {
      const rows = await this.db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(
          and(
            isNull(supportTickets.deletedAt),
            or(eq(supportTickets.userId, userId), eq(supportTickets.assigneeId, userId)),
          ),
        )
        .limit(200);
      for (const r of rows) {
        this.server.to(TICKET_ROOM(r.id)).emit('presence', { userId, online, at: Date.now() });
      }
    } catch {
      /* presence is best-effort */
    }
  }

  /** Snapshot for a ticket: its participants plus the staff roster. */
  private async presenceSnapshot(ticketId: string): Promise<Record<string, Presence>> {
    const [t] = await this.db
      .select({ userId: supportTickets.userId, assigneeId: supportTickets.assigneeId })
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1);
    const staff = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ['support', 'admin']), eq(users.status, 'active')));
    const ids = [t?.userId, t?.assigneeId, ...staff.map((s) => s.id)].filter(Boolean) as string[];
    return this.presenceFor(ids);
  }

  // ------------------------------------------------------------ rooms

  @SubscribeMessage('subscribe')
  async handleSubscribe(@ConnectedSocket() client: SupportSocket, @MessageBody() data: { ticketId?: string }) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    const id = typeof data?.ticketId === 'string' ? data.ticketId : '';
    if (!UUID_RE.test(id)) return { ok: false, error: 'INVALID_TICKET' };
    if (client.tickets.has(id)) return { ok: true, ticketId: id };
    if (client.tickets.size >= MAX_TICKET_ROOMS) return { ok: false, error: 'TOO_MANY_ROOMS' };
    this.touch(client.userId);
    try {
      // re-verified on every join: knowing the id grants nothing
      await this.support.requireAccess(id, { sub: client.userId, role: client.role ?? 'user' });
    } catch {
      return { ok: false, error: 'TICKET_ACCESS_DENIED' };
    }
    void client.join(TICKET_ROOM(id));
    client.tickets.add(id);
    client.emit('ticket:subscribed', { ticketId: id, presence: await this.presenceSnapshot(id) });
    // the room (including the joiner, who simply filters its own id) learns
    // that this participant is available again
    this.server.to(TICKET_ROOM(id)).emit('presence', { userId: client.userId, online: true, at: Date.now() });
    return { ok: true, ticketId: id };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: SupportSocket, @MessageBody() data: { ticketId?: string }) {
    const id = typeof data?.ticketId === 'string' ? data.ticketId : '';
    if (!client.tickets.has(id)) return { ok: true };
    void client.leave(TICKET_ROOM(id));
    client.tickets.delete(id);
    if (client.userId) {
      this.server.to(TICKET_ROOM(id)).emit('presence', {
        userId: client.userId,
        online: this.isOnline(client.userId),
        at: Date.now(),
      });
    }
    return { ok: true };
  }

  /** Is any OTHER live socket currently in this ticket room? */
  private async hasLivePeer(ticketId: string, exceptSocketId: string): Promise<boolean> {
    try {
      const sockets = await this.server.in(TICKET_ROOM(ticketId)).fetchSockets();
      return sockets.some((s) => s.id !== exceptSocketId);
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ chat

  private budget(client: SupportSocket, bucket: 'message' | 'typing'): boolean {
    const now = Date.now();
    const r = RATE[bucket];
    const all = this.hits.get(client) ?? {};
    this.hits.set(client, all);
    const list = all[bucket] ?? (all[bucket] = []);
    while (list.length && list[0] < now - r.windowMs) list.shift();
    if (list.length >= r.limit) return false;
    list.push(now);
    return true;
  }

  /**
   * Send a message over the socket. `clientMsgId` gives idempotency: a retry
   * after a dropped ack returns the original message (never a duplicate row),
   * so reconnects cannot double-post.
   */
  @SubscribeMessage('ticket:send')
  async handleSend(
    @ConnectedSocket() client: SupportSocket,
    @MessageBody() data: { ticketId?: string; body?: string; clientMsgId?: string },
  ) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    const id = typeof data?.ticketId === 'string' ? data.ticketId : '';
    const body = typeof data?.body === 'string' ? data.body : '';
    if (!UUID_RE.test(id)) return { ok: false, error: 'INVALID_TICKET' };
    if (!body.trim() || body.length > MESSAGE_MAX) return { ok: false, error: 'MESSAGE_INVALID' };
    if (!this.budget(client, 'message')) return { ok: false, error: 'RATE_LIMITED' };
    this.touch(client.userId);
    try {
      const msg = await this.support.sendMessage(
        id,
        { sub: client.userId, role: client.role ?? 'user' },
        body,
        typeof data?.clientMsgId === 'string' ? data.clientMsgId : undefined,
        { ip: 'ws', device: 'ws' },
      );
      // "delivered" = a counterpart socket is (right now) in the room
      if (await this.hasLivePeer(id, client.id)) await this.support.markDelivered(msg.id);
      return { ok: true, message: msg };
    } catch (e) {
      const err = e as { getResponse?: () => unknown; message?: string };
      const res = err.getResponse?.();
      const code =
        res && typeof res === 'object' && 'code' in res ? String((res as { code: unknown }).code) : err.message ?? 'SEND_FAILED';
      return { ok: false, error: code };
    }
  }

  @SubscribeMessage('ticket:typing')
  handleTyping(@ConnectedSocket() client: SupportSocket, @MessageBody() data: { ticketId?: string; typing?: boolean }) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    const id = typeof data?.ticketId === 'string' ? data.ticketId : '';
    if (!client.tickets.has(id)) return { ok: false, error: 'NOT_SUBSCRIBED' };
    if (!this.budget(client, 'typing')) return { ok: false, error: 'RATE_LIMITED' };
    this.server.to(TICKET_ROOM(id)).emit('ticket:typing', {
      ticketId: id,
      userId: client.userId,
      typing: data?.typing !== false,
      at: Date.now(),
    });
    return { ok: true };
  }

  /**
   * Read receipt. The reader identity comes from the socket session — the
   * client can only say which message it read up to, never WHO read.
   */
  @SubscribeMessage('ticket:read')
  async handleRead(@ConnectedSocket() client: SupportSocket, @MessageBody() data: { ticketId?: string; upToId?: string }) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    const id = typeof data?.ticketId === 'string' ? data.ticketId : '';
    const upToId = typeof data?.upToId === 'string' ? data.upToId : '';
    if (!client.tickets.has(id)) return { ok: false, error: 'NOT_SUBSCRIBED' };
    if (!UUID_RE.test(upToId)) return { ok: false, error: 'INVALID_MESSAGE' };
    this.touch(client.userId);
    try {
      const res = await this.support.markRead(id, { sub: client.userId, role: client.role ?? 'user' }, upToId);
      this.server.to(TICKET_ROOM(id)).emit('ticket:read', {
        ticketId: id,
        readBy: client.userId,
        upToId,
        marked: res.marked,
        at: Date.now(),
      });
      return { ok: true, marked: res.marked };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: SupportSocket) {
    if (client.userId) this.touch(client.userId);
    return { ok: true, ts: Date.now() };
  }

  // ------------------------------------------------------------ events (service → clients)

  /** Emitted for any change clients should refetch (claim/release/assign/status/delete). */
  ticketRefresh(ticketId: string, reason: string) {
    this.server.to(TICKET_ROOM(ticketId)).emit('ticket:refresh', { ticketId, reason, at: Date.now() });
  }

  /** The staff queue changed: every connected dashboard refetches its list. */
  queueChanged(reason: string, ticketId?: string) {
    this.server.to(TEAM_ROOM).emit('queue:changed', { reason, ticketId: ticketId ?? null, at: Date.now() });
  }

  ticketMessage(ticketId: string, message: unknown) {
    this.server.to(TICKET_ROOM(ticketId)).emit('ticket:message', { ticketId, message });
  }

  ticketRead(ticketId: string, payload: { readBy: string; upToId: string; marked: number }) {
    this.server.to(TICKET_ROOM(ticketId)).emit('ticket:read', { ticketId, ...payload });
  }

  notifyUser(userId: string, payload: { type: string; title: string; body: string; link: string | null; ts: number }) {
    this.server.to(USER_ROOM(userId)).emit('notification', payload);
  }

  notifyAdmins(payload: { type: string; title: string; body: string; link: string | null; ts: number }) {
    this.server.to(ADMIN_ROOM).emit('admin:notification', payload);
  }

  /**
   * Presence for the staff roster (support team page, ticket header). Offline
   * members fall back to the persisted last_seen_at, and stale heartbeats
   * never present as online.
   */
  async teamPresence(): Promise<Record<string, Presence>> {
    const rows = await this.db
      .select({ id: users.id, lastSeenAt: users.lastSeenAt })
      .from(users)
      .where(and(inArray(users.role, ['support', 'admin']), eq(users.status, 'active')))
      .orderBy(desc(users.lastSeenAt));
    const now = Date.now();
    const out: Record<string, Presence> = {};
    for (const r of rows) {
      const online = this.isOnline(r.id);
      const seen = this.lastSeen.get(r.id) ?? (r.lastSeenAt ? new Date(r.lastSeenAt).getTime() : null);
      out[r.id] = { online: online && (seen === null || now - seen <= HEARTBEAT_TTL_MS), lastSeenAt: seen };
    }
    return out;
  }
}
