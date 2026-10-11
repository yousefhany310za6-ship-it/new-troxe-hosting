import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildEnv, type SandboxSpec } from '../../src/modules/servers/provisioning/sandbox.ts';
import { RUNTIME_IMAGES } from '../../src/modules/servers/provisioning/images.ts';

const base: SandboxSpec = {
  serverId: '00000000-0000-4000-8000-000000000000',
  ownerId: '00000000-0000-4000-8000-000000000001',
  image: RUNTIME_IMAGES['Node.js'],
  startup: 'node index.js',
  env: [],
  cpuMilli: 500,
  ramMb: 512,
  networkName: 'net_test',
  volumeName: 'vol_test',
  autoRestart: true,
  pidsLimit: 256,
};

const get = (env: string[], key: string) => env.find((e) => e.startsWith(`${key}=`))?.slice(key.length + 1);

describe('SERVER_PORT injection', () => {
  it('exposes the allocated host port to the app', () => {
    const env = buildEnv({ ...base, ports: [{ port: 30089, protocol: 'tcp', containerPort: 3000 }] });
    assert.equal(get(env, 'SERVER_PORT'), '30089');
    assert.equal(get(env, 'PORT'), '3000');
    assert.equal(get(env, 'HOST'), '0.0.0.0');
  });

  it('is absent when the server has no allocation yet', () => {
    const env = buildEnv(base);
    assert.equal(get(env, 'SERVER_PORT'), undefined);
  });

  it('a user-set SERVER_PORT wins over the derived one', () => {
    const env = buildEnv({
      ...base,
      ports: [{ port: 30089, protocol: 'tcp', containerPort: 3000 }],
      env: [{ k: 'SERVER_PORT', v: '8080' }],
    });
    assert.equal(get(env, 'SERVER_PORT'), '8080');
  });

  it('uses the tcp allocation, not udp', () => {
    const env = buildEnv({
      ...base,
      ports: [
        { port: 30090, protocol: 'udp', containerPort: 3000 },
        { port: 30089, protocol: 'tcp', containerPort: 3000 },
      ],
    });
    assert.equal(get(env, 'SERVER_PORT'), '30089');
  });
});
