import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError, Err } from '../../common/errors';
import { DB, Db } from '../../db/db.module';
import { appSettings, nodes, serverPorts, servers } from '../../db/schema';

import { DEFAULT_PORT_RANGE, RESERVED_PORTS, resolvePublicHost } from './ports-policy';

/** Ports a sandbox may never publish (host control plane, docker, databases). */
const RESERVED = new Set(RESERVED_PORTS);

export interface AllocatedPort {
  port: number;
  protocol: 'tcp' | 'udp';
  containerPort: number;
}

/**
 * Host port allocation.
 *
 * The unique partial index on (node_id, port) WHERE state='allocated' is the
 * arbiter: allocation is a single conditional INSERT, so two servers can never
 * be handed the same port even under a race. A rejected pick simply retries
 * with a fresh random candidate; the caller sees either a port or a clear
 * exhaustion error, never a silent duplicate.
 *
 * Release marks the row released instead of deleting it, so the history of who
 * held a port survives for audits, and the port returns to the pool instantly.
 */
@Injectable()
export class PortsService {
  private readonly log = new Logger(PortsService.name);

  constructor(@Inject(DB) private db: Db) {}

  /** The effective range for a node (its own override, else the platform default). */
  rangeFor(nodeId: string): { from: number; to: number } {
    void nodeId;
    return { ...DEFAULT_PORT_RANGE };
  }

  /** Pick a free port and claim it. Retries on collision; fails loudly when exhausted. */
  async allocate(input: {
    serverId: string;
    nodeId: string;
    containerPort: number;
    protocol?: 'tcp' | 'udp';
    attempts?: number;
  }): Promise<AllocatedPort> {
    const { from, to } = this.rangeFor(input.nodeId);
    const protocol = input.protocol ?? 'tcp';
    const tries = Math.min(Math.max(input.attempts ?? 40, 1), 200);
    const span = to - from + 1;
    if (span <= 0) throw new AppError('PORT_RANGE_INVALID', 500, 'Configured port range is empty');

    for (let attempt = 0; attempt < tries; attempt++) {
      const candidate = from + randomInt(span);
      if (RESERVED.has(candidate)) continue;
      try {
        const rows = await this.db
          .insert(serverPorts)
          .values({
            serverId: input.serverId,
            nodeId: input.nodeId,
            port: candidate,
            containerPort: input.containerPort,
            protocol,
          })
          // the decisive guard: an allocated row for this (node, port) already
          // exists → this insert is refused by the database
          .onConflictDoNothing()
          .returning({ port: serverPorts.port });
        const [row] = rows;
        if (row) return { port: row.port, protocol, containerPort: input.containerPort };
      } catch (e) {
        // 23505 = any unique violation on this table (also the per-server one):
        // treat as a lost race and pick another candidate.
        if ((e as { code?: string })?.code !== '23505') throw e;
      }
    }
    throw new AppError('PORT_POOL_EXHAUSTED', 503, `No free port left on this node (${from}-${to})`);
  }

  /**
   * Free every allocation of a server. Idempotent, and never touches a port
   * another server owns.
   */
  async releaseAll(serverId: string): Promise<number> {
    const rows = await this.db
      .update(serverPorts)
      .set({ state: 'released', releasedAt: new Date() })
      .where(and(eq(serverPorts.serverId, serverId), eq(serverPorts.state, 'allocated')))
      .returning({ id: serverPorts.id });
    if (rows.length) this.log.debug(`released ${rows.length} port(s) for ${serverId}`);
    return rows.length;
  }

  /** The live allocations of a server (owner-visible). */
  async listForServer(serverId: string) {
    return this.db
      .select()
      .from(serverPorts)
      .where(and(eq(serverPorts.serverId, serverId), eq(serverPorts.state, 'allocated')))
      .orderBy(serverPorts.port);
  }

  /**
   * How much of the pool is in use — shown to admins so exhaustion is visible
   * before it bites.
   */
  async poolStatus(nodeId: string) {
    const { from, to } = this.rangeFor(nodeId);
    const [row] = await this.db
      .select({ used: sql<number>`count(*)::int` })
      .from(serverPorts)
      .where(and(eq(serverPorts.nodeId, nodeId), eq(serverPorts.state, 'allocated')));
    const used = Number(row?.used ?? 0);
    return { nodeId, from, to, capacity: to - from + 1, used, free: Math.max(0, to - from + 1 - used) };
  }

  /**
   * The public address of a server: the node's host and the allocated port.
   * Falls back to the node row (and never invents an address).
   */
  async addressFor(serverId: string): Promise<{ host: string; port: number; protocol: string } | null> {
    const [row] = await this.db
      .select({
        port: serverPorts.port,
        protocol: serverPorts.protocol,
        publicHost: nodes.publicHost,
        dockerHost: nodes.dockerHost,
      })
      .from(serverPorts)
      .innerJoin(nodes, eq(nodes.id, serverPorts.nodeId))
      .where(and(eq(serverPorts.serverId, serverId), eq(serverPorts.state, 'allocated')))
      .limit(1);
    if (!row) return null;
    // order of preference: the node's admin-set public host, then the global
    // setting, then the daemon host (last resort — it may be private).
    const host = resolvePublicHost({
      nodePublicHost: row.publicHost,
      globalHost: await this.globalHost(),
      daemonHost: row.dockerHost,
    });
    if (!host) return null;
    return { host, port: row.port, protocol: row.protocol };
  }

  /** Global fallback hostname for published ports (admin setting). */
  private async globalHost(): Promise<string | null> {
    const [row] = await this.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'ports.public_host'));
    return row?.value?.trim() || null;
  }

  /** Guard used by every port endpoint: the caller must own the server. */
  async requireOwned(serverId: string, ownerId: string): Promise<typeof servers.$inferSelect> {
    const [s] = await this.db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!s || s.ownerId !== ownerId) throw Err.notFound('SERVER_NOT_FOUND');
    return s;
  }

  /** Bulk release for servers being deleted (called by the delete path). */
  async releaseForServers(serverIds: string[]): Promise<void> {
    if (!serverIds.length) return;
    await this.db
      .update(serverPorts)
      .set({ state: 'released', releasedAt: new Date() })
      .where(and(inArray(serverPorts.serverId, serverIds), eq(serverPorts.state, 'allocated')));
  }
}
