import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Pool } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { DockerService } from '../servers/provisioning/docker.service';

interface Probe {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * /api/v1/health  → liveness (process is up)
 * /api/v1/health/ready → readiness (db + docker reachable) — load balancers
 * should only route traffic when this returns 200.
 */
@Controller({ path: 'health', version: '1' })
export class HealthController {
  private startedAt = Date.now();
  // readiness does a live DB round-trip per call: throttle + short cache so
  // anonymous floods cannot churn the pool, and never leak driver text.
  private readyCache: { at: number; body: { status: string; checks: Probe[] } } | null = null;

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private docker: DockerService,
  ) {}

  @Get()
  @SkipThrottle()
  liveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async readiness(): Promise<{ status: string; checks: Probe[] }> {
    if (this.readyCache && Date.now() - this.readyCache.at < 3000) return this.readyCache.body;
    const checks: Probe[] = [];

    try {
      await this.pool.query('select 1');
      checks.push({ name: 'postgres', ok: true });
    } catch {
      // static detail: driver messages carry host/db/user strings (recon aid)
      checks.push({ name: 'postgres', ok: false, detail: 'unavailable' });
    }

    const dockerOk = await this.docker.ping();
    checks.push(
      dockerOk
        ? { name: 'docker', ok: true }
        : { name: 'docker', ok: false, detail: this.docker.available ? 'daemon unreachable' : 'disabled/unconfigured' },
    );

    // docker being down degrades provisioning but the API still serves reads,
    // so only the database is a hard readiness requirement.
    const ready = checks.find((c) => c.name === 'postgres')?.ok;
    if (!ready) throw new ServiceUnavailableException({ status: 'degraded', checks });
    const body = { status: checks.every((c) => c.ok) ? 'ok' : 'degraded', checks };
    this.readyCache = { at: Date.now(), body };
    return body;
  }
}
