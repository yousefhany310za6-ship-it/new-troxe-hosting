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
/**
 * Raw frame stream kept before decoding. `tail` bounds the line COUNT, so a
 * daemon (or a rogue node) can hand back an arbitrarily large buffer — cap the
 * bytes FIRST, then decode, so the 4MB text ceiling below is never reached by
 * materialising 400MB of frames.
 */
const LOG_RAW_MAX_BYTES = 8 * 1024 * 1024;

/** Finite number from a daemon field: NaN/Infinity never reach a response. */
export const finiteNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Daemon-provided strings are unbounded: bound whatever we store or send. */
export const boundedStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Free/used space of the filesystem a node's Docker root lives on. */
export interface DiskUsage {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  /** 0..100, as reported by df (validated) */
  percent: number;
}

/**
 * Parse ONE line of `df -P` (POSIX format, one filesystem per line):
 *   Filesystem 1024-blocks Used Available Capacity Mounted
 * Fields are read from the END because a device label may contain spaces.
 * Pure and unit-tested — the disk guard must never misread a full disk.
 */
export function parseDfLine(line: string): DiskUsage | null {
  const t = (line ?? '').trim().split(/\s+/);
  if (t.length < 6) return null;
  const capacity = Number.parseInt(t[t.length - 2], 10);
  const avail = Number(t[t.length - 3]);
  const used = Number(t[t.length - 4]);
  const blocks = Number(t[t.length - 5]);
  if (![avail, used, blocks].every((n) => Number.isFinite(n) && n >= 0) || blocks <= 0) return null;
  const totalBytes = blocks * 1024;
  const usedBytes = used * 1024;
  const computed = Math.round((usedBytes / totalBytes) * 100);
  const percent = Number.isFinite(capacity) && capacity >= 0 && capacity <= 100 ? capacity : computed;
  return { totalBytes, usedBytes, freeBytes: avail * 1024, percent: Math.min(100, percent) };
}

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
export function decodeDockerLogs(buf: Buffer): string {
  const chunks: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + len;
    // plausible header: stream byte 0..3, three zero bytes, non-zero length
    // that fits inside the buffer
    const ok =
      len > 0 && buf[offset] <= 3 && buf[offset + 1] === 0 && buf[offset + 2] === 0 && buf[offset + 3] === 0 && end <= buf.length;
    if (!ok) {
      if (chunks.length) break; // strict once frames are flowing — no mid-stream jumps
      offset++; // head may be a TAIL slice (raw bytes capped above): resync
      continue;
    }
    chunks.push(buf.subarray(start, end).toString('utf8'));
    offset = end;
  }
  return chunks.length ? chunks.join('') : buf.toString('utf8');
}

/**
 * Cap-then-decode. Keeps the LAST `LOG_RAW_MAX_BYTES` of the frame stream so
 * a normal short log is byte-identical while a hostile/huge one cannot make
 * the API materialise it whole.
 */
export function decodeLogsBounded(raw: unknown): string {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from((raw ?? '') as ArrayBuffer);
  return decodeDockerLogs(buf.length > LOG_RAW_MAX_BYTES ? buf.subarray(buf.length - LOG_RAW_MAX_BYTES) : buf);
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
  /** df snapshot per node (a helper run is expensive — reuse it for a minute) */
  private readonly diskCache = new Map<string, { at: number; usage: DiskUsage }>();
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

  /**
   * Disk usage of a node's filesystem (its Docker root) — measured ON the node
   * by binding the node's `/` read-only into a helper: `df` on the API host
   * would only ever describe the API host, and remote nodes have no agent.
   * Cached for 60s; `null` means "could not measure" (callers fail open, and
   * never block provisioning on a measurement failure).
   */
  async diskUsage(nodeId = 'local'): Promise<DiskUsage | null> {
    const hit = this.diskCache.get(nodeId);
    if (hit && Date.now() - hit.at < 60_000) return hit.usage;
    if (!(await this.availableOn(nodeId).catch(() => false))) return null;
    try {
      await this.ensureImage(config.HELPER_IMAGE, 300_000, nodeId);
      const res = await this.runHelper({
        image: config.HELPER_IMAGE,
        cmd: ['df -P /host | tail -1'],
        // binds resolve on the DAEMON's host — this is the node's own `/`
        binds: ['/:/host:ro'],
        user: '0:0',
        timeoutMs: 20_000,
        memoryMb: 64,
        captureLogs: true, // out is parsed — log-driver `none` yields ''
        nodeId,
      });
      const usage = parseDfLine(res.out.trim().split('\n').pop() ?? '');
      if (!usage) {
        this.log.warn(`df on node "${nodeId}" returned no parseable line: ${res.out.slice(0, 120)}`);
        return null;
      }
      this.diskCache.set(nodeId, { at: Date.now(), usage });
      return usage;
    } catch (e) {
      this.log.warn(`disk usage on node "${nodeId}" unavailable: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  }

  /** Drop a node's df snapshot (admin actions can change the picture). */
  invalidateDiskCache(nodeId?: string) {
    if (nodeId) this.diskCache.delete(nodeId);
    else this.diskCache.clear();
  }

  /**
   * Read a node's LIVE host iptables ruleset (`iptables -S`).
   *
   * The pinned helper image ships no iptables, so it chroots into the node's
   * own root (bind-mounted read-only) and runs the node's own binary — in the
   * node's host network namespace, with NET_ADMIN to open the xtables socket.
   * Identical code path for the local socket and a remote mTLS daemon, and it
   * observes the RUNNING ruleset, not the persisted file (a node whose
   * persistence service died after a reboot reads as drifted here).
   *
   * Returns `null` when it cannot read (never throws) — callers must fail
   * OPEN on `null`, never treat "unreadable" as "hardened".
   */
  async readHostIptables(nodeId = 'local'): Promise<string | null> {
    if (!(await this.availableOn(nodeId).catch(() => false))) return null;
    try {
      await this.ensureImage(config.HELPER_IMAGE, 300_000, nodeId);
      const res = await this.runHelper({
        image: config.HELPER_IMAGE,
        cmd: [
          'for p in /usr/sbin/iptables /sbin/iptables /usr/bin/iptables; do\n' +
            '  if chroot /host "$p" -S >/tmp/rules 2>/tmp/rules.err; then cat /tmp/rules; exit 0; fi\n' +
            'done\n' +
            'echo "no usable iptables inside the node root" >&2\n' +
            'exit 42',
        ],
        binds: ['/:/host:ro'],
        networkMode: 'host',
        capAdd: ['NET_ADMIN', 'SYS_CHROOT'],
        user: '0:0',
        timeoutMs: 20_000,
        memoryMb: 64,
        captureLogs: true, // out is the ruleset — log-driver `none` yields ''
        nodeId,
      });
      if (res.code !== 0 || !res.out.includes('-A ')) {
        this.log.warn(`iptables unreadable on node "${nodeId}" (exit ${res.code}): ${res.out.slice(0, 160)}`);
        return null;
      }
      return res.out;
    } catch (e) {
      this.log.warn(`iptables read failed on node "${nodeId}": ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
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
      const subnet = boundedStr(info?.IPAM?.Config?.[0]?.Subnet, 64);
      // a CIDR shape only: this string is stored in the row and later passed
      // as an iptables argument — junk from a rogue node is treated as
      // "subnet unknown" (hardening skipped + logged), never as a rule
      return { id: boundedStr(info?.Id, 64) || name, subnet: /^[0-9a-fA-F:.]{3,45}\/\d{1,3}$/.test(subnet) ? subnet : '' };
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
      // shape + bounds: a daemon is untrusted input — status/error/startedAt
      // are strings we store in `lastError` and broadcast to the owner
      return {
        exists: true,
        status: boundedStr(state.Status, 32) || 'unknown',
        running: !!state.Running,
        exitCode: Math.trunc(finiteNum(state.ExitCode)),
        oomKilled: !!state.OOMKilled,
        error: boundedStr(state.Error, 500),
        restartCount: Math.max(0, Math.trunc(finiteNum(state.RestartCount))),
        startedAt: boundedStr(state.StartedAt, 40),
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
      // every field below comes from the node: coerce to finite numbers so a
      // malformed/rogue payload yields 0 instead of NaN/Infinity in JSON
      const cpuDelta = finiteNum(s?.cpu_stats?.cpu_usage?.total_usage) - finiteNum(s?.precpu_stats?.cpu_usage?.total_usage);
      const sysDelta = finiteNum(s?.cpu_stats?.system_cpu_usage) - finiteNum(s?.precpu_stats?.system_cpu_usage);
      const cpus = Math.max(1, finiteNum(s?.cpu_stats?.online_cpus) || 1);
      const cpuPercent = sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * cpus * 1000) / 10 : 0;
      const mem = s?.memory_stats ?? {};
      const cache = finiteNum(mem?.stats?.cache);
      return {
        cpuPercent: cpuPercent > 0 ? cpuPercent : 0,
        memBytes: Math.max(0, finiteNum(mem.usage) - cache),
        memLimitBytes: Math.max(0, finiteNum(mem.limit)),
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
      const text = decodeLogsBounded(buf);
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
    /** default `none` — only the host-firewall reader uses the host netns */
    networkMode?: 'none' | 'host';
    /** extra capabilities, merged onto the base set (never a blanket grant) */
    capAdd?: string[];
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
          NetworkMode: opts.networkMode ?? 'none',
          Binds: opts.binds ?? [],
          AutoRemove: false,
          ReadonlyRootfs: false,
          CapDrop: ['ALL'],
          // the helper runs root inside a single bind mount to chown/untar;
          // these are the only capabilities it may hold (plus whatever the
          // caller explicitly adds — NET_ADMIN/SYS_CHROOT for the rules reader)
          CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE', 'SETUID', 'SETGID', ...(opts.capAdd ?? [])],
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
      const out = logs ? decodeLogsBounded(logs) : '';
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
  if (!nets || typeof nets !== 'object') return 0;
  return Object.values(nets).reduce((acc, n) => acc + finiteNum((n ?? {})[key]), 0);
}

/** Small helper so callers can map daemon failures to app errors. */
export function wrapDockerError(e: unknown, code = 'DOCKER_ERROR'): never {
  const msg = (e as Error)?.message ?? String(e);
  if (/no such|not found/i.test(msg)) throw Err.notFound('NOT_FOUND');
  throw new AppError(code, 502, `Container runtime error: ${msg.slice(0, 200)}`);
}
