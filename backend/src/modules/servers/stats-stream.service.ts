import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env';
import { DB, Db } from '../../db/db.module';
import { servers } from '../../db/schema';
import { RealtimeGateway } from '../auth/realtime.gateway';
import { DockerService } from './provisioning/docker.service';

/** hard ceiling of simultaneously streamed containers (daemon connections) */
const MAX_STREAMS = 64;
const RETRY_NOT_RUNNING_MS = 3_000;
const RETRY_AFTER_END_MS = 2_000;
const RETRY_AFTER_ERROR_MS = 5_000;

interface Entry {
  close: () => void;
}

/**
 * Real-time resource stats. Publishes ~1 sample/second on `server:stats:<id>`
 * for every server somebody is currently watching — and ONLY those: a stream is
 * opened when the first viewer subscribes and closed when the last one leaves.
 * One daemon stream per server regardless of how many tabs are watching.
 *
 * Demand is read from the gateway's rooms every second, so there is no
 * subscribe/unsubscribe bookkeeping to leak; a stream that ends because the
 * container stopped/restarted is re-opened automatically while viewers remain.
 */
@Injectable()
export class StatsStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StatsStreamService.name);
  private readonly streams = new Map<string, Entry>();
  private readonly retryAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @Inject(DB) private db: Db,
    private docker: DockerService,
    private realtime: RealtimeGateway,
  ) {}

  onModuleInit() {
    if (!config.DOCKER_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const e of this.streams.values()) e.close();
    this.streams.clear();
  }

  /** exposed for tests */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const wanted = new Set(this.realtime.statsSubscribers());
      for (const [id, entry] of this.streams) {
        if (wanted.has(id)) continue;
        entry.close();
        this.streams.delete(id);
        this.retryAt.delete(id);
      }
      for (const id of this.retryAt.keys()) if (!wanted.has(id)) this.retryAt.delete(id);
      for (const id of wanted) {
        if (this.streams.has(id) || this.streams.size >= MAX_STREAMS) continue;
        if ((this.retryAt.get(id) ?? 0) > Date.now()) continue;
        await this.open(id);
      }
    } catch (e) {
      this.log.debug(`stats tick failed: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async open(id: string): Promise<void> {
    const later = (ms: number): void => {
      this.retryAt.set(id, Date.now() + ms);
    };
    try {
      const [row] = await this.db
        .select({ containerId: servers.containerId, nodeId: servers.nodeId })
        .from(servers)
        .where(eq(servers.id, id))
        .limit(1);
      if (!row?.containerId) return later(RETRY_AFTER_ERROR_MS);
      const state = await this.docker.inspect(row.containerId, row.nodeId).catch(() => null);
      if (!state?.running) return later(RETRY_NOT_RUNNING_MS);

      const entry: Entry = { close: () => undefined };
      this.streams.set(id, entry);
      try {
        const handle = await this.docker.streamStats(
          row.containerId,
          row.nodeId,
          (stats) => this.realtime.broadcastServerStats(id, { serverId: id, ...stats, ts: Date.now() }),
          () => {
            // only forget THIS stream (a newer one may already have replaced it)
            if (this.streams.get(id) === entry) {
              this.streams.delete(id);
              later(RETRY_AFTER_END_MS);
            }
          },
        );
        entry.close = handle.close;
      } catch (e) {
        if (this.streams.get(id) === entry) this.streams.delete(id);
        throw e;
      }
    } catch (e) {
      this.log.debug(`stats stream for ${id} failed: ${(e as Error).message}`);
      later(RETRY_AFTER_ERROR_MS);
    }
  }
}
