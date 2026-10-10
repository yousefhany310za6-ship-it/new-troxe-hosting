import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  RETIRED_IMAGES,
  RUNTIMES,
  isAllowlistedImage,
  resolveRuntimeImage,
  runtimeImage,
} from '../../src/modules/servers/provisioning/images.ts';

describe('runtime image allowlist', () => {
  it('exposes the four supported runtimes only', () => {
    assert.deepEqual([...RUNTIMES].sort(), ['Bun', 'Node.js', 'PHP', 'Python']);
  });

  it('pins the Node images to the glibc (Debian slim) variants', () => {
    const node = runtimeImage('Node.js');
    for (const v of node.versions) {
      assert.match(v.image, /^node@sha256:[a-f0-9]{64}$/, 'must stay digest-pinned');
    }
    assert.equal(isAllowlistedImage(node, RETIRED_IMAGES['node@sha256:bf77dc26e48ea95fca9d1aceb5acfa69d2e546b765ec2abfb502975f1a2d4def']), true);
  });
});

describe('resolveRuntimeImage (image rotation migration)', () => {
  const node = runtimeImage('Node.js');
  const python = runtimeImage('Python');

  it('keeps a digest that is still allowlisted', () => {
    const current = node.versions[node.versions.length - 1].image;
    assert.equal(resolveRuntimeImage(node, current), current);
  });

  it('maps a retired digest to its successor instead of failing', () => {
    for (const [oldDigest, successor] of Object.entries(RETIRED_IMAGES)) {
      const resolved = resolveRuntimeImage(node, oldDigest);
      assert.equal(resolved, successor, `${oldDigest} must map to its successor`);
      assert.equal(isAllowlistedImage(node, resolved), true, 'the successor must be runnable');
    }
  });

  it('falls back to the runtime default for anything unknown', () => {
    assert.equal(resolveRuntimeImage(node, 'node@sha256:' + '0'.repeat(64)), node.image);
    assert.equal(resolveRuntimeImage(node, undefined), node.image);
  });

  it('never returns an image of another runtime', () => {
    const pythonImage = python.versions[0].image;
    assert.equal(resolveRuntimeImage(node, pythonImage), node.image);
  });

  it('retired digests are not themselves allowlisted any more', () => {
    for (const oldDigest of Object.keys(RETIRED_IMAGES)) {
      assert.equal(isAllowlistedImage(node, oldDigest), false);
    }
  });
});
