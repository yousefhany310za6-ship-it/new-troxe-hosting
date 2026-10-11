import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors';
import { DB, Db } from '../../db/db.module';
import { auditLogs } from '../../db/schema';
import { runtimeImage, type Runtime } from './provisioning/images';
import { DockerService } from './provisioning/docker.service';
import { ServersService } from './servers.service';
import {
  MANAGER_FOR_RUNTIME,
  PACKAGE_OP_TIMEOUT_MS,
  basePackageName,
  installCommand,
  isValidPackageName,
  uninstallCommand,
  type PackageManager,
} from './package-policy';

export interface PackageRow {
  name: string;
  version: string | null;
  source: 'manifest';
}

export interface PackageOpResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Package management INSIDE the client's own sandbox.
 *
 * Guarantees (and why they matter):
 *  - the client supplies one package NAME; the command, manager and arguments
 *    come from package-policy.ts, and the name must match that manager's
 *    syntax before anything runs;
 *  - execution is a docker exec with an argv array — no shell is spawned, so
 *    there is no string a hostile name could escape;
 *  - it runs in the client's own container on their node, as the same
 *    unprivileged uid, read-only rootfs and network policy as the sandbox —
 *    never on the host;
 *  - ownership + a running, operable container are verified per operation;
 *  - one operation per call, time-boxed, and audited with the outcome (never
 *    the package output, which may echo secrets).
 *
 * Note: installing a package runs its install scripts. That is already the
 * sandbox's threat model (untrusted client code, isolated), and it is exactly
 * why none of this can reach the host.
 */
@Injectable()
export class PackagesService {
  private readonly log = new Logger(PackagesService.name);
  private static readonly OPS_PER_HOUR = 30;
  private static readonly OUTPUT_LIMIT = 8_000;

  constructor(
    @Inject(DB) private db: Db,
    private servers: ServersService,
    private docker: DockerService,
  ) {}

  /** Which manager this server uses, or null when the runtime has none. */
  managerForRuntime(runtime: string): PackageManager | null {
    return MANAGER_FOR_RUNTIME[runtime] ?? null;
  }

  private async requireRunningOwned(serverId: string, ownerId: string) {
    const row = await this.servers.requireOwned(ownerId, serverId);
    if (!row.containerId) throw new AppError('SERVER_NOT_READY', 409, 'This server has no container yet — start it first.');
    const state = await this.docker.inspect(row.containerId, row.nodeId).catch(() => null);
    if (!state?.running) throw new AppError('SERVER_NOT_RUNNING', 409, 'The server must be running to manage packages.');
    return row;
  }

  /**
   * The packages the platform can list, read from the server's real manifests.
   * A runtime with no manifest returns an empty list — nothing is invented.
   */
  async list(serverId: string, ownerId: string): Promise<{ manager: PackageManager | null; manifest: string | null; packages: PackageRow[] }> {
    const row = await this.servers.requireOwned(ownerId, serverId);
    const manager = this.managerForRuntime(row.runtime);
    const image = runtimeImage(row.runtime as Runtime);
    if (!manager || !row.containerId) return { manager, packages: [], manifest: null };
    const read = async (path: string) => {
      const res = await this.docker
        .runInContainer(row.containerId!, ['cat', path], { nodeId: row.nodeId, timeoutMs: 10_000 })
        .catch(() => null);
      return res && res.exitCode === 0 ? res.stdout : null;
    };

    if (manager === 'npm' || manager === 'bun') {
      const raw = await read(`${image.workdir}/package.json`);
      if (!raw) return { manager, packages: [], manifest: 'package.json' };
      try {
        const parsed = JSON.parse(raw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const merged = { ...parsed.dependencies, ...parsed.devDependencies };
        return {
          manager,
          manifest: 'package.json',
          packages: Object.entries(merged).map(([name, version]) => ({ name, version, source: 'manifest' as const })),
        };
      } catch {
        return { manager, packages: [], manifest: 'package.json' };
      }
    }
    if (manager === 'pip') {
      const raw = await read(`${image.workdir}/requirements.txt`);
      if (!raw) return { manager, packages: [], manifest: 'requirements.txt' };
      return {
        manager,
        manifest: 'requirements.txt',
        packages: raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => {
            const [name, ...rest] = l.split(/[<>=!~]/);
            return { name: name.trim(), version: rest.join('').trim() || null, source: 'manifest' as const };
          }),
      };
    }
    return { manager, packages: [], manifest: 'go.mod' };
  }

  /** Install one package into this server. */
  async install(serverId: string, ownerId: string, name: string, ip?: string): Promise<PackageOpResult> {
    const row = await this.requireRunningOwned(serverId, ownerId);
    const manager = this.managerForRuntime(row.runtime);
    if (!manager) {
      throw new AppError('PACKAGE_MANAGER_UNSUPPORTED', 400, `${row.runtime} has no package manager on this platform.`);
    }
    const pkg = name.trim();
    if (!isValidPackageName(manager, pkg)) {
      throw new AppError('PACKAGE_NAME_INVALID', 400, 'That is not a valid package name for this runtime.');
    }
    await this.assertBudget(serverId);
    const argv = installCommand(manager, pkg);
    const started = Date.now();
    const res = await this.docker.runInContainer(row.containerId!, argv, {
      nodeId: row.nodeId,
      timeoutMs: PACKAGE_OP_TIMEOUT_MS,
    });
    const out = this.shape(res, started);
    await this.record(serverId, ownerId, 'install', pkg, out, ip);
    return out;
  }

  /** Remove one package the manifest lists. */
  async uninstall(serverId: string, ownerId: string, name: string, ip?: string): Promise<PackageOpResult> {
    const row = await this.requireRunningOwned(serverId, ownerId);
    const manager = this.managerForRuntime(row.runtime);
    if (!manager) {
      throw new AppError('PACKAGE_MANAGER_UNSUPPORTED', 400, `${row.runtime} has no package manager on this platform.`);
    }
    const pkg = name.trim();
    if (!isValidPackageName(manager, pkg)) {
      throw new AppError('PACKAGE_NAME_INVALID', 400, 'That is not a valid package name for this runtime.');
    }
    const listed = await this.list(serverId, ownerId);
    const bare = basePackageName(manager, pkg);
    if (!listed.packages.some((p) => p.name.toLowerCase() === bare.toLowerCase())) {
      throw new AppError('PACKAGE_NOT_INSTALLED', 404, 'That package is not listed for this server.');
    }
    await this.assertBudget(serverId);
    const argv = uninstallCommand(manager, pkg);
    const started = Date.now();
    const res = await this.docker.runInContainer(row.containerId!, argv, {
      nodeId: row.nodeId,
      timeoutMs: PACKAGE_OP_TIMEOUT_MS,
    });
    const out = this.shape(res, started);
    await this.record(serverId, ownerId, 'uninstall', pkg, out, ip);
    return out;
  }

  private shape(res: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }, started: number): PackageOpResult {
    return {
      ok: res.exitCode === 0 && !res.timedOut,
      exitCode: res.exitCode,
      // bounded: output can be huge and is never stored anyway
      stdout: res.stdout.slice(-PackagesService.OUTPUT_LIMIT),
      stderr: res.stderr.slice(-PackagesService.OUTPUT_LIMIT),
      timedOut: res.timedOut,
      durationMs: Date.now() - started,
    };
  }

  /** Per-server budget (a runaway install loop must not be possible). */
  private async assertBudget(serverId: string) {
    const [row] = await this.db.execute(sql`
      select count(*)::int as n from audit_logs
      where target_id = ${serverId}
        and action in ('server.package.install', 'server.package.uninstall')
        and created_at > now() - interval '1 hour'
    `).then((r) => (r.rows as Array<{ n: number }>));
    const used = Number(row?.n ?? 0);
    if (used >= PackagesService.OPS_PER_HOUR) {
      throw new AppError('PACKAGE_OPS_RATE_LIMITED', 429, 'Too many package operations this hour on this server.');
    }
  }

  /** Audit the outcome only — never the command output, which may echo secrets. */
  private async record(
    serverId: string,
    actorId: string,
    action: 'install' | 'uninstall',
    pkg: string,
    result: PackageOpResult,
    ip?: string,
  ) {
    await this.db
      .insert(auditLogs)
      .values({
        actorId,
        action: `server.package.${action}`,
        targetType: 'server',
        targetId: serverId,
        ip: ip ?? null,
        meta: { ok: result.ok, exitCode: result.exitCode, durationMs: result.durationMs },
      })
      .catch(() => undefined);
    this.log.log(`server ${serverId}: ${action} ${pkg} ok=${result.ok} exit=${result.exitCode}`);
  }
}

