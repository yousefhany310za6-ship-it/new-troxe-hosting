import type { ContainerCreateOptions, HostConfig } from 'dockerode';
import type { EnvVar } from '../../../db/schema';
import type { Runtime, RuntimeImage } from './images';
import { compileBuildPrelude, compileInstallPrelude } from '../templates/steps';
import type { TemplateDefinition } from '../templates/types';

/** Deterministic, globally unique docker resource names for one server. */
export function resourceNames(serverId: string) {
  const hex = serverId.replace(/-/g, '');
  return {
    containerName: `srv_${hex}`,
    networkName: `net_${hex}`,
    volumeName: `vol_${hex}`,
  };
}

export interface SandboxSpec {
  serverId: string;
  ownerId: string;
  image: RuntimeImage;
  startup: string;
  env: EnvVar[];
  cpuMilli: number;
  ramMb: number;
  networkName: string;
  volumeName: string;
  autoRestart: boolean;
  pidsLimit: number;
  /** host ports already allocated by PortsService (published on the host) */
  ports?: Array<{ port: number; protocol: string; containerPort: number }>;
  /**
   * The template driving this sandbox. It supplies the install and build steps
   * that a hardcoded per-runtime prelude could never express: a template may
   * install with pnpm, Yarn, Composer, Poetry or Bundler, and may compile Go,
   * Rust, Maven, Gradle or .NET.
   *
   * Optional because a server created before templates existed has no template
   * row — it keeps the legacy per-runtime behaviour unchanged.
   */
  template?: TemplateDefinition;
}

const TROXE_LABELS = (serverId: string, ownerId: string) => ({
  'troxe.managed': 'true',
  'troxe.server-id': serverId,
  'troxe.owner-id': ownerId,
  'troxe.created-at': String(Math.floor(Date.now() / 1000)),
});

/**
 * The container ports this sandbox exposes.
 *
 * Driven by the template's port plan, so a bot publishes nothing and a game or
 * web app publishes the one port it declares. Legacy rows without a template
 * fall back to their runtime's single port, which is exactly how they behaved
 * before templates existed.
 */
export function exposedPorts(spec: SandboxSpec): Record<string, Record<string, never>> {
  const out: Record<string, Record<string, never>> = {};
  if (spec.template) {
    for (const p of spec.template.ports) out[`${p.containerPort}/${p.protocol}`] = {};
    // A template that declares no port still needs its runtime's default
    // exported for env, but exposes nothing — that is what makes a bot
    // unreachable from the network.
    return out;
  }
  out[`${spec.image.port}/tcp`] = {};
  return out;
}

/**
 * The container port an app should bind, i.e. the value of $PORT.
 *
 * The template wins when it declares one, so a Flask app on 8000 or a Go
 * service on 8080 each advertise the right thing instead of inheriting
 * whatever their runtime happened to use. Templates with no port (bots and
 * workers) fall back to the runtime default so $PORT is still defined.
 */
export function primaryContainerPort(spec: SandboxSpec): number {
  const declared = spec.template?.ports[0];
  return declared?.containerPort ?? spec.image.port;
}

/**
 * Compose the client environment: runtime baseline first, then the client's
 * own variables (they win). Values never touch a shell — they are passed as a
 * plain env array to the container process.
 */
export function buildEnv(spec: SandboxSpec): string[] {
  const merged = new Map<string, string>();
  for (const [k, v] of Object.entries(spec.image.env)) merged.set(k, v);
  // the client's own code/config lives on the persistent volume
  merged.set('PORT', String(primaryContainerPort(spec)));
  merged.set('HOST', '0.0.0.0');
  // The PUBLIC port clients use, for display only (invite links, status pages,
  // "connect to host:port" banners). Apps must still BIND the container port
  // (PORT, e.g. 3000) — the platform maps it to the host port automatically.
  // Binding SERVER_PORT inside the container is the classic mistake: that
  // number does not exist in the sandbox network and the app only hangs.
  // A user-set SERVER_PORT wins (explicit beats derived); absent when the
  // server has no allocation yet.
  const published = spec.ports?.find((pt) => pt.protocol === 'tcp');
  if (published) merged.set('SERVER_PORT', String(published.port));
  for (const { k, v } of spec.env) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) merged.set(k, v);
  }
  return [...merged].map(([k, v]) => `${k}=${v}`);
}

/**
 * Dependency auto-install prelude, prepended to the client's startup command.
 *
 * Problem it fixes: a client uploads `package.json` / `requirements.txt`
 * (without vendored deps) and the sandbox runs the main file straight away,
 * dying with MODULE_NOT_FOUND. The prelude installs first — on EVERY start
 * path (create, restart, repair) since it lives inside the container command
 * itself, not in a provision step that restarts skip.
 *
 * Cost control: the install runs only when the manifest's sha256 has no
 * matching `.troxe-deps-<hash>` marker, so unchanged restarts pay one `[ -f ]`
 * test. The marker is written only on success, so a failed install retries
 * on the next start instead of being cached as done.
 *
 * Containment: same unprivileged uid, same read-only rootfs, same network
 * policy as the startup itself; the commands below are fixed strings (no
 * client input is interpolated); a 10-minute `timeout` bounds a hung
 * registry; install output streams to the container logs. PHP has no
 * prelude — php:8.3-cli ships no composer, so PHP clients upload `vendor/`.
 */
const INSTALL_TIMEOUT_SECS = 600;

function jsPrelude(pkgMgr: 'npm' | 'bun'): string {
  // NOTE: deliberately `npm install`, never `npm ci` — even when a lockfile
  // exists. The manifest is edited by hand in the file manager, so it
  // routinely drifts ahead of the lock; `ci` aborts on that drift ("lock
  // and package.json are out of sync") and the sandbox would crash-loop.
  // `install` reconciles the lock instead, and the marker still skips it
  // entirely when nothing changed.
  // On failure the user gets the reason, not just the node-gyp wall: this
  // runtime ships glibc PREBUILT binaries for native addons, but it has no
  // C/Python toolchain, so a package that must be compiled still fails.
  const hint =
    ` || { echo "[troxe] dependency install FAILED."; ` +
    `echo "[troxe] native modules are used from their prebuilt binaries; this dependency has none for this Node version."; ` +
    `echo "[troxe] check the log above for the package name, then use a newer version that ships prebuilt binaries."; exit 1; }`;
  const install =
    pkgMgr === 'npm'
      ? `timeout ${INSTALL_TIMEOUT_SECS} npm install --no-audit --no-fund --no-update-notifier${hint}`
      : `timeout ${INSTALL_TIMEOUT_SECS} bun install${hint}`;
  return (
    `if [ -f package.json ]; then h=$(sha256sum package.json | cut -d' ' -f1); ` +
    `if [ ! -f ".troxe-deps-$h" ]; then echo "[troxe] package.json changed, installing dependencies..." && ` +
    `${install} && rm -f .troxe-deps-* && touch ".troxe-deps-$h"; fi; fi`
  );
}

function pyPrelude(): string {
  return (
    `if [ -f requirements.txt ]; then h=$(sha256sum requirements.txt | cut -d' ' -f1); ` +
    `if [ ! -f ".troxe-deps-$h" ]; then echo "[troxe] requirements.txt changed, installing dependencies..." && ` +
    `timeout ${INSTALL_TIMEOUT_SECS} pip install --user -r requirements.txt && rm -f .troxe-deps-* && touch ".troxe-deps-$h"; fi; fi`
  );
}

/**
 * Map the server's allocated host ports onto the container port. Only ports
 * already claimed by PortsService may appear here — the sandbox never chooses
 * a port itself, so two servers cannot be handed the same one.
 */
export function portBindings(ports: Array<{ port: number; protocol: string; containerPort: number }>): Record<string, Array<{ HostPort: string }>> {
  const out: Record<string, Array<{ HostPort: string }>> = {};
  for (const p of ports) {
    const key = `${p.containerPort}/${p.protocol}`;
    out[key] = [{ HostPort: String(p.port) }];
  }
  return out;
}

/**
 * Shell prefix for the sandbox command, including the trailing `&& ` (or empty).
 *
 * DEPRECATED as an install mechanism: this hardcodes ONE dependency strategy
 * per runtime, which is exactly why Composer, pnpm, Yarn, Poetry, Cargo,
 * Maven, Gradle and `go build` never existed. It survives only so that server
 * rows created before templates existed keep booting exactly as they did; any
 * server on a template gets its steps from the template instead.
 *
 * `npm install`, never `npm ci`: the file manager lets the manifest drift ahead
 * of the lock, and `ci` aborts on that drift ("lock and package.json are out of
 * sync") which reads to the client as a crash loop.
 */
export function depsPrelude(runtime: Runtime): string {
  switch (runtime) {
    case 'Node.js':
      return `${jsPrelude('npm')} && `;
    case 'Bun':
      return `${jsPrelude('bun')} && `;
    case 'Python':
      return `${pyPrelude()} && `;
    default:
      // PHP, Go, Rust, Java, Ruby, .NET and Deno either get their install and
      // build steps from a template, or have no dependency step at all.
      return '';
  }
}

/**
 * The isolation policy for one client sandbox.
 *
 * Threat model: a hostile client controls `startup` and the contents of
 * `/data`. Inside the container they are effectively "root of their own
 * processes" — but they must not be able to:
 *   • escape to the host (no privileged, no caps, no-new-privileges, ro rootfs,
 *     no docker.sock, no device access, non-root uid)
 *   • exhaust the machine (cpu / memory / pids / fd limits, capped logs)
 *   • reach other clients (dedicated per-server user-defined network — Docker
 *     blocks inter-network traffic by default)
 *   • reach the host or private networks / cloud metadata (iptables rules in
 *     DOCKER-USER, see NetworkHardeningService)
 *   • persist into system paths (read-only rootfs, only /data is writable)
 */
export function buildSandboxConfig(spec: SandboxSpec): ContainerCreateOptions {
  const { containerName } = resourceNames(spec.serverId);
  const memoryBytes = Math.max(spec.ramMb, 64) * 1024 * 1024;
  const labels = TROXE_LABELS(spec.serverId, spec.ownerId);

  const hostConfig = {
    // the ONLY writable persistent path — owned by the client
    Binds: [`${spec.volumeName}:/data:rw`],
    NetworkMode: spec.networkName,
    ReadonlyRootfs: true,
    // host ports allocated for this server (PortsService); an empty map keeps
    // the sandbox internal, exactly as before.
    ...(spec.ports?.length ? { PortBindings: portBindings(spec.ports) } : { PortBindings: {} }),
    PublishAllPorts: false,
    Tmpfs: {
      '/tmp': 'rw,noexec,nosuid,size=64m,mode=1777',
      '/run': 'rw,noexec,nosuid,size=16m,mode=755',
    },

    // --- privilege containment -------------------------------------------
    Privileged: false,
    CapDrop: ['ALL'],
    CapAdd: [],
    SecurityOpt: ['no-new-privileges:true'],
    Devices: [],
    DeviceRequests: [],
    IpcMode: 'private',
    CgroupnsMode: 'private',
    // PidMode intentionally left unset → private PID namespace

    // --- resource limits (plan quota, enforced by the kernel) -------------
    NanoCpus: Math.max(spec.cpuMilli, 50) * 1_000_000,
    CpuShares: Math.max(64, Math.round(spec.cpuMilli / 2)),
    Memory: memoryBytes,
    MemorySwap: memoryBytes, // no swap headroom → no memory DoS
    MemoryReservation: Math.round(memoryBytes * 0.5),
    PidsLimit: spec.pidsLimit,
    ShmSize: 32 * 1024 * 1024,
    Ulimits: [
      { Name: 'nofile', Soft: 1024, Hard: 2048 },
      { Name: 'nproc', Soft: 256, Hard: 512 },
    ],

    // --- networking: private bridge by default; published ports are added
    // by the caller through spec.ports (see buildSandboxConfig).
    ExtraHosts: [],
    Dns: [],

    // --- housekeeping -----------------------------------------------------
    AutoRemove: false,
    LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3', 'compress': 'true' } },
    // Use "no" restart policy — we handle crashes at the API level (settled/failStart).
    // The container command wraps the user's startup so the container STAYS ALIVE
    // even after the process crashes. This keeps the exec shell connected so the
    // user can see the crash output in the console.
    RestartPolicy: { Name: 'no' },
    // CgroupnsMode is supported by the engine but missing from @types/dockerode
  } as HostConfig;

  // The install/build prelude for this sandbox.
  //
  // A template's own steps win: that is how Composer, pnpm, Yarn, Poetry,
  // Bundler, `go build`, `cargo build`, Maven, Gradle and `dotnet publish`
  // exist at all. Without a template (a server row created before templates
  // existed) the legacy per-runtime prelude applies, unchanged, so those
  // servers keep behaving exactly as they did.
  //
  // Order matters and is fixed: INSTALL → BUILD → START. A failed install or
  // build `exit 1`s inside its own step, so the app is never started against a
  // half-installed tree or a stale binary.
  const prelude = spec.template
    ? `${compileInstallPrelude(spec.template.install)}; ${compileBuildPrelude(spec.template.build)}`
    : depsPrelude(spec.image.runtime);

/**
 * Strip trailing shell operators from a prelude so exactly one `; ` can be
 * added when it is joined to the startup command.
 *
 * TWO ways this glue has broken, both producing a container that dies before
 * the client's code ever runs:
 *
 *  1. NO separator at all. A compiled build step ends in the `fi` that closes
 *     its conditional, so `prelude + startup` produced `finode index.js`.
 *
 *  2. A DANGLING `&&`. The legacy per-runtime `depsPrelude` appends `&& ` (it
 *     was designed to be concatenated directly), so joining it with a leading
 *     `; ` produced `fi &&; node index.js`. The Debian `/bin/sh` is dash, and
 *     dash reports exactly `Syntax error: ";" unexpected` — the error a user
 *     saw on a live server. Every pre-template server took this path, so this
 *     was not a corner case for new templates but the whole legacy fleet.
 *
 * So trailing whitespace, `;` and `&&` are all removed first, and the caller
 * re-adds a single `; `. `fi; cmd` and `:; cmd` are valid POSIX sh.
 */
function normalizePrelude(prelude: string): string {
  return prelude.replace(/[ \t]*&&[ \t]*$|[ \t]*;[ \t]*$|[ \t]+$/, '');
}

  // The prelude and the startup command are two separate shell fragments glued
  // into one script, so they MUST be separated. See `normalizePrelude` for the
  // two ways that glue has broken: a missing separator (`finode index.js`) and
  // a dangling `&&` from the legacy prelude (`fi &&; node index.js`, which
  // dash rejects with `Syntax error: ";" unexpected`).
  const script = `${normalizePrelude(prelude)}; ${spec.startup}`;

  // Wrap the startup command so the container STAYS RUNNING after the process
  // exits (crashes or clean). This keeps the exec shell connected so the user
  // can see the crash output, type commands, inspect files, etc.
  const wrappedStartup = `
${script}
EXIT_CODE=$?
echo
echo "[troxe] Process exited with code $EXIT_CODE"
echo "[troxe] Container kept alive for debugging. Connect via console to inspect."
# Keep container alive without requiring stdin/TTY
exec tail -f /dev/null
`;
  return {
    name: containerName,
    Image: spec.image.image,
    Hostname: `srv-${spec.serverId.slice(0, 8)}`,
    Cmd: ['/bin/sh', '-c', wrappedStartup],
    Entrypoint: [],
    User: spec.image.user,
    WorkingDir: spec.image.workdir,
    Env: buildEnv(spec),
    Labels: labels,
    // Expose exactly the container ports this workload declares. A bot template
    // declares none and stays unreachable from outside, which is the point; a
    // template with a TCP port exposes it so Docker may publish it. The
    // runtime's legacy `image.port` remains the fallback for template-less rows.
    ExposedPorts: exposedPorts(spec),
    StopSignal: 'SIGTERM',
    StopTimeout: 30,
    HostConfig: hostConfig,
    NetworkingConfig: {
      EndpointsConfig: { [spec.networkName]: { IPAMConfig: {} } },
    },
  };
}