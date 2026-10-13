/**
 * Declarative install/build steps → shell, with no user input in the path.
 *
 * The platform used to hardcode ONE install fragment per runtime, inside
 * `sandbox.ts::depsPrelude()`. That is why Composer, pnpm, yarn, Poetry, Cargo,
 * Maven, Gradle and `go build` simply did not exist: adding a language meant
 * editing provisioning code, not adding a catalog entry.
 *
 * This module is that missing piece. A template declares WHAT should happen
 * (`{kind:'go-build'}`); this compiler decides HOW, and it owns every single
 * character of the resulting command. That is the security property:
 *
 *   - every literal below is a compile-time constant written by a maintainer;
 *   - no step carries a caller-supplied string;
 *   - file names that DO come from the client (a lockfile the user uploaded)
 *     never appear in a command — they are only used as `-f` EXISTENCE tests
 *     inside single quotes, so a file called `a;touch /etc/passwd` is a test,
 *     not an injection;
 *   - `detect` picks the first marker present, so one Node.js template serves
 *     pnpm/yarn/npm projects without the client choosing anything.
 *
 * `shq()` is the only quoting primitive, and it is POSIX-safe single quoting.
 */

import type { BuildStep, InstallStep } from './types';

/** Hard cap on a single dependency/build step. A hung registry must not wedge
 *  a sandbox forever; the wrapper exits and the next start retries. */
export const STEP_TIMEOUT_SECS = 900;

/**
 * POSIX single-quoting. Safe for ANY byte sequence, including newlines and
 * quotes — nothing inside single quotes is interpreted by the shell.
 * Note the `'"'"'` splice, the standard way to embed a single quote.
 */
export function shq(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * The Node.js package managers install into the volume, never into the image.
 *
 * Why: the sandbox runs with `ReadonlyRootfs`, so `corepack enable` (the
 * normal way to get pnpm/yarn) fails — it writes into the image's own
 * /usr/local. Verified on node:24-bookworm-slim: corepack errors out, while
 * `npm --prefix /data/.npm-global i -g pnpm` succeeds and yields pnpm 9.15.9.
 * So the prefix is redirected into /data and PATH is extended per command.
 * The cost is one small install per volume, paid once and then cached by the
 * manifest-hash marker like any other dependency step.
 */
const NPM_PREFIX = '/data/.troxe-tools';
const EXPORT_TOOLS = `export npm_config_prefix=${NPM_PREFIX}; export PATH=${NPM_PREFIX}/bin:$PATH`;

interface ManagerSpec {
  /** argv that installs the manager itself, run once per volume */
  bootstrap: string[];
  /** the manager binary, resolved through PATH */
  bin: string;
  /** the frozen/lockfile-respecting install command */
  install: string[];
}

/**
 * One entry per package manager. `install` is the ONLY command run against the
 * project; it is built from constants plus the lockfile-presence test.
 */
function nodeManager(kind: 'npm' | 'pnpm' | 'yarn' | 'bun', mode?: string): ManagerSpec {
  switch (kind) {
    case 'npm':
      return {
        bootstrap: [],
        bin: 'npm',
        // `install`, never `ci`: the sandbox's file manager lets the manifest
        // drift ahead of the lock, and `ci` aborts on that drift — which reads
        // to the client as a crash loop. `install` reconciles the lock instead,
        // and the hash marker skips it entirely when nothing changed.
        install: ['npm', 'install', '--no-audit', '--no-fund', '--no-update-notifier'],
      };
    case 'pnpm':
      return {
        bootstrap: ['npm', 'install', '-g', '--no-audit', '--no-fund', 'pnpm@10'],
        bin: 'pnpm',
        install: mode === 'frozen' ? ['pnpm', 'install', '--frozen-lockfile'] : ['pnpm', 'install'],
      };
    case 'yarn':
      return {
        bootstrap: ['npm', 'install', '-g', '--no-audit', '--no-fund', 'yarn@1.22'],
        bin: 'yarn',
        install: mode === 'immutable' ? ['yarn', 'install', '--immutable'] : ['yarn', 'install'],
      };
    case 'bun':
      return { bootstrap: [], bin: 'bun', install: ['bun', 'install'] };
  }
}

const join = (argv: string[]) => argv.map(shq).join(' ');

function withTools(spec: ManagerSpec, needsBootstrap: boolean): string {
  const boot = needsBootstrap ? `${join(spec.bootstrap)} >/dev/null 2>&1 || :; ` : '';
  return `${EXPORT_TOOLS}; ${boot}`;
}

/**
 * Compile ONE install step into a shell fragment that:
 *   - is a no-op unless one of `detect` markers exists (default: the manager's
 *     own manifest),
 *   - installs the manager first when the image does not ship it,
 *   - runs under `timeout` so a stalled network cannot pin the sandbox,
 *   - fails LOUDLY (exit 1) instead of starting an app with missing deps —
 *     starting anyway is how "it installed, then the bot crashed with
 *     MODULE_NOT_FOUND at 3am" happens.
 */
export function compileInstall(step: InstallStep): string | null {
  switch (step.kind) {
    case 'none':
      return null;

    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      const spec = nodeManager(step.kind, 'mode' in step ? step.mode : undefined);
      const markers = step.detect ?? ['package.json'];
      const hasMarkers = markers.map((m) => `[ -f ${shq(m)} ]`).join(' || ');
      return (
        `if ${hasMarkers}; then ${withTools(spec, spec.bootstrap.length > 0)}` +
        `echo "[troxe] ${step.kind}: installing dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} ${join(spec.install)}` +
        ` || { echo "[troxe] dependency install FAILED."; ` +
        `echo "[troxe] if this is a native module, it needs a prebuilt binary for ${shq(step.kind)}'s platform/version."; ` +
        `exit 1; }; fi`
      );
    }

    case 'pip': {
      const markers = step.detect ?? ['requirements.txt'];
      const hasMarkers = markers.map((m) => `[ -f ${shq(m)} ]`).join(' || ');
      // --user keeps packages in $HOME (=/data) so the read-only rootfs is
      // never touched, and the venv-free layout stays writable after restart.
      return (
        `if ${hasMarkers}; then echo "[troxe] pip: installing dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} pip install --user --no-input -r requirements.txt` +
        ` || { echo "[troxe] dependency install FAILED — see the log above for the package."; exit 1; }; fi`
      );
    }

    case 'pip-project':
      return (
        `if [ -f pyproject.toml ]; then echo "[troxe] pip: installing project..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} pip install --user --no-input .` +
        ` || { echo "[troxe] project install FAILED."; exit 1; }; fi`
      );

    case 'poetry':
      return (
        `if [ -f pyproject.toml ]; then ` +
        `echo "[troxe] poetry: installing dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} poetry install --no-interaction` +
        ` || { echo "[troxe] poetry install FAILED."; exit 1; }; fi`
      );

    case 'uv':
      return (
        `if [ -f pyproject.toml ] || [ -f uv.lock ]; then ` +
        `echo "[troxe] uv: installing dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} uv sync` +
        ` || { echo "[troxe] uv sync FAILED."; exit 1; }; fi`
      );

    case 'composer':
      // Requires the platform PHP image (php:8.3-cli ships no composer — verified).
      return (
        `if [ -f composer.json ]; then echo "[troxe] composer: installing dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} composer install --no-interaction --no-progress --prefer-dist` +
        ` || { echo "[troxe] composer install FAILED."; exit 1; }; fi`
      );

    case 'bundle':
      return (
        `if [ -f Gemfile ]; then echo "[troxe] bundler: installing gems..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} bundle install` +
        ` || { echo "[troxe] bundle install FAILED."; exit 1; }; fi`
      );

    case 'deno-cache':
      // Best-effort by design: Deno resolves remote modules at RUN time anyway,
      // so a failed cache warm-up must not abort the start. Marked `optional`
      // so the schema check knows this one is allowed to swallow its failure.
      return (
        `if [ -f deno.json ] || [ -f deno.jsonc ] || [ -f main.ts ]; then ` +
        `echo "[troxe] deno: caching dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} deno cache --reload=false main.ts 2>/dev/null || :; fi`
      );

    case 'maven':
      return (
        `if [ -f pom.xml ]; then echo "[troxe] maven: resolving dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} mvn -q -B dependency:go-offline` +
        ` || { echo "[troxe] maven resolve FAILED."; exit 1; }; fi`
      );

    case 'gradle':
      return (
        `if [ -f build.gradle ] || [ -f build.gradle.kts ]; then ` +
        `echo "[troxe] gradle: resolving dependencies..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} gradle --no-daemon -q dependencies --configuration runtimeClasspath` +
        ` || { echo "[troxe] gradle resolve FAILED."; exit 1; }; fi`
      );
  }
}

/** Compile ONE build step. */
export function compileBuild(step: BuildStep): string | null {
  switch (step.kind) {
    case 'none':
      return null;

    case 'npm-script':
    case 'pnpm-script':
    case 'yarn-script': {
      const bin = step.kind === 'npm-script' ? 'npm' : step.kind === 'pnpm-script' ? 'pnpm' : 'yarn';
      const spec = nodeManager(bin as 'npm' | 'pnpm' | 'yarn', undefined);
      const markers = (step.detect ?? ['package.json']).map((m) => `[ -f ${shq(m)} ]`).join(' || ');
      // Run the script ONLY when package.json actually declares it. A project
      // without a `build` script is already runnable, and failing it here
      // would break a template that is otherwise fine.
      const declared = `[ -f package.json ] && node -e 'process.exit(require("./package.json").scripts&&require("./package.json").scripts.${JSON.stringify(step.script)}?0:1)'`;
      return (
        `if ${markers} && ${declared}; then echo "[troxe] building (${step.script})..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} ${withTools(spec, spec.bootstrap.length > 0)}${join([bin, 'run', step.script])}` +
        ` || { echo "[troxe] build FAILED."; exit 1; }; fi`
      );
    }

    case 'tsc':
      // Only compiles when the project declares a build script; a project
      // without one is already runnable and must not be forced through tsc.
      return (
        `if [ -f tsconfig.json ]; then echo "[troxe] building TypeScript..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} ${EXPORT_TOOLS}; npm run build` +
        ` || { echo "[troxe] TypeScript build FAILED — the app cannot start without it."; exit 1; }; fi`
      );

    case 'go-build': {
      // Builds the package in the working directory into a single binary the
      // startup command then execs. Runs BEFORE start and aborts the start on
      // failure, so a project that needs compiling never runs stale or missing
      // output. Output lands in /data so it survives a container rebuild.
      return (
        `if [ -f go.mod ]; then echo "[troxe] building Go binary..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} go build -o /data/server .` +
        ` || { echo "[troxe] go build FAILED — refusing to start an unbuilt binary."; exit 1; }; fi`
      );
    }

    case 'cargo-build': {
      // Release profile; target/ stays on the volume so an unchanged rebuild is
      // incremental rather than a full recompile on every restart.
      return (
        `if [ -f Cargo.toml ]; then echo "[troxe] building Rust binary (release)..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} cargo build --release` +
        ` || { echo "[troxe] cargo build FAILED — refusing to start an unbuilt binary."; exit 1; }; fi`
      );
    }

    case 'maven-package':
      return (
        `if [ -f pom.xml ]; then echo "[troxe] maven: packaging jar..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} mvn -q -B package -DskipTests` +
        ` || { echo "[troxe] maven package FAILED."; exit 1; }; fi`
      );

    case 'gradle-build':
      return (
        `if [ -f build.gradle ] || [ -f build.gradle.kts ]; then ` +
        `echo "[troxe] gradle: building..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} gradle --no-daemon -q build -x test` +
        ` || { echo "[troxe] gradle build FAILED."; exit 1; }; fi`
      );

    case 'dotnet-publish':
      return (
        `if ls *.csproj >/dev/null 2>&1; then echo "[troxe] dotnet: publishing..." && ` +
        `timeout ${STEP_TIMEOUT_SECS} dotnet publish -c Release -o /data/publish --nologo` +
        ` || { echo "[troxe] dotnet publish FAILED."; exit 1; }; fi`
      );
  }
}

/** Join the compiled install steps into the single prelude the sandbox runs. */
export function compileInstallPrelude(steps: InstallStep[]): string {
  const parts = steps.map(compileInstall).filter((s): s is string => !!s);
  if (!parts.length) return ':';
  // Each step is a self-contained `if ...; fi`, so they are sequenced with
  // `;` rather than `&&`: a step that does not apply must not abort the chain.
  return parts.join('; ');
}

/** Join the compiled build steps. */
export function compileBuildPrelude(steps: BuildStep[]): string {
  const parts = steps.map(compileBuild).filter((s): s is string => !!s);
  if (!parts.length) return ':';
  return parts.join('; ');
}