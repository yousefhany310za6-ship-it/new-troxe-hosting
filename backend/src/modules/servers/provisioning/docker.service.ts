import { Injectable, Logger } from '@nestjs/common';
import Dockerode, { Container, ContainerCreateOptions } from 'dockerode';
import { createReadStream, createWriteStream } from 'fs';
import { rm, stat } from 'fs/promises';
import { PassThrough, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { config } from '../../../config/env';
import { NodePoolService } from '../../nodes/node-pool.service';
import { AppError, Err } from '../../../common/errors';

export interface HelperResult {
  code: number;
  out: string;
}

/** Ceiling for a single logs read (tail bounds lines, not bytes). */
const LOG_TEXT_MAX_BYTES = 4 * 1024 * 1024;

export interface ContainerState {
  exists: boolean;
  status: string;
  running: boolean;
  exitCode: number;
  oomKilled: boolean;
  error: string;
  restartCount: number;
  startedAt: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}

/**
 * Interactive shell inside a running sandbox (`docker exec -it /bin/sh`).
 * Runs as the container's own (unprivileged) user with its WorkingDir —
 * no new privileges, no new mounts, container cgroup limits still apply.
 */
export interface ShellHandle {
  write(data: Buffer): boolean;
  resize(cols: number, rows: number): Promise<void>;
  onOutput(cb: (data: Buffer) => void): void;
  onEnd(cb: (code: number | null) => void): void;
  close(): void;
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
 * Absolute deadline for a bulk stream. Same contract as `withTimeout`, but the
 * message is prose and the timer is always cleared — otherwise every backup
 * leaves a 30-minute timer behind (thousands in a busy process, and a test
 * runner that never exits).
 */
function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 60_000)}m`)), ms);
    t.unref?.();
  });
  return Promise.race([p, deadline]).finally(() => {
    if (t) clearTimeout(t);
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

  constructor(private pool: NodePoolService) {
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

  /**
   * Resolve the daemon client for a node. 'local' keeps the exact legacy
   * behavior (unix socket, sync guards); anything else goes through the
   * node pool (mutual TLS, fail-closed).
   */
  private async cx(nodeId = 'local'): Promise<Dockerode> {
    if (!nodeId || nodeId === 'local') return this.d();
    return this.pool.client(nodeId);
  }

  /** Liveness of a specific node (local stays synchronous via `available`). */
  async availableOn(nodeId = 'local'): Promise<boolean> {
    if (!nodeId || nodeId === 'local') return this.available;
    return this.pool.available(nodeId);
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

  async ping(timeoutMs = 3000, nodeId = 'local'): Promise<boolean> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return false;
    try {
      await withTimeout(d.info(), timeoutMs, 'docker info');
      return true;
    } catch {
      return false;
    }
  }

  async ensureImage(image: string, timeoutMs = 300_000, nodeId = 'local'): Promise<void> {
    const d = await this.cx(nodeId);
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

  async createNetwork(
    name: string,
    labels: Record<string, string>,
    opts: { nodeId?: string; subnet?: string } = {},
  ): Promise<{ id: string; subnet: string }> {
    const d = await this.cx(opts.nodeId);
    const ipam = opts.subnet ? { IPAM: { Config: [{ Subnet: opts.subnet }] } } : {};
    const network = await withTimeout(
      d.createNetwork({ Name: name, Driver: 'bridge', Attachable: false, EnableIPv6: false, Internal: false, Labels: labels, ...ipam }),
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

  async removeNetwork(idOrName: string, nodeId = 'local'): Promise<void> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return;
    try {
      await withTimeout(d.getNetwork(idOrName).remove(), 15_000, 'network remove');
    } catch (e) {
      if (!isStatus(e, 404)) throw e;
    }
  }

  async createVolume(name: string, labels: Record<string, string>, nodeId = 'local'): Promise<void> {
    await withTimeout((await this.cx(nodeId)).createVolume({ Name: name, Labels: labels, Driver: 'local' }), 15_000, `create volume ${name}`);
  }

  async removeVolume(name: string, nodeId = 'local'): Promise<void> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return;
    try {
      await withTimeout(d.getVolume(name).remove({ force: true }), 15_000, 'volume remove');
    } catch (e) {
      // 409 = still in use by a stopped helper/child → treat as gone later
      if (!isStatus(e, 404) && !isStatus(e, 409)) throw e;
    }
  }

  /** Returns the network id + subnet when it already exists, else null. */
  async networkInfo(name: string, nodeId = 'local'): Promise<{ id: string; subnet: string } | null> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return null;
    try {
      const info: any = await withTimeout(d.getNetwork(name).inspect(), 10_000, 'network inspect');
      return { id: info?.Id ?? name, subnet: info?.IPAM?.Config?.[0]?.Subnet ?? '' };
    } catch (e) {
      if (isStatus(e, 404)) return null;
      throw e;
    }
  }

  async volumeExists(name: string, nodeId = 'local'): Promise<boolean> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return false;
    try {
      await withTimeout(d.getVolume(name).inspect(), 10_000, 'volume inspect');
      return true;
    } catch (e) {
      if (isStatus(e, 404)) return false;
      throw e;
    }
  }

  async createContainer(opts: ContainerCreateOptions, nodeId = 'local'): Promise<string> {
    const container = await withTimeout((await this.cx(nodeId)).createContainer(opts), 60_000, 'create container');
    return container.id;
  }

  async start(id: string, nodeId = 'local'): Promise<void> {
    await withTimeout((await this.cx(nodeId)).getContainer(id).start(), 30_000, 'container start');
  }

  async stop(id: string, timeoutSec = 15, nodeId = 'local'): Promise<void> {
    try {
      await withTimeout((await this.cx(nodeId)).getContainer(id).stop({ t: timeoutSec }), timeoutSec * 1000 + 15_000, 'container stop');
    } catch (e) {
      if (!isStatus(e, 304) && !isStatus(e, 404)) throw e; // already stopped
    }
  }

  async restart(id: string, timeoutSec = 10, nodeId = 'local'): Promise<void> {
    await withTimeout((await this.cx(nodeId)).getContainer(id).restart({ t: timeoutSec }), timeoutSec * 1000 + 15_000, 'container restart');
  }

  async remove(id: string, force = true, nodeId = 'local'): Promise<void> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return;
    try {
      await withTimeout(d.getContainer(id).remove({ force, v: false }), 30_000, 'container remove');
    } catch (e) {
      if (!isStatus(e, 404)) throw e;
    }
  }

  async removeByName(name: string, nodeId = 'local'): Promise<void> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return;
    try {
      await withTimeout(d.getContainer(name).remove({ force: true, v: false }), 30_000, 'container remove');
    } catch (e) {
      if (!isStatus(e, 404)) throw e;
    }
  }

  // ---- observation ----------------------------------------------------------

  async inspect(id: string, nodeId = 'local'): Promise<ContainerState | null> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return null;
    try {
      const info: any = await withTimeout(d.getContainer(id).inspect(), 10_000, 'container inspect');
      const state = info?.State ?? {};
      return {
        exists: true,
        status: state.Status ?? 'unknown',
        running: !!state.Running,
        exitCode: state.ExitCode ?? 0,
        oomKilled: !!state.OOMKilled,
        error: state.Error ?? '',
        restartCount: state.RestartCount ?? 0,
        startedAt: state.StartedAt ?? '',
      };
    } catch (e) {
      if (isStatus(e, 404)) return null;
      throw e;
    }
  }

  async stats(id: string, nodeId = 'local'): Promise<ContainerStats | null> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return null;
    try {
      const s: any = await withTimeout(d.getContainer(id).stats({ stream: false }), 10_000, 'container stats');
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

  async logs(id: string, tail = 200, nodeId = 'local'): Promise<string> {
    const d = await this.cx(nodeId).catch(() => null);
    if (!d) return '';
    try {
      const buf: Buffer = await withTimeout(
        d.getContainer(id).logs({ stdout: true, stderr: true, tail: Math.min(Math.max(tail || 200, 1), 2000), timestamps: false }),
        10_000,
        'container logs',
      );
      const text = decodeDockerLogs(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as unknown as ArrayBuffer));
      // hard ceiling: `tail` bounds the line COUNT, not bytes — a single line
      // can be huge, so a client can never pull an unbounded payload (also
      // caps what a rogue node can make us materialise in memory).
      if (text.length > LOG_TEXT_MAX_BYTES)
        return '…[log truncated to the last 4MB]\n' + text.slice(-LOG_TEXT_MAX_BYTES);
      return text;
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
    /** json-file max-size (default '1m'); raise only for bounded bulk reads */
    logMaxSize?: string;
    /** target node (volume/network names are node-local) */
    nodeId?: string;
  }): Promise<HelperResult> {
    const d = await this.cx(opts.nodeId);
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
            ? { Type: 'json-file', Config: { 'max-size': opts.logMaxSize ?? '1m', 'max-file': '1' } }
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

  // ---- bulk streams (node-local-host transfers) ---------------------------------

  /**
   * Stream a volume's content to a host file WITHOUT bind-mounting host
   * paths into a helper (binds resolve on the DAEMON's host — meaningless
   * for remote nodes). Uses getArchive through a short-lived holder +
   * a timeout-free stream client; guarded by a 30min watchdog.
   */
  async streamVolumeToHost(volumeName: string, destPath: string, nodeId = 'local', maxBytes?: number): Promise<number> {
    const d = await this.pool.client(nodeId);
    await this.ensureImage(config.HELPER_IMAGE, 300_000, nodeId);
    let container: Container | null = null;
    try {
      container = await d.createContainer({
        Image: config.HELPER_IMAGE,
        Entrypoint: ['/bin/sh', '-c'],
        Cmd: ['sleep infinity'],
        User: '0:0',
        Labels: { 'troxe.helper': 'true' },
        HostConfig: {
          NetworkMode: 'none',
          Binds: [`${volumeName}:/data:ro`],
          AutoRemove: false,
          ReadonlyRootfs: false,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          Memory: 256 * 1024 * 1024,
          NanoCpus: 500_000_000,
          PidsLimit: 32,
          RestartPolicy: { Name: 'no' },
          LogConfig: { Type: 'none', Config: {} },
        },
      } as any);
      await withTimeout(container.start(), 15_000, 'stream holder start');
      // '/data/.' (not '/data'): members come out relative (a.txt), not
      // prefixed (data/a.txt) — same layout as the local tar flow.
      const stream = (await container.getArchive({ path: '/data/.' })) as unknown as NodeJS.ReadableStream;
      const bytes = await this.pipeToHost(stream, destPath, maxBytes);
      return bytes;
    } finally {
      if (container) await container.remove({ force: true }).catch(() => undefined);
    }
  }

  /**
   * Stream a host tarball into a volume (reverse of the above). The daemon
   * extracts (and decompresses) the archive — verified against engine 28.
   */
  async streamHostToVolume(srcPath: string, volumeName: string, nodeId = 'local', maxBytes?: number): Promise<void> {
    const d = await this.pool.client(nodeId);
    await this.ensureImage(config.HELPER_IMAGE, 300_000, nodeId);
    let container: Container | null = null;
    try {
      container = await d.createContainer({
        Image: config.HELPER_IMAGE,
        Entrypoint: ['/bin/sh', '-c'],
        Cmd: ['sleep infinity'],
        User: '0:0',
        Labels: { 'troxe.helper': 'true' },
        HostConfig: {
          NetworkMode: 'none',
          Binds: [`${volumeName}:/data`],
          AutoRemove: false,
          ReadonlyRootfs: false,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          Memory: 256 * 1024 * 1024,
          NanoCpus: 500_000_000,
          PidsLimit: 32,
          RestartPolicy: { Name: 'no' },
          LogConfig: { Type: 'none', Config: {} },
        },
      } as any);
      await withTimeout(container.start(), 15_000, 'stream holder start');
      await this.pipeToVolume(srcPath, container, '/data', maxBytes);
    } finally {
      if (container) await container.remove({ force: true }).catch(() => undefined);
    }
  }

  /**
   * Pump a daemon stream to a host file, with a 30min absolute watchdog and a
   * HARD byte ceiling: a rogue/oversized volume can never fill the host disk.
   * On breach the source is destroyed, the partial file is removed and the
   * call fails with ARCHIVE_TOO_LARGE.
   */
  private async pipeToHost(stream: NodeJS.ReadableStream, destPath: string, maxBytes?: number): Promise<number> {
    const cap = maxBytes && maxBytes > 0 ? maxBytes : Number.POSITIVE_INFINITY;
    let bytes = 0;
    const guard = new Transform({
      transform(c: Buffer, _enc, cb) {
        bytes += c.length;
        if (bytes > cap) {
          cb(new AppError('ARCHIVE_TOO_LARGE', 413, `archive exceeds the ${Math.round(cap / 1024 / 1024)}MB limit`));
          return;
        }
        cb(null, c);
      },
    });
    try {
      await withDeadline(
        pipeline(stream as any, guard, createWriteStream(destPath, { mode: 0o600 })),
        30 * 60 * 1000,
        'bulk stream',
      );
    } catch (e) {
      await rm(destPath, { force: true }).catch(() => undefined);
      throw e;
    }
    return bytes;
  }

  /** Pump a host file into a volume path, with a 30min absolute watchdog. */
  private async pipeToVolume(srcPath: string, container: Container, putPath: string, maxBytes?: number): Promise<number> {
    // stat FIRST: the source must exist and (when a ceiling is configured)
    // must fit — both verified before a single byte is pushed into the volume.
    const size = (await stat(srcPath).catch(() => null))?.size;
    if (size === null || size === undefined) throw Err.notFound('ARCHIVE_FILE_MISSING');
    if (maxBytes && maxBytes > 0 && size > maxBytes)
      throw new AppError('ARCHIVE_TOO_LARGE', 413, `archive exceeds the ${Math.max(1, Math.round(maxBytes / 1024 / 1024))}MB limit`);
    let bytes = 0;
    const tap = new PassThrough();
    tap.on('data', (c: Buffer) => {
      bytes += c.length;
    });
    // a read failure (file vanished / permissions) must NEVER surface as an
    // unhandled 'error' event — that takes the whole API process down. It is
    // forwarded into the archive stream instead, so putArchive above fails
    // and the caller gets a normal rejected promise.
    tap.on('error', () => undefined);
    const reader = createReadStream(srcPath);
    reader.on('error', (e: Error) => tap.destroy(e));
    reader.pipe(tap);
    await withDeadline((container as any).putArchive(tap, { path: putPath }), 30 * 60 * 1000, 'bulk stream');
    // integrity: the archive we pushed must be the archive on disk
    if (bytes !== size)
      throw new AppError('ARCHIVE_TRUNCATED', 502, `archive stream sent ${bytes} of ${size} bytes`);
    return bytes;
  }

  // ---- interactive shells (exec gateway) --------------------------------------

  /**
   * Opens `/bin/sh` in a RUNNING container with a pty. Caller must verify
   * ownership + running state first. With `Tty: true` the hijacked stream
   * is raw bytes (no multiplex headers).
   */
  async openShell(containerId: string, nodeId = 'local'): Promise<ShellHandle> {
    const container = (await this.cx(nodeId)).getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['/bin/sh'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      WorkingDir: '/data',
    });
    const stream = (await exec.start({ hijack: true, stdin: true })) as unknown as {
      write(d: Buffer): boolean;
      destroy(): void;
      on(event: 'data', cb: (d: Buffer) => void): unknown;
      on(event: 'end' | 'close' | 'error', cb: () => void): unknown;
    };
    const outCbs: Array<(data: Buffer) => void> = [];
    const endCbs: Array<(code: number | null) => void> = [];
    let ended = false;
    const finish = async () => {
      if (ended) return;
      ended = true;
      let code: number | null = null;
      try {
        const info = await exec.inspect();
        code = typeof info?.ExitCode === 'number' ? info.ExitCode : null;
      } catch {
        /* daemon gone — code stays null */
      }
      for (const cb of endCbs) cb(code);
    };
    stream.on('data', (d: Buffer) => {
      const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
      for (const cb of outCbs) cb(buf);
    });
    stream.on('end', () => void finish());
    stream.on('error', () => void finish());
    // `close` (not just `end`) fires when the daemon tears the socket down
    stream.on('close', () => void finish());
    return {
      write: (data: Buffer) => {
        if (ended) return false;
        try {
          return stream.write(data);
        } catch {
          return false;
        }
      },
      resize: async (cols: number, rows: number) => {
        await exec.resize({ h: rows, w: cols }).catch(() => undefined);
      },
      onOutput: (cb) => void outCbs.push(cb),
      onEnd: (cb) => void endCbs.push(cb),
      close: () => {
        try {
          stream.destroy();
        } catch {
          /* already gone */
        }
        void finish();
      },
    };
  }

  // ---- inventory (reconciler / GC) ------------------------------------------

  async listManaged(nodeId = 'local'): Promise<{
    containers: Array<{ id: string; name: string; labels: Record<string, string> }>;
    networks: Array<{ id: string; name: string; labels: Record<string, string> }>;
    volumes: Array<{ name: string; labels: Record<string, string> }>;
  }> {
    const d = await this.cx(nodeId);
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
