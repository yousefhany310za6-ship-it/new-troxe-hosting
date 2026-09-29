import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { auditLogs } from '../../db/schema';
import { DB, Db } from '../../db/db.module';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(@Inject(DB) private db: Db) {}

  /** Fire-and-forget: auditing must never break the business flow. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        meta: entry.meta ?? null,
      } as never);
    } catch (e) {
      this.log.warn(`audit write failed for ${entry.action}: ${(e as Error).message}`);
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
