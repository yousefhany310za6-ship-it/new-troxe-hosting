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
import { config } from '../../config/env';
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
/**
 * OUTPUT side of an exec. The bytes come from the daemon and are forwarded
 * into socket.io, which queues per client — a rogue node (or `yes`) streaming
 * forever grows API memory while the client is slow. Bound both dimensions:
 * no single WS frame above 64KB (base64 => ~87KB), and no more than 4MB in
 * any rolling second. 3 consecutive over-windows closes the session — the
 * exit reason reaches the client, and a legitimate `cat` burst is under the
 * ceiling for one second at a time.
 */
const OUT_CHUNK_MAX = 64 * 1024;
const OUT_BPS_MAX = 4 * 1024 * 1024;
const OUT_FLOOD_WINDOWS = 3;

interface ExecSession {
  userId: string;
  serverId: string;
  shell: ShellHandle;
  idleTimer: NodeJS.Timeout;
  maxTimer: NodeJS.Timeout;
  inputAt: number[];
  closed: boolean;
  readOnly: boolean;
  /** output budget: rolling 1s window + consecutive over-window counter */
  outWindowAt: number;
  outWindowBytes: number;
  outOver: number;
  outPaused: boolean;
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
 * 3 per user, 4KB input cap, 4MB/s + 64KB-frame output budget (paused, then
 * closed after 3s of sustained flood), 5min idle kill, 30min max life,
 * open/close audited (content is never logged — keystrokes may carry secrets).
 */
@WebSocketGateway({
  namespace: '/ws/exec',
  cors: { origin: [...config.ALLOWED_ORIGINS], credentials: true },
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
      const readOnly = true; // Always read-only mode

      const row = await this.servers.requireOwned(userId, serverId).catch(() => null);
      if (!row) return fail('EXEC_NO_ACCESS');
      if (!row.containerId) return fail('EXEC_NO_CONTAINER');
      const state = await this.docker.inspect(row.containerId, row.nodeId).catch(() => null);
      if (!state?.running) return fail('EXEC_OFFLINE');

      if (this.byServer.has(serverId)) {
        const existingId = this.byServer.get(serverId)!;
        const existing = this.bySocket.get(existingId);
        if (existing && existing.userId === userId && existingId !== client.id) {
          // Same owner reconnecting while the old transport is still
          // half-open (mobile blip, tab remount, missed close handshake):
          // retire the ghost instead of locking its owner out with
          // EXEC_BUSY. A different user keeps getting EXEC_BUSY below.
          // NOTE: `server` here is the /ws/exec Namespace itself, so its
          // socket map is `server.sockets` (a Map) — NOT
          // `server.sockets.sockets` (undefined; that typo throws). The
          // static type still says Server, hence the cast.
          // close() marks it closed synchronously, so the late
          // handleDisconnect that follows is a harmless no-op.
          const allSockets = this.server.sockets as unknown as Map<string, Socket>;
          const oldClient = allSockets.get(existingId);
          if (oldClient) this.close(oldClient, 'replaced');
          else {
            this.bySocket.delete(existingId);
            this.byServer.delete(serverId);
            this.perUser.set(userId, Math.max(0, (this.perUser.get(userId) ?? 1) - 1));
          }
        } else {
          return fail('EXEC_BUSY');
        }
      }
      if ((this.perUser.get(userId) ?? 0) >= MAX_PER_USER) return fail('EXEC_LIMIT');

      const shell = await this.docker.openShell(row.containerId, row.nodeId).catch(() => null);
      if (!shell) return fail('EXEC_FAILED');

      const session: ExecSession = {
        userId,
        serverId,
        shell,
        idleTimer: setTimeout(() => this.close(client, 'idle-timeout'), IDLE_MS),
        maxTimer: setTimeout(() => this.close(client, 'max-time'), MAX_SESSION_MS),
        inputAt: [],
        closed: false,
        readOnly,
        outWindowAt: Date.now(),
        outWindowBytes: 0,
        outOver: 0,
        outPaused: false,
      };
      this.bySocket.set(client.id, session);
      this.byServer.set(serverId, client.id);
      this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + 1);

      shell.onOutput((data) => {
        if (session.closed) return;
        this.touch(session);
        const now = Date.now();
        if (now - session.outWindowAt >= 1000) {
          session.outOver = session.outWindowBytes > OUT_BPS_MAX ? session.outOver + 1 : 0;
          session.outWindowAt = now;
          session.outWindowBytes = 0;
          if (session.outOver >= OUT_FLOOD_WINDOWS) {
            this.close(client, 'output-flood');
            return;
          }
          session.outPaused = false;
        }
        session.outWindowBytes += data.length;
        if (session.outWindowBytes > OUT_BPS_MAX) {
          // pause, don't queue: keeping only one marker line per window
          if (!session.outPaused) {
            session.outPaused = true;
            client.emit('output', {
              data: Buffer.from(`\r\n[troxe] paused: console exceeded ${OUT_BPS_MAX / 1024 / 1024} MB/s\r\n`).toString('base64'),
            });
          }
          return;
        }
        // slice into bounded WS frames (base64 of 64KB ≈ 87KB per message)
        for (let i = 0; i < data.length; i += OUT_CHUNK_MAX)
          client.emit('output', { data: data.subarray(i, i + OUT_CHUNK_MAX).toString('base64') });
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

      client.emit('ready', { serverId, readOnly });
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
    if (s.readOnly) return { ok: false, error: 'READ_ONLY_MODE' };
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
    if (s.readOnly) return { ok: false, error: 'READ_ONLY_MODE' };
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
          // NOTE: same Namespace-map subtlety as above — `.sockets` here is
          // already the Map. The old `.sockets.sockets` form threw a TypeError
          // inside this timer for any session idle 5+ minutes, which the
          // uncaught-exception handler turns into a process exit.
          const allSockets = this.server.sockets as unknown as Map<string, Socket>;
          const client = allSockets.get(sid);
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
