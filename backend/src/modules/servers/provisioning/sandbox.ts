import type { ContainerCreateOptions, HostConfig } from 'dockerode';
import type { EnvVar } from '../../../db/schema';
import type { Runtime, RuntimeImage } from './images';

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
}

const TROXE_LABELS = (serverId: string, ownerId: string) => ({
  'troxe.managed': 'true',
  'troxe.server-id': serverId,
  'troxe.owner-id': ownerId,
  'troxe.created-at': String(Math.floor(Date.now() / 1000)),
});

/**
 * Compose the client environment: runtime baseline first, then the client's
 * own variables (they win). Values never touch a shell — they are passed as a
 * plain env array to the container process.
 */
export function buildEnv(spec: SandboxSpec): string[] {
  const merged = new Map<string, string>();
  for (const [k, v] of Object.entries(spec.image.env)) merged.set(k, v);
  // the client's own code/config lives on the persistent volume
  merged.set('PORT', String(spec.image.port));
  merged.set('HOST', '0.0.0.0');
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
  const install =
    pkgMgr === 'npm'
      ? `timeout ${INSTALL_TIMEOUT_SECS} npm install --no-audit --no-fund --no-update-notifier`
      : `timeout ${INSTALL_TIMEOUT_SECS} bun install`;
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

/** Shell prefix for the sandbox command, including the trailing `&& ` (or empty). */
export function depsPrelude(runtime: Runtime): string {
  switch (runtime) {
    case 'Node.js':
      return `${jsPrelude('npm')} && `;
    case 'Bun':
      return `${jsPrelude('bun')} && `;
    case 'Python':
      return `${pyPrelude()} && `;
    case 'PHP':
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

    // --- networking: private bridge, nothing published --------------------
    PortBindings: {},
    ExtraHosts: [],
    Dns: [],

    // --- housekeeping -----------------------------------------------------
    AutoRemove: false,
    LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3', 'compress': 'true' } },
    // MaximumRetryCount is only valid with the "on-failure" policy.
    // on-failure (not unless-stopped): a crashing startup must NOT loop
    // forever — after 5 retries the container stays exited so the API can
    // report a clear error instead of flapping online/offline.
    RestartPolicy: spec.autoRestart ? { Name: 'on-failure', MaximumRetryCount: 5 } : { Name: 'no' },
    // CgroupnsMode is supported by the engine but missing from @types/dockerode
  } as HostConfig;
  return {
    name: containerName,
    Image: spec.image.image,
    Hostname: `srv-${spec.serverId.slice(0, 8)}`,
    // startup is a single argv element — never interpolated into a host shell.
    // A dependency prelude (same sandbox user, fixed commands, no client
    // input) installs package.json/requirements.txt first when the manifest
    // changed; unchanged restarts skip it via the .troxe-deps-<hash> marker.
    Cmd: ['/bin/sh', '-c', depsPrelude(spec.image.runtime) + spec.startup],
    Entrypoint: [],
    User: spec.image.user,
    WorkingDir: spec.image.workdir,
    Env: buildEnv(spec),
    Labels: labels,
    ExposedPorts: { [`${spec.image.port}/tcp`]: {} },
    StopSignal: 'SIGTERM',
    StopTimeout: 30,
    HostConfig: hostConfig,
    NetworkingConfig: {
      EndpointsConfig: { [spec.networkName]: { IPAMConfig: {} } },
    },
  };
}
