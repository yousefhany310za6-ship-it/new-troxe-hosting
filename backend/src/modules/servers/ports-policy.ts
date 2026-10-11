/**
 * Pure port-allocation policy (no Nest/Drizzle imports — unit-testable).
 *
 * The allocation ITSELF is a database concern: the unique partial index on
 * (node_id, port) WHERE state='allocated' decides races, and the service only
 * retries candidates. Everything a test can check without a database lives
 * here: the range discipline, the reserved ports, and the preference order for
 * the address a client is shown.
 */

/** Where the allocator may pick from. Bounded; a node can narrow it. */
export const DEFAULT_PORT_RANGE = { from: 30000, to: 30100 };

/** Never published: host control plane, docker, and bundled services. */
export const RESERVED_PORTS: readonly number[] = [22, 80, 443, 3300, 5432, 3306, 6379];

/** True when a port may be handed to a sandbox. */
export function isAllocatablePort(port: number, range = DEFAULT_PORT_RANGE): boolean {
  if (!Number.isInteger(port)) return false;
  if (port < 1024 || port > 65535) return false; // never a privileged port
  if (port < range.from || port > range.to) return false; // outside the pool
  return !RESERVED_PORTS.includes(port);
}

/** A range is usable when it is ordered, in-bounds and not empty. */
export function isValidRange(range: { from: number; to: number }): boolean {
  return (
    Number.isInteger(range.from) &&
    Number.isInteger(range.to) &&
    range.from >= 1024 &&
    range.to <= 65535 &&
    range.from <= range.to
  );
}

/**
 * Which host to show a client for a published port. Preference order:
 *  1. the node's admin-set public host (e.g. node.hosting.troxe.dev),
 *  2. the global fallback the admin configured,
 *  3. the daemon host (last resort — it may be a private address).
 * Returns null when nothing is configured, so the UI says "not available"
 * instead of inventing an address.
 */
export function resolvePublicHost(input: {
  nodePublicHost?: string | null;
  globalHost?: string | null;
  daemonHost?: string | null;
}): string | null {
  const node = input.nodePublicHost?.trim();
  if (node) return node;
  const global = input.globalHost?.trim();
  if (global) return global;
  const daemon = input.daemonHost?.trim();
  return daemon || null;
}

/** The address string shown to a client: `host:port` (no scheme). */
export function formatAddress(host: string, port: number): string {
  return `${host}:${port}`;
}
