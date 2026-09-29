import { Controller, Get, Inject } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { plans } from '../../db/schema';

/** Public price list (the marketing pages read this). */
@Controller({ path: 'plans', version: '1' })
export class PlansController {
  constructor(@Inject(DB) private db: Db) {}

  @Get()
  async list() {
    const rows = await this.db.select().from(plans).orderBy(plans.sortOrder);
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      priceCents: p.priceCents,
      cpuMilli: p.cpuMilli,
      ramMb: p.ramMb,
      storageGb: p.storageGb,
      maxServers: p.maxServers,
      maxBackupSlots: p.maxBackupSlots,
      custom: p.custom,
      sortOrder: p.sortOrder,
    }));
  }
}
