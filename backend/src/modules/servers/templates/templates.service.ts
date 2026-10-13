import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AppError, Err } from '../../../common/errors';
import { DB, Db } from '../../../db/db.module';
import { templateVerifications, servers } from '../../../db/schema';
import { TEMPLATES, TEMPLATE_BY_ID, creatableTemplates, legacyTemplateFor } from './catalog';
import { validateCatalog } from './schema-check';
import { runtimeImage, resolveVersion } from '../provisioning/images';
import type { TemplateDefinition, TemplateStatus } from './types';

/**
 * Template administration.
 *
 * What an admin needs to know is not "is this template in the catalog" but
 * "can I trust it, when was it last proven, and WHY is it not". So every entry
 * carries its declared status, the latest recorded verification result, and
 * the image and startup it would actually run — with digests never leaving
 * the API except as a provenance label an admin can paste into an incident
 * ticket.
 *
 * Two rules are enforced here rather than trusted:
 *
 *  1. `verified` can only be SET by a real test run, never by an API call. The
 *     write path accepts only `enabled` and `deprecated`; promoting a template
 *     to verified goes through the test suite. Otherwise the badge is worth
 *     nothing.
 *  2. Disabling a template blocks NEW servers only. Existing rows keep their
 *     `template_id` and still resolve, so a disabled template never bricks
 *     servers that are already running on it.
 */
@Injectable()
export class TemplatesService {
  private readonly log = new Logger(TemplatesService.name);

  constructor(@Inject(DB) private db: Db) {}

  /** Every template, with its current status and last verification. */
  async list() {
    const rows = await this.db
      .select()
      .from(templateVerifications)
      .orderBy(desc(templateVerifications.ranAt));
    // newest first per template
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.templateId)) latest.set(r.templateId, r);

    return TEMPLATES.map((t) => this.describe(t, latest.get(t.id) ?? null));
  }

  private describe(t: TemplateDefinition, verification: typeof templateVerifications.$inferSelect | null) {
    const runtime = runtimeImage(t.runtime);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      language: t.language ?? null,
      runtime: t.runtime,
      // provenance: the TAG is shown, the digest is available to an admin for
      // incident response but is never what a client sees.
      versions: t.versions.map((v) => {
        const resolved = runtime.versions.find((rv) => rv.version === v);
        return { version: v, label: resolved?.label ?? `${t.runtime} ${v}`, image: resolved?.image ?? null };
      }),
      enabled: t.enabled,
      status: t.status,
      note: t.note ?? null,
      ports: t.ports,
      installSteps: t.install.map((s) => s.kind),
      buildSteps: t.build.map((s) => s.kind),
      startup: t.startup,
      variables: t.variables,
      recommended: t.recommended,
      expectedFiles: t.expectedFiles,
      docs: t.docs,
      creatable: t.enabled && t.status !== 'disabled' && t.status !== 'deprecated',
      lastVerification: verification
        ? {
            status: verification.status,
            install: verification.installStatus,
            build: verification.buildStatus,
            startup: verification.startupStatus,
            health: verification.healthStatus,
            reason: verification.reason,
            ranAt: verification.ranAt,
            durationMs: verification.durationMs,
            runtimeVersion: verification.runtimeVersion,
          }
        : null,
    };
  }

  /** One template with its full recorded verification history. */
  async detail(id: string) {
    const t = TEMPLATE_BY_ID.get(id);
    if (!t) throw Err.notFound('TEMPLATE_NOT_FOUND');
    const history = await this.db
      .select()
      .from(templateVerifications)
      .where(eq(templateVerifications.templateId, id))
      .orderBy(desc(templateVerifications.ranAt))
      .limit(25);
    return { ...this.describe(t, history[0] ?? null), history };
  }

  /**
   * Record a verification result.
   *
   * Called by the test suite, NOT by the admin UI. It is the only path that
   * can write a `verified` status, which is what makes the badge mean
   * something.
   */
  async recordVerification(input: {
    templateId: string;
    status: TemplateStatus;
    install?: string;
    build?: string;
    startup?: string;
    health?: string;
    detail?: Record<string, unknown>;
    reason?: string;
    runtimeVersion?: string;
    durationMs?: number;
  }): Promise<void> {
    if (!TEMPLATE_BY_ID.has(input.templateId)) throw Err.invalid('TEMPLATE_NOT_FOUND', `Unknown template "${input.templateId}"`);
    const allowed = ['ok', 'failed', 'skipped', 'pending', 'unknown'] as const;
    const check = (v: string | undefined) => (v && allowed.includes(v as never) ? v : 'unknown');
    await this.db.insert(templateVerifications).values({
      templateId: input.templateId,
      status: input.status,
      installStatus: check(input.install),
      buildStatus: check(input.build),
      startupStatus: check(input.startup),
      healthStatus: check(input.health),
      detail: input.detail ?? {},
      reason: input.reason?.slice(0, 500) ?? null,
      runtimeVersion: input.runtimeVersion?.slice(0, 16) ?? null,
      durationMs: input.durationMs ?? null,
    });
  }

  /**
   * The admin toggle.
   *
   * `enabled: false` hides a template from creation. It deliberately does NOT
   * touch `status`, so a verified template that is switched off keeps its
   * verification history and can be switched back on honestly.
   *
   * The catalog is source-controlled, so this records the decision and returns
   * the blast radius rather than pretending to mutate a compiled constant.
   * Promoting to `verified` is not exposed here at all — only a real test run
   * may write that status.
   */
  async setEnabled(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean; affectedServers: number }> {
    const t = TEMPLATE_BY_ID.get(id);
    if (!t) throw Err.notFound('TEMPLATE_NOT_FOUND');

    const affected = await countServersForTemplate(this.db, id);
    this.log.log(
      `template ${id} enable=${enabled} (${affected} existing server(s) keep running regardless)`,
    );
    return { id, enabled, affectedServers: affected };
  }

  /** Catalog-wide schema problems — surfaced in the admin UI as a banner. */
  health() {
    const issues = validateCatalog();
    return {
      templates: TEMPLATES.length,
      creatable: creatableTemplates().length,
      errors: issues.filter((i) => i.severity === 'error'),
      warnings: issues.filter((i) => i.severity === 'warning'),
      byStatus: TEMPLATES.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }

  /** Which template a legacy runtime row resolves to (used by the admin UI). */
  legacyMapping() {
    return Object.entries(
      TEMPLATES.reduce<Record<string, string>>((acc, t) => {
        acc[t.runtime] = legacyTemplateFor(t.runtime)?.id ?? '';
        return acc;
      }, {}),
    ).map(([runtime, templateId]) => ({ runtime, templateId }));
  }

  /** The image a given template+version actually resolves to. */
  resolveImage(templateId: string, version?: string): string {
    const t = TEMPLATE_BY_ID.get(templateId);
    if (!t) throw Err.invalid('TEMPLATE_NOT_FOUND', `Unknown template "${templateId}"`);
    return resolveVersion(t.runtime, version).image;
  }
}

/** How many live servers a disable would NOT stop — the blast radius. */
async function countServersForTemplate(db: Db, templateId: string): Promise<number> {
  const rows = await db.select({ id: servers.id }).from(servers).where(eq(servers.templateId, templateId));
  return rows.length;
}