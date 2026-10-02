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
import { Inject, UseGuards } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { WsAuthGuard } from './ws-auth.guard';
import { DB, Db } from '../../db/db.module';
import { servers } from '../../db/schema';

interface AuthenticatedSocket extends Socket {
  userId?: string;
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
      client.userId = userId;
      client.subscriptions = new Set();
      client.emit('connected', { userId });
    } catch (e) {
      client.emit('error', { code: 'AUTH_FAILED', message: (e as Error).message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    // Cleanup handled by Socket.IO room leave on disconnect
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channels: string[] },
  ) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    if (!Array.isArray(data.channels)) return { ok: false, error: 'INVALID_CHANNELS' };

    const allowed: string[] = [];
    for (const ch of data.channels) {
      if (typeof ch !== 'string' || ch.length > 200) continue;
      if (await this.isAllowedChannel(client.userId, ch)) {
        client.join(ch);
        client.subscriptions.add(ch);
        allowed.push(ch);
      }
    }
    return { ok: true, subscribed: allowed };
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channels: string[] },
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
  private async isAllowedChannel(userId: string, channel: string): Promise<boolean> {
    // user:audit:{userId} — only own userId
    if (channel.startsWith(CHANNEL_PREFIX.userAudit)) {
      return channel === `${CHANNEL_PREFIX.userAudit}${userId}`;
    }
    for (const prefix of [CHANNEL_PREFIX.serverStats, CHANNEL_PREFIX.serverLogs, CHANNEL_PREFIX.serverStatus]) {
      if (!channel.startsWith(prefix)) continue;
      const id = channel.slice(prefix.length);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
      const [row] = await this.db
        .select({ id: servers.id })
        .from(servers)
        .where(and(eq(servers.id, id), eq(servers.ownerId, userId)))
        .limit(1);
      return !!row;
    }
    return false;
  }
}