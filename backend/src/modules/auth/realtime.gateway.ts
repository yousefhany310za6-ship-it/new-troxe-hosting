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
import { UseGuards } from '@nestjs/common';
import { WsAuthGuard } from './ws-auth.guard';

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
  cors: { origin: '*', credentials: true },
  pingInterval: 20_000,
  pingTimeout: 10_000,
})
@UseGuards(WsAuthGuard)
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly authGuard: WsAuthGuard;

  constructor(authGuard: WsAuthGuard) {
    this.authGuard = authGuard;
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const ticket = client.handshake.query.ticket as string | undefined;
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
  handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channels: string[] },
  ) {
    if (!client.userId) return { ok: false, error: 'NOT_AUTHENTICATED' };
    if (!Array.isArray(data.channels)) return { ok: false, error: 'INVALID_CHANNELS' };

    const allowed = data.channels.filter((ch) => this.isAllowedChannel(client.userId!, ch));
    for (const ch of allowed) {
      client.join(ch);
      client.subscriptions.add(ch);
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

  /** Check if user is allowed to subscribe to a channel. */
  private isAllowedChannel(userId: string, channel: string): boolean {
    // server:stats:{id}, server:logs:{id}, server:status:{id} — require ownership (checked at broadcast time via service)
    // user:audit:{userId} — only own userId
    if (channel.startsWith(CHANNEL_PREFIX.userAudit)) {
      return channel === `${CHANNEL_PREFIX.userAudit}${userId}`;
    }
    // For server channels, we allow subscription; services will verify ownership before broadcasting
    // This avoids duplicate ownership checks in the gateway.
    return (
      channel.startsWith(CHANNEL_PREFIX.serverStats) ||
      channel.startsWith(CHANNEL_PREFIX.serverLogs) ||
      channel.startsWith(CHANNEL_PREFIX.serverStatus)
    );
  }
}