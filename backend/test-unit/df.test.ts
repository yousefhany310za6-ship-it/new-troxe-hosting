import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { parseDfLine } from '../src/modules/servers/provisioning/docker.service';

/**
 * The placement guard refuses a node from `df -P` output — a parse bug would
 * either block every provision (false full) or never block one (disk fills).
 */
export function testParseDf() {
  // real output from this host (`df -P /`)
  const real = execSync('df -P / | tail -1').toString();
  const u = parseDfLine(real);
  assert.ok(u, 'parses this machine\'s real df line');
  assert.ok(u.totalBytes > 0 && u.freeBytes >= 0, 'sizes are sane');
  assert.ok(u.percent >= 0 && u.percent <= 100, 'percent in range');
  // `Available` excludes fs-reserved blocks, so used+free <= total (never >)
  assert.ok(u.usedBytes + u.freeBytes <= u.totalBytes, 'columns never overflow');
  assert.ok(u.usedBytes > 0, 'this host has data on /');

  // synthetic POSIX line: capacity column wins
  const s = parseDfLine('/dev/vda1  1000000 990000 10000 99% /host');
  assert.deepEqual(s, { totalBytes: 1000000 * 1024, usedBytes: 990000 * 1024, freeBytes: 10000 * 1024, percent: 99 });

  // device labels with spaces: fields are read from the end
  const spaced = parseDfLine('overlay with spaces 2048 1024 1024 50% /host');
  assert.equal(spaced?.percent, 50);
  assert.equal(spaced?.totalBytes, 2048 * 1024);

  // malformed / hostile input must never read as "full" or "empty"
  assert.equal(parseDfLine(''), null, 'empty line rejected');
  assert.equal(parseDfLine('Filesystem 1024-blocks Used Available Capacity Mounted'), null, 'header rejected');
  assert.equal(parseDfLine('/dev/x 0 0 0 0% /'), null, 'zero-size fs rejected');
  assert.equal(parseDfLine('/dev/x 100 abc 10 10% /'), null, 'non-numeric rejected');
  assert.equal(parseDfLine('too short'), null, 'truncated line rejected');
  // absurd capacity column falls back to the computed ratio (99%), never >100
  const over = parseDfLine('/dev/x 100 99 1 1000% /');
  assert.equal(over?.percent, 99, 'bad capacity column falls back to computed');
  assert.ok((parseDfLine('/dev/x 100 100 0 100% /')?.percent ?? 0) === 100, 'true full disk reads as 100');
}
