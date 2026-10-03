import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { starterSeed, type Starter } from '../src/modules/servers/provisioning/starter';
import { RUNTIME_IMAGES } from '../src/modules/servers/provisioning/images';

/**
 * The seed only matters when a real shell executes it: quoting bugs here are
 * invisible in the source (an escaped `$` in the grep anchor silently disables
 * every seed while still exiting 0), so these cases run the fragment through
 * `sh -c` against temp directories instead of pattern-matching the string.
 */
function run(dir: string, starter?: Starter): { status: number | null; out: string } {
  // exactly what the provisioner builds, minus the chown/chmod tail
  const script = `touch ${dir}/.troxe-init && { ${starterSeed(starter, dir)}; } && echo TROXE_OK`;
  const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const temp = () => mkdtempSync(join(tmpdir(), 'troxe-starter-'));

export function testStarterSeeding() {
  const JS: Starter = {
    path: 'index.js',
    // hostile-by-construction payload: quotes, backticks, $ and newlines must
    // survive byte-for-byte because the fragment carries them as base64
    content: 'console.log("hi");\n// $HOME `id` \'quoted\' \\ backslash\n',
  };

  // ---- a virgin volume (our marker only) gets the starter, byte-identical
  const a = temp();
  const r1 = run(a, JS);
  assert.equal(r1.status, 0, `fragment failed: ${r1.out}`);
  assert.ok(existsSync(join(a, 'index.js')), 'starter written into an empty volume');
  assert.equal(readFileSync(join(a, 'index.js'), 'utf8'), JS.content, 'payload byte-identical after base64 round-trip');
  assert.ok(existsSync(join(a, '.troxe-init')), 'marker still present');

  // ---- idempotent: a second pass over the now-non-empty volume writes nothing
  const r2 = run(a, JS);
  assert.equal(r2.status, 0, `second pass failed: ${r2.out}`);
  assert.equal(readFileSync(join(a, 'index.js'), 'utf8'), JS.content, 'existing client file untouched on reinstall');

  // ---- a volume the client already owns is NEVER seeded
  const b = temp();
  writeFileSync(join(b, 'server.js'), '// my own code\n');
  const r3 = run(b, JS);
  assert.equal(r3.status, 0, `fragment failed: ${r3.out}`);
  assert.equal(existsSync(join(b, 'index.js')), false, 'client files win — no starter injected');
  assert.equal(readFileSync(join(b, 'server.js'), 'utf8'), '// my own code\n', 'client file intact');

  // ---- no starter / empty content / hostile path -> no-op statement, still valid shell
  const c = temp();
  assert.equal(starterSeed(undefined), ':', 'undefined starter is a no-op');
  assert.equal(starterSeed({ path: 'index.js', content: '' }), ':', 'empty content is a no-op');
  assert.equal(starterSeed({ path: '../escape', content: 'x' }), ':', 'path traversal refused');
  assert.equal(starterSeed({ path: 'a b', content: 'x' }), ':', 'whitespace path refused');
  assert.equal(run(c, undefined).status, 0, 'no-op fragment still composes with touch && …');

  // ---- the regression that shipped: `\$` in the grep anchor counts the marker
  // as content and skips every seed while exiting 0
  const frag = starterSeed(JS);
  assert.ok(frag.includes("grep -v '^\\.troxe-init$'"), `marker filter must anchor with a plain $: ${frag}`);
  assert.ok(!frag.includes('\\$'), `no escaped $ in the pattern: ${frag}`);
  assert.ok(frag.includes("base64 -d"), 'payload is decoded, not interpolated');

  // ---- every runtime declares a usable starter (the first-run fix covers all)
  for (const [name, rt] of Object.entries(RUNTIME_IMAGES)) {
    assert.ok(rt.starter, `${name} declares a starter`);
    assert.match(rt.starter!.path, /^[A-Za-z0-9._-]+$/, `${name} starter path is a safe token`);
    assert.ok(rt.starter!.content.length > 0, `${name} starter has content`);
    assert.notEqual(starterSeed(rt.starter), ':', `${name} produces a real seed fragment`);
  }

  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
  rmSync(c, { recursive: true, force: true });
}
