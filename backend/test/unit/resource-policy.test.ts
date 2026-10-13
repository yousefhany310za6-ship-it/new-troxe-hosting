import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  RESOURCE_HARD_MAX,
  RESOURCE_KEYS,
  RESOURCE_MIN,
  RESOURCE_STEP,
  formatResource,
  platformHardMax,
  poolCeiling,
  resolveLimits,
  resolveRequest,
  sameGrant,
  serverHeadroom,
  snapToStep,
} from '../../src/modules/servers/resource-policy.ts';

/** A Pro-like plan with explicit pools. */
const pro = {
  id: 'pro',
  name: 'Pro',
  cpuMilli: 500,
  ramMb: 512,
  storageGb: 5,
  poolCpuMilli: 1500,
  poolRamMb: 1536,
  poolStorageGb: 15,
  maxServers: 3,
};

const legacy = { ...pro, poolCpuMilli: null, poolRamMb: null, poolStorageGb: null };

describe('plan pools', () => {
  it('reads a NULL pool as perServer × maxServers (pre-0026 rows)', () => {
    assert.equal(poolCeiling(legacy, 'cpuMilli'), 500 * 3);
    assert.equal(poolCeiling(legacy, 'ramMb'), 512 * 3);
    assert.equal(poolCeiling(legacy, 'storageGb'), 5 * 3);
  });

  it('never lets a pool fall below a single server', () => {
    const broken = { ...pro, poolCpuMilli: 10, poolRamMb: 10, poolStorageGb: 1 };
    assert.equal(poolCeiling(broken, 'cpuMilli'), 500);
    assert.equal(poolCeiling(broken, 'ramMb'), 512);
    assert.equal(poolCeiling(broken, 'storageGb'), 5);
  });

  it('reads a zero pool as "unset" (legacy fallback), never as "nothing"', () => {
    const zeroed = { ...pro, poolCpuMilli: 0, poolRamMb: 0, poolStorageGb: 0 };
    assert.equal(poolCeiling(zeroed, 'cpuMilli'), 1500);
    assert.equal(poolCeiling(zeroed, 'ramMb'), 1536);
    assert.equal(poolCeiling(zeroed, 'storageGb'), 15);
  });

  it('caps everything at the platform maximum', () => {
    const absurd = { ...pro, poolCpuMilli: 999_999, poolRamMb: 999_999, poolStorageGb: 999_999 };
    for (const key of RESOURCE_KEYS) assert.equal(poolCeiling(absurd, key), RESOURCE_HARD_MAX[key]);
  });

  it('counts server headroom against both the plan and the platform cap', () => {
    assert.equal(serverHeadroom(pro, 0, 10), 3);
    assert.equal(serverHeadroom(pro, 2, 10), 1);
    assert.equal(serverHeadroom(pro, 3, 10), 0);
    assert.equal(serverHeadroom(pro, 0, 2), 2); // platform cap binds
    assert.equal(serverHeadroom(pro, 9, 10), 0); // never negative
  });
});

describe('step grid', () => {
  it('snaps to round numbers and never under the floor', () => {
    assert.equal(snapToStep(137, 'ramMb'), 128);
    assert.equal(snapToStep(200, 'ramMb'), 256);
    assert.equal(snapToStep(1237, 'cpuMilli'), 1250);
    assert.equal(snapToStep(1, 'cpuMilli'), RESOURCE_MIN.cpuMilli);
    assert.equal(snapToStep(Number.NaN, 'storageGb'), RESOURCE_MIN.storageGb);
  });

  it('keeps every step divisible by itself and above the floor', () => {
    for (const key of RESOURCE_KEYS) assert.ok(RESOURCE_STEP[key] >= 1 && RESOURCE_MIN[key] >= 1);
  });
});

describe('limits for one account', () => {
  it('derives "available" from the pool minus what the other servers hold', () => {
    const limits = resolveLimits(pro, { servers: 1, cpuMilli: 500, ramMb: 512, storageGb: 5 });
    assert.equal(limits.cpuMilli.poolMax, 1500);
    assert.equal(limits.cpuMilli.used, 500);
    assert.equal(limits.cpuMilli.available, 1000);
    assert.equal(limits.ramMb.available, 1024);
    assert.equal(limits.storageGb.available, 10);
  });

  it('never offers more per server than the plan allows', () => {
    const limits = resolveLimits(pro, { servers: 0, cpuMilli: 0, ramMb: 0, storageGb: 0 });
    assert.equal(limits.cpuMilli.max, 500);
    assert.equal(limits.ramMb.max, 512);
    assert.equal(limits.storageGb.max, 5);
  });

  it('marks a resource exhausted when the pool has less than the floor left', () => {
    const limits = resolveLimits(pro, { servers: 3, cpuMilli: 1500, ramMb: 1536, storageGb: 15 });
    for (const key of RESOURCE_KEYS) assert.equal(limits[key].exhausted, true);
  });

  it('clamps "used" to the pool when an admin lowered the plan afterwards', () => {
    const limits = resolveLimits(pro, { servers: 2, cpuMilli: 5000, ramMb: 5000, storageGb: 5000 });
    assert.equal(limits.cpuMilli.used, 1500);
    assert.equal(limits.cpuMilli.available, 0);
    assert.equal(limits.cpuMilli.exhausted, true);
  });
});

describe('resolving a request', () => {
  const empty = resolveLimits(pro, { servers: 0, cpuMilli: 0, ramMb: 0, storageGb: 0 });

  it('grants exactly what was asked when it fits', () => {
    const out = resolveRequest({ limits: empty, requested: { cpuMilli: 250, ramMb: 256, storageGb: 2 } });
    assert.equal(out.ok, true);
    assert.deepEqual(out.grant, { cpuMilli: 250, ramMb: 256, storageGb: 2 });
  });

  it('falls back to the plan defaults when nothing was asked', () => {
    const out = resolveRequest({ limits: empty });
    assert.equal(out.ok, true);
    assert.deepEqual(out.grant, { cpuMilli: 500, ramMb: 512, storageGb: 5 });
  });

  it('never grants more than the account pool has left', () => {
    const spent = resolveLimits(pro, { servers: 2, cpuMilli: 1250, ramMb: 1280, storageGb: 13 });
    const out = resolveRequest({ limits: spent, requested: { cpuMilli: 1000, ramMb: 512, storageGb: 1 } });
    assert.equal(out.ok, false);
    assert.equal(out.refusal.code, 'QUOTA_CPU');
    const granted = resolveRequest({ limits: spent, requested: { cpuMilli: 200, ramMb: 128, storageGb: 1 } });
    assert.equal(granted.ok, true);
    assert.equal(granted.grant.cpuMilli, 200);
  });

  it('never grants more than the per-server ceiling, even with pool to spare', () => {
    const out = resolveRequest({ limits: empty, planName: 'Pro', requested: { cpuMilli: 900 } });
    assert.equal(out.ok, false);
    assert.equal(out.refusal.code, 'QUOTA_CPU');
    assert.match(out.refusal.message, /Pro/);
    assert.match(out.refusal.message, /per server/);
  });

  it('refuses a pool with nothing left, and says why', () => {
    const spent = resolveLimits(pro, { servers: 3, cpuMilli: 1500, ramMb: 512, storageGb: 5 });
    const out = resolveRequest({ limits: spent, planName: 'Pro' });
    assert.equal(out.ok, false);
    assert.equal(out.refusal.code, 'QUOTA_CPU'); // the first exhausted resource
    assert.match(out.refusal.message, /Pro/);
  });

  it('honours a platform maximum lowered by config (never above the constant)', () => {
    assert.deepEqual(platformHardMax(), { cpuMilli: 8000, ramMb: 24576, storageGb: 100 });
    assert.deepEqual(platformHardMax({ cpuMilli: 2000, ramMb: 999_999 }), {
      cpuMilli: 2000,
      ramMb: 24576,
      storageGb: 100,
    });
    const tight = resolveRequest({
      limits: empty,
      override: true,
      hardMax: { cpuMilli: 1500 },
      requested: { cpuMilli: 4000 },
    });
    assert.equal(tight.ok, false);
    assert.equal(tight.refusal.code, 'RESOURCE_OUT_OF_RANGE');
    const roomy = resolveRequest({ limits: empty, override: true, hardMax: { cpuMilli: 1500 }, requested: { cpuMilli: 1000 } });
    assert.equal(roomy.ok, true);
    assert.equal(roomy.grant.cpuMilli, 1000);
  });

  it('lets an explicit admin override exceed the plan but not the platform', () => {
    const out = resolveRequest({ limits: empty, planName: 'Pro', override: true, requested: { cpuMilli: 4000, ramMb: 4096, storageGb: 40 } });
    assert.equal(out.ok, true);
    assert.equal(out.grant.cpuMilli, 4000);

    const tooFar = resolveRequest({ limits: empty, override: true, requested: { cpuMilli: RESOURCE_HARD_MAX.cpuMilli + 1 } });
    assert.equal(tooFar.ok, false);
    assert.equal(tooFar.refusal.code, 'RESOURCE_OUT_OF_RANGE');

    const tooSmall = resolveRequest({ limits: empty, override: true, requested: { ramMb: 1 } });
    assert.equal(tooSmall.ok, false);
    assert.equal(tooSmall.refusal.code, 'RESOURCE_OUT_OF_RANGE');
  });

  it('reports no change when nothing moved', () => {
    assert.equal(sameGrant({ cpuMilli: 100, ramMb: 128, storageGb: 1 }, { cpuMilli: 100, ramMb: 128, storageGb: 1 }), true);
    assert.equal(sameGrant({ cpuMilli: 100, ramMb: 128, storageGb: 1 }, { cpuMilli: 150, ramMb: 128, storageGb: 1 }), false);
  });
});

describe('formatting', () => {
  it('shows CPU as vCPU and memory in GB when it divides evenly', () => {
    assert.equal(formatResource('cpuMilli', 500), '0.5 vCPU');
    assert.equal(formatResource('cpuMilli', 1000), '1 vCPU');
    assert.equal(formatResource('ramMb', 512), '512 MB');
    assert.equal(formatResource('ramMb', 2048), '2 GB');
    assert.equal(formatResource('storageGb', 15), '15 GB');
  });
});