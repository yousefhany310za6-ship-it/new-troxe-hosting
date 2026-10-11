import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user';
import { ctxOf } from '../../common/request-context';
import { PortsService } from './ports.service';
import { ServersService } from './servers.service';

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
  constructor(private ports: PortsService, private servers: ServersService) {}

  /** The server's published port(s) + the address to reach them on. */
  @Get(':id/ports')
  async show(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    const ctx = ctxOf(req);
    await this.ports.requireOwned(id, u.sub);
    void ctx;
    const [ports, address, pool] = await Promise.all([
      this.ports.listForServer(id),
      this.ports.addressFor(id),
      this.servers.getNodeId(id).then((nodeId) => this.ports.poolStatus(nodeId).catch(() => null)),
    ]);
    return {
      ports,
      address,
      pool,
      range: { from: pool?.from ?? null, to: pool?.to ?? null },
    };
  }

  /**
   * Ask for a port to be (re)allocated. Used when a server has none yet (e.g.
   * provisioned before the port system existed): the allocator picks, the
   * container is recreated to publish it, and the attempt is audited.
   */
  @Post(':id/ports/allocate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async allocate(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    const ctx = ctxOf(req);
    const row = await this.ports.requireOwned(id, u.sub);
    const existing = await this.ports.listForServer(id);
    if (existing.length) return { ports: existing, address: await this.ports.addressFor(id), alreadyAllocated: true as const };
    const { runtimeImage } = await import('./provisioning/images');
    const allocated = await this.ports.allocate({
      serverId: id,
      nodeId: row.nodeId,
      containerPort: runtimeImage(row.runtime as 'Node.js').port,
      protocol: 'tcp',
    });
    // docker restart does NOT re-apply PortBindings: the container has to be
    // recreated (the volume, and therefore the client's files, is untouched)
    await this.servers.reprovision(u.sub, id, ctx);
    return { ports: await this.ports.listForServer(id), address: await this.ports.addressFor(id), allocated };
  }
}
