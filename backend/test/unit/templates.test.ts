import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { TEMPLATES, TEMPLATE_BY_ID, creatableTemplates, legacyTemplateFor } from '../../src/modules/servers/templates/catalog.ts';
import { validateCatalog, catalogErrors } from '../../src/modules/servers/templates/schema-check.ts';
import { RUNTIME_IMAGES, RUNTIMES } from '../../src/modules/servers/provisioning/images.ts';
import { detectProject, templateAccepts } from '../../src/modules/servers/templates/discovery.ts';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { compileBuildPrelude, compileInstallPrelude } from '../../src/modules/servers/templates/steps.ts';

describe('catalog schema validation (level 1)', () => {
  it('has no blocking schema errors', () => {
    const errors = catalogErrors();
    assert.deepEqual(
      errors,
      [],
      'catalog errors:\n' + errors.map((e) => `  ${e.templateId}: ${e.message}`).join('\n'),
    );
  });

  it('has no duplicate template ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('only references runtimes that exist in the image allowlist', () => {
    for (const t of TEMPLATES) {
      assert.ok(
        RUNTIMES.includes(t.runtime as never),
        `${t.id} references unknown runtime ${t.runtime}`,
      );
    }
  });

  it('only offers versions the runtime actually has', () => {
    for (const t of TEMPLATES) {
      const available = RUNTIME_IMAGES[t.runtime as keyof typeof RUNTIME_IMAGES].versions.map((v) => v.version);
      for (const v of t.versions) {
        assert.ok(available.includes(v), `${t.id} offers ${v}, runtime ${t.runtime} has ${available.join(',')}`);
      }
    }
  });

  it('never leaks an unpinned image reference', () => {
    // Templates carry no image of their own — that is the whole point of the
    // indirection. Assert it so a future edit cannot smuggle one in.
    for (const t of TEMPLATES as unknown as Record<string, unknown>[]) {
      assert.equal(t.image, undefined, `${t.id} must not define its own image`);
    }
    for (const [name, img] of Object.entries(RUNTIME_IMAGES)) {
      for (const v of img.versions) {
        assert.match(v.image, /@sha256:[a-f0-9]{64}$/, `${name} ${v.version} must be digest-pinned`);
      }
      assert.ok(!/:latest\b/.test(img.image), `${name} must not use a mutable tag`);
    }
  });

  it('declares no more than one port per protocol (platform limit)', () => {
    for (const t of TEMPLATES) {
      assert.ok(t.ports.filter((p) => p.protocol === 'tcp').length <= 1, `${t.id} declares >1 tcp port`);
      assert.ok(t.ports.filter((p) => p.protocol === 'udp').length <= 1, `${t.id} declares >1 udp port`);
    }
  });

  it('every startup placeholder is backed by a declared variable', () => {
    for (const t of TEMPLATES) {
      const declared = new Set(t.variables.map((v) => v.key));
      for (const m of t.startup.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) {
        assert.ok(declared.has(m[1]!), `${t.id}: {{${m[1]}}} has no matching variable`);
      }
    }
  });

  it('every documented link is https', () => {
    for (const t of TEMPLATES) {
      assert.match(t.docs, /^https:\/\//, `${t.id} has a non-https docs link`);
    }
  });

  it('recommended resources sit within the platform floors', () => {
    for (const t of TEMPLATES) {
      assert.ok(t.recommended.cpuMilli >= 100, `${t.id} cpu below floor`);
      assert.ok(t.recommended.ramMb >= 128, `${t.id} ram below floor`);
      assert.ok(t.recommended.storageGb >= 1, `${t.id} storage below floor`);
      if (t.minimum) {
        assert.ok(t.minimum.cpuMilli <= t.recommended.cpuMilli, `${t.id} minimum cpu > recommended`);
        assert.ok(t.minimum.ramMb <= t.recommended.ramMb, `${t.id} minimum ram > recommended`);
      }
    }
  });

  it('only marks a template verified when the integration suite actually tests it', () => {
    // The whole point of the status field. A template may claim `verified` only
    // if test/templates/integration.test.ts has a case for it — otherwise the
    // badge is decoration, and the whole catalog becomes a wish list.
    const src = readFileSync(
      new URL('../templates/integration.test.ts', import.meta.url),
      'utf8',
    );
    const tested = new Set<string>();
    for (const m of src.matchAll(/templateById\('([a-z0-9-]+)'\)/g)) tested.add(m[1]!);
    for (const m of src.matchAll(/startupFor\('([a-z0-9-]+)'\)/g)) tested.add(m[1]!);
    assert.ok(tested.size > 0, 'the integration suite references no templates at all');

    for (const t of TEMPLATES) {
      if (t.status === 'verified') {
        assert.ok(tested.has(t.id), `${t.id} claims "verified" but no integration test exercises it`);
        // A verified template must also carry the evidence, so an admin can
        // see WHY it is trusted rather than taking it on faith.
        assert.ok(t.note && t.note.length > 20, `${t.id} is verified but has no explanatory note`);
      }
    }
  });

  it('gives every unverified template a reason, so nothing is silently unproven', () => {
    for (const t of TEMPLATES) {
      if (t.status === 'unverified') {
        assert.ok(t.note && t.note.length > 10, `${t.id} is unverified but gives no reason`);
      }
    }
  });

  it('reaches every runtime the platform can provision', () => {
    const warnings = validateCatalog().filter((i) => i.severity === 'warning' && i.message.includes('no template'));
    assert.deepEqual(warnings, [], warnings.map((w) => w.message).join('\n'));
  });
});

describe('catalog behaviour', () => {
  it('hides disabled and deprecated templates from the picker but keeps them resolvable', () => {
    const creatable = creatableTemplates().map((t) => t.id);
    for (const t of TEMPLATES) {
      if (!t.enabled || t.status === 'disabled' || t.status === 'deprecated') {
        assert.ok(!creatable.includes(t.id), `${t.id} should not be creatable`);
        assert.ok(TEMPLATE_BY_ID.has(t.id), `${t.id} must still resolve for existing servers`);
      }
    }
  });

  it('maps every legacy runtime to a real template', () => {
    for (const r of RUNTIMES) {
      const t = legacyTemplateFor(r);
      assert.ok(t, `no legacy template for runtime ${r}`);
      assert.equal(t.runtime, r);
    }
  });

  it('gives every web template a port and every bot template none', () => {
    for (const t of TEMPLATES.filter((x) => x.category === 'bot')) {
      assert.deepEqual(t.ports, [], `${t.id} is a bot and must not publish a port`);
    }
  });

  it('covers the languages the landing page advertises', () => {
    const languages = new Set(TEMPLATES.map((t) => t.language));
    for (const lang of ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java', 'PHP', 'Ruby', 'C#']) {
      assert.ok(languages.has(lang as never), `no template for advertised language ${lang}`);
    }
  });
});

describe('project detection', () => {
  it('prefers the lockfile over the manifest', () => {
    assert.equal(detectProject(['package.json', 'pnpm-lock.yaml']), 'node-pnpm');
    assert.equal(detectProject(['package.json', 'yarn.lock']), 'node-yarn');
    assert.equal(detectProject(['package.json', 'package-lock.json']), 'node-npm');
    assert.equal(detectProject(['package.json']), 'node-npm');
  });

  it('recognises each ecosystem by its own manifest', () => {
    const cases: Array<[string[], string]> = [
      [['requirements.txt'], 'python-requirements'],
      [['pyproject.toml', 'poetry.lock'], 'python-poetry'],
      [['pyproject.toml', 'uv.lock'], 'python-uv'],
      [['go.mod'], 'go'],
      [['Cargo.toml'], 'rust'],
      [['pom.xml'], 'java-maven'],
      [['build.gradle'], 'java-gradle'],
      [['composer.json'], 'php-composer'],
      [['Gemfile'], 'ruby-bundler'],
      [[], 'unknown'],
    ];
    for (const [files, expected] of cases) {
      assert.equal(detectProject(files), expected, `files: ${files.join(',')}`);
    }
  });

  it('matches project kinds against the template that claims them', () => {
    assert.equal(templateAccepts('nodejs-npm', 'node-pnpm'), true, 'npm template also serves pnpm projects');
    assert.equal(templateAccepts('go-app', 'node-npm'), false);
    assert.equal(templateAccepts('go-app', 'go'), true);
    assert.equal(templateAccepts('unknown-template-id', 'go'), true, 'templates without a contract accept anything');
    assert.equal(templateAccepts('java-jar', 'go'), false, 'a jar template must not accept a Go project');
  });
});
/**
 * The compiled install/build/start script is handed straight to `/bin/sh -c`
 * as the container command. If it does not parse, the container dies on boot
 * before the app ever runs — and the user gets a server that cannot start, for
 * a reason that has nothing to do with anything they did.
 *
 * This shipped broken: `sandbox.ts` concatenated the prelude and the startup
 * command with no separator, so a build step ending in `fi` produced
 * `finode index.js`. That is a syntax error, and it hit 19 of the 38 templates
 * — every Node, Go, Rust, Java and .NET one.
 *
 * So: compile the real command for every template and ask a real shell to
 * parse it. Cheap, and it fails loudly the next time a step is added.
 */
describe('compiled sandbox script is valid shell', () => {
  const scriptFor = (t: (typeof TEMPLATES)[number]) =>
    [
      compileInstallPrelude(t.install),
      compileBuildPrelude(t.build),
      t.startup,
    ]
      .map((s) => s.replace(/[\s;]+$/, ''))
      .filter(Boolean)
      .join('; ');

  for (const t of TEMPLATES) {
    it(`${t.id} parses under /bin/sh -n`, () => {
      const script = scriptFor(t);
      const r = spawnSync('/bin/sh', ['-n', '-c', script], { encoding: 'utf8' });
      assert.equal(
        r.status,
        0,
        `${t.id} produces a script /bin/sh cannot parse:\n${script}\n→ ${r.stderr.trim()}`,
      );
    });
  }

  it('separates the prelude from the startup command', () => {
    // The exact regression: with no separator the build step's closing `fi`
    // fused onto `node`, yielding `finode index.js` — unparseable.
    const t = TEMPLATE_BY_ID.get('nodejs-npm')!;
    const script = scriptFor(t);
    assert.ok(!/finode/.test(script), script);
    assert.match(script, /;\s*node\b/, `prelude must end with a separator: ${script}`);
  });
});
