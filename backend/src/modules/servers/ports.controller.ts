import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { ServerAccessGuard } from './server-access.guard';
import { CurrentUser } from '../auth/current-user';
import { ctxOf } from '../../common/request-context';
import { PortsService } from './ports.service';
import { ServersService } from './servers.service';
import { ServerAccessService } from './server-access.service';
import { DockerService } from './provisioning/docker.service';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * Port endpoints for a server. Every route re-resolves ownership server-side
 * (the id alone grants nothing) and is owner-only — there is deliberately no
 * "choose my own port" endpoint: the allocator decides, within the configured
 * range, so a client can never squat or collide on a port.
 */
@Controller({ path: 'servers', version: '1' })
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PortsController {
  constructor(
    private ports: PortsService,
    private servers: ServersService,
    private docker: DockerService,
    private access: ServerAccessService,
  ) {}

  /**
   * The server's published port(s), the address to reach them on, and — the
   * part that used to be missing — what was ACTUALLY observed on the host.
   *
   * `health` is deliberately a set of independent facts rather than one
   * boolean. "Allocated" and "reachable" are different claims: a sandbox with
   * a perfectly valid allocation whose app never called `listen()` is
   * allocated, published, running, and completely unreachable, and the panel
   * has to be able to say so instead of printing a green "Allocated".
   *
   * `external` is always `unverified`. The node can only prove a path that
   * starts and ends inside itself; anything beyond that needs a probe on a
   * third network, which this process is not. Reporting it as reachable would
   * be a claim nobody measured.
   */
  @Get(':id/ports')
  @UseGuards(ServerAccessGuard)
  async show(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    const ctx = ctxOf(req);
    const access = await this.access.resolve(id, u.sub);
    this.access.requirePermission(access, 'server.view');
    void ctx;
    const row = access.row;
    const [ports, address, pool, health] = await Promise.all([
      this.ports.listForServer(id),
      this.ports.addressFor(id),
      this.servers.getNodeId(id).then((nodeId) => this.ports.poolStatus(nodeId).catch(() => null)),
      this.observe(id, row.nodeId, row.containerId ?? null, row.networkName ?? null),
    ]);
    return {
      ports,
      address,
      pool,
      range: { from: pool?.from ?? null, to: pool?.to ?? null },
      health,
    };
  }

  /**
   * Measure what the host actually has, right now.
   *
   * Three independent probes, and `null` whenever a probe cannot be run from
   * here — never a default that reads as a result:
   *   • published     — the daemon's own PortBindings (host port + protocol)
   *   • listening     — a real TCP connect to <containerIp>:<containerPort>
   *   • hostReachable — a real TCP connect to 127.0.0.1:<hostPort>
   *
   * The last one is LOCAL ONLY: on a remote node the API shares no loopback
   * with that node's daemon, so it returns null ("cannot verify from here")
   * rather than pretending. Results are cached on the allocation row with the
   * time they were taken, and every call refreshes them.
   */
  private async observe(serverId: string, nodeId: string, containerId: string | null, networkName: string | null) {
    const allocations = await this.ports.listForServer(serverId);
    if (!allocations.length) {
      return {
        allocated: false,
        published: null,
        containerRunning: null,
        containerListening: null,
        hostReachable: null,
        external: 'unverified' as const,
        checkedAt: null,
        drift: null,
        note: 'This server has no host port allocated, so there is nothing to reach.',
      };
    }
    const allocation = allocations[0];

    // no container at all (record-only dev mode, or a failed provision):
    // "not published" is a measured fact here, not an absence of data
    if (!containerId) {
      return {
        allocated: true,
        published: false,
        containerRunning: false,
        containerListening: null,
        hostReachable: null,
        external: 'unverified' as const,
        checkedAt: new Date().toISOString(),
        drift: 'missing' as const,
        note: 'The server has an allocated port but no container — Docker never published it.',
      };
    }

    const [state, bindings] = await Promise.all([
      this.docker.inspect(containerId, nodeId),
      this.docker.publishedBindings(containerId, nodeId),
    ]);
    if (!state) {
      return {
        allocated: true,
        published: false,
        containerRunning: false,
        containerListening: null,
        hostReachable: null,
        external: 'unverified' as const,
        checkedAt: new Date().toISOString(),
        drift: 'missing' as const,
        note: 'The container does not exist on the node — start the server to rebuild it.',
      };
    }

    // protocol AND port must both match: a tcp row bound as udp is drift
    const bound = bindings.find(
      (b) => b.hostPort === allocation.port && b.protocol === allocation.protocol,
    );
    const published = !!bound;
    const extra = bindings.some((b) => !allocations.some((a) => a.port === b.hostPort && a.protocol === b.protocol));
    const drift: 'missing' | 'extra' | null = !published ? 'missing' : extra ? 'extra' : null;

    // Does anything actually LISTEN inside the sandbox? Probed by connecting
    // straight to the container's address, which bypasses docker's userland
    // proxy — the proxy accepts the host handshake either way, so a probe
    // through it proves nothing (see PortsService.probeService).
    let listening: boolean | null = null;
    if (state.running && published) {
      const ip = networkName ? await this.docker.containerAddress(containerId, networkName, nodeId) : null;
      listening = ip ? await this.ports.probeService(ip, allocation.containerPort, { timeoutMs: 1_500 }) : null;
    }

    // End-to-end reachability of the PUBLISHED port. Local node only: the API
    // shares no loopback with a remote node's daemon, so there the honest
    // answer is "cannot verify from here", never a guess.
    let hostReachable: boolean | null = null;
    if (state.running && published && nodeId === 'local') {
      hostReachable = await this.ports.probeService('127.0.0.1', allocation.port);
    }

    await this.ports.recordHealth(allocation.id, { containerListening: listening, hostReachable, drift });

    const checkedAt = new Date().toISOString();
    const base = {
      allocated: true,
      published,
      containerRunning: state.running,
      containerListening: listening,
      hostReachable,
      external: 'unverified' as const,
      checkedAt,
      drift,
    };
    if (!state.running) return { ...base, note: 'The container is not running — the port is reserved but nothing is listening.' };
    if (!published)
      return { ...base, note: 'The port is allocated but Docker never published it on this container. Use "Repair" to re-apply it.' };
    if (listening === false)
      return {
        ...base,
        note: `Docker published the port, but nothing is listening on container port ${allocation.containerPort}. Your app has to bind it (e.g. process.env.PORT) before anything can connect.`,
      };
    if (hostReachable === false)
      return { ...base, note: 'The app is listening, but a connect to the published host port failed on the node itself.' };
    if (hostReachable === null)
      return {
        ...base,
        note: 'The app is listening inside the sandbox. Host-side reachability cannot be measured from here for a remote node — reachability from the internet is not verified by this panel.',
      };
    return { ...base, note: 'Published and listening, and the host port answered a connection from the node.' };
  }

  /**
   * Ask for a port to be (re)allocated. Used when a server has none yet (e.g.
   * provisioned before the port system existed): the allocator picks, the
   * container is recreated to publish it, and the attempt is audited.
   */
  @Post(':id/ports/allocate')
  @UseGuards(ServerAccessGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async allocate(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    const ctx = ctxOf(req);
    const access = await this.access.resolve(id, u.sub);
    this.access.requirePermission(access, 'settings.update');
    const row = access.row;
    const existing = await this.ports.listForServer(id);
    if (existing.length) {
      // A port can be allocated in the database but not live on the host (the
      // container predates the allocation, and `docker restart` does not
      // re-apply PortBindings). Reconcile rather than report a dead port.
      const published = row.containerId ? await this.docker.publishedPorts(row.containerId, row.nodeId) : [];
      const wanted = new Set(existing.map((p) => p.port));
      const missing = existing.some((p) => !published.includes(p.port));
      const extra = published.filter((p) => !wanted.has(p));
      if (missing || extra.length) {
        const result = await this.servers.reprovision(u.sub, id, ctx);
        return {
          ports: await this.ports.listForServer(id),
          address: await this.ports.addressFor(id),
          health: await this.observe(id, row.nodeId, row.containerId ?? null, row.networkName ?? null),
          reprovisioned: true as const,
          status: result.status,
        };
      }
      return {
        ports: existing,
        address: await this.ports.addressFor(id),
        health: await this.observe(id, row.nodeId, row.containerId ?? null, row.networkName ?? null),
        alreadyAllocated: true as const,
      };
    }
    const { runtimeImage } = await import('./provisioning/images');
    await this.ports.allocate({
      serverId: id,
      nodeId: row.nodeId,
      containerPort: runtimeImage(row.runtime as 'Node.js').port,
      protocol: 'tcp',
    });
    // docker restart does NOT re-apply PortBindings: the container has to be
    // recreated (the volume, and therefore the client's files, is untouched)
    await this.servers.reprovision(u.sub, id, ctx);
    return {
      ports: await this.ports.listForServer(id),
      address: await this.ports.addressFor(id),
      health: await this.observe(id, row.nodeId, row.containerId ?? null, row.networkName ?? null),
      allocated: true as const,
    };
  }

  /**
   * Reconcile the host against the database: re-apply the published bindings
   * by recreating the container (files untouched). This is the repair path a
   * drifted allocation needs — `docker restart` alone never re-applies them.
   */
  @Post(':id/ports/reconcile')
  @UseGuards(ServerAccessGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reconcile(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    const ctx = ctxOf(req);
    const access = await this.access.resolve(id, u.sub);
    this.access.requirePermission(access, 'settings.update');
    const row = access.row;
    if (!row.containerId) {
      return { ok: false as const, reason: 'The server has no container on this node yet — start it first.' };
    }
    const result = await this.servers.reprovision(u.sub, id, ctx);
    return {
      ok: true as const,
      status: result.status,
      ports: await this.ports.listForServer(id),
      address: await this.ports.addressFor(id),
      health: await this.observe(id, row.nodeId, row.containerId ?? null, row.networkName ?? null),
    };
  }
}