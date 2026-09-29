import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { encryptEnv, maskEnv } from '../../common/crypto';
import { DB, Db } from '../../db/db.module';
import { RUNTIME_VERSIONS, servers, type EnvVar } from '../../db/schema';
import { CreateServerDto, UpdateServerDto } from './dto';
import { DockerService } from './docker.service';

@Injectable()
export class ServersService {
  constructor(@Inject(DB) private db: Db, private docker: DockerService) {}

  list(ownerId: string) {
    return this.db.select().from(servers).where(eq(servers.ownerId, ownerId)).orderBy(desc(servers.createdAt));
  }

  async create(ownerId: string, dto: CreateServerDto) {
    const dupe = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.ownerId, ownerId), eq(servers.name, dto.name)))
      .limit(1);
    if (dupe.length) throw new ConflictException('SERVER_NAME_TAKEN');

    const [row] = await this.db
      .insert(servers)
      .values({
        ownerId,
        name: dto.name,
        runtime: dto.runtime as any,
        runtimeVersion: RUNTIME_VERSIONS[dto.runtime] ?? dto.runtime,
        status: 'offline',
        region: dto.region ?? 'fra-de',
        planId: dto.planId ?? 'free',
        startup: dto.startup,
        envEncrypted: dto.env?.length ? encryptEnv(dto.env) : null,
      } as any)
      .returning();
    return this.toPublic(row);
  }

  async update(id: string, dto: UpdateServerDto) {
    const patch: any = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.startup !== undefined) patch.startup = dto.startup;
    if (dto.env !== undefined) patch.envEncrypted = dto.env.length ? encryptEnv(dto.env) : null;
    if (dto.autoRestart !== undefined) patch.autoRestart = dto.autoRestart;
    if (dto.autoBackup !== undefined) patch.autoBackup = dto.autoBackup;
    const [row] = await this.db.update(servers).set(patch).where(eq(servers.id, id)).returning();
    return this.toPublic(row);
  }

  async remove(id: string) {
    await this.db.delete(servers).where(eq(servers.id, id));
    return { ok: true };
  }

  async lifecycle(id: string, action: 'start' | 'stop' | 'restart' | 'reinstall') {
    const [row] = await this.db.select().from(servers).where(eq(servers.id, id)).limit(1);
    if (!row) throw new ConflictException('SERVER_NOT_FOUND');

    if (action === 'start') {
      await this.docker.start(row.containerId);
      await this.db.update(servers).set({ status: 'online' } as any).where(eq(servers.id, id));
      return { status: 'online' };
    }
    if (action === 'stop') {
      await this.docker.stop(row.containerId);
      await this.db.update(servers).set({ status: 'offline' } as any).where(eq(servers.id, id));
      return { status: 'offline' };
    }
    // restart + reinstall share the restarting state for the UI meter
    await this.docker.restart(row.containerId);
    await this.db.update(servers).set({ status: 'restarting' } as any).where(eq(servers.id, id));
    setTimeout(() => {
      this.db.update(servers).set({ status: 'online' } as any).where(eq(servers.id, id)).catch(() => null);
    }, 2000);
    return { status: 'restarting' };
  }

  private toPublic(row: typeof servers.$inferSelect) {
    let env: EnvVar[] = [];
    try {
      if (row.envEncrypted) {
        // lazy require to avoid cycle; decrypt only for shape, values masked
        const { decryptEnv } = require('../../common/crypto') as typeof import('../../common/crypto');
        env = maskEnv(decryptEnv<EnvVar[]>(row.envEncrypted));
      }
    } catch {
      env = [];
    }
    return { ...row, envEncrypted: undefined, env };
  }
}
