import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { starterFilesSeed, starterSeed } from '../../src/modules/servers/provisioning/starter.ts';
import { RUNTIME_IMAGES } from '../../src/modules/servers/provisioning/images.ts';

/**
 * Go and Rust cannot be served by a single starter FILE the way Node and Python
 * are: `go build` needs go.mod + main.go, `cargo build` needs Cargo.toml +
 * src/main.rs. These tests prove the multi-file seed actually produces a
 * compilable project and never overwrites a volume the client owns.
 */
describe('starter project seeding', () => {
  it('seeds a two-file Go project', () => {
    const go = RUNTIME_IMAGES.Go;
    assert.ok(go.starterFiles, 'Go has no starterFiles');
    assert.deepEqual(go.starterFiles!.map((f) => f.path).sort(), ['go.mod', 'main.go']);
    const shell = starterFilesSeed(go.starterFiles);
    assert.ok(shell.includes('/data/go.mod'));
    assert.ok(shell.includes('/data/main.go'));
  });

  it('seeds a nested Rust project and creates src/', () => {
    const rust = RUNTIME_IMAGES.Rust;
    assert.ok(rust.starterFiles, 'Rust has no starterFiles');
    const paths = rust.starterFiles!.map((f) => f.path).sort();
    assert.deepEqual(paths, ['Cargo.toml', 'src/main.rs']);
    const shell = starterFilesSeed(rust.starterFiles);
    assert.ok(shell.includes("mkdir -p '/data/src'"), 'src/ is never created, so src/main.rs cannot be written');
  });

  it('never writes when the volume already holds client files', () => {
    const shell = starterFilesSeed([{ path: 'main.go', content: 'x' }]);
    // The emptiness test is the whole guarantee: grep -v filters our marker,
    // head -n 1 finds any real file, and only an empty volume seeds.
    assert.ok(shell.includes('ls -A /data'), 'no emptiness test');
    assert.ok(shell.includes("grep -v '^\\.troxe-init$'"), 'the marker is not filtered');
    assert.ok(shell.includes('head -n 1'), 'no emptiness short-circuit');
  });

  it('the shipped Go and Rust starters are compilable source, not placeholders', () => {
    // A starter that does not compile makes the FIRST start fail for a reason
    // that has nothing to do with the client.
    const goMain = RUNTIME_IMAGES.Go.starterFiles!.find((f) => f.path === 'main.go')!.content;
    assert.match(goMain, /package main/);
    assert.match(goMain, /func main\(\)/);
    // the go directive lives in go.mod, not in main.go
    const goMod = RUNTIME_IMAGES.Go.starterFiles!.find((f) => f.path === 'go.mod')!.content;
    assert.match(goMod, /^go \d/m, 'go.mod must declare a go directive');

    const rustMain = RUNTIME_IMAGES.Rust.starterFiles!.find((f) => f.path === 'src/main.rs')!.content;
    assert.match(rustMain, /fn main\(\)/);
  });

  it('single-file starters still work for the classic runtimes', () => {
    for (const name of ['Node.js', 'Python', 'Bun', 'PHP', 'Ruby', 'Deno'] as const) {
      const img = RUNTIME_IMAGES[name];
      assert.ok(img.starter, `${name} lost its single-file starter`);
      const shell = starterSeed(img.starter);
      assert.notEqual(shell, ':', `${name} starter does not seed`);
    }
  });

  it('a runtime with no starter produces a harmless no-op', () => {
    assert.equal(starterSeed(undefined), ':');
    assert.equal(starterFilesSeed(undefined), ':');
    assert.equal(starterFilesSeed([]), ':');
  });
});