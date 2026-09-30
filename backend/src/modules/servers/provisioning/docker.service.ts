import { Injectable, Logger } from '@nestjs/common';
import Dockerode, { Container, ContainerCreateOptions } from 'dockerode';
import { config } from '../../../config/env';
import { AppError, Err } from '../../../common/errors';

export interface HelperResult {
  code: number;
  out: string;
}

export interface ContainerState {
  exists: boolean;
  status: string;
  running: boolean;
  exitCode: number;
  oomKilled: boolean;
  error: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}

const isStatus = (e: unknown, code: number) => (e as { statusCode?: number })?.statusCode === code;

/** Docker frames logs as `type(1) | zero(3) | len(4 BE) | payload`. */
function decodeDockerLogs(buf: Buffer): string {
  const chunks: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + len;
    if (end > buf.length) break;
    chunks.push(buf.subarray(start, end).toString('utf8'));
    offset = end;
  }
  return chunks.length ? chunks.join('') : buf.toString('utf8');
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Thin, defensive wrapper around the Docker daemon.
 *
 * Every method is timeout-guarded and typed; a missing daemon degrades the
 * API to "record-only" mode in development and refuses provisioning in
 * production (see ProvisionerService).
 */
@Injectable()
export class DockerService {
  private readonly log = new Logger(DockerService.name);
  private docker: Dockerode | null = null;
  private unavailabilityLogged = false;

  constructor() {
    if (!config.DOCKER_ENABLED) {
      this.log.warn('Docker integration disabled by DOCKER_ENABLED=false');
      return;
    }
    try {
      this.docker = new Dockerode({ socketPath: config.DOCKER_SOCKET });
    } catch (e) {
      this.log.warn(`dockerode init failed: ${(e as Error).message}`);
    }
  }

  get available(): boolean {
    return this.docker !== null;
  }

  private d(): Dockerode {
    if (!this.docker) {
      if (!this.unavailabilityLogged) {
        this.unavailabilityLogged = true;
        this.log.warn('Docker daemon not reachable — running in record-only mode');
      }
      throw Err.unavailable('DOCKER_UNAVAILABLE', 'Container runtime is not available');
    }
    return this.docker;
  }

  // ---- lifecycle ------------------------------------------------------------

  async ping(timeoutMs = 3000): Promise<boolean> {
    if (!this.docker) return false;
    try {
      await withTimeout(this.docker.info(), timeoutMs, 'docker info');
      return true;
    } catch {
      return false;
    }
  }

  async ensureImage(image: string, timeoutMs = 300_000): Promise<void> {
    const d = this.d();
    try {
      await withTimeout(d.getImage(image).inspect(), 10_000, `inspect ${image}`);
      return;
    } catch {
      this.log.log(`pulling ${image} …`);
    }
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      d.pull(image, {}, (err, s) => (err ? reject(err) : resolve(s as NodeJS.ReadableStream)));
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        err ? reject(err) : resolve();
      };
      const timer = setTimeout(() => done(new Error(`pull ${image} timed out`)), timeoutMs);
      stream.on('data', (chunk: Buffer) => {
        try {
          const msg = JSON.parse(chunk.toString());
          if (msg.error) done(new Error(msg.error));
        } catch {
          /* progress noise */
        }
      });
      stream.on('end', () => done());
      stream.on('error', (e: Error) => done(e));
    });
    this.log.log(`image ready: ${image}`);
  }

  async createNetwork(name: string, labels: Record<string, string>): Promise<{ id: string; subnet: string }> {
    const d = this.d();
    const network = await withTimeout(
      d.createNetwork({ Name: name, Driver: 'bridge', Attachable: false, EnableIPv6: false, Internal: false, Labels: labels }),
      15_000,
      `create network ${name}`,
    );
    let subnet = '';
    try {
      const info: any = await withTimeout(network.inspect(), 10_000, 'network inspect');
      subnet = info?.IPAM?.Config?.[0]?.Subnet ?? '';
    } catch {
      /* subnet unknown → hardening skipped, logged by caller */
    }
    return { id: network.id ?? String(network), subnet };
  }

  async removeNetwork(idOrName: string): Promise<void> {
    if (!this.docker) return;
    try {
      await withTimeout(this.docker.getNetwork(idOrName).remove(), 15_000, 'network remove');
    } catch (e) {
      if (!isStatus(e, 404)) throw e;
    }
  }

  async createVolume(name: string, labels: Record<string, string>): Promise<void> {
    await withTimeout(this.d().createVolume({ Name: name, Labels: labels, Driver: 'local' }), 15_000, `create volume ${name}`);
  }

  async removeVolume(name: string): Promise<void> {
    if (!this.docker) return;
    try {
      await withTimeout(this.docker.getVolume(name).remove({ force: true }), 15_000, 'volume remove');
    } catch (e) {
      // 409 = still in use by a stopped helper/child → treat as gone later
      if (!isStatus(e, 404) && !isStatus(e, 409)) throw e;
    }
  }

  /** Returns the network id + subnet when it already exists, else null. */
  async networkInfo(name: string): Promise<{ id: string; subnet: string } | null> {
    if (!this.docker) return null;
    try {
      const info: any = await withTimeout(this.docker.getNetwork(name).inspect(), 10_000, 'network inspect');
      return { id: info?.Id ?? name, subnet: info?.IPAM?.Config?.[0]?.Subnet ?? '' };
    } catch (e) {
      if (isStatus(e, 404)) return null;
      throw e;
    }
  }

  async volumeExists(name: string): Promise<boolean> {
    if (!this.docker) return false;
    try {
      await withTimeout(this.docker.getVolume(name).inspect(), 10_000, 'volume inspect');
      return true;
    } catch (e) {
      if (isStatus(e, 404)) return false;
      throw e;
    }
  }

  async createContainer(opts: ContainerCreateOptions): Promise<string> {
    const container = await withTimeout(this.d().createContainer(opts), 60_000, 'create container');
    return container.id;
  }

  async start(id: string): Promise<void> {
    await withTimeout(this.d().getContainer(id).start(), 30_000, 'container start');
  }

  async stop(id: string, timeoutSec = 15): Promise<void> {
    try {
      await withTimeout(this.d().getContainer(id).stop({ t: timeoutSec }), timeoutSec * 1000 + 15_000, 'container stop');
    } catch (e) {
      if (!isStatus(e, 304) && !isStatus(e, 404)) throw e; // already stopped
    }
  }

  async restart(id: string, timeoutSec = 10): Promise<void> {
    await withTimeout(this.d().getContainer(id).restart({ t: timeoutSec }), timeoutSec * 1000 + 15_000, 'container restart');
  }

  async remove(id: string, force = true): Promise<void> {
    if (!this.docker) return;
    try {
      await withTimeout(this.d().getContainer(id).remove({ force, v: false }), 30_000, 'container remove');
    } catch (e) {
      if (!isStatus(e, 404)) throw e;
    }
  }

  async removeByName(name: string): Promise<void> {
    if (!this.docker) return;
    try {
      await withTimeout(this.d().getContainer(name).remove({ force: true, v: false }), 30_000, 'container remove');
    } catch (e) {
      if (!isStatus(e, 404)) throw e;
    }
  }

  // ---- observation ----------------------------------------------------------

  async inspect(id: string): Promise<ContainerState | null> {
    if (!this.docker) return null;
    try {
      const info: any = await withTimeout(this.d().getContainer(id).inspect(), 10_000, 'container inspect');
      const state = info?.State ?? {};
      return {
        exists: true,
        status: state.Status ?? 'unknown',
        running: !!state.Running,
        exitCode: state.ExitCode ?? 0,
        oomKilled: !!state.OOMKilled,
        error: state.Error ?? '',
      };
    } catch (e) {
      if (isStatus(e, 404)) return null;
      throw e;
    }
  }

  async stats(id: string): Promise<ContainerStats | null> {
    if (!this.docker) return null;
    try {
      const s: any = await withTimeout(this.d().getContainer(id).stats({ stream: false }), 10_000, 'container stats');
      const cpuDelta = (s?.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s?.precpu_stats?.cpu_usage?.total_usage ?? 0);
      const sysDelta = (s?.cpu_stats?.system_cpu_usage ?? 0) - (s?.precpu_stats?.system_cpu_usage ?? 0);
      const cpus = s?.cpu_stats?.online_cpus ?? 1;
      const cpuPercent = sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * cpus * 1000) / 10 : 0;
      const mem = s?.memory_stats ?? {};
      const cache = mem?.stats?.cache ?? 0;
      return {
        cpuPercent,
        memBytes: Math.max(0, (mem.usage ?? 0) - cache),
        memLimitBytes: mem.limit ?? 0,
        netRxBytes: sumNet(s?.networks, 'rx_bytes'),
        netTxBytes: sumNet(s?.networks, 'tx_bytes'),
      };
    } catch (e) {
      if (isStatus(e, 404)) return null;
      throw e;
    }
  }

  async logs(id: string, tail = 200): Promise<string> {
    if (!this.docker) return '';
    try {
      const buf: Buffer = await withTimeout(
        this.d().getContainer(id).logs({ stdout: true, stderr: true, tail: Math.min(tail, 2000), timestamps: false }),
        10_000,
        'container logs',
      );
      return decodeDockerLogs(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as unknown as ArrayBuffer));
    } catch (e) {
      if (isStatus(e, 404)) return '';
      throw e;
    }
  }

  // ---- one-shot helper containers (chown / tar / du) ------------------------

  /**
   * Runs a short-lived container with `NetworkMode: none` and tight limits.
   * Used for volume maintenance only — never for client code.
   */
  /**
   * Runs a short-lived helper. `captureLogs` switches the log driver from
   * `none` to a tiny capped json-file — REQUIRED whenever the caller parses
   * `out` (log-driver `none` containers expose no stdout at all, so without
   * this flag `out` is always empty and parsers silently see nothing).
   */
  async runHelper(opts: {
    image: string;
    cmd: string[];
    binds?: string[];
    user?: string;
    timeoutMs?: number;
    memoryMb?: number;
    captureLogs?: boolean;
  }): Promise<HelperResult> {
    const d = this.d();
    const timeout = opts.timeoutMs ?? 60_000;
    let container: Container | null = null;
    try {
      const createOpts = {
        Image: opts.image,
        // helpers always run a plain shell script, bypassing any image entrypoint
        Entrypoint: ['/bin/sh', '-c'],
        Cmd: opts.cmd,
        User: opts.user ?? '0:0',
        Labels: { 'troxe.helper': 'true' },
        HostConfig: {
          NetworkMode: 'none',
          Binds: opts.binds ?? [],
          AutoRemove: false,
          ReadonlyRootfs: false,
          CapDrop: ['ALL'],
          // the helper runs root inside a single bind mount to chown/untar;
          // these are the only capabilities it may hold
          CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE', 'SETUID', 'SETGID'],
          SecurityOpt: ['no-new-privileges:true'],
          Memory: (opts.memoryMb ?? 256) * 1024 * 1024,
          NanoCpus: 1_000_000_000,
          PidsLimit: 64,
          RestartPolicy: { Name: 'no' },
          LogConfig: opts.captureLogs
            ? { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '1' } }
            : { Type: 'none', Config: {} },
        },
      };
      container = await d.createContainer(createOpts as any);
      await withTimeout(container.start(), 15_000, 'helper start');
      const res: any = await withTimeout(container.wait(), timeout, 'helper wait');
      // NOTE: with LogConfig `none` the daemon keeps no stdout — out is ''.
      const logs: any = opts.captureLogs
        ? await container.logs({ stdout: true, stderr: true, tail: 500 }).catch(() => Buffer.alloc(0))
        : Buffer.alloc(0);
      const out = logs ? decodeDockerLogs(Buffer.isBuffer(logs) ? logs : Buffer.from(logs)) : '';
      return { code: res?.StatusCode ?? 1, out };
    } finally {
      if (container) await container.remove({ force: true }).catch(() => undefined);
    }
  }

  // ---- inventory (reconciler / GC) ------------------------------------------

  async listManaged(): Promise<{
    containers: Array<{ id: string; name: string; labels: Record<string, string> }>;
    networks: Array<{ id: string; name: string; labels: Record<string, string> }>;
    volumes: Array<{ name: string; labels: Record<string, string> }>;
  }> {
    const d = this.d();
    const labelFilter = { label: ['troxe.managed=true'] };
    const [cs, ns, vs] = await Promise.all([
      d.listContainers({ all: true, filters: labelFilter }).catch(() => [] as any[]),
      d.listNetworks({ filters: labelFilter }).catch(() => [] as any[]),
      d.listVolumes({ filters: labelFilter }).catch(() => ({ Volumes: [] }) as any),
    ]);
    return {
      containers: (cs as any[]).map((c) => ({
        id: c.Id,
        name: String(c.Names?.[0] ?? '').replace(/^\//, ''),
        labels: c.Labels ?? {},
      })),
      networks: (ns as any[]).map((n) => ({ id: n.Id, name: n.Name, labels: n.Labels ?? {} })),
      volumes: ((vs as any)?.Volumes ?? []).map((v: any) => ({ name: v.Name, labels: v.Labels ?? {} })),
    };
  }
}

function sumNet(nets: Record<string, { rx_bytes?: number; tx_bytes?: number }> | undefined, key: 'rx_bytes' | 'tx_bytes') {
  if (!nets) return 0;
  return Object.values(nets).reduce((acc, n) => acc + (n?.[key] ?? 0), 0);
}

/** Small helper so callers can map daemon failures to app errors. */
export function wrapDockerError(e: unknown, code = 'DOCKER_ERROR'): never {
  const msg = (e as Error)?.message ?? String(e);
  if (/no such|not found/i.test(msg)) throw Err.notFound('NOT_FOUND');
  throw new AppError(code, 502, `Container runtime error: ${msg.slice(0, 200)}`);
}
