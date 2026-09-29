import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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
@SkipThrottle()
export class HealthController {
  private startedAt = Date.now();

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private docker: DockerService,
  ) {}

  @Get()
  liveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness(): Promise<{ status: string; checks: Probe[] }> {
    const checks: Probe[] = [];

    try {
      await this.pool.query('select 1');
      checks.push({ name: 'postgres', ok: true });
    } catch (e) {
      checks.push({ name: 'postgres', ok: false, detail: (e as Error).message.slice(0, 120) });
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
    return { status: checks.every((c) => c.ok) ? 'ok' : 'degraded', checks };
  }
}
