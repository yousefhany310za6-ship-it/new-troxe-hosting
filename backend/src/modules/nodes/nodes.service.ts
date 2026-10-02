import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DB, Db } from '../../db/db.module';
import { nodes, servers } from '../../db/schema';
import { Err } from '../../common/errors';
import { encryptSecret } from '../../common/crypto';
import { AuditService } from '../audit/audit.module';
import { NodePoolService } from './node-pool.service';
import { CreateNodeDto, UpdateNodeDto } from './dto';

/** The API host's own daemon — always present, never remote, never deleted. */
export const LOCAL_NODE_ID = 'local';

function mustPem(value: string | undefined, field: string): string {
  const v = (value ?? '').trim();
  if (!v.includes('BEGIN CERTIFICATE') && !v.includes('BEGIN PRIVATE KEY') && !v.includes('BEGIN RSA PRIVATE KEY')) {
    throw Err.invalid('NODE_TLS_INVALID', `${field} is not a PEM certificate/key block`);
  }
  return v;
}

/** Parse + normalize a supernet CIDR (mask 8-24, unicast only). */
export function mustCidr(value: string | undefined | null): string {
  const v = (value ?? '').trim();
  const m = /^((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(8|9|1\d|2[0-4])$/.exec(v);
  if (!m) throw Err.invalid('NODE_SUBNET_INVALID', 'subnetBase must be a CIDR like 10.201.0.0/16 (mask 8-24)');
  const ip = v.split('/')[0].split('.').map(Number);
  if (ip[0] === 0 || ip[0] === 127 || ip[0] >= 224) {
    throw Err.invalid('NODE_SUBNET_INVALID', 'subnetBase must be usable unicast space (no 0/127/multicast)');
  }
  // normalize to the network address (10.201.7.9/16 → 10.201.0.0/16)
  const mask = Number(v.split('/')[1]);
  const n = ((ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]) >>> 0;
  const net = (n & (~0 << (32 - mask))) >>> 0;
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${mask}`;
}

/** IPv4 <-> int helpers for /24 allocation inside a supernet. */
export function ipToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0);
}

export function intToIp(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

@Injectable()
export class NodesService {
  constructor(
    @Inject(DB) private db: Db,
    private pool: NodePoolService,
    private audit: AuditService,
  ) {}

  /** Strip TLS secrets — the API never returns key material, only its presence. */
  private strip<T extends { tlsCa?: unknown; tlsCert?: unknown; tlsKey?: unknown }>(row: T) {
    const { tlsCa: _ca, tlsCert: _cert, tlsKey: _key, ...safe } = row;
    return { ...safe, hasTls: !!(_ca && _cert && _key) };
  }

  async list() {
    const [rows, counts] = await Promise.all([
      this.db
        .select({
          id: nodes.id,
          name: nodes.name,
          dockerHost: nodes.dockerHost,
          dockerPort: nodes.dockerPort,
          tlsCa: nodes.tlsCa,
          tlsCert: nodes.tlsCert,
          tlsKey: nodes.tlsKey,
          enabled: nodes.enabled,
          drained: nodes.drained,
          lastSeenAt: nodes.lastSeenAt,
          createdAt: nodes.createdAt,
        })
        .from(nodes)
        .orderBy(nodes.id),
      this.db.select({ nodeId: servers.nodeId, n: count() }).from(servers).groupBy(servers.nodeId),
    ]);
    const serverCount = new Map(counts.map((c) => [c.nodeId, c.n]));
    return rows.map((r) => ({ ...this.strip(r), serverCount: serverCount.get(r.id) ?? 0 }));
  }

  async get(id: string) {
    const [row] = await this.db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
    if (!row) throw new NotFoundException('NODE_NOT_FOUND');
    const [c] = await this.db.select({ n: count() }).from(servers).where(eq(servers.nodeId, id));
    return { ...this.strip(row), serverCount: c?.n ?? 0 };
  }

  async create(dto: CreateNodeDto, actorId: string, actorEmail?: string) {
    const id = dto.id ?? `node_${randomBytes(3).toString('hex')}`;
    if (id === LOCAL_NODE_ID) throw new ForbiddenException('NODE_LOCAL_RESERVED');
    const [dup] = await this.db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, id)).limit(1);
    if (dup) throw Err.conflict('NODE_ID_TAKEN', `Node "${id}" already exists`);
    const base = mustCidr(dto.subnetBase);
    await this.ensureNoOverlap(id, base);
    const tls = {
      tlsCa: encryptSecret(JSON.stringify(mustPem(dto.ca, 'ca'))),
      tlsCert: encryptSecret(JSON.stringify(mustPem(dto.cert, 'cert'))),
      tlsKey: encryptSecret(JSON.stringify(mustPem(dto.key, 'key'))),
    };
    const [row] = await this.db
      .insert(nodes)
      .values({ id, name: dto.name.trim(), dockerHost: dto.host.trim(), dockerPort: dto.port ?? 2376, subnetBase: base, ...tls })
      .returning();
    this.pool.refresh(id);
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.node.create',
      targetType: 'node',
      targetId: id,
      meta: { host: dto.host, subnetBase: base },
    });
    return this.strip(row);
  }

  async update(id: string, dto: UpdateNodeDto, actorId: string, actorEmail?: string) {
    const [row] = await this.db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
    if (!row) throw new NotFoundException('NODE_NOT_FOUND');
    // the local daemon is socket-bound by definition — it can never point elsewhere
    if (id === LOCAL_NODE_ID && (dto.host !== undefined || dto.ca !== undefined || dto.cert !== undefined || dto.key !== undefined || dto.subnetBase !== undefined)) {
      throw new ForbiddenException('NODE_LOCAL_IMMUTABLE');
    }
    const tlsFields = [dto.ca, dto.cert, dto.key];
    if (tlsFields.some((v) => v !== undefined) && !tlsFields.every((v) => v !== undefined)) {
      throw Err.invalid('NODE_TLS_PARTIAL', 'TLS rotation is atomic: provide ca, cert and key together');
    }
    const [c] = await this.db.select({ n: count() }).from(servers).where(eq(servers.nodeId, id));
    const serverCount = c?.n ?? 0;
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.host !== undefined) patch.dockerHost = dto.host.trim();
    if (dto.port !== undefined) patch.dockerPort = dto.port;
    if (dto.subnetBase !== undefined) {
      // live servers are firewalled by the OLD base — moving it would
      // orphan their coverage, so it is pinned while servers exist
      if (serverCount > 0) throw Err.conflict('NODE_HAS_SERVERS', 'Cannot change the supernet while servers live on this node');
      const base = mustCidr(dto.subnetBase);
      await this.ensureNoOverlap(id, base);
      patch.subnetBase = base;
    }
    if (dto.ca !== undefined) {
      patch.tlsCa = encryptSecret(JSON.stringify(mustPem(dto.ca, 'ca')));
      patch.tlsCert = encryptSecret(JSON.stringify(mustPem(dto.cert, 'cert')));
      patch.tlsKey = encryptSecret(JSON.stringify(mustPem(dto.key, 'key')));
    }
    if (dto.enabled !== undefined) {
      if (id === LOCAL_NODE_ID && dto.enabled === false) throw new ForbiddenException('NODE_LOCAL_IMMUTABLE');
      patch.enabled = dto.enabled;
    }
    if (dto.drained !== undefined) patch.drained = dto.drained;
    if (!Object.keys(patch).length) throw Err.invalid('NODE_NO_CHANGES', 'Nothing to update');
    const [updated] = await this.db.update(nodes).set(patch).where(eq(nodes.id, id)).returning();
    this.pool.refresh(id);
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.node.update',
      targetType: 'node',
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    return this.strip(updated);
  }

  async remove(id: string, actorId: string, actorEmail?: string) {
    if (id === LOCAL_NODE_ID) throw new ForbiddenException('NODE_LOCAL_IMMUTABLE');
    const [row] = await this.db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, id)).limit(1);
    if (!row) throw new NotFoundException('NODE_NOT_FOUND');
    const [c] = await this.db.select({ n: count() }).from(servers).where(eq(servers.nodeId, id));
    if ((c?.n ?? 0) > 0) throw Err.conflict('NODE_HAS_SERVERS', `Node still hosts ${c?.n} server(s) — migrate or delete them first`);
    await this.db.delete(nodes).where(eq(nodes.id, id));
    this.pool.refresh(id);
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.node.delete',
      targetType: 'node',
      targetId: id,
    });
    return { ok: true };
  }

  /** Liveness probe through the pool (updates lastSeenAt on success). */
  check(id: string) {
    return this.pool.check(id);
  }

  /**
   * Placement: explicit node must exist, be enabled and undrained;
   * otherwise least-loaded eligible node. Throws 503 when the fleet has
   * no capacity (better than silently queueing on a dead node).
   */
  async pickNode(preferredId?: string): Promise<string> {
    if (preferredId) {
      const [n] = await this.db.select().from(nodes).where(eq(nodes.id, preferredId)).limit(1);
      if (!n) throw new NotFoundException('NODE_NOT_FOUND');
      if (!n.enabled) throw Err.conflict('NODE_DISABLED', `Node "${preferredId}" is disabled`);
      if (n.drained) throw Err.conflict('NODE_DRAINED', `Node "${preferredId}" is drained (no new servers)`);
      return n.id;
    }
    const rows = await this.db
      .select({ id: nodes.id, n: count(servers.id) })
      .from(nodes)
      .leftJoin(servers, eq(servers.nodeId, nodes.id))
      .where(and(eq(nodes.enabled, true), eq(nodes.drained, false)))
      .groupBy(nodes.id);
    if (!rows.length) throw Err.unavailable('NO_CAPACITY', 'No enabled node available for new servers');
    rows.sort((a, b) => a.n - b.n);
    return rows[0].id;
  }

  /** Supernet overlap guard: two nodes must never claim the same space. */
  private async ensureNoOverlap(selfId: string, base: string): Promise<void> {
    const [ip, mask] = base.split('/');
    const start = ipToInt(ip);
    const size = 2 ** (32 - Number(mask));
    const end = start + size - 1;
    const all = await this.db.select({ id: nodes.id, subnetBase: nodes.subnetBase }).from(nodes);
    for (const n of all) {
      if (n.id === selfId || !n.subnetBase) continue;
      const [oip, omask] = n.subnetBase.split('/');
      const ostart = ipToInt(oip);
      const oend = ostart + 2 ** (32 - Number(omask)) - 1;
      if (start <= oend && ostart <= end) {
        throw Err.conflict('NODE_SUBNET_OVERLAP', `Supernet overlaps node "${n.id}" (${n.subnetBase})`);
      }
    }
  }
}
