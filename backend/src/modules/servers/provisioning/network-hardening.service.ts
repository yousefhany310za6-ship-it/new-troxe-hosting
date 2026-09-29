import { execFile } from 'child_process';
import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import { config } from '../../../config/env';

const exec = promisify(execFile);

/**
 * Per-sandbox network hardening.
 *
 * Docker already guarantees that containers on *different* user-defined
 * networks cannot talk to each other (client ↔ client isolation). What it does
 * NOT block by default is client → host, so we install rules in TWO chains for
 * every sandbox subnet:
 *
 * `DOCKER-USER` (FORWARD path — traffic leaving the sandbox towards other
 * networks / the internet):
 *   • drop traffic to RFC1918 (LAN, other docker bridges, host gateway)
 *   • drop traffic to link-local (cloud metadata endpoints 169.254.169.254)
 *   • drop traffic to any LOCAL address of the host itself (its public IPs too)
 *
 * `INPUT` (host path — traffic *terminating on the host itself*, which never
 * traverses FORWARD/DOCKER-USER, e.g. container → 172.17.0.1:3300):
 *   • drop ALL traffic from the sandbox subnet to any host port
 *
 * Egress to the public internet and Docker's embedded DNS (127.0.0.11) are
 * unaffected: the former traverses FORWARD with a non-local destination, the
 * latter is answered inside the container's own netns path.
 *
 * Rules are idempotent (`-C` before `-I`) and tagged with a comment so they
 * can be found and deleted when the sandbox is destroyed.
 *
 * Failure policy: this service reports success/failure and never throws —
 * the CALLER decides. Provisioning fails closed in production (refuses to
 * start an unhardened sandbox); the reconciler converges rules back after
 * daemon/host restarts (netfilter state, unlike Docker networks, is lost).
 */
@Injectable()
export class NetworkHardeningService {
  private readonly log = new Logger(NetworkHardeningService.name);
  private probe: Promise<boolean> | null = null;
  private probedAt = 0;
  private warned = false;

  private tag(name: string): string {
    return `troxe:${name}`;
  }

  private get blockedDests(): string[] {
    return [
      '169.254.0.0/16', // link-local / cloud metadata
      '10.0.0.0/8',
      '172.16.0.0/12', // docker bridges + host gateway
      '192.168.0.0/16',
      '100.64.0.0/10', // CGNAT / service meshes
    ];
  }

  private iptables(args: string[]): Promise<{ ok: boolean; err: string }> {
    return exec('iptables', ['-w', '5', ...args], { timeout: 10_000 })
      .then(() => ({ ok: true, err: '' }))
      .catch((e: { stderr?: string; message?: string }) => ({
        ok: false,
        err: String(e.stderr ?? e.message ?? '').trim(),
      }));
  }

  /**
   * Lazy check with a 60s TTL: iptables present + DOCKER-USER chain exists.
   * A forever-cached probe goes stale in both directions (daemon restart
   * recreates the chain after a failed probe, or drops it after a pass).
   */
  private ensureAvailable(): Promise<boolean> {
    if (!this.probe || Date.now() - this.probedAt > 60_000) {
      this.probedAt = Date.now();
      this.probe = (async () => {
        if (!config.HARDEN_NETWORK) return false;
        const list = await this.iptables(['-L', 'DOCKER-USER', '-n']);
        if (!list.ok) {
          this.log.warn(`DOCKER-USER chain unavailable, network hardening inactive: ${list.err}`);
          return false;
        }
        return true;
      })();
    }
    return this.probe;
  }

  /** Install the isolation rules for a freshly created sandbox network. */
  async apply(subnet: string, networkName: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
    if (!subnet) {
      this.log.warn(`no subnet for ${networkName} — skipping hardening`);
      return false;
    }
    if (!(await this.ensureAvailable())) return false;

    const comment = this.tag(networkName);
    let applied = 0;
    let inserted = 0;

    for (const dest of this.blockedDests) {
      const exists = await this.iptables(['-C', 'DOCKER-USER', '-s', subnet, '-d', dest, '-m', 'comment', '--comment', comment, '-j', 'DROP']);
      if (exists.ok) {
        applied++;
        continue;
      }
      const ins = await this.iptables(['-I', 'DOCKER-USER', '-s', subnet, '-d', dest, '-m', 'comment', '--comment', comment, '-j', 'DROP']);
      if (ins.ok) {
        applied++;
        inserted++;
      } else if (!this.warned) this.log.warn(`could not install DROP ${dest}: ${ins.err}`);
    }

    // host's own addresses (public IPs included) — skipped if unsupported
    const localRule = ['-s', subnet, '-m', 'addrtype', '--dst-type', 'LOCAL', '-m', 'comment', '--comment', comment, '-j', 'DROP'];
    const localExists = await this.iptables(['-C', 'DOCKER-USER', ...localRule]);
    if (localExists.ok) {
      applied++;
    } else {
      const ins = await this.iptables(['-I', 'DOCKER-USER', ...localRule]);
      if (ins.ok) {
        applied++;
        inserted++;
      } else this.log.warn(`host-local drop rule not installed: ${ins.err}`);
    }

    // INPUT chain: container → host traffic never reaches DOCKER-USER (it is
    // locally delivered, not forwarded), so block the whole subnet at the host.
    const inputRule = ['-s', subnet, '-m', 'comment', '--comment', comment, '-j', 'DROP'];
    const inputExists = await this.iptables(['-C', 'INPUT', ...inputRule]);
    if (inputExists.ok) {
      applied++;
    } else {
      const ins = await this.iptables(['-I', 'INPUT', ...inputRule]);
      if (ins.ok) {
        applied++;
        inserted++;
      } else if (!this.warned) this.log.warn(`could not install INPUT drop: ${ins.err}`);
    }

    if (applied === 0 && !this.warned) {
      this.warned = true;
      this.log.warn('network hardening rules could not be installed');
    }
    // quiet mode (reconciler convergence): log only when rules changed.
    if (!opts.quiet || inserted > 0) this.log.log(`hardened ${networkName} (${subnet}) — ${applied} rules (${inserted} new)`);
    return applied > 0;
  }

  /**
   * Remove every rule of a sandbox network (idempotent). Deletion is
   * attempted unconditionally — never gated on the availability probe, so a
   * stale probe can never leak rules.
   */
  async cleanup(subnet: string, networkName: string): Promise<void> {
    if (!subnet) return;
    await this.ensureAvailable().catch(() => false);
    const comment = this.tag(networkName);

    const targets = [...this.blockedDests.map((dest) => ['-s', subnet, '-d', dest]), ['-s', subnet, '-m', 'addrtype', '--dst-type', 'LOCAL']];
    for (const extra of targets) {
      // delete repeatedly: the rule may have been inserted more than once
      for (let i = 0; i < 5; i++) {
        const args = ['DOCKER-USER', ...extra, '-m', 'comment', '--comment', comment, '-j', 'DROP'];
        const del = await this.iptables(['-D', ...args]);
        if (!del.ok) break;
      }
    }
    // INPUT chain rules (same match, different chain)
    for (let i = 0; i < 5; i++) {
      const del = await this.iptables(['-D', 'INPUT', '-s', subnet, '-m', 'comment', '--comment', comment, '-j', 'DROP']);
      if (!del.ok) break;
    }
    this.log.log(`removed hardening rules for ${networkName}`);
  }
}
