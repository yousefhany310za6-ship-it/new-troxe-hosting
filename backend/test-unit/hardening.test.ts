import { strict as assert } from 'node:assert';
import { evaluateHardeningRules } from '../src/modules/servers/provisioning/network-hardening.service';

const DESTS = ['169.254.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'];
const SUBNET = '172.21.0.0/16';
const TAG = 'troxe:net_abc123';

/** Realistic `iptables -S` output for one hardened sandbox. */
function ruleset(opts: { dropInput?: boolean; dropAddrtype?: boolean; extraTag?: string } = {}): string {
  const { dropInput = true, dropAddrtype = true, extraTag } = opts;
  const lines: string[] = ['-P FORWARD DROP'];
  for (const d of DESTS)
    lines.push(`-A DOCKER-USER -s ${SUBNET} -d ${d} -m comment --comment "${TAG}" -j DROP`);
  if (dropAddrtype)
    lines.push(`-A DOCKER-USER -s ${SUBNET} -m addrtype --dst-type LOCAL -m comment --comment "${TAG}" -j DROP`);
  if (dropInput) lines.push(`-A INPUT -s ${SUBNET} -m comment --comment "${TAG}" -j DROP`);
  if (extraTag) lines.push(`-A DOCKER-USER -s 172.99.0.0/16 -d 10.0.0.0/8 -m comment --comment "${extraTag}" -j DROP`);
  return lines.join('\n');
}

/** The static supernet ruleset node-setup.sh installs on remote nodes. */
function supernetRuleset(): string {
  const TAGN = 'troxe:node-supernet';
  const lines: string[] = [];
  for (const d of DESTS)
    lines.push(`-A DOCKER-USER -s 10.201.0.0/16 -d ${d} -m comment --comment "${TAGN}" -j DROP`);
  lines.push(`-A DOCKER-USER -s 10.201.0.0/16 -m addrtype --dst-type LOCAL -m comment --comment "${TAGN}" -j DROP`);
  lines.push(`-A INPUT -s 10.201.0.0/16 -m comment --comment "${TAGN}" -j DROP`);
  return lines.join('\n');
}

export function testHardeningEvaluation() {
  // ---- complete ruleset passes (7 = 5 egress + addrtype + INPUT)
  const full = evaluateHardeningRules(ruleset(), SUBNET, TAG, DESTS);
  assert.equal(full.ok, true, 'a complete ruleset is ok');
  assert.equal(full.expected, 7, '7 rules are required');
  assert.equal(full.found, 7, 'all 7 found');
  assert.deepEqual(full.missing, [], 'nothing missing');
  assert.deepEqual(full.stale, [], 'nothing stale');

  // ---- PARTIAL apply is what `apply()` used to wave through: >0 installed
  const partial = evaluateHardeningRules(ruleset({ dropInput: false, dropAddrtype: false }), SUBNET, TAG, DESTS);
  assert.equal(partial.ok, false, 'partial ruleset is NOT ok');
  assert.equal(partial.found, 5, 'the 5 egress rules alone are not enough');
  assert.equal(partial.missing.length, 2, 'INPUT + addrtype reported missing');
  assert.ok(partial.missing.some((m) => m.startsWith('INPUT -s')), 'names the missing INPUT rule');
  assert.ok(partial.missing.some((m) => m.includes('addrtype')), 'names the missing addrtype rule');

  // ---- an EMPTY ruleset (daemon restart flushed DOCKER-USER) reads as full drift
  const empty = evaluateHardeningRules('', SUBNET, TAG, DESTS);
  assert.equal(empty.ok, false, 'empty ruleset fails');
  assert.equal(empty.found, 0, 'nothing found');
  assert.equal(empty.missing.length, 7, 'all 7 reported missing');

  // ---- REUSE: a rule tagged for THIS network but sitting on another subnet
  const stale = evaluateHardeningRules(ruleset({ extraTag: TAG }), SUBNET, TAG, DESTS);
  assert.equal(stale.ok, false, 'a tagged rule on a foreign subnet is drift');
  assert.equal(stale.missing.length, 0, 'nothing missing — the problem is the stale rule');
  assert.equal(stale.stale.length, 1, 'one stale rule reported');
  assert.ok(stale.stale[0].includes('172.99.0.0/16'), 'stale rule quotes the offending subnet');

  // ---- another tenant's rules must NOT count as ours
  const foreign = evaluateHardeningRules(ruleset({ dropInput: false, dropAddrtype: false }), '172.98.0.0/16', TAG, DESTS);
  assert.equal(foreign.ok, false, 'wrong subnet finds none of its rules');
  assert.equal(foreign.found, 0, 'zero found for the other subnet');

  // ---- remote supernet ruleset (node-setup.sh) passes against its own tag
  const remote = evaluateHardeningRules(supernetRuleset(), '10.201.0.0/16', 'troxe:node-supernet', DESTS);
  assert.equal(remote.ok, true, 'node-setup supernet ruleset verifies');
  assert.equal(remote.expected, 7, 'same 7 rules are required');

  // ---- a supernet installed for a DIFFERENT /16 (node relocated) reads as drift
  const moved = evaluateHardeningRules(supernetRuleset(), '10.202.0.0/16', 'troxe:node-supernet', DESTS);
  assert.equal(moved.ok, false, 'wrong supernet is not hardened');
  assert.equal(moved.found, 0, 'and it finds nothing to credit');

  // ---- hostile/absurd input never throws and never reads as ok
  assert.equal(evaluateHardeningRules('DROP\n-A', SUBNET, TAG, DESTS).ok, false, 'garbage input fails closed');
  assert.equal(evaluateHardeningRules(null as unknown as string, SUBNET, TAG, DESTS).ok, false, 'null input fails closed');
}
