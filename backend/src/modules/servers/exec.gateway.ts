import { Logger } from '@nestjs/common';
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
import { WsTicketService } from '../auth/ws-ticket.service';
import { AuditService } from '../audit/audit.module';
import { ServersService } from './servers.service';
import { DockerService, type ShellHandle } from './provisioning/docker.service';

const MAX_INPUT_BYTES = 4096;
const IDLE_MS = 5 * 60 * 1000;
const MAX_SESSION_MS = 30 * 60 * 1000;
const MAX_PER_USER = 3;
// >600 input frames in 10s = paste-loop/flood, not a human
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX = 600;

interface ExecSession {
  userId: string;
  serverId: string;
  shell: ShellHandle;
  idleTimer: NodeJS.Timeout;
  maxTimer: NodeJS.Timeout;
  inputAt: number[];
  closed: boolean;
}

/**
 * Interactive shell (`/ws/exec` namespace, socket.io).
 *
 * Handshake: `auth: { ticket, serverId }` — the same 30s WS ticket as the
 * realtime namespace. The exec runs as the sandbox's own unprivileged user
 * (`/bin/sh`, cwd /data): no new privileges, no new mounts, the container's
 * cgroup limits still apply.
 *
 * Guardrails: owner-only, container must be online, 1 session per server,
 * 3 per user, 4KB input cap, 5min idle kill, 30min max life, open/close
 * audited (content is never logged — keystrokes may carry secrets).
 */
@WebSocketGateway({
  namespace: '/ws/exec',
  cors: { origin: '*', credentials: true },
  pingInterval: 20_000,
  pingTimeout: 10_000,
})
export class ExecGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly log = new Logger(ExecGateway.name);
  private readonly bySocket = new Map<string, ExecSession>();
  private readonly byServer = new Map<string, string>(); // serverId -> socketId
  private readonly perUser = new Map<string, number>();

  constructor(
    private tickets: WsTicketService,
    private servers: ServersService,
    private docker: DockerService,
    private audit: AuditService,
  ) {}

  async handleConnection(client: Socket) {
    const auth = (client.handshake.auth ?? {}) as { ticket?: string; serverId?: string };
    const fail = (code: string) => {
      client.emit('exec-error', { code });
      client.disconnect(true);
    };
    try {
      if (!auth.ticket || !auth.serverId) return fail('EXEC_BAD_HANDSHAKE');
      const { sub: userId } = this.tickets.verify(auth.ticket);
      const serverId = auth.serverId;

      const row = await this.servers.requireOwned(userId, serverId).catch(() => null);
      if (!row) return fail('EXEC_NO_ACCESS');
      if (!row.containerId) return fail('EXEC_NO_CONTAINER');
      const state = await this.docker.inspect(row.containerId).catch(() => null);
      if (!state?.running) return fail('EXEC_OFFLINE');

      if (this.byServer.has(serverId)) return fail('EXEC_BUSY');
      if ((this.perUser.get(userId) ?? 0) >= MAX_PER_USER) return fail('EXEC_LIMIT');

      const shell = await this.docker.openShell(row.containerId).catch(() => null);
      if (!shell) return fail('EXEC_FAILED');

      const session: ExecSession = {
        userId,
        serverId,
        shell,
        idleTimer: setTimeout(() => this.close(client, 'idle-timeout'), IDLE_MS),
        maxTimer: setTimeout(() => this.close(client, 'max-time'), MAX_SESSION_MS),
        inputAt: [],
        closed: false,
      };
      this.bySocket.set(client.id, session);
      this.byServer.set(serverId, client.id);
      this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + 1);

      shell.onOutput((data) => {
        this.touch(session);
        client.emit('output', { data: data.toString('base64') });
      });
      shell.onEnd((code) => this.close(client, 'exit', code));

      await this.audit.record({
        actorId: userId,
        action: 'server.exec.open',
        targetType: 'server',
        targetId: serverId,
        ip: client.handshake.address,
        userAgent: 'ws-exec',
      }).catch(() => undefined);

      client.emit('ready', { serverId });
    } catch (e) {
      this.log.debug(`exec connect failed: ${(e as Error).message}`);
      fail('EXEC_DENIED');
    }
  }

  handleDisconnect(client: Socket) {
    const s = this.bySocket.get(client.id);
    if (s) this.teardown(client, s, 'disconnect', null);
  }

  @SubscribeMessage('input')
  onInput(@ConnectedSocket() client: Socket, @MessageBody() body: { data?: string }) {
    const s = this.bySocket.get(client.id);
    if (!s || s.closed) return { ok: false };
    if (typeof body?.data !== 'string') return { ok: false };
    const buf = Buffer.from(body.data, 'base64');
    if (buf.length > MAX_INPUT_BYTES) return { ok: false, error: 'INPUT_TOO_LARGE' };
    const now = Date.now();
    s.inputAt = s.inputAt.filter((t) => now - t < FLOOD_WINDOW_MS);
    if (s.inputAt.length >= FLOOD_MAX) {
      this.close(client, 'flood');
      return { ok: false, error: 'FLOOD' };
    }
    s.inputAt.push(now);
    this.touch(s);
    if (!s.shell.write(buf)) this.close(client, 'write-failed');
    return { ok: true };
  }

  @SubscribeMessage('resize')
  async onResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { cols?: number; rows?: number },
  ) {
    const s = this.bySocket.get(client.id);
    if (!s || s.closed) return { ok: false };
    const cols = Math.min(500, Math.max(1, Math.floor(body?.cols ?? 80)));
    const rows = Math.min(500, Math.max(1, Math.floor(body?.rows ?? 24)));
    await s.shell.resize(cols, rows);
    return { ok: true };
  }

  // ---- internals ----------------------------------------------------------

  private touch(s: ExecSession) {
    clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(() => {
      for (const [sid, sess] of this.bySocket) {
        if (sess === s) {
          const client = this.server.sockets.sockets.get(sid);
          if (client) this.close(client, 'idle-timeout');
          break;
        }
      }
    }, IDLE_MS);
  }

  private close(client: Socket, reason: string, code: number | null = null) {
    const s = this.bySocket.get(client.id);
    if (!s || s.closed) return;
    client.emit('exit', { code, reason });
    this.teardown(client, s, reason, code);
    client.disconnect(true);
  }

  private teardown(client: Socket, s: ExecSession, reason: string, code: number | null) {
    if (s.closed) return;
    s.closed = true;
    clearTimeout(s.idleTimer);
    clearTimeout(s.maxTimer);
    try {
      s.shell.close();
    } catch {
      /* already gone */
    }
    this.bySocket.delete(client.id);
    if (this.byServer.get(s.serverId) === client.id) this.byServer.delete(s.serverId);
    this.perUser.set(s.userId, Math.max(0, (this.perUser.get(s.userId) ?? 1) - 1));
    this.audit
      .record({
        actorId: s.userId,
        action: 'server.exec.close',
        targetType: 'server',
        targetId: s.serverId,
        ip: client.handshake.address,
        userAgent: 'ws-exec',
        meta: { reason, code },
      })
      .catch(() => undefined);
  }
}
