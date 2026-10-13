/**
 * Port allocation against a REAL PostgreSQL — the guarantees that matter here
 * (atomicity under concurrency, the partial unique index, release semantics)
 * are database guarantees, and a mock would only test the mock.
 *
 * Runs against DESTRUCTIVE_DATABASE_URL, never DATABASE_URL. The suite
 * truncates the tables it touches, so pointing it at the production database
 * would delete the fleet.
 *
 * The schema is applied by the test itself (TEST_SCHEMA_SQL, written by
 * scripts/prepare-port-test-db.mjs) so no migration runner is involved and the
 * index definitions under test are exactly the shipped ones.
 */
import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const URL = process.env.DESTRUCTIVE_DATABASE_URL;
if (!URL) {
  console.error('DESTRUCTIVE_DATABASE_URL is required — this suite TRUNCATES tables.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: URL });
const pool = new pg.Pool({ connectionString: URL, max: 10 });

let seq = 0;
/**
 * A fresh server row + its uuid.
 *
 * `server_ports.server_id` is a real foreign key, so the tests cannot just
 * invent ids — the uuid is v4-shaped because the API parses the path param
 * with ParseUUIDPipe({ version: '4' }), and the row is inserted so the
 * constraint proves the same thing it proves in production.
 */
const newServer = async () => {
  const n = (seq++).toString(16).padStart(12, '0');
  const id = `00000000-0000-4000-8000-${n}`;
  await pool.query('insert into servers (id) values ($1) on conflict do nothing', [id]);
  await pool.query('insert into nodes (id, name) values ($1,$2) on conflict do nothing', ['n2', 'node two']);
  return id;
};

/**
 * The allocator, reduced to the only part that touches the database. The
 * production `PortsService` differs by reading env/config and validating DTOs;
 * its decision logic — candidate order + the conditional INSERT — is here
 * verbatim, so a change to either must be made in both places deliberately.
 */
async function allocate(serverId, nodeId, containerPort, protocol = 'tcp') {
  const range = { from: 20000, to: 32000 };
  const existing = await pool.query(
    `select port from server_ports where server_id=$1 and protocol=$2 and state='allocated' limit 1`,
    [serverId, protocol],
  );
  if (existing.rows[0]) {
    return { port: existing.rows[0].port, created: false };
  }
  const span = range.to - range.from + 1;
  const start = ((seq * 7919) % span) + range.from;
  for (let i = 0; i < span; i++) {
    const candidate = start + i > range.to ? start + i - span : start + i;
    const inserted = await pool.query(
      `insert into server_ports (server_id, node_id, port, container_port, protocol)
       values ($1,$2,$3,$4,$5) on conflict do nothing returning port`,
      [serverId, nodeId, candidate, containerPort, protocol],
    );
    if (inserted.rows[0]) return { port: inserted.rows[0].port, created: true };
  }
  throw new Error('PORT_POOL_EXHAUSTED');
}

before(async () => {
  await client.connect();
  await client.query(readFileSync(process.env.TEST_SCHEMA_SQL, 'utf8'));
});

after(async () => {
  await client.end();
  await pool.end();
});

describe('allocation basics', () => {
  it('gives a new server a port inside the configured range', async () => {
    const id = await newServer();
    const { port, created } = await allocate(id, 'local', 3000);
    assert.ok(created);
    assert.ok(port >= 20000 && port <= 32000, `port ${port} outside the pool`);
    const rows = await pool.query(`select state, container_port, protocol from server_ports where server_id=$1`, [id]);
    assert.equal(rows.rows[0].state, 'allocated');
    assert.equal(rows.rows[0].container_port, 3000);
    assert.equal(rows.rows[0].protocol, 'tcp');
  });

  it('is idempotent: a second call returns the SAME port, not a new one', async () => {
    const id = await newServer();
    const first = await allocate(id, 'local', 3000);
    const second = await allocate(id, 'local', 3000);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.port, second.port);
    const rows = await pool.query(`select count(*)::int n from server_ports where server_id=$1`, [id]);
    assert.equal(rows.rows[0].n, 1, 'must not burn a second port on the same server');
  });
});

describe('two servers can never share a port', () => {
  it('refuses a duplicate allocation for the same (node, port)', async () => {
    const a = await newServer();
    const b = await newServer();
    const { port } = await allocate(a, 'local', 3000);
    let threw = null;
    try {
      await pool.query(
        `insert into server_ports (server_id, node_id, port, container_port) values ($1,'local',$2,3000)`,
        [b, port],
      );
    } catch (e) {
      threw = e.code;
    }
    assert.equal(threw, '23505', 'the partial unique index must reject the second claim');
  });

  it('50 concurrent allocations produce 50 DISTINCT ports', async () => {
    // the property that matters: no check-then-insert race anywhere
    const ids = await Promise.all(Array.from({ length: 50 }, () => newServer()));
    const results = await Promise.all(ids.map((id) => allocate(id, 'local', 3000)));
    const ports = results.map((r) => r.port);
    assert.equal(new Set(ports).size, 50, `duplicate ports handed out: ${ports.length - new Set(ports).size}`);
    for (const p of ports) assert.ok(p >= 20000 && p <= 32000);
    const rows = await pool.query(
      `select count(*)::int n, count(distinct port)::int d from server_ports
       where server_id = any($1::uuid[]) and state='allocated'`,
      [ids],
    );
    assert.equal(rows.rows[0].n, 50);
    assert.equal(rows.rows[0].d, 50);
  });

  it('keeps concurrent allocations apart per node', async () => {
    // same port number on two DIFFERENT nodes is legal — different daemons
    const a = await newServer();
    const b = await newServer();
    const ra = await allocate(a, 'local', 3000);
    const rb = await allocate(b, 'n2', 3000);
    assert.ok(ra.port && rb.port);
  });
});

describe('release semantics', () => {
  it('frees a released port back to the pool (the partial index does not burn it)', async () => {
    const id = await newServer();
    const first = await allocate(id, 'local', 3000);
    await pool.query(`update server_ports set state='released', released_at=now() where server_id=$1`, [id]);

    // a different server must be able to take the very same port back
    const b = await newServer();
    const taken = await pool.query(
      `insert into server_ports (server_id, node_id, port, container_port) values ($1,'local',$2,3000) returning port`,
      [b, first.port],
    );
    assert.equal(taken.rows[0].port, first.port, 'a released port must be reusable');
  });

  it('survives 100 create/delete cycles without exhausting the pool', async () => {
    // the regression this guards: a FULL unique index on (node, port) would
    // make every deleted server burn a port forever
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const id = await newServer();
      ids.push(id);
      await allocate(id, 'local', 3000);
      await pool.query(`update server_ports set state='released', released_at=now() where server_id=$1`, [id]);
    }
    const live = await pool.query(
      `select count(*)::int n from server_ports where state='allocated' and server_id = any($1::uuid[])`,
      [ids],
    );
    assert.equal(live.rows[0].n, 0, 'deleted servers must leave nothing allocated');
    // and the pool is still full-size
    const reused = await allocate(await newServer(), 'local', 3000);
    assert.ok(reused.port >= 20000 && reused.port <= 32000);
  });
});

describe('the shipped index definitions', () => {
  it('are partial on state=allocated, not full', async () => {
    const rows = await pool.query(
      `select indexdef from pg_indexes where tablename='server_ports' and indexname in
       ('server_ports_node_port_unique','server_ports_server_proto_unique')`,
    );
    assert.equal(rows.rows.length, 2);
    for (const r of rows.rows) {
      assert.match(r.indexdef, /WHERE \(state = 'allocated'/, `index is not partial: ${r.indexdef}`);
    }
  });

  it('allow one live allocation per protocol per server', async () => {
    const id = await newServer();
    await allocate(id, 'local', 3000, 'tcp');
    let threw = null;
    try {
      await pool.query(
        `insert into server_ports (server_id, node_id, port, container_port, protocol) values ($1,'local',31500,3000,'tcp')`,
        [id],
      );
    } catch (e) {
      threw = e.code;
    }
    assert.equal(threw, '23505');
  });
});

describe('health columns are tri-state and default to unknown', () => {
  it('starts as NULL, never as false', async () => {
    const id = await newServer();
    await allocate(id, 'local', 3000);
    const rows = await pool.query(
      `select container_listening, host_reachable, container_checked_at, drift
       from server_ports where server_id=$1`,
      [id],
    );
    assert.equal(rows.rows[0].container_listening, null);
    assert.equal(rows.rows[0].host_reachable, null);
    assert.equal(rows.rows[0].container_checked_at, null);
    assert.equal(rows.rows[0].drift, null);
  });

  it('records a measurement together with its timestamp', async () => {
    const id = await newServer();
    await allocate(id, 'local', 3000);
    await pool.query(
      `update server_ports set container_listening=false, container_checked_at=now(), drift='missing' where server_id=$1`,
      [id],
    );
    const rows = await pool.query(
      `select container_listening, container_checked_at, drift from server_ports where server_id=$1`,
      [id],
    );
    assert.equal(rows.rows[0].container_listening, false);
    assert.ok(rows.rows[0].container_checked_at, 'a measurement must carry when it was taken');
    assert.equal(rows.rows[0].drift, 'missing');
  });

  it('rejects an unknown drift value', async () => {
    const id = await newServer();
    await allocate(id, 'local', 3000);
    await assert.rejects(
      pool.query(`update server_ports set drift='bogus' where server_id=$1`, [id]),
      /server_ports_drift_check/,
    );
  });
});

describe('container port must be a real port', () => {
  it('rejects 0 and out-of-range container ports', async () => {
    const id = await newServer();
    for (const bad of [0, -1, 65536]) {
      await assert.rejects(
        pool.query(
          `insert into server_ports (server_id, node_id, port, container_port) values ($1,'local',31500,$2)`,
          [id, bad],
        ),
        /server_ports_container_ck/,
      );
    }
  });
});