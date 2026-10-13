import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  RESOURCE_HARD_MAX,
  RESOURCE_KEYS,
  RESOURCE_MIN,
  RESOURCE_STEP,
  budgetCeiling,
  formatResource,
  platformHardMax,
  resolveLimits,
  resolveRequest,
  sameGrant,
  serverHeadroom,
  snapToStep,
} from '../../src/modules/servers/resource-policy.ts';

/**
 * A plan row. `cpuMilli/ramMb/storageGb` are the ACCOUNT's budget — the whole
 * thing, to be divided across every server the owner holds.
 */
const pro = { id: 'pro', name: 'Pro', cpuMilli: 500, ramMb: 512, storageGb: 5, maxServers: 3 };
const platinum = { id: 'platinum', name: 'Platinum', cpuMilli: 1500, ramMb: 3072, storageGb: 12, maxServers: 12 };
const free = { id: 'free', name: 'Free', cpuMilli: 250, ramMb: 256, storageGb: 1, maxServers: 1 };

describe('the plan numbers are the account budget', () => {
  it('reports the plan value as the total, never multiplied by maxServers', () => {
    assert.equal(budgetCeiling(pro, 'cpuMilli'), 500);
    assert.equal(budgetCeiling(pro, 'ramMb'), 512);
    assert.equal(budgetCeiling(pro, 'storageGb'), 5);
    // the regression this whole model exists to prevent
    assert.equal(budgetCeiling(platinum, 'cpuMilli'), 1500);
    assert.notEqual(budgetCeiling(platinum, 'cpuMilli'), 1500 * 12);
    assert.equal(budgetCeiling(platinum, 'ramMb'), 3072);
    assert.equal(budgetCeiling(platinum, 'storageGb'), 12);
  });

  it('floors a nonsense budget at the smallest bootable server', () => {
    const broken = { ...pro, cpuMilli: 1, ramMb: 1, storageGb: 0 };
    assert.equal(budgetCeiling(broken, 'cpuMilli'), RESOURCE_MIN.cpuMilli);
    assert.equal(budgetCeiling(broken, 'ramMb'), RESOURCE_MIN.ramMb);
    assert.equal(budgetCeiling(broken, 'storageGb'), RESOURCE_MIN.storageGb);
  });

  it('caps at the platform maximum', () => {
    const absurd = { ...pro, cpuMilli: 999_999, ramMb: 999_999, storageGb: 999_999 };
    for (const key of RESOURCE_KEYS) assert.equal(budgetCeiling(absurd, key), RESOURCE_HARD_MAX[key]);
  });

  it('caps the count independently of the budget', () => {
    assert.equal(serverHeadroom(pro, 0, 10), 3);
    assert.equal(serverHeadroom(pro, 3, 10), 0);
    assert.equal(serverHeadroom(pro, 0, 2), 2); // platform cap binds
    assert.equal(serverHeadroom(platinum, 5, 10), 5); // platform cap binds (plan allows 12)
    assert.equal(serverHeadroom(platinum, 12, 10), 0);
    assert.equal(serverHeadroom(platinum, 99, 10), 0); // never negative
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

  it('keeps every step at least 1 and above the floor', () => {
    for (const key of RESOURCE_KEYS) assert.ok(RESOURCE_STEP[key] >= 1 && RESOURCE_MIN[key] >= 1);
  });
});

describe('what is left for one account', () => {
  it('subtracts what the other servers already hold', () => {
    const limits = resolveLimits(pro, { servers: 1, cpuMilli: 300, ramMb: 384, storageGb: 3 });
    assert.equal(limits.cpuMilli.total, 500);
    assert.equal(limits.cpuMilli.used, 300);
    assert.equal(limits.cpuMilli.available, 200);
    assert.equal(limits.ramMb.available, 128);
    assert.equal(limits.storageGb.available, 2);
  });

  it('gives a brand-new account the whole plan', () => {
    const limits = resolveLimits(platinum, { servers: 0, cpuMilli: 0, ramMb: 0, storageGb: 0 });
    assert.equal(limits.cpuMilli.max, 1500);
    assert.equal(limits.ramMb.max, 3072);
    assert.equal(limits.storageGb.max, 12);
  });

  it('reports nothing left when the budget is spent', () => {
    const limits = resolveLimits(pro, { servers: 3, cpuMilli: 500, ramMb: 512, storageGb: 5 });
    for (const key of RESOURCE_KEYS) {
      assert.equal(limits[key].available, 0);
      assert.equal(limits[key].exhausted, true);
    }
  });

  it('never lets the servers of one account exceed the budget, however many', () => {
    // A Platinum customer adding servers one after another, each taking
    // whatever is left. The sum must never pass 1.5 vCPU — and at some point
    // the account must simply run out.
    let spent = 0;
    let servers = 0;
    let refused = false;
    for (let i = 0; i < platinum.maxServers; i++) {
      const limits = resolveLimits(platinum, { servers, cpuMilli: spent, ramMb: 0, storageGb: 0 });
      const ask = resolveRequest({ limits, planName: 'Platinum', requested: { cpuMilli: limits.cpuMilli.max } });
      if (!ask.ok) {
        // refused: the budget is spent, and the message points at the fix
        assert.match(ask.refusal.message, /upgrade/i);
        refused = true;
        break;
      }
      spent += ask.grant.cpuMilli;
      servers++;
      assert.ok(spent <= platinum.cpuMilli, `overflowed at server ${servers}: ${spent}`);
    }
    assert.ok(refused, 'the budget must eventually run out');
    assert.ok(spent <= platinum.cpuMilli, `spent ${spent} of ${platinum.cpuMilli}`);
  });

  it('reads "used" as the whole budget after a downgrade under an account', () => {
    // admin lowers the plan while the account already holds more
    const limits = resolveLimits(free, { servers: 2, cpuMilli: 5000, ramMb: 5000, storageGb: 5000 });
    assert.equal(limits.cpuMilli.used, 250);
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

  it('defaults to the whole budget for a fresh account', () => {
    const out = resolveRequest({ limits: empty });
    assert.equal(out.ok, true);
    assert.deepEqual(out.grant, { cpuMilli: 500, ramMb: 512, storageGb: 5 });
  });

  it('grants only what is left of the shared budget', () => {
    const spent = resolveLimits(pro, { servers: 1, cpuMilli: 300, ramMb: 384, storageGb: 3 });
    const tooMuch = resolveRequest({ limits: spent, planName: 'Pro', requested: { cpuMilli: 400 } });
    assert.equal(tooMuch.ok, false);
    assert.equal(tooMuch.refusal.code, 'QUOTA_CPU');
    assert.match(tooMuch.refusal.message, /0\.2 vCPU/); // says what IS left
    assert.match(tooMuch.refusal.message, /upgrade/i); // and how to get more

    const fitting = resolveRequest({ limits: spent, requested: { cpuMilli: 200, ramMb: 128, storageGb: 1 } });
    assert.equal(fitting.ok, true);
    assert.equal(fitting.grant.cpuMilli, 200);
  });

  it('refuses outright once the budget is spent, and says how to fix it', () => {
    const spent = resolveLimits(pro, { servers: 2, cpuMilli: 500, ramMb: 512, storageGb: 5 });
    const out = resolveRequest({ limits: spent, planName: 'Pro' });
    assert.equal(out.ok, false);
    assert.equal(out.refusal.code, 'QUOTA_CPU'); // the first exhausted resource
    assert.match(out.refusal.message, /Delete a server/);
    assert.match(out.refusal.message, /upgrade/i);
  });

  it('honours a platform maximum lowered by config', () => {
    assert.deepEqual(platformHardMax(), { cpuMilli: 8000, ramMb: 24576, storageGb: 100 });
    assert.deepEqual(platformHardMax({ cpuMilli: 2000, ramMb: 999_999 }), {
      cpuMilli: 2000,
      ramMb: 24576,
      storageGb: 100,
    });
    const tight = resolveRequest({ limits: empty, override: true, hardMax: { cpuMilli: 1500 }, requested: { cpuMilli: 4000 } });
    assert.equal(tight.ok, false);
    assert.equal(tight.refusal.code, 'RESOURCE_OUT_OF_RANGE');
    const roomy = resolveRequest({ limits: empty, override: true, hardMax: { cpuMilli: 1500 }, requested: { cpuMilli: 1000 } });
    assert.equal(roomy.ok, true);
    assert.equal(roomy.grant.cpuMilli, 1000);
  });

  it('lets an explicit admin override exceed the plan but not the platform', () => {
    const out = resolveRequest({ limits: empty, override: true, requested: { cpuMilli: 4000, ramMb: 4096, storageGb: 40 } });
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
    assert.equal(formatResource('cpuMilli', 1500), '1.5 vCPU');
    assert.equal(formatResource('ramMb', 512), '512 MB');
    assert.equal(formatResource('ramMb', 3072), '3 GB');
    assert.equal(formatResource('storageGb', 12), '12 GB');
  });
});