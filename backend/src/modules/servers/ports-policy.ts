/**
 * Pure port-allocation policy (no Nest/Drizzle imports — unit-testable).
 *
 * The allocation ITSELF is a database concern: the unique partial index on
 * (node_id, port) WHERE state='allocated' decides races, and the service only
 * retries candidates. Everything a test can check without a database lives
 * here: the range discipline, the reserved ports, and the preference order for
 * the address a client is shown.
 */

/**
 * Platform default range, used when a node has no override of its own.
 *
 * Deliberately wide (12 001 ports/node) and deliberately BELOW the ephemeral
 * range. Linux picks `net.ipv4.ip_local_port_range` — 32768-60999 by default —
 * for the SOURCE port of every outbound connection, so a listening pool that
 * overlapped it would collide with the host's own traffic: a client would see
 * intermittent `EADDRINUSE` on ports nobody was listening on. Ending at 32000
 * leaves the ephemeral band untouched.
 *
 * Overridable per node in the admin dashboard (`nodes.port_range_from/to`);
 * `validateRange` refuses a range that re-enters the ephemeral band.
 */
export const DEFAULT_PORT_RANGE = { from: 20000, to: 32000 };

/**
 * The kernel's default outbound source-port band. A published port inside it
 * is not refused outright, it just races the host's own connections.
 */
export const EPHEMERAL_PORT_RANGE = { from: 32768, to: 60999 };

/**
 * Ports a sandbox may never publish.
 *
 * The first block is universal (SSH, DNS, HTTP/S, MySQL, Postgres, Redis); the
 * second is this platform's own control plane — the API (3300), the docker
 * daemon (2375/2376), Caddy's admin endpoint (2019) and the UDP port-guard
 * diagnostics (4192-4194). Publishing any of these would hand a client the
 * platform's own services.
 */
export const RESERVED_PORTS: readonly number[] = [
  22, 53, 80, 443, // ssh, dns, http, https
  2375, 2376, // docker daemon (tcp) / tls
  3300, // troxe-api
  3306, 5432, 6379, // mysql, postgres, redis
  2019, // caddy admin
  4192, 4193, 4194, // udp port-guard diagnostics
];

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
 * Why a proposed range was refused. Returned (not thrown) so the admin
 * endpoint and the unit tests share exactly one definition of "bad range".
 */
export type RangeRejection =
  | 'not_integers'
  | 'privileged'
  | 'out_of_bounds'
  | 'inverted'
  | 'too_small'
  | 'overlaps_ephemeral'
  | 'overlaps_other_node';

/**
 * A range must leave room to actually allocate: below this the random-pick +
 * retry allocator starts colliding with itself under load.
 */
export const MIN_RANGE_SPAN = 64;

/** How many usable (non-reserved) ports a range actually offers. */
export function usablePortCount(range: { from: number; to: number }): number {
  let n = 0;
  for (let p = range.from; p <= range.to; p++) if (!RESERVED_PORTS.includes(p)) n++;
  return n;
}

/**
 * Validate a proposed range against every rule a node port pool must obey.
 *
 * `otherRanges` are the ranges already claimed by OTHER nodes. Two nodes on
 * different hosts may share a range, but on the same host two pools that
 * overlap would hand the same host port to two different daemons — Docker
 * would refuse the second bind and the allocation would silently leak. The
 * caller passes only the ranges that share a host (today: the local node).
 */
export function validateRange(
  range: { from: number; to: number },
  otherRanges: Array<{ from: number; to: number }> = [],
): RangeRejection | null {
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to)) return 'not_integers';
  if (range.from < 1024) return 'privileged';
  if (range.to > 65535) return 'out_of_bounds';
  if (range.from > range.to) return 'inverted';
  // a range made entirely of reserved platform ports is useless even if wide
  if (usablePortCount(range) < MIN_RANGE_SPAN) return 'too_small';
  // the kernel hands out 32768-60999 as outbound SOURCE ports; a listener
  // there races the host's own connections
  if (range.to >= EPHEMERAL_PORT_RANGE.from && range.from <= EPHEMERAL_PORT_RANGE.to) return 'overlaps_ephemeral';
  for (const other of otherRanges) {
    if (!isValidRange(other)) continue;
    if (range.from <= other.to && other.from <= range.to) return 'overlaps_other_node';
  }
  return null;
}

/** Human text for a rejection, shown verbatim in the admin dashboard. */
export function explainRange(rejection: RangeRejection, range: { from: number; to: number }): string {
  switch (rejection) {
    case 'not_integers':
      return 'Port range bounds must be whole numbers.';
    case 'privileged':
      return 'Port range must start at 1024 or above — privileged ports are never allocated to sandboxes.';
    case 'out_of_bounds':
      return 'Port range must end at 65535 or below.';
    case 'inverted':
      return `Port range is empty (${range.from} > ${range.to}).`;
    case 'too_small':
      return `Port range offers fewer than ${MIN_RANGE_SPAN} usable ports — the allocator would collide with itself.`;
    case 'overlaps_ephemeral':
      return `Port range overlaps the kernel's outbound port range (${EPHEMERAL_PORT_RANGE.from}-${EPHEMERAL_PORT_RANGE.to}); published ports there collide with the host's own connections.`;
    case 'overlaps_other_node':
      return 'Port range overlaps a range already used by another node on this host.';
  }
}

/**
 * Deterministic, bounded candidate order for one allocation attempt.
 *
 * Pure so the retry policy is unit-testable without a database. `salt` (the
 * attempt number) rotates the start offset so repeated attempts do not probe
 * the same low ports first; the scan then walks forward and wraps, so a nearly
 * full pool still finds the tail instead of spinning on a busy prefix.
 */
export function candidatePorts(range: { from: number; to: number }, salt: number): number[] {
  const span = range.to - range.from + 1;
  if (span <= 0) return [];
  const out: number[] = [];
  const start = ((salt >>> 0) % span) + range.from;
  for (let i = 0; i < span; i++) {
    const p = start + i;
    out.push(p > range.to ? p - span : p);
  }
  return out;
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