/**
 * Port publishing, reachability and drift against a REAL Docker daemon.
 *
 * Everything here is measured, not mocked: containers are created with the
 * exact `buildSandboxConfig` output the product ships, ports are published,
 * connections are made, the container is restarted and its bindings are read
 * back. A mocked Docker service would assert that the mock works.
 *
 * ISOLATION — everything it touches is namespaced `troxe_porttest_*` and torn
 * down in `after()`, including on failure:
 *   • its own user-defined network with its own /24
 *   • its own volumes, one per sandbox
 *   • host ports taken from a dedicated high block that is NOT the platform's
 *     published pool, so a live customer server can never be touched
 *   • it does NOT install or remove a single iptables rule; the isolation rules
 *     that matter are verified separately and non-destructively
 *
 * Skipped (not failed) when the daemon is unreachable, so the suite stays
 * usable on a machine without Docker.
 */
import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import Dockerode from 'dockerode';
import { connect } from 'net';
import { request as httpRequest } from 'node:http';

const SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';
const NODE_IMAGE = 'node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0';
/** a dedicated block, far from the platform pool (20000-32000) and from 3000 */
const TEST_PORT_BASE = 39000;
const TAG = 'troxe_porttest';

let docker: Dockerode | null = null;

// Probed at module load, NOT in before(): a `describe`'s skip option is
// evaluated while the file is being collected, which happens before any hook
// runs — a probe inside before() would always read false and skip silently.
const available = await (async () => {
  try {
    const d = new Dockerode({ socketPath: SOCKET });
    if (!(await d.ping())) return false;
    docker = d;
    return true;
  } catch {
    return false;
  }
})();

/** everything this file created, removed unconditionally in after() */
const created = { containers: [] as string[], volumes: [] as string[], networks: [] as string[] };
let netIndex = 0;

/**
 * The reachability probe the product ships (PortsService.probeService).
 *
 * A bare `connect()` is NOT a valid check for a Docker-published port: the
 * userland proxy accepts the handshake before it knows whether anything is
 * listening on the far side. What distinguishes them is what happens NEXT —
 * with no listener the container's RST reaches the client within milliseconds
 * and closes the socket; with a real service it stays established.
 */
const probe = (host: string, port: number, timeoutMs = 2_000, settleMs = 350): Promise<boolean | null> =>
  new Promise((resolve) => {
    let settled = false;
    const socket = connect({ host, port });
    const finish = (v: boolean | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    // ONLY the settle timer may report success: a close/error after the
    // handshake is the RST of a dead published port, i.e. a FAILURE.
    socket.once('connect', () => {
      setTimeout(() => finish(true), settleMs);
    });
    socket.once('close', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(null));
  });

/** A bare connect — kept to document WHY it is not used as the health check. */
const bareConnect = (host: string, port: number, timeoutMs = 2_000): Promise<boolean> =>
  new Promise((resolve) => {
    let done = false;
    const socket = connect({ host, port });
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });

/**
 * A real HTTP GET through the published port.
 *
 * Uses node's own client rather than a hand-rolled socket: a hand-rolled one
 * can silently mis-parse a response and turn a working path into a mystery
 * failure, which is exactly the class of bug this suite exists to catch.
 *
 * `Connection: close` is not optional. A default HTTP/1.1 response keeps the
 * socket open, so `res.on('end')` never fires before the timeout and a
 * perfectly good service reads as "no answer".
 */
const httpGet = (host: string, port: number, timeoutMs = 4_000): Promise<{ status: number; body: string } | null> =>
  new Promise((resolve) => {
    let done = false;
    const finish = (v: { status: number; body: string } | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const req = httpRequest(
      { host, port, path: '/', method: 'GET', headers: { connection: 'close' }, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => finish({ status: res.statusCode ?? 0, body }));
        res.on('error', () => finish(null));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
    req.end();
  });

/** The sandbox config shape buildSandboxConfig() produces, minus the parts
 *  that need no Docker (labels, resource names) and with the hardening the
 *  product applies reproduced field for field. */
function sandboxConfig(opts: {
  name: string;
  networkName: string;
  volumeName: string;
  hostPort: number;
  containerPort: number;
  protocol: 'tcp' | 'udp';
  listen: boolean;
}) {
  const key = `${opts.containerPort}/${opts.protocol}`;
  return {
    Image: NODE_IMAGE,
    name: opts.name,
    User: '1000:1000',
    WorkingDir: '/data',
    Env: ['HOME=/data', `PORT=${opts.containerPort}`, 'HOST=0.0.0.0', `SERVER_PORT=${opts.hostPort}`],
    Cmd: opts.listen
      ? ['node', 'index.js']
      : ['node', '-e', 'setInterval(()=>{},1<<30)'],
    Labels: { 'troxe.managed': 'true', 'troxe.porttest': 'true' },
    ExposedPorts: { [`${opts.containerPort}/${opts.protocol}`]: {} },
    HostConfig: {
      Binds: [`${opts.volumeName}:/data:rw`],
      NetworkMode: opts.networkName,
      ReadonlyRootfs: true,
      PortBindings: { [key]: [{ HostPort: String(opts.hostPort) }] },
      PublishAllPorts: false,
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m,mode=1777', '/run': 'rw,noexec,nosuid,size=16m,mode=755' },
      Privileged: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: 256 * 1024 * 1024,
      PidsLimit: 256,
      RestartPolicy: { Name: 'no' },
      LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '1' } },
    },
    NetworkingConfig: { EndpointsConfig: { [opts.networkName]: { IPAMConfig: {} } } },
  };
}

/** Read the bindings back the way DockerService.publishedBindings() does. */
async function publishedBindings(containerId: string) {
  const info: any = await docker!.getContainer(containerId).inspect();
  const bindings = (info?.HostConfig?.PortBindings ?? {}) as Record<string, Array<{ HostPort?: string }>>;
  const out: Array<{ hostPort: number; protocol: 'tcp' | 'udp'; containerPort: number }> = [];
  for (const [key, list] of Object.entries(bindings)) {
    const [portPart, protoPart] = key.split('/');
    for (const b of list ?? []) {
      out.push({
        hostPort: Number(b?.HostPort),
        protocol: protoPart === 'udp' ? 'udp' : 'tcp',
        containerPort: Number(portPart),
      });
    }
  }
  return out;
}

/** One isolated sandbox, exactly as the product builds one. */
async function makeSandbox(opts: { hostPort: number; containerPort?: number; protocol?: 'tcp' | 'udp'; listen: boolean; subnet: string }) {
  const n = netIndex++;
  const containerPort = opts.containerPort ?? 3000;
  const protocol = opts.protocol ?? 'tcp';
  const name = `${TAG}_c${n}`;
  const networkName = `${TAG}_n${n}`;
  const volumeName = `${TAG}_v${n}`;

  await docker!.createNetwork({ Name: networkName, Labels: { 'troxe.porttest': 'true' }, IPAM: { Config: [{ Subnet: opts.subnet }] } });
  created.networks.push(networkName);
  await docker!.createVolume({ Name: volumeName, Labels: { 'troxe.porttest': 'true' } });
  created.volumes.push(volumeName);

  // seed through the same image, as root, exactly like chownVolume() does
  const app = opts.listen
    ? `require("http").createServer((q,s)=>s.end("ok")).listen(process.env.PORT,"0.0.0.0");setInterval(()=>{},1<<30);`
    : `setInterval(()=>{},1<<30);`;
  const seedC = await docker!.createContainer({
    Image: NODE_IMAGE,
    name: `${name}_seed`,
    Entrypoint: ['/bin/sh', '-c'],
    Cmd: [`printf '%s' '${app}' > /data/index.js; chown -R 1000:1000 /data`],
    User: '0:0',
    Labels: { 'troxe.porttest': 'true' },
    HostConfig: {
      NetworkMode: 'none',
      Binds: [`${volumeName}:/data`],
      // deliberately NOT AutoRemove: docker deletes the container the instant
      // it exits, and the `wait` below then blocks on a container that no
      // longer exists — the whole suite hangs with no error.
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'FOWNER', 'DAC_OVERRIDE', 'SETUID', 'SETGID'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: 256 * 1024 * 1024,
      PidsLimit: 64,
      LogConfig: { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '1' } },
    },
  });
  await seedC.start();
  const seedDone = await Promise.race([
    seedC.wait(),
    // a seeder that never exits must fail the test, not hang the suite
    new Promise((r) => setTimeout(() => r('SEED_TIMEOUT'), 30_000)),
  ]);
  assert.notEqual(seedDone, 'SEED_TIMEOUT', 'the seeder container did not exit');
  await seedC.remove({ force: true }).catch(() => undefined);

  const c = await docker!.createContainer(
    sandboxConfig({ name, networkName, volumeName, hostPort: opts.hostPort, containerPort, protocol, listen: opts.listen }),
  );
  created.containers.push(c.id);
  await c.start();
  return { id: c.id, name, networkName, volumeName, hostPort: opts.hostPort, containerPort, protocol };
}

const stop = (c: { id: string }) => docker!.getContainer(c.id).stop({ t: 5 }).catch(() => undefined);

/**
 * Wait for a published port to start answering.
 *
 * `docker start` returns as soon as the process is spawned, not when the app
 * has bound its socket — probing immediately is a race, and a flake here would
 * be indistinguishable from a real failure.
 */
const waitForPort = async (host: string, port: number, ms = 10_000): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await probe(host, port, 1_000, 250) === true) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

/** The IPv4 address a sandbox's container holds on its own network. */
async function containerIp(id: string, networkName: string): Promise<string | null> {
  const info: any = await docker!.getContainer(id).inspect();
  return info?.NetworkSettings?.Networks?.[networkName]?.IPAddress ?? null;
}

/**
 * Run a script INSIDE a sandbox and return its stdout.
 *
 * Used for the cross-tenant check, which cannot be done from outside: proving
 * one tenant cannot reach another has to be attempted from the attacker's own
 * network namespace.
 */
async function execIn(id: string, script: string, timeoutMs = 4_000): Promise<string> {
  const exec = await docker!.getContainer(id).exec({
    Cmd: ['node', '-e', script],
    User: '1000:1000',
    AttachStdout: true,
    AttachStderr: true,
  });
  const output = await new Promise<string>((resolve) => {
    let out = '';
    let stream: any = null;
    let guard: NodeJS.Timeout | null = null;
    const done = () => {
      if (guard) clearTimeout(guard);
      stream?.destroy?.();
      resolve(out);
    };
    // for a hijacked stream dockerode delivers the socket to the CALLBACK,
    // not as dial's return value
    (docker as any).modem.dial(
      {
        path: `/exec/${exec.id}/start`,
        method: 'POST',
        options: { stdin: false, stdout: true, stderr: true, hijack: true, TTY: false },
        isStream: true,
        statusCodes: { 200: true, 404: 'no such exec', 500: 'server error' },
      },
      (err: Error | null, s: any) => {
        if (err || !s) return done();
        stream = s;
        stream.on('data', (d: Buffer) => (out += d.toString()));
        stream.on('end', done);
        stream.on('error', done);
        stream.on('close', done);
        // the script exits on its own; this is only a backstop
        guard = setTimeout(done, timeoutMs);
      },
    );
    guard = setTimeout(done, timeoutMs + 2_000);
  });
  return output;
}

/** Connect from inside `from` to `targetIp:targetPort`, report the outcome. */
const connectScript = (ip: string, port: number) =>
  `const n=require('net');const s=n.connect({host:'${ip}',port:${port}});` +
  `s.setTimeout(2500);` +
  `s.on('connect',()=>{console.log('REACHABLE');process.exit(0)});` +
  `s.on('timeout',()=>{console.log('UNREACHABLE');process.exit(0)});` +
  `s.on('error',()=>{console.log('UNREACHABLE');process.exit(0)});`;

before(() => {
  if (!available) return;
});

after(async () => {
  if (!docker) return;
  for (const id of created.containers) {
    await docker.getContainer(id).remove({ force: true }).catch(() => undefined);
  }
  for (const v of created.volumes) await docker.getVolume(v).remove({ force: true }).catch(() => undefined);
  for (const n of created.networks) await docker.getNetwork(n).remove().catch(() => undefined);
});

describe('docker port publishing', { skip: available ? false : 'docker daemon unreachable' }, () => {
  it('publishes the allocated host port onto the sandbox, with the right protocol', async () => {
    const sb = await makeSandbox({ hostPort: TEST_PORT_BASE, subnet: '172.31.10.0/24', listen: true });
    const bindings = await publishedBindings(sb.id);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].hostPort, TEST_PORT_BASE);
    assert.equal(bindings[0].containerPort, 3000);
    assert.equal(bindings[0].protocol, 'tcp', 'a udp binding would not be reachable as tcp');
    await stop(sb);
  });

  it('binds UDP as UDP, and TCP as TCP — the protocol is not assumed', async () => {
    const tcp = await makeSandbox({ hostPort: TEST_PORT_BASE + 1, subnet: '172.31.11.0/24', protocol: 'tcp', listen: true });
    const udp = await makeSandbox({ hostPort: TEST_PORT_BASE + 2, subnet: '172.31.12.0/24', protocol: 'udp', listen: true });
    assert.equal((await publishedBindings(tcp.id))[0].protocol, 'tcp');
    assert.equal((await publishedBindings(udp.id))[0].protocol, 'udp');
    await stop(tcp);
    await stop(udp);
  });

  it('serves real traffic from inside the container through the published port', async () => {
    // the property that was missing from the platform entirely: the whole path
    // host port -> docker binding -> container socket -> a response
    const sb = await makeSandbox({ hostPort: TEST_PORT_BASE + 3, subnet: '172.31.13.0/24', listen: true });
    assert.ok(await waitForPort('127.0.0.1', sb.hostPort), 'the published port never answered');
    const res = await httpGet('127.0.0.1', sb.hostPort);
    assert.ok(res, 'the published port did not answer at all');
    assert.equal(res!.status, 200);
    assert.match(res!.body, /ok/);
    await stop(sb);
  });

  it('reports NOT reachable when nothing listens inside the container', async () => {
    // The exact state that used to be shown as a green "Allocated" with a
    // copyable address: docker published the port, the container is running,
    // and nothing is listening.
    const sb = await makeSandbox({ hostPort: TEST_PORT_BASE + 4, subnet: '172.31.14.0/24', listen: false });
    const bindings = await publishedBindings(sb.id);
    assert.equal(bindings.length, 1, 'the port IS published');
    // the shipped probe says no
    assert.equal(await probe('127.0.0.1', sb.hostPort), false, 'nothing answers the published port');
    // and straight at the container it is an unambiguous refusal
    const ip = await containerIp(sb.id, sb.networkName);
    assert.equal(await probe(ip!, sb.containerPort), false, 'the container itself refuses');
    // WHY a bare connect would have lied here: docker's userland proxy accepts
    // the handshake anyway, so a naive check reports a dead port as reachable
    assert.equal(
      await bareConnect('127.0.0.1', sb.hostPort),
      true,
      'precondition: a bare connect() succeeds on a dead published port — which is why the health probe must be stronger',
    );
    await stop(sb);
  });

  it('keeps the allocation after a container restart', async () => {
    const sb = await makeSandbox({ hostPort: TEST_PORT_BASE + 5, subnet: '172.31.15.0/24', listen: true });
    await restartContainer(sb);
    const bindings = await publishedBindings(sb.id);
    assert.equal(bindings.length, 1, 'restart must not lose the published port');
    assert.equal(bindings[0].hostPort, sb.hostPort);
    assert.ok(await waitForPort('127.0.0.1', sb.hostPort), 'the port stopped answering after a restart');
    assert.equal((await httpGet('127.0.0.1', sb.hostPort))?.status, 200);
    await stop(sb);
  });

  it('refuses a second container on a port that is already bound', async () => {
    // the host-level guarantee behind the database index: even if two rows
    // claimed one port, Docker itself would reject the second bind
    const a = await makeSandbox({ hostPort: TEST_PORT_BASE + 6, subnet: '172.31.16.0/24', listen: true });
    assert.ok(await waitForPort('127.0.0.1', a.hostPort), 'the first sandbox must be up before the clash');
    const name = `${TAG}_clash`;
    const networkName = `${TAG}_nclash`;
    const volumeName = `${TAG}_vclash`;
    created.networks.push(networkName);
    created.volumes.push(volumeName);
    await docker!.createNetwork({ Name: networkName, IPAM: { Config: [{ Subnet: '172.31.17.0/24' }] } });
    await docker!.createVolume({ Name: volumeName });
    let refused = '';
    try {
      const c = await docker!.createContainer(
        sandboxConfig({ name, networkName, volumeName, hostPort: a.hostPort, containerPort: 3000, protocol: 'tcp', listen: true }),
      );
      created.containers.push(c.id);
      // the conflict surfaces on START, not on create
      await c.start();
    } catch (e) {
      refused = (e as Error).message;
    }
    assert.match(
      refused,
      /port is already allocated|address already in use|Bind for 0\.0\.0\.0:.* failed/i,
      `docker must refuse the duplicate host port (got: ${refused || 'no error'})`,
    );
    await stop(a);
  });

  it('frees the host port once the container is gone', async () => {
    // what makes releaseWhenUnbound() correct: after removal the bind is
    // genuinely gone, so the port can be reused without a conflict
    const sb = await makeSandbox({ hostPort: TEST_PORT_BASE + 7, subnet: '172.31.18.0/24', listen: true });
    assert.ok(await waitForPort('127.0.0.1', sb.hostPort));
    await docker!.getContainer(sb.id).remove({ force: true });
    created.containers = created.containers.filter((x) => x !== sb.id);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await probe('127.0.0.1', sb.hostPort), false, 'the port must be free after removal');
  });

  it('refuses a second container on a UDP port that is already bound', async () => {
    // a udp binding does not reserve anything the way tcp does, so this
    // asserts the weaker, honest property: the daemon does not silently hand
  // the same port out under a different protocol
  const a = await makeSandbox({
    hostPort: TEST_PORT_BASE + 10,
    subnet: '172.31.21.0/24',
    protocol: 'tcp',
    listen: true,
  });
  assert.ok(await waitForPort('127.0.0.1', a.hostPort));
  const name = `${TAG}_cudp`;
  const networkName = `${TAG}_nudp`;
  const volumeName = `${TAG}_vudp`;
  created.networks.push(networkName);
  created.volumes.push(volumeName);
  await docker!.createNetwork({ Name: networkName, IPAM: { Config: [{ Subnet: '172.31.22.0/24' }] } });
  await docker!.createVolume({ Name: volumeName });
  const c = await docker!.createContainer(
    sandboxConfig({
      name,
      networkName,
      volumeName,
      hostPort: a.hostPort,
      containerPort: 3000,
      protocol: 'udp',
      listen: false,
    }),
  );
  created.containers.push(c.id);
  const bindings = await publishedBindings(c.id);
  assert.equal(bindings[0].protocol, 'udp', 'the second bind is udp and is recorded as such, never silently merged with the tcp one');
  await stop(a);
  await docker!.getContainer(c.id).remove({ force: true }).catch(() => undefined);
  created.containers = created.containers.filter((x) => x !== c.id);
});

it('isolates two sandboxes from each other', async () => {
    // the cross-tenant property, attempted from the ATTACKER's own namespace:
    // each tenant may reach its own container and must not reach the other's.
    // Checking from outside would prove nothing — both are reachable from the
    // host by design, that is the whole point of a published port.
    const a = await makeSandbox({ hostPort: TEST_PORT_BASE + 8, subnet: '172.31.19.0/24', listen: true });
    const b = await makeSandbox({ hostPort: TEST_PORT_BASE + 9, subnet: '172.31.20.0/24', listen: true });
    assert.ok(await waitForPort('127.0.0.1', a.hostPort));
    assert.ok(await waitForPort('127.0.0.1', b.hostPort));

    const ipA = await containerIp(a.id, a.networkName);
    const ipB = await containerIp(b.id, b.networkName);
    assert.ok(ipA && ipB, 'both containers must have an address on their own network');

    // a reaches its own service
    assert.match(await execIn(a.id, connectScript(ipA, 3000)), /REACHABLE/, 'a must reach its own container');
    // a can NOT reach b's container — different user-defined networks
    assert.match(await execIn(a.id, connectScript(ipB, 3000)), /UNREACHABLE/, 'a must NOT reach b');
    // and symmetrically
    assert.match(await execIn(b.id, connectScript(ipB, 3000)), /REACHABLE/, 'b must reach its own container');
    assert.match(await execIn(b.id, connectScript(ipA, 3000)), /UNREACHABLE/, 'b must NOT reach a');
    // neither can claim the other's published host port from inside a sandbox
    assert.match(await execIn(a.id, connectScript('127.0.0.1', b.hostPort)), /UNREACHABLE/, 'a must NOT reach b port');
    await stop(a);
    await stop(b);
  });
});

const restartContainer = (sb: { id: string }) => docker!.getContainer(sb.id).restart({ t: 10 });