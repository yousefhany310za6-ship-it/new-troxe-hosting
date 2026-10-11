import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  DEFAULT_PORT_RANGE,
  RESERVED_PORTS,
  formatAddress,
  isAllocatablePort,
  isValidRange,
  resolvePublicHost,
} from '../../src/modules/servers/ports-policy.ts';

describe('port range discipline', () => {
  it('stays inside unprivileged, valid TCP ports', () => {
    assert.ok(DEFAULT_PORT_RANGE.from >= 1024);
    assert.ok(DEFAULT_PORT_RANGE.to <= 65535);
    assert.ok(DEFAULT_PORT_RANGE.from <= DEFAULT_PORT_RANGE.to);
  });

  it('is wide enough that random picks find a free port under load', () => {
    const span = DEFAULT_PORT_RANGE.to - DEFAULT_PORT_RANGE.from + 1;
    assert.ok(span >= 32, `pool too small: ${span}`);
  });

  it('accepts a range inside the pool and rejects nonsense', () => {
    assert.equal(isValidRange({ from: 30000, to: 30010 }), true);
    assert.equal(isValidRange({ from: 10, to: 20 }), false); // privileged
    assert.equal(isValidRange({ from: 30010, to: 30000 }), false); // empty
    assert.equal(isValidRange({ from: 1.5, to: 10 }), false); // not integers
  });
});

describe('which ports a sandbox may take', () => {
  it('allows a port inside the range', () => {
    assert.equal(isAllocatablePort(30042), true);
  });

  it('refuses privileged ports, out-of-range ports and the reserved set', () => {
    assert.equal(isAllocatablePort(80), false);
    assert.equal(isAllocatablePort(22), false);
    assert.equal(isAllocatablePort(29999), false); // just below the pool
    assert.equal(isAllocatablePort(30101), false); // just above the pool
    for (const p of RESERVED_PORTS) assert.equal(isAllocatablePort(p), false, `reserved ${p} must be refused`);
  });

  it('refuses non-integers', () => {
    assert.equal(isAllocatablePort(30000.5), false);
    assert.equal(isAllocatablePort(Number.NaN), false);
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
    assert.equal(formatAddress('node.hosting.troxe.dev', 30125), 'node.hosting.troxe.dev:30125');
    assert.equal(formatAddress('203.0.113.10', 30001), '203.0.113.10:30001');
  });
});
