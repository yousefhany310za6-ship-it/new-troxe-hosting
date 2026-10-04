import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { appSettings } from '../../db/schema';

export const SETTING_NEW_LOGIN_EMAILS = 'security.new_login_emails';

/**
 * Runtime admin settings (no redeploy to flip). Tiny TTL cache so the
 * login path pays no extra query in the common case.
 */
@Injectable()
export class EmailSettingsService {
  private cache = new Map<string, { v: string; at: number }>();

  constructor(@Inject(DB) private db: Db) {}

  async get(key: string, def: string): Promise<string> {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < 30_000) return c.v;
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1).catch(() => [undefined]);
    const v = row?.value ?? def;
    this.cache.set(key, { v, at: Date.now() });
    return v;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    this.cache.set(key, { v: value, at: Date.now() });
  }
}
