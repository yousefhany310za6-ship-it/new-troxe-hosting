import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config/env';
import * as schema from './schema';

export const DB = 'DB';
export const PG_POOL = 'PG_POOL';
export type Db = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const pool = new Pool({
          connectionString: config.DATABASE_URL,
          max: config.PG_POOL_MAX,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          application_name: 'troxe-api',
          // server-side guards: no query may hang forever, no idle txn squatting
          options: `-c statement_timeout=${config.PG_STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout=10000`,
          ...(config.PG_SSL
            ? {
                ssl: {
                  // managed PG providers ship their own CA; override with
                  // PG_SSL_REJECT_UNAUTHORIZED=true when you pin a CA bundle.
                  rejectUnauthorized:
                    (process.env.PG_SSL_REJECT_UNAUTHORIZED ?? 'false').toLowerCase() !== 'true',
                },
              }
            : {}),
        });
        pool.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('[troxe-api] idle client error:', err.message);
        });
        return pool;
      },
    },
    {
      provide: DB,
      useFactory: (pool: Pool): Db => drizzle(pool, { schema }),
      inject: [PG_POOL],
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end().catch(() => undefined);
  }
}
