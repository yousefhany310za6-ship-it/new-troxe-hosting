import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../../config/env';
import { AppError } from '../../../common/errors';
import type { EnvVar } from '../../../db/schema';
import { DockerService } from './docker.service';
import { NetworkHardeningService } from './network-hardening.service';
import { runtimeImage, type Runtime } from './images';
import { buildSandboxConfig, resourceNames } from './sandbox';

export interface ProvisionInput {
  id: string;
  ownerId: string;
  runtime: Runtime;
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
 * Provisioning is transactional in spirit: any failure rolls back every
 * resource created so far, so no half-made network/volume is ever left behind.
 */
@Injectable()
export class ProvisionerService {
  private readonly log = new Logger(ProvisionerService.name);

  constructor(
    private docker: DockerService,
    private hardening: NetworkHardeningService,
  ) {}

  get available(): boolean {
    return this.docker.available;
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    if (!this.docker.available) {
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
    const names = resourceNames(input.id);
    const labels = LABELS(input.id, input.ownerId);
    const partial: DestroyInput = { containerName: names.containerName, networkName: names.networkName, volumeName: names.volumeName };

    try {
      // 1. image (allowlisted) must exist before we create anything
      await this.docker.ensureImage(runtime.image);

      // 2. private network for this server only (reused if it already exists)
      const network = await this.getOrCreateNetwork(names.networkName, labels);
      partial.networkSubnet = network.subnet;
      if (network.created) await this.hardening.apply(network.subnet, names.networkName);

      // 3. persistent volume, owned by the unprivileged runtime user — this
      // runs before EVERY container create (not just on first creation):
      // docker normalizes an EMPTY volume dir to root:root 0755 while
      // preparing WorkingDir (/data) at create time, so the helper must
      // guarantee ownership + a non-empty dir first (see chownVolume).
      await this.getOrCreateVolume(names.volumeName, labels);
      await this.chownVolume(names.volumeName, runtime.image);

      // 4. the sandbox container itself (replaces any previous one)
      await this.docker.removeByName(names.containerName).catch(() => undefined);
      const containerId = await this.docker.createContainer(
        buildSandboxConfig({
          serverId: input.id,
          ownerId: input.ownerId,
          image: runtime,
          startup: input.startup || runtime.defaultStartup,
          env: input.env,
          cpuMilli: input.cpuMilli,
          ramMb: input.ramMb,
          networkName: names.networkName,
          volumeName: names.volumeName,
          autoRestart: input.autoRestart,
          pidsLimit: config.CONTAINER_PIDS_LIMIT,
        }),
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
        image: runtime.image,
      };
    } catch (e) {
      const message = e instanceof AppError ? e.message : `Provisioning failed: ${(e as Error).message}`;
      this.log.error(`rollback for ${names.containerName}: ${message}`);
      const errors = await this.destroy(partial);
      throw new AppError('PROVISION_FAILED', 502, errors.length ? `${message} (rollback errors: ${errors.join('; ')})` : message);
    }
  }

  /**
   * Best-effort teardown in dependency order: container → hardening rules +
   * network → volume. Never throws; returns the list of failures so callers
   * can surface them (the reconciler GCs anything left).
   */
  async destroy(input: DestroyInput): Promise<string[]> {
    const errors: string[] = [];

    if (input.containerId) {
      await this.docker.remove(input.containerId).catch((e: Error) => errors.push(`container: ${e.message}`));
    } else if (input.containerName) {
      await this.docker.removeByName(input.containerName).catch((e: Error) => errors.push(`container: ${e.message}`));
    }

    if (input.networkName) {
      await this.hardening
        .cleanup(input.networkSubnet ?? '', input.networkName)
        .catch((e: Error) => errors.push(`rules: ${e.message}`));
      await this.docker.removeNetwork(input.networkName).catch((e: Error) => errors.push(`network: ${e.message}`));
    }

    if (input.volumeName) {
      await this.docker.removeVolume(input.volumeName).catch((e: Error) => errors.push(`volume: ${e.message}`));
    }

    if (errors.length) this.log.warn(`destroy incomplete: ${errors.join(' | ')}`);
    return errors;
  }

  /** Networks are per-server; create only when absent so provision can repair. */
  private async getOrCreateNetwork(name: string, labels: Record<string, string>) {
    const existing = await this.docker.networkInfo(name);
    if (existing) return { ...existing, created: false };
    return { ...(await this.docker.createNetwork(name, labels)), created: true };
  }

  private async getOrCreateVolume(name: string, labels: Record<string, string>): Promise<boolean> {
    const exists = await this.docker.volumeExists(name);
    if (exists) return false;
    await this.docker.createVolume(name, labels);
    return true;
  }

  /** `chown -R 1000:1000 /data` through a network-less helper container. */
  private async chownVolume(volumeName: string, image: string): Promise<void> {
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
      });
      if (res.code !== 0) this.log.warn(`volume chown exited ${res.code}: ${res.out.slice(0, 200)}`);
    } catch (e) {
      // non-fatal: the sandbox may still run, writes would fail loudly
      this.log.warn(`volume ownership setup failed: ${(e as Error).message}`);
    }
  }

  /** Disk usage of a sandbox volume in bytes (via a network-less helper). */
  async volumeUsage(volumeName: string, image: string): Promise<number | null> {
    if (!this.docker.available || !volumeName) return null;
    try {
      const res = await this.docker.runHelper({
        image,
        cmd: ['du -sb /data 2>/dev/null | cut -f1 || echo 0'],
        binds: [`${volumeName}:/data`],
        user: '0:0',
        timeoutMs: 30_000,
      });
      const n = Number.parseInt(res.out.trim().split('\n').pop() ?? '', 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
}
