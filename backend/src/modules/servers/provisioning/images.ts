/**
 * Runtime image allowlist.
 *
 * A client can only ever run one of these images — never an arbitrary image
 * from the registry (that would be remote code execution on the host's Docker
 * daemon with root-equivalent pull rights).
 *
 * Images are pinned by DIGEST (`name@sha256:...`), never by mutable tag: a
 * republished tag (upstream rebuild, registry compromise) must not change
 * the bytes we execute — as root in helpers, as uid 1000 in sandboxes.
 *
 * Rotation runbook: `docker pull <tag>` → read `.RepoDigests[0]` →
 * replace the digest below → rebuild + full suite. Never accept a digest
 * over an insecure channel; verify against the upstream release notes.
 *
 * `user` is a numeric uid/gid: every sandbox runs as an unprivileged user
 * even if a future image drops its own non-root account.
 */
export type Runtime = 'Node.js' | 'Python' | 'Bun' | 'PHP';

/** One selectable version of a runtime (egg-style `docker_images` entry). */
export interface RuntimeVersion {
  /** stable selector, e.g. '20' — what the API accepts */
  version: string;
  /** human display label, e.g. 'Node.js 20' */
  label: string;
  /** pinned, allowlisted digest ref (see rotation runbook above) */
  image: string;
}

/** Egg-style startup variable (cf. Pterodactyl `variables[]`). */
export interface EggVariable {
  /** env key, e.g. MAIN_FILE */
  key: string;
  /** human name shown in the form */
  name: string;
  description: string;
  defaultValue: string;
  required: boolean;
}

export interface RuntimeImage {
  runtime: Runtime;
  /** pinned, allowlisted digest ref (see rotation runbook above) */
  image: string;
  /** human display label — digests must never reach the UI */
  label: string;
  /** selectable versions; [0] is the default */
  versions: RuntimeVersion[];
  /** egg-style variables, injected as env defaults and usable as {{KEY}} */
  variables: EggVariable[];
  /** uid:gid inside the container (never 0) */
  user: string;
  /** working directory = the client's persistent volume */
  workdir: string;
  port: number;
  /** baseline env for this runtime (client env is applied on top) */
  env: Record<string, string>;
  /** fallback startup when the client did not provide one */
  defaultStartup: string;
}

export const RUNTIME_IMAGES: Record<Runtime, RuntimeImage> = {
  'Node.js': {
    runtime: 'Node.js',
    image: 'node@sha256:bf77dc26e48ea95fca9d1aceb5acfa69d2e546b765ec2abfb502975f1a2d4def', // node:20.11-alpine
    label: 'Node.js 20.11',
    versions: [
      {
        version: '20',
        label: 'Node.js 20',
        image: 'node@sha256:bf77dc26e48ea95fca9d1aceb5acfa69d2e546b765ec2abfb502975f1a2d4def', // node:20.11-alpine
      },
      {
        version: '22',
        label: 'Node.js 22',
        image: 'node@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd', // node:22.12-alpine
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'index.js', required: true },
      { key: 'NODE_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to node.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 3000,
    env: {
      HOME: '/data',
      NODE_ENV: 'production',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_AUDIT: 'false',
    },
    defaultStartup: 'node {{MAIN_FILE}} {{NODE_ARGS}}',
  },
  Python: {
    runtime: 'Python',
    image: 'python@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e', // python:3.11-slim
    label: 'Python 3.11',
    versions: [
      {
        version: '3.11',
        label: 'Python 3.11',
        image: 'python@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e', // python:3.11-slim
      },
      {
        version: '3.12',
        label: 'Python 3.12',
        image: 'python@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f', // python:3.12-slim
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'main.py', required: true },
      { key: 'PY_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to python.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8000,
    env: {
      HOME: '/data',
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PIP_NO_CACHE_DIR: '1',
    },
    defaultStartup: 'python {{MAIN_FILE}} {{PY_ARGS}}',
  },
  Bun: {
    runtime: 'Bun',
    image: 'oven/bun@sha256:29cebde0efcd19be4b1e1592d73cd21ccba93c1448b1cec172584738d74b7b80', // oven/bun:1.2.4
    label: 'Bun 1.2',
    versions: [
      {
        version: '1.2',
        label: 'Bun 1.2',
        image: 'oven/bun@sha256:29cebde0efcd19be4b1e1592d73cd21ccba93c1448b1cec172584738d74b7b80', // oven/bun:1.2.4
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'index.js', required: true },
      { key: 'BUN_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to bun.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 3000,
    env: { HOME: '/data', NODE_ENV: 'production' },
    defaultStartup: 'bun run {{MAIN_FILE}} {{BUN_ARGS}}',
  },
  PHP: {
    runtime: 'PHP',
    image: 'php@sha256:f1ed6d1fd0aa769ab94ca307b9deaf55fbc18434315b70e319cd79078515cd2b', // php:8.3-cli
    label: 'PHP 8.3',
    versions: [
      {
        version: '8.3',
        label: 'PHP 8.3',
        image: 'php@sha256:f1ed6d1fd0aa769ab94ca307b9deaf55fbc18434315b70e319cd79078515cd2b', // php:8.3-cli
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'index.php', required: true },
      { key: 'PHP_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to php.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data' },
    defaultStartup: 'php {{MAIN_FILE}} {{PHP_ARGS}}',
  },
};

export const RUNTIMES = Object.keys(RUNTIME_IMAGES) as Runtime[];

export function runtimeImage(runtime: string): RuntimeImage {
  const img = RUNTIME_IMAGES[runtime as Runtime];
  if (!img) throw new Error(`unsupported runtime: ${runtime}`);
  return img;
}

/** Resolve a version selector to its pinned entry (default = versions[0]). */
export function resolveVersion(runtime: string, version?: string): RuntimeVersion {
  const img = runtimeImage(runtime);
  if (!version) return img.versions[0];
  const v = img.versions.find((x) => x.version === version);
  if (!v) throw new Error(`unsupported version: ${version} (allowed: ${img.versions.map((x) => x.version).join(', ')})`);
  return v;
}

/** Display label for a stored digest — never leaks the digest itself. */
export function labelFor(runtime: string, digest: string | null): string {
  const img = runtimeImage(runtime);
  return img.versions.find((v) => v.image === digest)?.label ?? img.label;
}

/** Merge egg variable defaults under explicit user env (user wins). */
export function resolveEggEnv(runtime: string, userEnv: { k: string; v: string }[]): { k: string; v: string }[] {
  const img = runtimeImage(runtime);
  const seen = new Set(userEnv.map((e) => e.k));
  const out = [...userEnv];
  for (const v of img.variables) {
    if (!seen.has(v.key)) out.push({ k: v.key, v: v.defaultValue });
  }
  return out;
}

const TEMPLATE_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/**
 * Substitute `{{VAR}}` placeholders in a startup command from the merged
 * env. Unknown variables fail fast (typos would otherwise boot silently
 * wrong). Values are shell-quoted when they contain unsafe characters.
 */
export function applyTemplate(startup: string, env: { k: string; v: string }[]): string {
  const map = new Map(env.map((e) => [e.k, e.v]));
  return startup.replace(TEMPLATE_RE, (m, key: string) => {
    if (!map.has(key)) throw new Error(`unknown startup variable: {{${key}}}`);
    const v = map.get(key)!;
    return /[^A-Za-z0-9_@%+=:,./-]/.test(v) ? `'${v.replace(/'/g, `'\\''`)}'` : v;
  });
}
