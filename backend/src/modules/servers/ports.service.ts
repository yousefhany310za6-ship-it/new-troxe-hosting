import { Inject, Injectable, Logger } from '@nestjs/common';
import { connect } from 'net';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError, Err } from '../../common/errors';
import { DB, Db } from '../../db/db.module';
import { appSettings, nodes, serverPorts, servers } from '../../db/schema';

import { DEFAULT_PORT_RANGE, RESERVED_PORTS, candidatePorts, resolvePublicHost } from './ports-policy';

/** Ports a sandbox may never publish (host control plane, docker, databases). */
const RESERVED = new Set(RESERVED_PORTS);

export interface AllocatedPort {
  port: number;
  protocol: 'tcp' | 'udp';
  containerPort: number;
}

export interface PortRange {
  from: number;
  to: number;
  /** true when this range came from the node row, false = platform default */
  nodeOverride: boolean;
}

/**
 * What was actually observed for one published port.
 *
 * These are SEPARATE facts on purpose. `allocated: true, listening: true` and
 * `allocated: true, listening: false` are both legitimate states and the UI
 * must never collapse them into one boolean. `null` means "not measured, or not
 * measurable from here" — deliberately distinct from `false`.
 *
 * `external` is ALWAYS 'unverified': the node can only ever prove a path that
 * starts and ends inside itself. Only a probe on a third network can settle it,
 * so the platform states the limit instead of claiming reachability it never
 * measured.
 */
export interface PortHealth {
  /** the allocation row exists and is `allocated` */
  allocated: boolean;
  /** the daemon has this host port bound with this protocol */
  published: boolean | null;
  /** the container is running */
  containerRunning: boolean | null;
  /** a connect to <containerIp>:<containerPort> succeeded from the node */
  containerListening: boolean | null;
  /** a connect to 127.0.0.1:<hostPort> succeeded from the node */
  hostReachable: boolean | null;
  /** never anything but 'unverified' from inside the node */
  external: 'unverified';
  /** when the two probes above were last run (null = never) */
  checkedAt: Date | null;
  /** 'missing' = allocated but not published, 'extra' = published but not allocated */
  drift: 'missing' | 'extra' | null;
}

/** A fresh, entirely unmeasured health record. */
export const UNKNOWN_HEALTH: PortHealth = Object.freeze({
  allocated: false,
  published: null,
  containerRunning: null,
  containerListening: null,
  hostReachable: null,
  external: 'unverified' as const,
  checkedAt: null,
  drift: null,
});

/** One node's port pool occupancy, as the admin dashboard renders it. */
export interface FleetPoolStatus {
  nodeId: string;
  from: number;
  to: number;
  capacity: number;
  used: number;
  free: number;
  /** true when the range is the node's own override, false = platform default */
  nodeOverride: boolean;
}

/**
 * Host port allocation.
 *
 * The unique partial index on (node_id, port) WHERE state='allocated' is the
 * arbiter: allocation is a single conditional INSERT, so two servers can never
 * be handed the same port even under a race. A rejected pick simply retries
 * with a fresh candidate; the caller sees either a port or a clear exhaustion
 * error, never a silent duplicate.
 *
 * Release marks the row released instead of deleting it, so the history of who
 * held a port survives for audits, and the port returns to the pool instantly.
 * It is NEVER called on the strength of an API call alone — the delete path
 * confirms the container is gone first (see releaseWhenUnbound).
 */
@Injectable()
export class PortsService {
  private readonly log = new Logger(PortsService.name);

  constructor(@Inject(DB) private db: Db) {}

  /**
   * The effective range for a node: its own admin-set override, else the
   * platform default.
   *
   * Read once per allocation (a primary-key lookup), never per candidate — so
   * there is no cache to invalidate and no window where the allocator uses a
   * range the admin has already changed.
   */
  async rangeFor(nodeId: string): Promise<PortRange> {
    const [node] = await this.db
      .select({ from: nodes.portRangeFrom, to: nodes.portRangeTo })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (node && node.from !== null && node.to !== null && node.from <= node.to) {
      return { from: node.from, to: node.to, nodeOverride: true };
    }
    return { from: DEFAULT_PORT_RANGE.from, to: DEFAULT_PORT_RANGE.to, nodeOverride: false };
  }

  /** Sync shape of rangeFor(), for callers that already hold the node row. */
  rangeFromNode(node: { portRangeFrom: number | null; portRangeTo: number | null } | undefined): PortRange {
    if (node && node.portRangeFrom !== null && node.portRangeTo !== null && node.portRangeFrom <= node.portRangeTo) {
      return { from: node.portRangeFrom, to: node.portRangeTo, nodeOverride: true };
    }
    return { from: DEFAULT_PORT_RANGE.from, to: DEFAULT_PORT_RANGE.to, nodeOverride: false };
  }

  /**
   * Pick a free port and claim it.
   *
   * IDEMPOTENT: a server that already holds a live allocation of the same
   * protocol gets that port back instead of losing 40 candidates to the
   * per-server unique index and then being told the node is out of ports — the
   * old behaviour, which reported "no free port" for "you already have one".
   *
   * The candidate walk rotates per attempt and wraps, so a nearly full pool
   * finds its tail instead of spinning on a busy prefix.
   */
  async allocate(input: {
    serverId: string;
    nodeId: string;
    containerPort: number;
    protocol?: 'tcp' | 'udp';
    attempts?: number;
  }): Promise<{ allocation: AllocatedPort; created: boolean }> {
    const protocol = input.protocol ?? 'tcp';
    const existing = await this.findLive(input.serverId, protocol);
    if (existing) {
      return { allocation: existing, created: false };
    }

    const { from, to } = await this.rangeFor(input.nodeId);
    const tries = Math.min(Math.max(input.attempts ?? 40, 1), 200);
    const span = to - from + 1;
    if (span <= 0) throw new AppError('PORT_RANGE_INVALID', 500, 'Configured port range is empty');

    // One walk over the pool, not `tries` random single draws: the ordered scan
    // finds a free port even at 99% occupancy, which random retrying cannot.
    const order = candidatePorts({ from, to }, Math.floor(Math.random() * span));
    for (let attempt = 0; attempt < Math.min(tries, order.length); attempt++) {
      const candidate = order[attempt];
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
        if (row) return { allocation: { port: row.port, protocol, containerPort: input.containerPort }, created: true };
      } catch (e) {
        // 23505 = any unique violation on this table (also the per-server one):
        // treat as a lost race and pick another candidate.
        if ((e as { code?: string })?.code !== '23505') throw e;
      }
    }
    throw new AppError('PORT_POOL_EXHAUSTED', 503, `No free port left on this node (${from}-${to})`);
  }

  /** The server's live allocation of one protocol, if it holds one. */
  async findLive(serverId: string, protocol: 'tcp' | 'udp'): Promise<AllocatedPort | null> {
    const [row] = await this.db
      .select({ port: serverPorts.port, protocol: serverPorts.protocol, containerPort: serverPorts.containerPort })
      .from(serverPorts)
      .where(
        and(
          eq(serverPorts.serverId, serverId),
          eq(serverPorts.protocol, protocol),
          eq(serverPorts.state, 'allocated'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Free every allocation of a server. Idempotent, and never touches a port
   * another server owns.
   *
   * This is the LOW-LEVEL operation: it trusts its caller. The server delete
   * path must go through releaseWhenUnbound() instead, which only releases once
   * the container is demonstrably gone — releasing first would let a new server
   * be handed a port the dying container still holds, and its provision would
   * fail on Docker's "port is already allocated" with a leaked allocation.
   */
  async releaseAll(serverId: string, opts: { reason?: string } = {}): Promise<number> {
    const rows = await this.db
      .update(serverPorts)
      .set({ state: 'released', releasedAt: new Date(), reason: opts.reason ?? null, drift: null })
      .where(and(eq(serverPorts.serverId, serverId), eq(serverPorts.state, 'allocated')))
      .returning({ id: serverPorts.id });
    if (rows.length) this.log.debug(`released ${rows.length} port(s) for ${serverId}`);
    return rows.length;
  }

  /**
   * Release a server's ports ONLY once nothing on the host still binds them.
   *
   * `stillBound` is the set of host ports a live container still publishes.
   * Anything in that set is left `allocated` with a reason, so the port cannot
   * be handed out from under the process that is using it and the reconciler
   * can finish the job on a later tick.
   */
  async releaseWhenUnbound(
    serverId: string,
    stillBound: ReadonlySet<number>,
  ): Promise<{ released: number; held: number[] }> {
    const live = await this.db
      .select({ id: serverPorts.id, port: serverPorts.port })
      .from(serverPorts)
      .where(and(eq(serverPorts.serverId, serverId), eq(serverPorts.state, 'allocated')));
    const blocked = live.filter((r) => stillBound.has(r.port));
    if (blocked.length) {
      await this.db
        .update(serverPorts)
        .set({ reason: 'awaiting container removal — the host port is still bound' })
        .where(inArray(serverPorts.id, blocked.map((b) => b.id)));
      this.log.warn(
        `server ${serverId}: keeping ${blocked.length} port(s) held (${blocked
          .map((b) => b.port)
          .join(', ')}) — still published by a container`,
      );
    }
    const released = await this.releaseAll(
      serverId,
      blocked.length ? { reason: 'released while container still bound it' } : {},
    );
    return { released, held: blocked.map((b) => b.port) };
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
   * How much of the pool is in use — shown to admins AND to the owner so
   * exhaustion is visible before it bites.
   */
  async poolStatus(nodeId: string) {
    const { from, to, nodeOverride } = await this.rangeFor(nodeId);
    const [row] = await this.db
      .select({ used: sql<number>`count(*)::int` })
      .from(serverPorts)
      .where(and(eq(serverPorts.nodeId, nodeId), eq(serverPorts.state, 'allocated')));
    const used = Number(row?.used ?? 0);
    const capacity = to - from + 1;
    return { nodeId, from, to, capacity, used, free: Math.max(0, capacity - used), nodeOverride };
  }

  /**
   * Every node's pool health, for the admin dashboard. One query — the admin
   * page renders a fleet, not one node at a time.
   */
  async fleetPoolStatus(): Promise<FleetPoolStatus[]> {
    const nodeRows = await this.db.select({ id: nodes.id }).from(nodes);
    const counts = await this.db
      .select({ nodeId: serverPorts.nodeId, used: sql<number>`count(*)::int` })
      .from(serverPorts)
      .where(eq(serverPorts.state, 'allocated'))
      .groupBy(serverPorts.nodeId);
    const usedBy = new Map(counts.map((c) => [c.nodeId, Number(c.used)]));
    const out: FleetPoolStatus[] = [];
    for (const n of nodeRows) {
      const { from, to, nodeOverride } = await this.rangeFor(n.id);
      const capacity = to - from + 1;
      const used = usedBy.get(n.id) ?? 0;
      out.push({ nodeId: n.id, from, to, capacity, used, free: Math.max(0, capacity - used), nodeOverride });
    }
    return out;
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

  // ---- observed health ----------------------------------------------------

  /**
   * Persist what a probe just observed. Split from the probing itself so the
   * reconciler and the on-demand endpoint share one write path, and so a
   * measurement is always stored together with the time it was taken.
   */
  async recordHealth(
    allocationId: string,
    patch: { containerListening?: boolean | null; hostReachable?: boolean | null; drift?: 'missing' | 'extra' | null },
  ): Promise<void> {
    const now = new Date();
    const set: Record<string, unknown> = {};
    if (patch.containerListening !== undefined) {
      set.container_listening = patch.containerListening;
      set.container_checked_at = patch.containerListening === null ? null : now;
    }
    if (patch.hostReachable !== undefined) {
      set.host_reachable = patch.hostReachable;
      set.host_checked_at = patch.hostReachable === null ? null : now;
    }
    set.drift = patch.drift ?? null;
    if (!Object.keys(set).length) return;
    await this.db.update(serverPorts).set(set).where(eq(serverPorts.id, allocationId));
  }

  /**
   * Probe whether a TCP service actually ANSWERS on `host:port`.
   *
   * A bare `connect()` is NOT a valid test for a Docker-published port, and
   * this is measured, not theorised:
   *
   *   published port, container has NO listener  → connect() SUCCEEDS
   *   published port, container IS listening     → connect() succeeds, holds
   *
   * Docker's userland proxy accepts the handshake on the host port before it
   * has any idea whether anything is on the other side. A plain connect would
   * therefore report a dead port as reachable — which is precisely the false
   * "Allocated / online" this whole layer exists to eliminate.
   *
   * The discriminator is what happens NEXT. With nothing listening, the
   * container's TCP stack answers the proxy's SYN with a RST, which reaches the
   * client within a few milliseconds and closes the socket. With a real
   * service the connection stays ESTABLISHED and simply waits for data.
   * Measured on this host: dead → closed at 11ms, live → still open at 502ms.
   *
   * `null` means "could not tell" (probe errored, timed out, or was not run) —
   * never conflated with a false.
   */
  probeService(host: string, port: number, opts: { timeoutMs?: number; settleMs?: number } = {}): Promise<boolean | null> {
    const timeoutMs = opts.timeoutMs ?? 2_000;
    const settleMs = opts.settleMs ?? 350;
    return new Promise((resolve) => {
      let settled = false;
      const socket = connect({ host, port });
      const finish = (v: boolean | null) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(v);
      };
      socket.setTimeout(timeoutMs);
      // ONLY the settle timer may report success. A `close`/`error` after a
      // successful handshake is a FAILURE, not a success: that is exactly the
      // RST a dead published port produces a few milliseconds after the proxy
      // accepts. Treating "we had connected" as the answer reports every dead
      // port as reachable — the bug this function exists to prevent.
      socket.once('connect', () => {
        setTimeout(() => finish(true), settleMs);
      });
      socket.once('close', () => finish(false));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(null));
    });
  }
}