import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
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
    const tls = {
      tlsCa: encryptSecret(JSON.stringify(mustPem(dto.ca, 'ca'))),
      tlsCert: encryptSecret(JSON.stringify(mustPem(dto.cert, 'cert'))),
      tlsKey: encryptSecret(JSON.stringify(mustPem(dto.key, 'key'))),
    };
    const [row] = await this.db
      .insert(nodes)
      .values({ id, name: dto.name.trim(), dockerHost: dto.host.trim(), dockerPort: dto.port ?? 2376, ...tls })
      .returning();
    this.pool.refresh(id);
    await this.audit.record({
      actorId,
      actorEmail: actorEmail ?? null,
      action: 'admin.node.create',
      targetType: 'node',
      targetId: id,
      meta: { host: dto.host },
    });
    return this.strip(row);
  }

  async update(id: string, dto: UpdateNodeDto, actorId: string, actorEmail?: string) {
    const [row] = await this.db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
    if (!row) throw new NotFoundException('NODE_NOT_FOUND');
    // the local daemon is socket-bound by definition — it can never point elsewhere
    if (id === LOCAL_NODE_ID && (dto.host !== undefined || dto.ca !== undefined || dto.cert !== undefined || dto.key !== undefined)) {
      throw new ForbiddenException('NODE_LOCAL_IMMUTABLE');
    }
    const tlsFields = [dto.ca, dto.cert, dto.key];
    if (tlsFields.some((v) => v !== undefined) && !tlsFields.every((v) => v !== undefined)) {
      throw Err.invalid('NODE_TLS_PARTIAL', 'TLS rotation is atomic: provide ca, cert and key together');
    }
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.host !== undefined) patch.dockerHost = dto.host.trim();
    if (dto.port !== undefined) patch.dockerPort = dto.port;
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
}
