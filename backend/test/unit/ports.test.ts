import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  DEFAULT_PORT_RANGE,
  EPHEMERAL_PORT_RANGE,
  MIN_RANGE_SPAN,
  RESERVED_PORTS,
  candidatePorts,
  explainRange,
  formatAddress,
  isAllocatablePort,
  isValidRange,
  resolvePublicHost,
  usablePortCount,
  validateRange,
} from '../../src/modules/servers/ports-policy.ts';

describe('port range discipline', () => {
  it('stays inside unprivileged, valid TCP ports', () => {
    assert.ok(DEFAULT_PORT_RANGE.from >= 1024);
    assert.ok(DEFAULT_PORT_RANGE.to <= 65535);
    assert.ok(DEFAULT_PORT_RANGE.from <= DEFAULT_PORT_RANGE.to);
  });

  it('is wide enough to host a real fleet', () => {
    const span = DEFAULT_PORT_RANGE.to - DEFAULT_PORT_RANGE.from + 1;
    assert.ok(span >= 1000, `pool too small: ${span}`);
    assert.ok(usablePortCount(DEFAULT_PORT_RANGE) >= MIN_RANGE_SPAN);
  });

  it('stays clear of the Linux ephemeral range (32768-60999)', () => {
    // a pool inside the ephemeral range fights the host's own outbound
    // sockets: published ports would randomly fail with EADDRINUSE
    assert.ok(
      DEFAULT_PORT_RANGE.to < EPHEMERAL_PORT_RANGE.from || DEFAULT_PORT_RANGE.from > EPHEMERAL_PORT_RANGE.to,
      `pool ${DEFAULT_PORT_RANGE.from}-${DEFAULT_PORT_RANGE.to} overlaps the ephemeral range`,
    );
  });

  it('refuses an admin range that re-enters the ephemeral band', () => {
    assert.equal(validateRange({ from: 30000, to: 40000 }), 'overlaps_ephemeral');
    assert.match(explainRange('overlaps_ephemeral', { from: 30000, to: 40000 }), /outbound/);
    // the whole band is refused, not just its middle
    assert.equal(validateRange({ from: 32768, to: 40000 }), 'overlaps_ephemeral');
    assert.equal(validateRange({ from: 20000, to: 32768 }), 'overlaps_ephemeral');
    // and anything fully above it is fine
    assert.equal(validateRange({ from: 61000, to: 65000 }), null);
  });

  it('keeps the platform control plane out of the pool', () => {
    for (const p of RESERVED_PORTS) {
      assert.equal(isAllocatablePort(p, DEFAULT_PORT_RANGE), false, `reserved ${p} must be refused`);
    }
    // the ports this deployment actually binds must never be allocatable
    for (const p of [22, 53, 80, 443, 2019, 2376, 3300, 5432]) {
      assert.equal(isAllocatablePort(p, DEFAULT_PORT_RANGE), false, `control-plane port ${p} must be refused`);
    }
  });

  it('accepts a range inside the pool and rejects nonsense', () => {
    assert.equal(isValidRange({ from: 30000, to: 30010 }), true);
    assert.equal(isValidRange({ from: 10, to: 20 }), false); // privileged
    assert.equal(isValidRange({ from: 30010, to: 30000 }), false); // empty
    assert.equal(isValidRange({ from: 1.5, to: 10 }), false); // not integers
  });
});

describe('range validation (what an admin may set on a node)', () => {
  it('accepts a sane wide range', () => {
    assert.equal(validateRange({ from: 20000, to: 32000 }), null);
  });

  it('rejects privileged bounds', () => {
    assert.equal(validateRange({ from: 80, to: 39999 }), 'privileged');
    assert.match(explainRange('privileged', { from: 80, to: 39999 }), /1024/);
  });

  it('rejects out-of-bounds and inverted ranges', () => {
    assert.equal(validateRange({ from: 20000, to: 70000 }), 'out_of_bounds');
    assert.equal(validateRange({ from: 30010, to: 30000 }), 'inverted');
  });

  it('rejects non-integers', () => {
    assert.equal(validateRange({ from: 20000.5, to: 39999 }), 'not_integers');
  });

  it('rejects a range too narrow to allocate from', () => {
    assert.equal(validateRange({ from: 20000, to: 20010 }), 'too_small');
    assert.match(explainRange('too_small', { from: 20000, to: 20010 }), /fewer than/);
  });

  it('rejects a range whose usable ports are eaten by reserved ones', () => {
    // 64 wide, but only 62 ports are actually allocatable — below the floor
    assert.equal(usablePortCount({ from: 3300, to: 3363 }), 62);
    assert.equal(validateRange({ from: 3300, to: 3363 }), 'too_small');
  });

  it('refuses a range that overlaps another node on the same host', () => {
    const others = [{ from: 20000, to: 29999 }];
    assert.equal(validateRange({ from: 25000, to: 30000 }, others), 'overlaps_other_node');
    assert.equal(validateRange({ from: 20000, to: 29998 }, others), 'overlaps_other_node');
    // touching is fine: 30000 is outside 20000-29999
    assert.equal(validateRange({ from: 30000, to: 32000 }, others), null);
    // disjoint is fine
    assert.equal(validateRange({ from: 21000, to: 29999 }, others), 'overlaps_other_node');
  });

  it('allows the exact same range when the other node is on a different host', () => {
    // callers only pass siblings sharing a host, so an empty list means "no
    // conflict possible" — the same range is then fine
    assert.equal(validateRange({ from: 20000, to: 32000 }, []), null);
  });
});

describe('candidate ordering', () => {
  it('covers the whole range exactly once, with no duplicates', () => {
    const range = { from: 100, to: 140 };
    const seen = candidatePorts(range, 0);
    assert.equal(seen.length, 41);
    assert.equal(new Set(seen).size, 41);
    assert.equal(Math.min(...seen), 100);
    assert.equal(Math.max(...seen), 140);
  });

  it('rotates the starting offset per attempt but still covers everything', () => {
    const range = { from: 20000, to: 20009 };
    const a = candidatePorts(range, 0);
    const b = candidatePorts(range, 3);
    assert.equal(new Set(a).size, 10);
    assert.equal(new Set(b).size, 10);
    assert.notDeepEqual(a, b, 'a different salt must not start in the same place');
  });

  it('finds a free tail port even when the prefix is full', () => {
    // the ordered walk is what makes a 99%-full pool work at all
    const range = { from: 20000, to: 20020 };
    const order = candidatePorts(range, 0);
    const taken = new Set(order.slice(0, 20));
    assert.ok(!taken.has(order[20]), 'the 21st candidate must still be offered');
  });

  it('returns nothing for an empty range', () => {
    assert.deepEqual(candidatePorts({ from: 10, to: 9 }, 0), []);
  });
});

describe('which ports a sandbox may take', () => {
  it('allows a port inside the range', () => {
    assert.equal(isAllocatablePort(30042), true);
  });

  it('refuses privileged ports, out-of-range ports and the reserved set', () => {
    assert.equal(isAllocatablePort(80), false);
    assert.equal(isAllocatablePort(22), false);
    assert.equal(isAllocatablePort(19999), false); // just below the pool
    assert.equal(isAllocatablePort(32001), false); // just above the pool
    for (const p of RESERVED_PORTS) assert.equal(isAllocatablePort(p), false, `reserved ${p} must be refused`);
  });

  it('refuses non-integers', () => {
    assert.equal(isAllocatablePort(20000.5), false);
    assert.equal(isAllocatablePort(Number.NaN), false);
  });

  it('honours a node-specific range over the platform default', () => {
    const nodeRange = { from: 25000, to: 25999 };
    assert.equal(isAllocatablePort(25050, nodeRange), true);
    assert.equal(isAllocatablePort(30050, nodeRange), false, 'in the default pool but not this node pool');
  });
});

describe('public host resolution', () => {
  it('prefers the node host, then the global setting, then the daemon host', () => {
    assert.equal(
      resolvePublicHost({ nodePublicHost: 'node.hosting.troxe.dev', globalHost: 'g.example.com', daemonHost: '10.0.0.5' }),
      'node.hosting.troxe.dev',
    );
    assert.equal(resolvePublicHost({ nodePublicHost: null, globalHost: 'g.example.com', daemonHost: '10.0.0.5' }), 'g.example.com');
    assert.equal(resolvePublicHost({ nodePublicHost: null, globalHost: null, daemonHost: '10.0.0.5' }), '10.0.0.5');
  });

  it('treats blank values as unset and returns null when nothing is configured', () => {
    assert.equal(resolvePublicHost({ nodePublicHost: '   ', daemonHost: '' }), null);
    assert.equal(resolvePublicHost({}), null);
  });
});

describe('address formatting', () => {
  it('is host:port without a scheme', () => {
    assert.equal(formatAddress('node.hosting.troxe.dev', 20125), 'node.hosting.troxe.dev:20125');
    assert.equal(formatAddress('203.0.113.10', 20001), '203.0.113.10:20001');
  });
});