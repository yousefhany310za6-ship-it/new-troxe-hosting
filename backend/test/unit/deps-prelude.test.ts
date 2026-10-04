import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { depsPrelude } from '../../src/modules/servers/provisioning/sandbox.ts';

describe('depsPrelude', () => {
  it('builds a gated, bounded, marker-tracked install for Node.js', () => {
    const node = depsPrelude('Node.js');
    assert.ok(node.endsWith(' && '), 'prelude is &&-chainable');
    assert.ok(node.includes('[ -f package.json ]'), 'gated on the manifest');
    assert.ok(node.includes('npm install'), 'always install (never ci: a hand-edited manifest routinely drifts ahead of the lock)');
    assert.ok(!node.includes('npm ci'), 'no ci branch');
    assert.ok(node.includes('--no-audit --no-fund'), 'quiet flags');
    assert.ok(node.includes('sha256sum package.json'), 'change detection');
    assert.ok(node.includes('.troxe-deps-'), 'hash marker');
    assert.ok(node.includes('timeout 600'), 'bounded install');
  });

  it('uses bun for Bun and pip --user for Python, nothing for PHP', () => {
    const bun = depsPrelude('Bun');
    assert.ok(bun.includes('bun install') && !bun.includes('npm '), 'bun uses bun');
    const py = depsPrelude('Python');
    assert.ok(py.includes('[ -f requirements.txt ]'), 'gated on requirements');
    assert.ok(py.includes('pip install --user -r requirements.txt'), 'user install into /data HOME');
    assert.ok(py.includes('.troxe-deps-'), 'hash marker');
    // php:8.3-cli ships no composer — the command must stay untouched
    assert.equal(depsPrelude('PHP'), '');
  });

  it('marker protocol holds through a real sh (install once, skip, rotate)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'troxe-deps-'));
    const stubDir = mkdtempSync(join(tmpdir(), 'troxe-bin-'));
    try {
      const prelude = depsPrelude('Node.js');
      // stub npm: record invocations, fake a node_modules drop (offline-safe)
      writeFileSync(join(stubDir, 'npm'), `#!/bin/sh\necho "npm-stub $@" >> ${dir}/npm.calls\nmkdir -p node_modules\n`, {
        mode: 0o755,
      });
      writeFileSync(join(dir, 'package.json'), '{"dependencies":{}}');
      const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH}` };
      // NOTE: no `VAR=x cmd` prefix here — dash rejects an assignment
      // before a compound command (`if`), so PATH travels via env instead
      const runPrelude = () =>
        spawnSync('sh', ['-c', `cd ${dir} && ${prelude}true`], { encoding: 'utf8', env });
      const markers = () => readdirSync(dir).filter((f) => f.startsWith('.troxe-deps-'));

      const r1 = runPrelude();
      assert.equal(r1.status, 0, `prelude failed: ${r1.stderr}`);
      assert.ok(readFileSync(join(dir, 'npm.calls'), 'utf8').includes('npm-stub'), 'install ran on fresh manifest');
      const markers1 = markers();
      assert.equal(markers1.length, 1, 'exactly one marker written');

      rmSync(join(dir, 'npm.calls'));
      const r2 = runPrelude();
      assert.equal(r2.status, 0, `rerun failed: ${r2.stderr}`);
      assert.ok(!existsSync(join(dir, 'npm.calls')), 'unchanged manifest skips install');

      writeFileSync(join(dir, 'package.json'), '{"dependencies":{"x":"1.0.0"}}');
      const r3 = runPrelude();
      assert.equal(r3.status, 0, `changed-manifest run failed: ${r3.stderr}`);
      const markers2 = markers();
      assert.equal(markers2.length, 1, 'old marker rotated, not accumulated');
      assert.notEqual(markers2[0], markers1[0], 'marker tracks the new hash');
      assert.ok(existsSync(join(dir, 'npm.calls')), 'changed manifest reinstalls');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(stubDir, { recursive: true, force: true });
    }
  });
});
