import { strict as assert } from 'node:assert';
import {
  applyTemplate,
  labelFor,
  resolveEggEnv,
  resolveVersion,
  RUNTIME_IMAGES,
} from '../src/modules/servers/provisioning/images';

export function testImages() {
  // applyTemplate: substitution
  assert.equal(applyTemplate('node {{MAIN_FILE}} {{NODE_ARGS}}', [
    { k: 'MAIN_FILE', v: 'app.js' },
    { k: 'NODE_ARGS', v: '--watch' },
  ]), 'node app.js --watch');

  // applyTemplate: unknown variable fails fast (no silent wrong boot)
  assert.throws(() => applyTemplate('node {{NOPE}}', [{ k: 'MAIN_FILE', v: 'a' }]), /unknown startup variable/);

  // applyTemplate: unsafe values are shell-quoted, safe ones are bare
  assert.equal(applyTemplate('run {{A}}', [{ k: 'A', v: 'simple_1' }]), 'run simple_1');
  assert.equal(applyTemplate('run {{A}}', [{ k: 'A', v: 'has space' }]), "run 'has space'");
  assert.equal(applyTemplate('run {{A}}', [{ k: 'A', v: "o'clock" }]), `run 'o'\\''clock'`);
  assert.equal(applyTemplate('run {{A}} {{A}}', [{ k: 'A', v: 'x' }]), 'run x x');

  // resolveVersion: default is versions[0], unknown throws
  assert.equal(resolveVersion('Node.js').version, RUNTIME_IMAGES['Node.js'].versions[0].version);
  assert.equal(resolveVersion('Node.js', '22').label, 'Node.js 22');
  assert.throws(() => resolveVersion('Node.js', '99'), /unsupported version/);
  assert.throws(() => resolveVersion('Nope'), /unsupported runtime/);

  // labelFor: digest maps to version label, never leaks the digest
  const node22 = RUNTIME_IMAGES['Node.js'].versions.find((v) => v.version === '22')!;
  assert.equal(labelFor('Node.js', node22.image), 'Node.js 22');
  assert.ok(!labelFor('Node.js', node22.image).includes('sha256'));
  assert.equal(labelFor('Node.js', 'unknown-digest'), RUNTIME_IMAGES['Node.js'].label);
  assert.equal(labelFor('Node.js', null), RUNTIME_IMAGES['Node.js'].label);

  // resolveEggEnv: user wins, defaults fill gaps, unknown keys pass through
  assert.deepEqual(
    resolveEggEnv('Node.js', [{ k: 'MAIN_FILE', v: 'srv.js' }]),
    [{ k: 'MAIN_FILE', v: 'srv.js' }, { k: 'NODE_ARGS', v: '' }],
  );
  assert.deepEqual(resolveEggEnv('Node.js', []), [
    { k: 'MAIN_FILE', v: 'index.js' },
    { k: 'NODE_ARGS', v: '' },
  ]);
}
