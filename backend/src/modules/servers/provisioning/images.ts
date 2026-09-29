/**
 * Runtime image allowlist.
 *
 * A client can only ever run one of these images — never an arbitrary image
 * from the registry (that would be remote code execution on the host's Docker
 * daemon with root-equivalent pull rights).
 *
 * `user` is a numeric uid/gid: every sandbox runs as an unprivileged user
 * even if a future image drops its own non-root account.
 */
export type Runtime = 'Node.js' | 'Python' | 'Bun' | 'PHP';

export interface RuntimeImage {
  runtime: Runtime;
  /** pinned, allowlisted tag */
  image: string;
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
    image: 'node:20.11-alpine',
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
    image: 'python:3.11-slim',
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
    image: 'oven/bun:1.2.4',
    user: '1000:1000',
    workdir: '/data',
    port: 3000,
    env: { HOME: '/data', NODE_ENV: 'production' },
    defaultStartup: 'bun run index.js',
  },
  PHP: {
    runtime: 'PHP',
    image: 'php:8.3-cli',
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
