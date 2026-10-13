/**
 * Regression test for the `/bin/sh: 2: Syntax error: ";" unexpected` failure.
 *
 * The bug: `prelude` + `startup` were concatenated WITHOUT a separator, so a
 * compiled build step ending in `fi` produced `finode index.js` — a syntax
 * error that killed the container before the app ran at all. It hit every
 * Node/Go/Rust/Java/.NET template, i.e. half the catalog.
 *
 * Why it must be checked with REAL dash and not just `sh -n` on the host: the
 * host `sh` is bash, which parses things the minimal POSIX shell in the Debian
 * sandbox rejects. So each generated script is written to a file and run
 * through `dash -n` inside the image the sandbox actually uses.
 *
 * Level 2 (static): builds every template's script and proves the line the
 * container executes parses.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSandboxConfig } from '../../src/modules/servers/provisioning/sandbox.ts';
import { TEMPLATES } from '../../src/modules/servers/templates/catalog.ts';
import { runtimeImage } from '../../src/modules/servers/provisioning/images.ts';

function scriptForTemplate(t: (typeof TEMPLATES)[number], startup = 'node index.js'): string {
  const cfg = buildSandboxConfig({
    serverId: '00000000-0000-4000-8000-000000000000',
    ownerId: '00000000-0000-4000-8000-000000000001',
    image: runtimeImage(t.runtime),
    startup,
    env: [],
    cpuMilli: 250,
    ramMb: 512,
    networkName: 'net_x',
    volumeName: 'vol_x',
    autoRestart: true,
    pidsLimit: 256,
    template: t,
  });
  return cfg.Cmd![2] as string;
}

describe('prelude/startup separation (the ";" unexpected regression)', () => {
  it('never concatenates the prelude and the startup command', () => {
    for (const t of TEMPLATES) {
      const script = scriptForTemplate(t);
      const cmdLine = script.split('\n')[1]!;
      // the exact failure signature: a closing keyword fused to the command
      assert.doesNotMatch(cmdLine, /\bfi[a-z]/, `${t.id}: 'fi' fused to the startup command`);
      // and no doubled separator
      assert.doesNotMatch(cmdLine, /;\s*;/, `${t.id}: doubled ';'`);
    }
  });

  it('always emits a separator before the startup command', () => {
    for (const t of TEMPLATES) {
      const script = scriptForTemplate(t);
      const cmdLine = script.split('\n')[1]!;
      assert.match(cmdLine, /;\s*\S|&&\s*\S/, `${t.id}: nothing separates the prelude from the startup`);
    }
  });

  it('produces a script the sandbox shell (dash) accepts', () => {
    // A file-based `dash -n` inside the Debian image the sandbox really runs.
    // Skipped (not failed) when Docker is unavailable, so the suite stays green
    // on a laptop but still catches the bug when it matters.
    let docker = true;
    try {
      execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', stdio: 'ignore' });
    } catch {
      docker = false;
    }
    if (!docker) {
      console.log('    (docker unavailable — skipping the dash parse check)');
      return;
    }

    const file = join(tmpdir(), `troxe-startup-${process.pid}.sh`);
    const failures: string[] = [];
    for (const t of TEMPLATES) {
      writeFileSync(file, scriptForTemplate(t));
      try {
        execFileSync('docker', ['run', '--rm', '--entrypoint', 'dash', '-v', `${file}:/w.sh:ro`, 'node:24-bookworm-slim', '-n', '/w.sh'], {
          encoding: 'utf8',
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 60_000,
        });
      } catch (e) {
        failures.push(`${t.id}: ${String((e as { stderr?: string }).stderr ?? '').trim().slice(0, 160)}`);
      }
    }
    try { unlinkSync(file); } catch { /* ignore */ }

    assert.deepEqual(failures, [], 'scripts the sandbox shell rejects:\n' + failures.join('\n'));
  });

  it('keeps the legacy (pre-template) path working and syntactically valid', () => {
    // A row created before templates existed has no `template` and must keep
    // taking the legacy per-runtime prelude. It does NOT need the `&& ` join
    // preserved — that trailing `&&` is precisely what produced
    // `fi &&; node index.js` and killed these servers. What must be preserved
    // is that the SAME install work still runs.
    const cfg = buildSandboxConfig({
      serverId: '00000000-0000-4000-8000-000000000000',
      ownerId: '00000000-0000-4000-8000-000000000001',
      image: runtimeImage('Node.js'),
      startup: 'node index.js',
      env: [],
      cpuMilli: 250,
      ramMb: 512,
      networkName: 'net_x',
      volumeName: 'vol_x',
      autoRestart: true,
      pidsLimit: 256,
    });
    const cmdLine = (cfg.Cmd![2] as string).split('\n')[1]!;
    // the legacy npm install guard still runs
    assert.match(cmdLine, /npm install --no-audit --no-fund/, 'the legacy install step disappeared');
    assert.match(cmdLine, /troxe-deps-/, 'the legacy hash-marker cache disappeared');
    // and the dangling `&&` is gone, so dash accepts it
    assert.doesNotMatch(cmdLine, /&&\s*;/, 'a dangling && is still glued before the startup');
    assert.match(cmdLine, /fi; node index\.js$/, 'the startup command is not cleanly separated');
  });
});