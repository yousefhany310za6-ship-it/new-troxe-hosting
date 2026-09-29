import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config/env';
import { plans } from './schema';

/** Mirrors src/data/plans.jsx on the frontend (price in cents). */
const SEED_PLANS = [
  { id: 'free', name: 'Free', priceCents: 0, cpuMilli: 250, ramMb: 256, storageGb: 1, maxServers: 1, maxBackupSlots: 0, sortOrder: 1 },
  { id: 'starter', name: 'Starter', priceCents: 100, cpuMilli: 500, ramMb: 512, storageGb: 3, maxServers: 2, maxBackupSlots: 2, sortOrder: 2 },
  { id: 'pro', name: 'Pro', priceCents: 200, cpuMilli: 500, ramMb: 512, storageGb: 5, maxServers: 3, maxBackupSlots: 3, sortOrder: 3 },
  { id: 'premium', name: 'Premium', priceCents: 300, cpuMilli: 1000, ramMb: 1024, storageGb: 6, maxServers: 5, maxBackupSlots: 3, sortOrder: 4 },
  { id: 'gold', name: 'Gold', priceCents: 500, cpuMilli: 1000, ramMb: 2048, storageGb: 10, maxServers: 8, maxBackupSlots: 5, sortOrder: 5 },
  { id: 'platinum', name: 'Platinum', priceCents: 700, cpuMilli: 1500, ramMb: 3072, storageGb: 12, maxServers: 12, maxBackupSlots: 5, sortOrder: 6 },
  { id: 'diamond', name: 'Diamond', priceCents: 850, cpuMilli: 2000, ramMb: 5120, storageGb: 15, maxServers: 16, maxBackupSlots: 6, sortOrder: 7 },
  { id: 'elite', name: 'Elite', priceCents: 1000, cpuMilli: 2500, ramMb: 6144, storageGb: 18, maxServers: 24, maxBackupSlots: 7, sortOrder: 8 },
  { id: 'super', name: 'Super', priceCents: 1500, cpuMilli: 4000, ramMb: 10240, storageGb: 30, maxServers: 40, maxBackupSlots: 10, sortOrder: 9 },
  { id: 'custom', name: 'Custom', priceCents: 0, cpuMilli: 4000, ramMb: 10240, storageGb: 30, maxServers: 100, maxBackupSlots: 20, custom: true, sortOrder: 10 },
];

async function main() {
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema: { plans } });
  for (const p of SEED_PLANS) {
    await db
      .insert(plans)
      .values(p)
      .onConflictDoUpdate({ target: plans.id, set: p });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${SEED_PLANS.length} plans.`);
  await pool.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
