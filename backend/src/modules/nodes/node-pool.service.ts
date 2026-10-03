import { Inject, Injectable, Logger } from '@nestjs/common';
import Dockerode from 'dockerode';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { Err } from '../../common/errors';
import { decryptSecret } from '../../common/crypto';
import { DB, Db } from '../../db/db.module';
import { nodes } from '../../db/schema';

export interface NodeCheck {
  ok: boolean;
  version?: string;
  error?: string;
}
/**
 * Per-node Docker clients. The local daemon (socket) behaves exactly like
 * the old single DockerService; remote daemons connect over mutual TLS.
 * Clients are cached and dropped on config change (refresh) so rotation
 * takes effect without a restart.
 */
@Injectable()
export class NodePoolService {
  private readonly log = new Logger(NodePoolService.name);
  private readonly clients = new Map<string, Dockerode | null>();
  private warned = new Set<string>();

  constructor(@Inject(DB) private db: Db) {}

  /** Resolve a usable client or throw DOCKER_UNAVAILABLE (fail closed). */
  async client(nodeId = 'local'): Promise<Dockerode> {
    const d = await this.resolve(nodeId);
    if (!d) throw Err.unavailable('DOCKER_UNAVAILABLE', `Docker node "${nodeId}" is not available`);
    return d;
  }

  async available(nodeId = 'local'): Promise<boolean> {
    return (await this.resolve(nodeId)) !== null;
  }

  /** Drop cached clients (all, or one node) — call after node CRUD. */
  refresh(nodeId?: string): void {
    if (nodeId) this.clients.delete(nodeId);
    else this.clients.clear();
  }

  /**
   * Ping + version probe; updates lastSeenAt on success. Never throws —
   * an unreachable node reports { ok: false }, it doesn't take the API down.
   */
  async check(nodeId: string): Promise<NodeCheck> {
    const d = await this.resolve(nodeId);
    if (!d) return { ok: false, error: 'node is disabled or unconfigured' };
    try {
      // bounded explicitly: the pool client itself carries no socket timeout
      const pong = await Promise.race([
        d.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ping timeout after 10s')), 10_000)),
      ]);
      // docker-modem resolves ping to a Buffer ('OK') on some versions —
      // normalize before comparing, and never trust truthiness alone.
      if (String(pong) !== 'OK') return { ok: false, error: `unexpected ping: ${String(pong).slice(0, 80)}` };
      const info = await d.version().catch(() => null);
      await this.db.update(nodes).set({ lastSeenAt: new Date() }).where(eq(nodes.id, nodeId)).catch(() => undefined);
      // bounded: the version string is echoed back to the admin UI verbatim
      const version = typeof info?.Version === 'string' ? info.Version.slice(0, 40) : undefined;
      return { ok: true, version };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 200) };
    }
  }

  private async resolve(nodeId: string): Promise<Dockerode | null> {
    if (this.clients.has(nodeId)) return this.clients.get(nodeId)!;
    const d = await this.build(nodeId).catch((e) => {
      if (!this.warned.has(nodeId)) {
        this.warned.add(nodeId);
        this.log.warn(`node "${nodeId}" client build failed: ${(e as Error).message}`);
      }
      return null;
    });
    // cache nulls too (a dead node shouldn't rebuild a client per request);
    // refresh() evicts on config change.
    this.clients.set(nodeId, d);
    if (d) this.warned.delete(nodeId);
    return d;
  }

  private async build(nodeId: string): Promise<Dockerode | null> {
    if (nodeId === 'local') {
      if (!config.DOCKER_ENABLED) return null;
      // no socket-level timeout (same as the legacy local client): every
      // call site carries its own withTimeout guard, and streams carry a
      // watchdog. A fixed modem timeout would murder slow-but-valid calls
      // (image pulls, graceful stops, bulk transfers) mid-flight.
      return new Dockerode({ socketPath: config.DOCKER_SOCKET });
    }
    const [row] = await this.db.select().from(nodes).where(and(eq(nodes.id, nodeId), eq(nodes.enabled, true))).limit(1);
    if (!row?.dockerHost) return null;
    if (!row.tlsCa || !row.tlsCert || !row.tlsKey) {
      throw new Error('remote node is missing TLS material (mutual TLS is mandatory)');
    }
    const pem = (blob: string): Buffer => Buffer.from(decryptSecret<string>(blob), 'utf8');
    // no socket-level timeout: call sites guard (withTimeout) and streams
    // guard (watchdog). A fixed modem timeout would murder slow-but-valid
    // calls (pulls, graceful stops, transfers) exactly when they matter.
    return new Dockerode({
      host: row.dockerHost,
      port: row.dockerPort ?? 2376,
      ca: pem(row.tlsCa),
      cert: pem(row.tlsCert),
      key: pem(row.tlsKey),
    });
  }
}
