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

export interface RuntimeImage {
  runtime: Runtime;
  /** pinned, allowlisted digest ref (see rotation runbook above) */
  image: string;
  /** human display label — digests must never reach the UI */
  label: string;
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
    defaultStartup: 'node index.js',
  },
  Python: {
    runtime: 'Python',
    image: 'python@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e', // python:3.11-slim
    label: 'Python 3.11',
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
    defaultStartup: 'python main.py',
  },
  Bun: {
    runtime: 'Bun',
    image: 'oven/bun@sha256:29cebde0efcd19be4b1e1592d73cd21ccba93c1448b1cec172584738d74b7b80', // oven/bun:1.2.4
    label: 'Bun 1.2',
    user: '1000:1000',
    workdir: '/data',
    port: 3000,
    env: { HOME: '/data', NODE_ENV: 'production' },
    defaultStartup: 'bun run index.js',
  },
  PHP: {
    runtime: 'PHP',
    image: 'php@sha256:f1ed6d1fd0aa769ab94ca307b9deaf55fbc18434315b70e319cd79078515cd2b', // php:8.3-cli
    label: 'PHP 8.3',
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data' },
    defaultStartup: 'php index.php',
  },
};

export const RUNTIMES = Object.keys(RUNTIME_IMAGES) as Runtime[];

export function runtimeImage(runtime: string): RuntimeImage {
  const img = RUNTIME_IMAGES[runtime as Runtime];
  if (!img) throw new Error(`unsupported runtime: ${runtime}`);
  return img;
}
