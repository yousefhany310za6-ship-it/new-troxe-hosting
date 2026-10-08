import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { WsAuthGuard } from './ws-auth.guard';
import { AdminGrantService } from './admin-grant.service';
import { ChannelSubscribeDto } from './ws.dto';
import { DB, Db } from '../../db/db.module';
import { servers, users } from '../../db/schema';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  role?: string;
  grant?: string;
  subscriptions: Set<string>;
}

const CHANNEL_PREFIX = {
  serverStats: 'server:stats:',
  serverLogs: 'server:logs:',
  serverStatus: 'server:status:',
  userAudit: 'user:audit:',
} as const;

/**
 * Real-time gateway for:
 * - server stats (CPU/RAM)
 * - server logs (stdout/stderr tail)
 * - server status changes (online/offline/restarting/error)
 * - user audit events (login, server create/delete, settings changes)
 *
 * Channels are joined/left via subscribe/unsubscribe messages.
 * Auth: short-lived ticket in handshake query (`?ticket=...`).
 */
@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: [...config.ALLOWED_ORIGINS], credentials: true },
  pingInterval: 20_000,
  pingTimeout: 10_000,
})
@UseGuards(WsAuthGuard)
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly authGuard: WsAuthGuard;

  constructor(
    authGuard: WsAuthGuard,
    private grants: AdminGrantService,
    @Inject(DB) private db: Db,
  ) {
    this.authGuard = authGuard;
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // socket.io v4 clients send credentials via handshake.auth; the raw
      // query form is kept for non-socket.io transports.
      const ticket =
        (client.handshake.auth as { ticket?: string } | undefined)?.ticket ??
        (client.handshake.query.ticket as string | undefined);
      const { userId } = this.authGuard.validate(ticket);
      // suspended / deleted accounts get no sockets at all
      const [actor] = await this.db
        .select({ id: users.id, role: users.role, status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!actor || actor.status !== 'active') throw new Error('account not active');
      client.userId = userId;
      client.role = actor.role;
      client.subscriptions = new Set();
      client.grant = (client.handshake.auth as { grant?: string } | undefined)?.grant;
      client.emit('connected', { userId });
    } catch (e) {
      client.emit('error', { code: 'AUTH_FAILED', message: (e as Error).message });
      client.disconnect(true);
    }
  }

  /**
   * Disconnect every /ws socket of a user (account suspension / deletion).
   * Room membership dies with the socket, so stats/log streams stop too.
   */
  closeUserSockets(userId: string): void {
    const allSockets = this.server?.sockets as unknown as Map<string, AuthenticatedSocket> | undefined;
    if (!allSockets) return;
    for (const [, sock] of allSockets) {
      if (sock.userId === userId) sock.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    // Cleanup handled by Socket.IO room leave on disconnect
  }

  @SubscribeMessage('subscribe')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: ChannelSubscribeDto,
  ) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    if (!Array.isArray(data.channels)) return { ok: false, error: 'INVALID_CHANNELS' };

    const allowed: string[] = [];
    for (const ch of data.channels) {
      if (typeof ch !== 'string' || ch.length > 200) continue;
      if (await this.isAllowedChannel(client, ch)) {
        client.join(ch);
        client.subscriptions.add(ch);
        allowed.push(ch);
      }
    }
    return { ok: true, subscribed: allowed };
  }

  @SubscribeMessage('unsubscribe')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: ChannelSubscribeDto,
  ) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    if (!Array.isArray(data.channels)) return { ok: false, error: 'INVALID_CHANNELS' };

    for (const ch of data.channels) {
      client.leave(ch);
      client.subscriptions.delete(ch);
    }
    return { ok: true, unsubscribed: data.channels };
  }

  @SubscribeMessage('ping')
  handlePing() {
    return { ok: true, ts: Date.now() };
  }

  /**
   * Ids of servers that currently have at least one live stats subscriber.
   * Read straight from the socket.io rooms, so a closed tab / dropped socket
   * stops counting without any bookkeeping of our own.
   */
  statsSubscribers(): string[] {
    const rooms = (this.server?.adapter as unknown as { rooms?: Map<string, Set<string>> } | undefined)?.rooms;
    if (!rooms) return [];
    const ids: string[] = [];
    for (const [room, members] of rooms) {
      if (room.startsWith(CHANNEL_PREFIX.serverStats) && members.size > 0) ids.push(room.slice(CHANNEL_PREFIX.serverStats.length));
    }
    return ids;
  }

  /** Broadcast server stats to channel `server:stats:{id}`. */
  broadcastServerStats(serverId: string, payload: unknown) {
    this.server.to(`${CHANNEL_PREFIX.serverStats}${serverId}`).emit('server:stats', payload);
  }

  /** Broadcast server log line to channel `server:logs:{id}`. */
  broadcastServerLog(serverId: string, line: string) {
    this.server.to(`${CHANNEL_PREFIX.serverLogs}${serverId}`).emit('server:log', { line, ts: Date.now() });
  }

  /** Broadcast server status change to channel `server:status:{id}`. */
  broadcastServerStatus(serverId: string, status: string, detail?: string) {
    this.server.to(`${CHANNEL_PREFIX.serverStatus}${serverId}`).emit('server:status', { status, detail, ts: Date.now() });
  }

  /** Broadcast user audit event to channel `user:audit:{userId}`. */
  broadcastUserAudit(userId: string, event: unknown) {
    this.server.to(`${CHANNEL_PREFIX.userAudit}${userId}`).emit('user:audit', event);
  }

  /**
   * Channel authorization, enforced HERE at subscribe time (the broadcasts
   * themselves are blind room emits). Server channels require a live
   * ownership row — never trust the channel name alone.
   */
  private async isAllowedChannel(client: AuthenticatedSocket, channel: string): Promise<boolean> {
    const userId = client.userId;
    if (!userId) return false;
    // user:audit:{userId} — only own userId
    if (channel.startsWith(CHANNEL_PREFIX.userAudit)) {
      return channel === `${CHANNEL_PREFIX.userAudit}${userId}`;
    }
    for (const prefix of [CHANNEL_PREFIX.serverStats, CHANNEL_PREFIX.serverLogs, CHANNEL_PREFIX.serverStatus]) {
      if (!channel.startsWith(prefix)) continue;
      const id = channel.slice(prefix.length);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
      // admin access grant: single-server management view for admins —
      // verified here (signature + admin + server match), audited at issuance
      if (client.grant && client.role === 'admin') {
        try {
          const grant = this.grants.verify(client.grant);
          if (grant.adminId === userId && grant.serverId === id) {
            const [row] = await this.db.select({ id: servers.id }).from(servers).where(eq(servers.id, id)).limit(1);
            return !!row;
          }
        } catch {
          /* invalid grant — fall through to owner check */
        }
      }
      const [row] = await this.db
        .select({ id: servers.id, status: servers.status })
        .from(servers)
        .where(and(eq(servers.id, id), eq(servers.ownerId, userId)))
        .limit(1);
      if (!row) return false;
      // suspended servers stream nothing to their owners (only the status
      // channel stays open so the UI learns about the suspension itself)
      if (row.status === 'suspended' && prefix !== CHANNEL_PREFIX.serverStatus) return false;
      return true;
    }
    return false;
  }
}