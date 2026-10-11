import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { config } from '../../config/env';
import { ServerSchedulesService } from './server-schedules.service';

/**
 * Fires due schedules once a minute. Single-flight in this process; the
 * deployment runs a single API instance, so an in-memory guard is the whole
 * story — a second instance would need a database advisory lock, which is
 * documented here instead of pretended.
 *
 * Missed ticks (restarts, deploys) never cause catch-up storms: each schedule
 * carries its own next_run_at, and the service reschedules from the actual
 * fire time with a lateness cap.
 */
@Injectable()
export class ScheduleRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ScheduleRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private schedules: ServerSchedulesService) {}

  onModuleInit() {
    if (!config.DOCKER_ENABLED) {
      this.log.log('docker disabled — schedule runner stays off');
      return;
    }
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    // first pass shortly after boot so a schedule due during downtime fires
    // once (lateness-capped) instead of waiting a full minute
    const first = setTimeout(() => void this.tick(), 10_000);
    first.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { fired, errors } = await this.schedules.tick(new Date());
      if (fired || errors) this.log.log(`schedules tick: ${fired} fired, ${errors} failed`);
    } catch (e) {
      this.log.warn(`schedules tick failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
