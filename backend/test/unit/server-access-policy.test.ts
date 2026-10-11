import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  MAX_SUBUSERS,
  PERMISSION_LABELS,
  SERVER_PERMISSIONS,
  hasPermission,
  normalizePermissions,
} from '../../src/modules/servers/server-access-policy.ts';

describe('server permissions', () => {
  it('knows ten grantable permissions', () => {
    assert.equal(SERVER_PERMISSIONS.length, 10);
    assert.ok(SERVER_PERMISSIONS.includes('server.view'));
    assert.ok(SERVER_PERMISSIONS.includes('schedule.manage'));
  });

  it('every permission has a human label', () => {
    for (const p of SERVER_PERMISSIONS) {
      assert.ok(PERMISSION_LABELS[p]?.title, p);
      assert.ok(PERMISSION_LABELS[p]?.text, p);
    }
  });

  it('owners pass everything', () => {
    for (const p of SERVER_PERMISSIONS) {
      assert.equal(hasPermission({ isOwner: true, granted: [], required: p }), true);
    }
  });

  it('subusers need the exact key', () => {
    assert.equal(hasPermission({ isOwner: false, granted: ['files.read'], required: 'files.read' }), true);
    assert.equal(hasPermission({ isOwner: false, granted: ['files.read'], required: 'files.write' }), false);
    assert.equal(hasPermission({ isOwner: false, granted: [], required: 'server.view' }), false);
  });

  it('normalisation keeps only known keys, deduped', () => {
    assert.deepEqual(normalizePermissions(['files.read', 'files.read', 'root.shell', 42, null]), ['files.read']);
    assert.deepEqual(normalizePermissions('files.read'), []);
    assert.deepEqual(normalizePermissions(undefined), []);
  });

  it('caps the sharing fan-out', () => {
    assert.equal(MAX_SUBUSERS, 20);
  });
});
