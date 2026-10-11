import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  availableVersions,
  defaultMainFile,
  extensionMatchesRuntime,
  migrateEnvForRuntime,
  recommendedStartup,
  runtimeChangeWarnings,
} from '../../src/modules/servers/runtime-switch.ts';

/**
 * Runtime switching. The rules that protect the user's data and prevent a
 * broken server: only the platform's runtimes are switchable, the user's own
 * variables survive, the runtime machinery is re-derived, and every
 * detectable breakage is reported instead of hidden.
 */
describe('env migration on a runtime change', () => {
  const env = [
    { k: 'MAIN_FILE', v: 'index.js' },
    { k: 'NODE_ARGS', v: '--enable-source-maps' },
    { k: 'DISCORD_TOKEN', v: 'secret-value' },
    { k: 'FEATURE_FLAG', v: 'on' },
  ];

  it('keeps the user variables and drops only the old runtime machinery', () => {
    const out = migrateEnvForRuntime({ env, fromRuntime: 'Node.js', toRuntime: 'Python' });
    const keys = out.map((e) => e.k);
    assert.ok(keys.includes('DISCORD_TOKEN'), 'a secret must never be dropped');
    assert.ok(keys.includes('FEATURE_FLAG'), 'user config must survive');
    assert.ok(!keys.includes('MAIN_FILE'), 'the old entry point is meaningless under Python');
    assert.ok(!keys.includes('NODE_ARGS'), 'node flags are not python flags');
    assert.equal(out.find((e) => e.k === 'DISCORD_TOKEN')?.v, 'secret-value');
  });

  it('is a no-op inside the same runtime', () => {
    assert.deepEqual(migrateEnvForRuntime({ env, fromRuntime: 'Node.js', toRuntime: 'Node.js' }), env);
  });
});

describe('extension compatibility', () => {
  it('recognises a matching entry point', () => {
    assert.equal(extensionMatchesRuntime('main.py', 'Python'), true);
    assert.equal(extensionMatchesRuntime('index.js', 'Node.js'), true);
    assert.equal(extensionMatchesRuntime('index.ts', 'Bun'), true);
    assert.equal(extensionMatchesRuntime('app.php', 'PHP'), true);
  });

  it('flags a mismatched entry point', () => {
    assert.equal(extensionMatchesRuntime('index.js', 'Python'), false);
    assert.equal(extensionMatchesRuntime('main.py', 'Node.js'), false);
  });

  it('returns null when there is nothing to check', () => {
    assert.equal(extensionMatchesRuntime(null, 'Python'), null);
    assert.equal(extensionMatchesRuntime('', 'Python'), null);
  });
});

describe('warnings are honest and specific', () => {
  it('warns about a mismatched main file and lost dependencies', () => {
    const w = runtimeChangeWarnings({
      fromRuntime: 'Node.js',
      toRuntime: 'Python',
      mainFile: 'index.js',
      mainFileExists: true,
      hasDependencies: true,
    });
    assert.equal(w.length, 2);
    assert.match(w[0], /main\.py/);
    assert.match(w[1], /will not run under Python/);
  });

  it('warns when the file is missing', () => {
    const w = runtimeChangeWarnings({
      fromRuntime: 'Node.js',
      toRuntime: 'Bun',
      mainFile: 'src/main.js',
      mainFileExists: false,
      hasDependencies: false,
    });
    assert.ok(w.some((x) => x.includes('was not found')));
  });

  it('stays quiet when nothing detectable breaks', () => {
    const w = runtimeChangeWarnings({
      fromRuntime: 'Node.js',
      toRuntime: 'Python',
      mainFile: 'main.py',
      mainFileExists: true,
      hasDependencies: false,
    });
    assert.equal(w.length, 0);
  });

  it('says so when nothing but the version changes', () => {
    const w = runtimeChangeWarnings({
      fromRuntime: 'Node.js',
      toRuntime: 'Node.js',
      mainFile: 'index.js',
      mainFileExists: true,
      hasDependencies: true,
    });
    assert.equal(w.length, 1);
    assert.match(w[0], /only the version changes/);
  });
});

describe('defaults come from the runtime allowlist', () => {
  it('derives the entry point per runtime', () => {
    assert.equal(defaultMainFile('Node.js'), 'index.js');
    assert.equal(defaultMainFile('Python'), 'main.py');
    assert.equal(defaultMainFile('PHP'), 'index.php');
  });

  it('recommends a startup that references the entry point', () => {
    assert.match(recommendedStartup('Node.js'), /MAIN_FILE/);
    assert.match(recommendedStartup('Python'), /MAIN_FILE/);
  });

  it('offers only the versions that exist', () => {
    for (const runtime of ['Node.js', 'Python', 'Bun', 'PHP']) {
      const versions = availableVersions(runtime);
      assert.ok(versions.length > 0, `${runtime} must have versions`);
      assert.equal(new Set(versions.map((v) => v.version)).size, versions.length, 'unique selectors');
    }
  });
});
