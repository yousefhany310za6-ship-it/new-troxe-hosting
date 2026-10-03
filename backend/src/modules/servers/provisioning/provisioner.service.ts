import { Inject, Injectable, Logger } from '@nestjs/common';
import { config } from '../../../config/env';
import { AppError } from '../../../common/errors';
import type { EnvVar } from '../../../db/schema';
import { DB, Db } from '../../../db/db.module';
import { nodes, servers } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { DockerService } from './docker.service';
import { NetworkHardeningService } from './network-hardening.service';
import { runtimeImage, type Runtime } from './images';
import { intToIp, ipToInt } from '../../nodes/nodes.service';
import { buildSandboxConfig, resourceNames } from './sandbox';

export interface ProvisionInput {
  id: string;
  ownerId: string;
  /** target daemon — volumes/networks/containers are node-local */
  nodeId: string;
  runtime: Runtime;
  /** pinned digest override (a selectable version) — must be allowlisted */
  image?: string;
  startup: string;
  env: EnvVar[];
  cpuMilli: number;
  ramMb: number;
  autoRestart: boolean;
}

export interface ProvisionResult {
  containerId: string;
  containerName: string;
  networkName: string;
  networkSubnet: string;
  volumeName: string;
  image: string;
}

export interface DestroyInput {
  /** target daemon (defaults to local for legacy callers) */
  nodeId?: string;
  containerId?: string | null;
  containerName?: string | null;
  networkName?: string | null;
  networkSubnet?: string | null;
  volumeName?: string | null;
}

const LABELS = (serverId: string, ownerId: string) => ({
  'troxe.managed': 'true',
  'troxe.server-id': serverId,
  'troxe.owner-id': ownerId,
  'troxe.created-at': String(Math.floor(Date.now() / 1000)),
});

/**
 * Creates and tears down one fully isolated sandbox per client server:
 *
 *   own user-defined network (+ iptables isolation rules)
 *   own persistent volume (chowned to the unprivileged runtime user)
 *   own container with the hardened policy from sandbox.ts
 *
 * Provisioning is transactional in spirit: any failure rolls back only the
 * resources THIS call created. A reused network/volume (holding live client
 * data from a previous provision) is never deleted by rollback.
 */
@Injectable()
export class ProvisionerService {
  private readonly log = new Logger(ProvisionerService.name);

  constructor(
    @Inject(DB) private db: Db,
    private docker: DockerService,
    private hardening: NetworkHardeningService,
  ) {}

  /** Per-node mutex: two concurrent provisions must never pick one /24. */
  private readonly netLocks = new Map<string, Promise<void>>();

  private async acquireNet(nodeId: string): Promise<() => void> {
    const prev = this.netLocks.get(nodeId) ?? Promise.resolve();
    let done!: () => void;
    const gate = new Promise<void>((resolve) => (done = resolve));
    const chained = prev.catch(() => undefined).then(() => gate);
    this.netLocks.set(nodeId, chained);
    await prev.catch(() => undefined);
    return () => {
      done();
      if (this.netLocks.get(nodeId) === chained) this.netLocks.delete(nodeId);
    };
  }

  get available(): boolean {
    return this.docker.available;
  }

  /** Node-aware availability (record-only dev mode degrades per node). */
  availableOn(nodeId = 'local'): Promise<boolean> {
    return this.docker.availableOn(nodeId);
  }

  /**
   * Is this node's isolation in force RIGHT NOW?
   *
   * Local nodes: per-sandbox rules, converged by the reconciler (and applied
   * fail-closed at provision) — nothing extra to ask.
   * Remote nodes: their isolation is a STATIC ruleset installed once by
   * `node-setup.sh`, which nothing ever re-checked — this does, against the
   * node's RUNNING kernel ruleset.
   *
   * `false` = confirmed drift (a ruleset was read and required rules are
   * gone, or the node has no supernet at all). An UNREADABLE ruleset fails
   * OPEN — never block a fleet because a reader broke (the reader logs it).
   */
  async isolationOk(nodeId: string): Promise<boolean> {
    if (!config.HARDEN_NETWORK || nodeId === 'local') return true;
    const [n] = await this.db
      .select({ subnetBase: nodes.subnetBase })
      .from(nodes)
      .where(eq(nodes.id, nodeId))
      .limit(1);
    if (!n?.subnetBase) return false;
    const check = await this.hardening.verifySupernet(nodeId, n.subnetBase);
    if (!check) return true;
    if (!check.ok) {
      this.log.warn(
        `node "${nodeId}" firewall drift: ${check.missing.length} missing / ${check.stale.length} stale rule(s) ` +
          `for ${n.subnetBase}`,
      );
    }
    return check.ok;
  }

  /**
   * Admin-facing isolation report for one node.
   * `ok: null` means "could not read" — deliberately distinct from
   * `false` ("read it, and the rules are gone"): placement fails open on
   * `null`, while `false` is confirmed drift.
   */
  async firewallReport(nodeId: string): Promise<{
    mode: 'sandbox' | 'supernet' | 'none';
    ok: boolean | null;
    expected: number;
    found: number;
    subnetBase?: string;
    missing: string[];
    stale: string[];
  }> {
    if (!config.HARDEN_NETWORK) return { mode: 'none', ok: null, expected: 0, found: 0, missing: [], stale: [] };
    if (nodeId === 'local') {
      const rows = await this.db
        .select({ id: servers.id, networkName: servers.networkName, networkSubnet: servers.networkSubnet })
        .from(servers)
        .where(eq(servers.nodeId, 'local'))
        .limit(200);
      const check = await this.hardening.verifySandboxes(
        rows.filter((r) => r.networkName && r.networkSubnet).map((r) => ({ id: r.id, subnet: r.networkSubnet!, networkName: r.networkName! })),
      );
      if (!check) return { mode: 'sandbox', ok: null, expected: 0, found: 0, missing: [], stale: [] };
      return { mode: 'sandbox', ok: check.ok, expected: check.expected, found: check.found, missing: check.missing, stale: check.stale };
    }
    const [n] = await this.db.select({ subnetBase: nodes.subnetBase }).from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    if (!n?.subnetBase)
      return { mode: 'supernet', ok: false, expected: 0, found: 0, missing: ['subnetBase is not configured'], stale: [] };
    const check = await this.hardening.verifySupernet(nodeId, n.subnetBase);
    if (!check)
      return { mode: 'supernet', ok: null, expected: 0, found: 0, subnetBase: n.subnetBase, missing: [], stale: [] };
    return {
      mode: 'supernet',
      ok: check.ok,
      expected: check.expected,
      found: check.found,
      subnetBase: n.subnetBase,
      missing: check.missing,
      stale: check.stale,
    };
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    if (!(await this.docker.availableOn(input.nodeId))) {
      if (config.IS_PROD) {
        throw new AppError('DOCKER_UNAVAILABLE', 503, 'Container runtime is not available');
      }
      // record-only mode for local development
      const names = resourceNames(input.id);
      this.log.warn(`docker unavailable — recording server ${input.id} without a container`);
      return {
        containerId: '',
        containerName: names.containerName,
        networkName: '',
        networkSubnet: '',
        volumeName: '',
        image: runtimeImage(input.runtime).image,
      };
    }

    const runtime = runtimeImage(input.runtime);
    // defense in depth: even internal callers may only use allowlisted digests
    const image = input.image ?? runtime.image;
    if (!runtime.versions.some((v) => v.image === image)) {
      throw new AppError('IMAGE_NOT_ALLOWED', 400, 'Image is not allowlisted for this runtime');
    }
    const spec = { ...runtime, image };
    const names = resourceNames(input.id);
    const labels = LABELS(input.id, input.ownerId);
    const partial: DestroyInput = { containerName: names.containerName, networkName: names.networkName, volumeName: names.volumeName };
    // ownership flags: rollback may only delete what THIS call created —
    // never a reused network/volume holding live client data.
    const created = { network: false, volume: false };

    try {
      // 1. image (allowlisted) must exist before we create anything
      await this.docker.ensureImage(image, 300_000, input.nodeId);

      // 2. private network for this server only (reused if it already exists).
      // Allocation is serialized per node so two concurrent provisions can
      // never claim one /24.
      const releaseNet = await this.acquireNet(input.nodeId);
      let network: { id: string; subnet: string; created: boolean };
      try {
        network = await this.getOrCreateNetwork(input.nodeId, names.networkName, labels);
      } finally {
        releaseNet();
      }
      created.network = network.created;
      partial.networkSubnet = network.subnet;
      if (network.created) {
        if (input.nodeId === 'local') {
          const hardened = await this.hardening.apply(network.subnet, names.networkName);
          // fail closed in production: never start an unhardened sandbox
          // (dev keeps best-effort so local work without iptables still runs).
          if (!hardened && config.IS_PROD && config.HARDEN_NETWORK) {
            throw new AppError('PROVISION_FAILED', 502, 'Network isolation could not be applied');
          }
        } else {
          // remote nodes are covered by STATIC host firewall over their whole
          // supernet (installed once by the node setup script) — per-sandbox
          // rules would target the wrong host from here, so they are
          // deliberately not applied.
          this.log.log(`node ${input.nodeId}: ${names.networkName} covered by static supernet firewall`);
        }
      }

      // 3. persistent volume, owned by the unprivileged runtime user — this
      // runs before EVERY container create (not just on first creation):
      // docker normalizes an EMPTY volume dir to root:root 0755 while
      // preparing WorkingDir (/data) at create time, so the helper must
      // guarantee ownership + a non-empty dir first (see chownVolume).
      await this.getOrCreateVolume(input.nodeId, names.volumeName, labels).then((v) => (created.volume = v));
      await this.chownVolume(input.nodeId, names.volumeName, image);

      // 4. the sandbox container itself (replaces any previous one)
      await this.docker.removeByName(names.containerName, input.nodeId).catch(() => undefined);
      const containerId = await this.docker.createContainer(
        buildSandboxConfig({
          serverId: input.id,
          ownerId: input.ownerId,
          image: spec,
          startup: input.startup || runtime.defaultStartup,
          env: input.env,
          cpuMilli: input.cpuMilli,
          ramMb: input.ramMb,
          networkName: names.networkName,
          volumeName: names.volumeName,
          autoRestart: input.autoRestart,
          pidsLimit: config.CONTAINER_PIDS_LIMIT,
        }),
        input.nodeId,
      );
      partial.containerId = containerId;

      // NOTE: starting is the caller's decision (ProvisionInput.start is not
      // used here) so create/rebuild/repair flows stay deterministic.

      this.log.log(`provisioned ${names.containerName} on ${network.subnet || 'no-subnet'}`);
      return {
        containerId,
        containerName: names.containerName,
        networkName: names.networkName,
        networkSubnet: network.subnet,
        volumeName: names.volumeName,
        image,
      };
    } catch (e) {
      const message = e instanceof AppError ? e.message : `Provisioning failed: ${(e as Error).message}`;
      this.log.error(`rollback for ${names.containerName}: ${message}`);
      const errors = await this.rollbackProvision(input.nodeId, partial, created);
      throw new AppError('PROVISION_FAILED', 502, errors.length ? `${message} (rollback errors: ${errors.join('; ')})` : message);
    }
  }

  /**
   * Rollback for a failed provision: remove the just-created container (if
   * any) plus ONLY the network/volume this call created. A reused volume
   * holds live client data and a reused network may still be referenced —
   * deleting either would be data loss, so they are always kept.
   */
  private async rollbackProvision(
    nodeId: string,
    partial: DestroyInput,
    created: { network: boolean; volume: boolean },
  ): Promise<string[]> {
    return this.destroy({
      nodeId,
      containerId: partial.containerId,
      containerName: partial.containerName,
      ...(created.network ? { networkName: partial.networkName, networkSubnet: partial.networkSubnet } : {}),
      ...(created.volume ? { volumeName: partial.volumeName } : {}),
    });
  }

  /**
   * Best-effort teardown in dependency order: container → hardening rules +
   * network → volume. Never throws; returns the list of failures so callers
   * can surface them (the reconciler GCs anything left).
   */
  async destroy(input: DestroyInput): Promise<string[]> {
    const errors: string[] = [];
    const nodeId = input.nodeId ?? 'local';

    if (input.containerId) {
      await this.docker.remove(input.containerId, true, nodeId).catch((e: Error) => errors.push(`container: ${e.message}`));
    } else if (input.containerName) {
      await this.docker.removeByName(input.containerName, nodeId).catch((e: Error) => errors.push(`container: ${e.message}`));
    }

    if (input.networkName) {
      // local rules are per-sandbox (clean them); remote coverage is static
      // on the node host and intentionally untouched here.
      if (nodeId === 'local') {
        await this.hardening
          .cleanup(input.networkSubnet ?? '', input.networkName)
          .catch((e: Error) => errors.push(`rules: ${e.message}`));
      }
      await this.docker.removeNetwork(input.networkName, nodeId).catch((e: Error) => errors.push(`network: ${e.message}`));
    }

    if (input.volumeName) {
      await this.docker.removeVolume(input.volumeName, nodeId).catch((e: Error) => errors.push(`volume: ${e.message}`));
    }

    if (errors.length) this.log.warn(`destroy incomplete: ${errors.join(' | ')}`);
    return errors;
  }

  /** Networks are per-server; create only when absent so provision can repair. */
  private async getOrCreateNetwork(nodeId: string, name: string, labels: Record<string, string>) {
    const existing = await this.docker.networkInfo(name, nodeId);
    if (existing) return { ...existing, created: false };
    const subnet = await this.allocateSubnet(nodeId);
    return { ...(await this.docker.createNetwork(name, labels, { nodeId, subnet })), created: true };
  }

  /**
   * Pick a free /24 inside the node's supernet (null supernet = legacy
   * docker-assigned addressing, local node only). Call under acquireNet().
   */
  private async allocateSubnet(nodeId: string): Promise<string | undefined> {
    const [node] = await this.db.select({ subnetBase: nodes.subnetBase }).from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    if (!node?.subnetBase) return undefined;
    const [baseIp, mask] = node.subnetBase.split('/');
    const base = ipToInt(baseIp);
    const total = 2 ** (32 - Number(mask));
    const taken = new Set(
      (await this.db.select({ subnet: servers.networkSubnet }).from(servers).where(eq(servers.nodeId, nodeId)))
        .map((r) => r.subnet)
        .filter((s): s is string => !!s),
    );
    // /24 granularity (256 hosts each); skip network/broadcast of the base
    for (let off = 0; off + 256 <= total; off += 256) {
      const candidate = `${intToIp(base + off)}/24`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new AppError('NO_SUBNET', 503, `Node "${nodeId}" is out of sandbox subnets`);
  }

  private async getOrCreateVolume(nodeId: string, name: string, labels: Record<string, string>): Promise<boolean> {
    const exists = await this.docker.volumeExists(name, nodeId);
    if (exists) return false;
    await this.docker.createVolume(name, labels, nodeId);
    return true;
  }

  /** `chown -R 1000:1000 /data` through a network-less helper container. */
  private async chownVolume(nodeId: string, volumeName: string, image: string): Promise<void> {
    try {
      const res = await this.docker.runHelper({
        image,
        // .troxe-init must exist before the sandbox container is created:
        // dockerd resets an EMPTY volume dir to root:root 0755 while
        // preparing WorkingDir (/data), stripping the client's ownership.
        cmd: ['touch /data/.troxe-init && chown -R 1000:1000 /data && chmod 750 /data'],
        binds: [`${volumeName}:/data`],
        user: '0:0',
        timeoutMs: 30_000,
        nodeId,
      });
      if (res.code !== 0) this.log.warn(`volume chown exited ${res.code}: ${res.out.slice(0, 200)}`);
    } catch (e) {
      // non-fatal: the sandbox may still run, writes would fail loudly
      this.log.warn(`volume ownership setup failed: ${(e as Error).message}`);
    }
  }

  /** Disk usage of a sandbox volume in bytes (via a network-less helper). */
  async volumeUsage(volumeName: string, image: string, nodeId = 'local'): Promise<number | null> {
    if (!(await this.docker.availableOn(nodeId)) || !volumeName) return null;
    try {
      await this.docker.ensureImage(image, 300_000, nodeId).catch(() => undefined);
      const res = await this.docker.runHelper({
        image,
        cmd: ['du -sb /data 2>/dev/null | cut -f1 || echo 0'],
        binds: [`${volumeName}:/data`],
        user: '0:0',
        timeoutMs: 30_000,
        captureLogs: true, // out is parsed below — log-driver `none` yields ''
        nodeId,
      });
      const n = Number.parseInt(res.out.trim().split('\n').pop() ?? '', 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
}
