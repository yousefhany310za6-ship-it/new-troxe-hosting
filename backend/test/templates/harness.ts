/**
 * Level 3: Docker integration tests for the template catalog.
 *
 * THIS is what earns a template its `verified` status. Everything in
 * test/unit/ proves the catalog is internally consistent; nothing in it proves
 * a container actually boots. Only running the real lifecycle does:
 *
 *   1. prepare an isolated volume
 *   2. install  (real network, real package manager)
 *   3. build    (real compiler)
 *   4. start
 *   5. ASSERT something concrete — a bound port answering, a marker in the log
 *   6. collect logs
 *   7. stop / restart
 *   8. assert data survived
 *   9. clean up
 *
 * ISOLATION, and this is not optional:
 *   - names are prefixed `troxetpl-` and labelled, so nothing here can be
 *     mistaken for a customer container or be swept up by the reconciler;
 *   - NO `troxe.*` labels are ever set — the platform's own reconciler and
 *     destroy paths key off those, and a test container must stay invisible;
 *   - every test creates and destroys its own volume and container in `finally`,
 *     so a failed assertion cannot leave debris behind on a live node;
 *   - the suite is opt-in via TROXE_TEMPLATE_TESTS=1, because it pulls images
 *     and runs compilers, and must never fire by accident in CI or on a
 *     machine that is serving customers.
 */

import { execFileSync } from 'node:child_process';
import { compileBuildPrelude, compileInstallPrelude } from '../../src/modules/servers/templates/steps.ts';
import type { TemplateDefinition } from '../../src/modules/servers/templates/types.ts';

const ENABLED = process.env.TROXE_TEMPLATE_TESTS === '1';

function sh(cmd: string[]): string {
  return execFileSync('docker', cmd, { encoding: 'utf8', timeout: 900_000 });
}

function dockerAvailable(): boolean {
  try {
    sh(['info', '--format', '{{.ServerVersion}}']);
    return true;
  } catch {
    return false;
  }
}

/** Clean up anything a previous aborted run left behind. Never touches troxe.* */
export function cleanupStrayTestResources(): void {
  try {
    const ids = sh(['ps', '-aq', '--filter', 'name=troxetpl-']).trim();
    if (ids) execFileSync('docker', ['rm', '-f', ...ids.split('\n').filter(Boolean)], { encoding: 'utf8' });
  } catch { /* nothing to clean */ }
  try {
    const names = sh(['volume', 'ls', '-q', '--filter', 'name=troxetpl-']).trim();
    if (names) execFileSync('docker', ['volume', 'rm', ...names.split('\n').filter(Boolean)], { encoding: 'utf8' });
  } catch { /* nothing to clean */ }
}

export const dockerReady = ENABLED && dockerAvailable();

/** One prepared test volume, seeded with files, owned by uid 1000. */
export class TestSandbox {
  readonly name: string;
  private constructor(name: string) {
    this.name = name;
  }

  /**
   * Create the volume and seed it. Files are written as root (that is what the
   * platform's own upload path does) and then chowned to 1000, mirroring
   * `ownershipRepairScript` — a volume left root-owned would make every write
   * fail with EACCES and would test nothing real.
   */
  static async create(id: string, files: Record<string, string>, image: string): Promise<TestSandbox> {
    const name = `troxetpl-${id}-${Date.now().toString(36)}`;
    sh(['volume', 'create', name]);
    if (Object.keys(files).length) {
      // Write via a helper container rather than the host: the volume lives in
      // the daemon's storage, not in this process's filesystem.
      const script = Object.entries(files)
        .map(([path, content]) => `mkdir -p "/data/$(dirname '${path}')" 2>/dev/null || :; printf '%s' '${Buffer.from(content, 'utf8').toString('base64')}' | base64 -d > "/data/${path}"`)
        .join('\n');
      execFileSync('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${name}:/data`, image, '-c',
        `${script}\nchown -R 1000:1000 /data\nchmod 755 /data`], { encoding: 'utf8', timeout: 120_000 });
    } else {
      execFileSync('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${name}:/data`, image, '-c',
        'chown -R 1000:1000 /data; chmod 755 /data'], { encoding: 'utf8', timeout: 120_000 });
    }
    return new TestSandbox(name);
  }

  /**
   * Run a compiled command with the EXACT isolation the platform uses, per
   * `buildSandboxConfig`: non-root uid, read-only rootfs, all capabilities
   * dropped, no-new-privileges, PID/memory caps, and /tmp as a noexec tmpfs.
   *
   * If the template only works when these constraints are dropped, it does not
   * work on the platform — and this harness is what proves that either way.
   */
  runDetached(
    image: string,
    script: string,
    extraEnv: Record<string, string> = {},
    opts: { memoryMb?: number; pids?: number; port?: number } = {},
  ): string {
    const args = [
      'run', '-d',
      '--name', `troxetpl-c-${this.name}`,
      '--user', '1000:1000',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      '--tmpfs', '/run:rw,noexec,nosuid,size=16m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--pids-limit', String(opts.pids ?? 512),
      '--memory', `${opts.memoryMb ?? 2048}m`,
      '--memory-swap', `${opts.memoryMb ?? 2048}m`,
      '--network', 'bridge',
      '-w', '/data',
      '-e', 'HOME=/data',
      // The platform's buildEnv always sets PORT/HOST for the app. Without
      // them an app that reads PORT (every real web app) either binds NaN or a
      // random port, and the test would be measuring the harness, not the
      // template.
      '-e', 'HOST=0.0.0.0',
      '-v', `${this.name}:/data`,
    ];
    if (extraEnv.PORT === undefined && opts.port !== undefined) args.push('-e', `PORT=${opts.port}`);
    for (const [k, v] of Object.entries(extraEnv)) args.push('-e', `${k}=${v}`);
    args.push(image, '/bin/sh', '-c', script);
    return sh(args).trim();
  }

  logs(): string {
    try {
      return sh(['logs', `troxetpl-c-${this.name}`]);
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? '');
    }
  }

  isRunning(): boolean {
    try {
      return sh(['inspect', '-f', '{{.State.Running}}', `troxetpl-c-${this.name}`]).trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Stop AND remove. `stop` alone leaves the name occupied, so the next
   * `runDetached` fails with a name conflict — which is why `stop()` is not the
   * primitive for "restart this test server": a restart means a fresh container
   * from the same volume, exactly as the platform's rebuild does.
   */
  stop(): void {
    try {
      execFileSync('docker', ['rm', '-f', `troxetpl-c-${this.name}`], { encoding: 'utf8', timeout: 60_000 });
    } catch { /* already gone */ }
  }

  /** Read a file back off the volume — proves state persisted across restarts. */
  read(path: string, image: string): string {
    return execFileSync('docker', ['run', '--rm', '--entrypoint', 'cat', '-v', `${this.name}:/data`, image, `/data/${path}`],
      { encoding: 'utf8', timeout: 120_000 });
  }

  exists(path: string, image: string): boolean {
    try {
      // `-e`, not `-f`: node_modules/express, vendor/ and target/ are
      // DIRECTORIES, and `test -f` on a directory is false — which made a
      // successful install look like a missing one.
      execFileSync('docker', ['run', '--rm', '--entrypoint', 'test', '-v', `${this.name}:/data`, image, '-e', `/data/${path}`],
        { encoding: 'utf8', timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }

  destroy(): void {
    this.stop();
    try { execFileSync('docker', ['rm', '-f', `troxetpl-c-${this.name}`], { encoding: 'utf8', timeout: 60_000 }); } catch { /* gone */ }
    try { execFileSync('docker', ['volume', 'rm', '-f', this.name], { encoding: 'utf8', timeout: 60_000 }); } catch { /* gone */ }
  }
}

/**
 * The container command for a template, built from the SAME compiler the
 * platform uses. If this ever drifts from `buildSandboxConfig`, the tests stop
 * testing production — so it is composed here from the catalog definition
 * rather than hand-written per test.
 */
export function commandForTemplate(
  t: Pick<TemplateDefinition, 'install' | 'build' | 'startup'>,
  resolve: (startup: string) => string,
): string {
  return `${compileInstallPrelude(t.install)}; ${compileBuildPrelude(t.build)}; ${resolve(t.startup)}`;
}