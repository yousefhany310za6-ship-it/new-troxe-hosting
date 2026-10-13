/**
 * Renewal integration tests — REAL Postgres, MOCKED Work.ink, no Docker.
 *
 * These back the security claims that a pure-function test cannot prove:
 * replay, concurrency, ownership and ledger integrity are all decided by a
 * unique index or a row lock, so they must be exercised against the same
 * database the production code uses.
 *
 * Run against the COMPILED output (see package.json "test:integration"), which
 * is why this file is plain JS: the NestJS sources use constructor parameter
 * properties that Node's type-stripping cannot handle.
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as path from 'node:path';
import { eq, sql } from 'drizzle-orm';

const URL = process.env.DATABASE_URL;
if (!URL) throw new Error('DATABASE_URL is required for the renewal integration tests');

// config is read at import time by the services, so it must be set first.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-000000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-0000000';
process.env.ENV_ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.WS_TICKET_SECRET ??= 'test-ws-secret-that-is-long-enough-0000000000';
process.env.DOCKER_ENABLED = 'false';

// The build output is CommonJS (tsconfig `module: commonjs`), so the compiled
// services are loaded through require rather than import().
const require_ = createRequire(import.meta.url);
const schema = require_('../../dist/db/schema.js');
const { RenewalService } = require_('../../dist/modules/servers/renewal.service.js');
const { ServersService } = require_('../../dist/modules/servers/servers.service.js');
const { parseTokenVerdict } = require_('../../dist/modules/servers/workink-client.js');
const { RENEWAL_HOURS } = require_('../../dist/modules/servers/renewal-policy.js');
const { Err, pgCodeOf } = require_('../../dist/common/errors.js');

const { servers, users, plans, serverRenewals, serverRenewalSessions } = schema;

const HOUR = 60 * 60 * 1000;
let pool;
let db;

/** Answers whatever the test tells it to, through the REAL response parser. */
class FakeWorkink {
  calls = 0;
  consumed = 0;
  overrideCalls = 0;
  verdict = { valid: true, info: { linkId: 10345 } };

  cfg() {
    return {
      enabled: true,
      apiBaseUrl: 'https://work.ink/_api/v2',
      linkUrl: 'https://work.ink/test/renew',
      linkId: '10345',
      returnUrlTemplate: 'https://hosting.troxe.dev/renew/return?session={SESSION}&key={TOKEN}',
      deleteToken: true,
    };
  }
  ready() {
    return { ready: this._ready !== false, missing: [] };
  }
  async redirectFor(u) {
    this.overrideCalls++;
    if (!u.startsWith('https://hosting.troxe.dev/')) throw new Error('destination must be ours');
    return `${this.cfg().linkUrl}?sr=SIGNED`;
  }
  async validateToken(_t, opts) {
    this.calls++;
    if (opts.consume) this.consumed++;
    return parseTokenVerdict(this.verdict, new Date());
  }
}

/** ServersService with the Docker-touching parts stubbed out. */
function fakeServers(overrides = {}) {
  return {
    requireOwned: async (ownerId, id) => {
      const [row] = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
      if (!row || row.ownerId !== ownerId) throw Err.notFound('SERVER_NOT_FOUND');
      return row;
    },
    restoreFromExpiry: async (id) => {
      await db
        .update(servers)
        .set({ status: 'offline', suspendedReason: null, updatedAt: new Date() })
        .where(eq(servers.id, id));
    },
    stopForExpiry: async () => undefined,
    ...overrides,
  };
}

const fakeRealtime = { broadcastServerStatus: () => undefined };
const fakeAudit = { record: async () => undefined };

const makeService = (workink, overrides) =>
  new RenewalService(db, fakeServers(overrides), workink, fakeAudit, fakeRealtime);

const ctx = { ip: '1.2.3.4', device: 'integration-test' };

let seq = 0;
async function seedUser(planId) {
  const [u] = await db
    .insert(users)
    .values({
      email: `user-${Date.now()}-${seq++}@test.local`,
      name: `User ${seq}`,
      passwordHash: 'x',
      planId,
    })
    .returning();
  return u;
}

async function seedPlan(id, lifetimeHours) {
  const [existing] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  if (existing) {
    await db.update(plans).set({ serverLifetimeHours: lifetimeHours }).where(eq(plans.id, id));
    return;
  }
  await db.insert(plans).values({
    id,
    name: id,
    cpuMilli: 250,
    ramMb: 256,
    storageGb: 1,
    maxServers: 1,
    serverLifetimeHours: lifetimeHours,
    sortOrder: 99,
  });
}

async function seedServer({ plan = 'free', lifetimeHours = 24, expiresAt, status = 'suspended', owner } = {}) {
  await seedPlan(plan, lifetimeHours);
  const user = owner ?? (await seedUser(plan));
  const [row] = await db
    .insert(servers)
    .values({
      ownerId: user.id,
      name: `srv-${Date.now()}-${seq++}`,
      runtime: 'Node.js',
      status,
      startup: 'node index.js',
      planId: plan,
      expiresAt: expiresAt === undefined ? new Date(Date.now() - HOUR) : expiresAt,
      suspendedReason: status === 'suspended' ? 'expired' : null,
      // NOT NULL in the database since migration 0017, even though the drizzle
      // column definition omits it (pre-existing drift) — supply it explicitly.
      contactCode: String(10000000 + seq++).slice(0, 8),
    })
    .returning();
  return { server: row, user };
}

const grantsFor = (serverId) =>
  db.select().from(serverRenewals).where(eq(serverRenewals.serverId, serverId));
const sessionRow = (id) =>
  db.select().from(serverRenewalSessions).where(eq(serverRenewalSessions.id, id)).limit(1);
const serverRow = (id) => db.select().from(servers).where(eq(servers.id, id)).limit(1);

before(async () => {
  pool = new Pool({ connectionString: URL, max: 8 });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  // `servers.node_id` defaults to 'local' and is a FK — the test database needs
  // that node to exist for any server row to be insertable.
  await db.execute(sql`
    INSERT INTO nodes (id, name) VALUES ('local', 'local')
    ON CONFLICT (id) DO NOTHING
  `);

  // Stopgap: a sibling migration (templates) is present on disk but not yet in
  // the drizzle journal, so `migrate()` skips it while the compiled schema
  // already expects the column. Applying it here keeps this suite runnable
  // against a tree that is mid-change; it is a no-op once that migration is
  // journalled normally.
  await db.execute(sql`
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS template_id varchar(64)
  `);
});

after(async () => {
  // Remove ONLY what these tests created. The suite is pointed at its own
  // throwaway database, and the email filter makes the cleanup idempotent so a
  // re-run never collides with a previous run's fixtures.
  await db.execute(sql`DELETE FROM server_renewals WHERE server_id IN (SELECT id FROM servers WHERE name LIKE 'srv-%')`);
  await db.execute(sql`DELETE FROM server_renewal_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.local')`);
  await db.execute(sql`DELETE FROM servers WHERE name LIKE 'srv-%'`);
  await db.execute(sql`DELETE FROM users WHERE email LIKE '%@test.local'`);
  await pool.end();
});

beforeEach(async () => {
  // unique constraints (lower(name), lower(email)) mean fixtures must not
  // survive between tests
  await db.execute(sql`DELETE FROM servers WHERE name LIKE 'srv-%'`);
  await db.execute(sql`DELETE FROM users WHERE email LIKE '%@test.local'`);
  await db.execute(sql`DELETE FROM server_renewals`);
  await db.execute(sql`DELETE FROM server_renewal_sessions`);
});

describe('step 1 — opening a renewal attempt', () => {
  it('creates a pending session for an expired free server and returns a work.ink URL', async () => {
    const w = new FakeWorkink();
    const svc = makeService(w);
    const { server, user } = await seedServer();

    const out = await svc.open(user.id, server.id, ctx);
    assert.ok(out.session.id);
    assert.ok(out.redirectUrl.startsWith('https://work.ink/'), out.redirectUrl);
    assert.equal(w.overrideCalls, 1);

    const [row] = await sessionRow(out.session.id);
    assert.equal(row.userId, user.id);
    assert.equal(row.serverId, server.id);
    assert.equal(row.status, 'pending');
    // the ATTEMPT's deadline is minutes, not the server's 24h
    assert.ok(row.expiresAt.getTime() < Date.now() + 31 * 60_000);
  });

  it('refuses a server owned by somebody else and creates nothing', async () => {
    const svc = makeService(new FakeWorkink());
    const { server } = await seedServer();
    const stranger = await seedUser('free');

    await assert.rejects(() => svc.open(stranger.id, server.id, ctx), /SERVER_NOT_FOUND|Not Found/i);
    const rows = await db.select().from(serverRenewalSessions).where(eq(serverRenewalSessions.serverId, server.id));
    assert.equal(rows.length, 0);
  });

  it('refuses a paid server — the plan has no lifetime', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer({ plan: 'paid-a', lifetimeHours: null });
    await assert.rejects(() => svc.open(user.id, server.id, ctx), /PLAN_NOT_EXPIRING|time-limited/);
  });

  it('refuses a server that still has runtime left', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer({ expiresAt: new Date(Date.now() + 5 * HOUR) });
    await assert.rejects(() => svc.open(user.id, server.id, ctx), /NOT_EXPIRED|24 hours/);
  });

  it('refuses to open while the provider is not fully configured', async () => {
    const w = new FakeWorkink();
    w._ready = false;
    const svc = makeService(w);
    const { server, user } = await seedServer();
    await assert.rejects(() => svc.open(user.id, server.id, ctx), /RENEWAL_UNAVAILABLE|not available/);
  });

  it('rate-limits attempts per account', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    // open+expire repeatedly so each call creates a NEW session
    for (let i = 0; i < 10; i++) {
      const out = await svc.open(user.id, server.id, ctx);
      await db.update(serverRenewalSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(serverRenewalSessions.id, out.session.id));
    }
    await assert.rejects(() => svc.open(user.id, server.id, ctx), /RATE_LIMITED|RENEWAL_RATE/);
  });
});

describe('step 2 — completing with a key', () => {
  it('grants exactly 24 hours and writes the ledger row', async () => {
    const w = new FakeWorkink();
    const svc = makeService(w);
    const { server, user } = await seedServer();
    const [before] = await serverRow(server.id);

    const { session } = await svc.open(user.id, server.id, ctx);
    const out = await svc.complete(user.id, session.id, 'good-key-123', ctx);

    const [after] = await serverRow(server.id);
    // old deadline was 1h ago, the new one is 24h from now → 25h of movement
    const delta = after.expiresAt.getTime() - before.expiresAt.getTime();
    assert.ok(Math.abs(delta - (RENEWAL_HOURS + 1) * HOUR) < 60_000, `delta ${delta}`);
    assert.ok(out.expiresAt);
    assert.equal(w.consumed, 1, 'the key must be consumed at the provider');

    const grants = await grantsFor(server.id);
    assert.equal(grants.length, 1);
    assert.equal(grants[0].hours, RENEWAL_HOURS);
    assert.equal(grants[0].restarted, true);

    const [sess] = await sessionRow(session.id);
    assert.equal(sess.status, 'completed');
    assert.equal(sess.tokenHash.length, 64, 'the key is stored hashed');
  });

  it('never persists the raw key', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const { session } = await svc.open(user.id, server.id, ctx);
    await svc.complete(user.id, session.id, 'SUPER-SECRET-KEY', ctx);

    const [row] = await sessionRow(session.id);
    assert.ok(!JSON.stringify(row).includes('SUPER-SECRET-KEY'), 'raw key must not be stored');
  });

  it('a failed verification leaves the deadline and the ledger untouched', async () => {
    const w = new FakeWorkink();
    w.verdict = { valid: false };
    const svc = makeService(w);
    const { server, user } = await seedServer();
    const [before] = await serverRow(server.id);

    const { session } = await svc.open(user.id, server.id, ctx);
    await assert.rejects(() => svc.complete(user.id, session.id, 'bad-key', ctx));

    const [after] = await serverRow(server.id);
    assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
    assert.equal((await grantsFor(server.id)).length, 0);
  });

  it('refuses a key minted by a different work.ink link (provenance)', async () => {
    const w = new FakeWorkink();
    w.verdict = { valid: true, info: { linkId: 999999 } };
    const svc = makeService(w);
    const { server, user } = await seedServer();
    const { session } = await svc.open(user.id, server.id, ctx);

    // assert on the stable machine-readable code carried by the error
    // RESPONSE (AppError puts it in the body the filter forwards), not the copy
    await assert.rejects(
      () => svc.complete(user.id, session.id, 'foreign', ctx),
      (e) => e.getResponse().code === 'RENEWAL_VERIFICATION_FAILED' && /Troxe Hosting link/.test(e.message),
    );
    assert.equal((await grantsFor(server.id)).length, 0);
  });

  it('refuses a valid:true with NO linkId — an unprovable proof', async () => {
    const w = new FakeWorkink();
    w.verdict = { valid: true, info: {} };
    const svc = makeService(w);
    const { server, user } = await seedServer();
    const { session } = await svc.open(user.id, server.id, ctx);
    await assert.rejects(() => svc.complete(user.id, session.id, 'no-link', ctx));
    assert.equal((await grantsFor(server.id)).length, 0);
  });

  it('a provider outage does not grant runtime, and stays retryable', async () => {
    const w = new FakeWorkink();
    const svc = makeService(w);
    const { server, user } = await seedServer();
    const [before] = await serverRow(server.id);

    const { session } = await svc.open(user.id, server.id, ctx);

    // simulate the transport failing inside the client
    const broken = makeService({
      ...w,
      validateToken: async () => ({ kind: 'unavailable' }),
      cfg: w.cfg.bind(w),
      ready: w.ready.bind(w),
      redirectFor: w.redirectFor.bind(w),
    });
    await assert.rejects(
      () => broken.complete(user.id, session.id, 'key', ctx),
      /RENEWAL_PROVIDER_UNAVAILABLE|not extended/i,
    );

    const [after] = await serverRow(server.id);
    assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime(), 'an outage must not grant runtime');

    const [sess] = await sessionRow(session.id);
    assert.equal(sess.status, 'pending', 'the attempt returns to pending so the user can retry');

    // …and a successful retry then works
    const ok = await svc.complete(user.id, session.id, 'key', ctx);
    assert.ok(ok.expiresAt);
    assert.equal((await grantsFor(server.id)).length, 1);
  });

  it('refuses a session belonging to another user', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const stranger = await seedUser('free');
    const { session } = await svc.open(user.id, server.id, ctx);

    await assert.rejects(() => svc.complete(stranger.id, session.id, 'key', ctx), /RENEWAL_SESSION_NOT_FOUND/);
    assert.equal((await grantsFor(server.id)).length, 0);
  });

  it('refuses an expired session', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const { session } = await svc.open(user.id, server.id, ctx);
    await db
      .update(serverRenewalSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(serverRenewalSessions.id, session.id));

    await assert.rejects(() => svc.complete(user.id, session.id, 'key', ctx), /expired/i);
    assert.equal((await grantsFor(server.id)).length, 0);
  });

  it('never contacts the provider with a malformed key', async () => {
    const w = new FakeWorkink();
    const svc = makeService(w);
    const { server, user } = await seedServer();
    const { session } = await svc.open(user.id, server.id, ctx);

    await assert.rejects(() => svc.complete(user.id, session.id, '../../etc/passwd', ctx));
    assert.equal(w.calls, 0, 'a malformed key must not cost a provider call');
  });
});

describe('REPLAY — one key, one renewal', () => {
  it('the same key cannot renew a second server (unique token_hash)', async () => {
    const svc = makeService(new FakeWorkink());
    const a = await seedServer();
    const b = await seedServer({ owner: a.user });

    const s1 = await svc.open(a.user.id, a.server.id, ctx);
    await svc.complete(a.user.id, s1.session.id, 'REPLAY-KEY', ctx);

    const s2 = await svc.open(a.user.id, b.server.id, ctx);
    await assert.rejects(() => svc.complete(a.user.id, s2.session.id, 'REPLAY-KEY', ctx));

    assert.equal((await grantsFor(b.server.id)).length, 0, 'server B must not be extended by A’s key');
    assert.equal((await grantsFor(a.server.id)).length, 1);
  });

  it('a key that failed once can still only ever back ONE renewal', async () => {
    const w = new FakeWorkink();
    const svc = makeService(w);
    const a = await seedServer();
    const b = await seedServer({ owner: a.user });

    // burn the key against server A with a wrong link…
    w.verdict = { valid: true, info: { linkId: 42 } };
    const s1 = await svc.open(a.user.id, a.server.id, ctx);
    await assert.rejects(() => svc.complete(a.user.id, s1.session.id, 'ONCE-KEY', ctx));
    assert.equal((await grantsFor(a.server.id)).length, 0);

    // …then the SAME key now works exactly once, on server B
    w.verdict = { valid: true, info: { linkId: 10345 } };
    const s2 = await svc.open(a.user.id, b.server.id, ctx);
    await svc.complete(a.user.id, s2.session.id, 'ONCE-KEY', ctx);
    assert.equal((await grantsFor(b.server.id)).length, 1);

    // …and never again
    const s3 = await seedServer({ owner: a.user });
    const s3session = await svc.open(a.user.id, s3.server.id, ctx);
    await assert.rejects(() => svc.complete(a.user.id, s3session.session.id, 'ONCE-KEY', ctx));
    assert.equal((await grantsFor(s3.server.id)).length, 0);
  });

  it('the database itself refuses a duplicate grant for one session', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const { session } = await svc.open(user.id, server.id, ctx);
    await svc.complete(user.id, session.id, 'DUP-KEY', ctx);

    // bypass the service entirely: the database itself must refuse. drizzle
    // wraps the driver error, so the PG code lives on `.cause` — which is
    // exactly what the service's `pgCodeOf()` walks to catch this race.
    await assert.rejects(
      () =>
        db.insert(serverRenewals).values({
          serverId: server.id,
          userId: user.id,
          sessionId: session.id,
          hours: 24,
          expiresBefore: new Date(),
          expiresAfter: new Date(),
        }),
      (e) => pgCodeOf(e) === '23505',
    );
  });
});

describe('CONCURRENCY — a double-click must not buy two days', () => {
  it('five simultaneous completions grant exactly one 24 hours', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const [before] = await serverRow(server.id);
    const { session } = await svc.open(user.id, server.id, ctx);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => svc.complete(user.id, session.id, 'RACE-KEY', ctx)),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    assert.equal(won.length, 1, `exactly one completion may succeed, got ${won.length}`);

    assert.equal((await grantsFor(server.id)).length, 1, 'exactly one ledger row');

    const [after] = await serverRow(server.id);
    const delta = after.expiresAt.getTime() - before.expiresAt.getTime();
    assert.ok(Math.abs(delta - (RENEWAL_HOURS + 1) * HOUR) < 60_000, `one grant only, delta ${delta}`);
  });

  it('re-submitting a finished session is refused, never re-granted', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const { session } = await svc.open(user.id, server.id, ctx);
    await svc.complete(user.id, session.id, 'AGAIN-KEY', ctx);

    await assert.rejects(() => svc.complete(user.id, session.id, 'AGAIN-KEY', ctx));
    assert.equal((await grantsFor(server.id)).length, 1);
  });
});

describe('the expiry sweep', () => {
  it('suspends only servers past their deadline', async () => {
    const svc = makeService(new FakeWorkink());
    const expired = await seedServer({ status: 'online', expiresAt: new Date(Date.now() - HOUR) });
    const alive = await seedServer({ status: 'online', expiresAt: new Date(Date.now() + 2 * HOUR) });

    await svc.sweepExpired();

    const [e] = await serverRow(expired.server.id);
    assert.equal(e.status, 'suspended');
    assert.equal(e.suspendedReason, 'expired');

    const [a] = await serverRow(alive.server.id);
    assert.equal(a.status, 'online', 'a server with time left is never touched');
  });

  it('never suspends a server with no deadline (paid plans)', async () => {
    const svc = makeService(new FakeWorkink());
    const paid = await seedServer({ plan: 'paid-noexp', lifetimeHours: null, expiresAt: null, status: 'online' });
    await svc.sweepExpired();
    const [row] = await serverRow(paid.server.id);
    assert.equal(row.status, 'online');
    assert.equal(row.suspendedReason, null);
  });

  it('is idempotent and safe under concurrent sweeps', async () => {
    const svc = makeService(new FakeWorkink());
    const expired = await seedServer({ status: 'online', expiresAt: new Date(Date.now() - HOUR) });
    await Promise.all([svc.sweepExpired(), svc.sweepExpired(), svc.sweepExpired()]);
    const [row] = await serverRow(expired.server.id);
    assert.equal(row.status, 'suspended');
    assert.equal(row.suspendedReason, 'expired');
  });
});

describe('a failed restart must not cost the user their 24 hours', () => {
  it('grants the time, records the failure, and cannot be re-triggered', async () => {
    const svc = makeService(new FakeWorkink(), {
      restoreFromExpiry: async () => {
        throw new Error('docker daemon unreachable');
      },
    });
    const { server, user } = await seedServer();
    const [before] = await serverRow(server.id);
    const { session } = await svc.open(user.id, server.id, ctx);

    const out = await svc.complete(user.id, session.id, 'RESTART-FAIL', ctx);
    assert.ok(out.expiresAt, 'the user still received their 24 hours');
    assert.equal(out.restarted, false);
    assert.ok(out.restartError, 'the failure is reported honestly');

    const [after] = await serverRow(server.id);
    assert.ok(after.expiresAt.getTime() > before.expiresAt.getTime());

    const grants = await grantsFor(server.id);
    assert.equal(grants.length, 1);
    assert.equal(grants[0].restarted, false);
    assert.match(grants[0].restartError ?? '', /docker/);

    // retrying must NOT hand out another 24 hours
    await assert.rejects(() => svc.complete(user.id, session.id, 'RESTART-FAIL', ctx));
    assert.equal((await grantsFor(server.id)).length, 1);
  });
});

describe('an UPGRADED customer must never be stranded by an old expiry', () => {
  it('the sweep only expires servers whose OWNER is on an expiring plan now', async () => {
    // The regression this guards: `servers.plan_id` is a SNAPSHOT taken at
    // creation. A customer who created a server on the free plan and then
    // upgraded still has rows saying 'free'. Expiring those would suspend a
    // paid server whose owner can never renew it (their plan has no lifetime)
    // — permanently bricked.
    const svc = makeService(new FakeWorkink());
    await seedPlan('free', 24);
    await seedPlan('platinum-x', null);

    const owner = await seedUser('platinum-x');
    // a server created while this owner was still on the free plan
    const [stale] = await db
      .insert(servers)
      .values({
        ownerId: owner.id,
        name: `srv-${Date.now()}-up`,
        runtime: 'Node.js',
        status: 'online',
        startup: 'node index.js',
        planId: 'free', // <- the snapshot
        contactCode: String(90000000 + seq++).slice(0, 8),
        expiresAt: null,
      })
      .returning();

    await svc.sweepExpired();
    const [after] = await serverRow(stale.id);
    assert.equal(after.status, 'online', 'a paid owner’s server must never be swept');
    assert.equal(after.expiresAt, null);

    // and the eligibility check agrees: no lifetime on the owner's plan
    const st = await svc.statusFor(owner.id, stale.id);
    assert.equal(st.expiryState, 'not_expiring');
    assert.equal(st.eligible, false);
    assert.equal(st.ineligibleReason, 'PLAN_NOT_EXPIRING');
  });
});

describe('reads never leak another account or a secret', () => {
  it('history is owner-scoped', async () => {
    const svc = makeService(new FakeWorkink());
    const { server } = await seedServer();
    const stranger = await seedUser('free');
    await assert.rejects(() => svc.history(stranger.id, server.id), /SERVER_NOT_FOUND|Not Found/i);
  });

  it('session status is owner-scoped', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const stranger = await seedUser('free');
    const { session } = await svc.open(user.id, server.id, ctx);
    await assert.rejects(() => svc.requireOwnSession(stranger.id, session.id), /RENEWAL_SESSION_NOT_FOUND/);
  });

  it('status reports the deadline without provider configuration', async () => {
    const svc = makeService(new FakeWorkink());
    const { server, user } = await seedServer();
    const st = await svc.statusFor(user.id, server.id);
    assert.equal(st.server.id, server.id);
    assert.equal(st.expiryState, 'expired');
    assert.equal(st.eligible, true);
    assert.equal(st.renewalHours, RENEWAL_HOURS);

    const dumped = JSON.stringify(st);
    assert.ok(!dumped.includes('10345'), 'the configured link id must not reach the client');
    assert.ok(!/apikey|secret/i.test(dumped), 'no provider secret may reach the client');
  });
});

describe('the backend gate blocks power operations on an expired server', () => {
  it('refuses before any docker call, even with status still online', async () => {
    const svc = new ServersService(
      db,
      { provision: async () => ({}), isIsolationOk: async () => true },
      { allocate: async () => ({ port: 30001 }) },
      { inspect: async () => null, stats: async () => null, stop: async () => undefined },
      { record: async () => undefined },
      { broadcastServerStatus: () => undefined },
      { lookup: async () => null },
      { pickNode: async () => 'local' },
      { resolve: async () => ({ row: {}, isOwner: true, permissions: [] }) },
    );

    const { server } = await seedServer({ status: 'online', expiresAt: new Date(Date.now() - HOUR) });

    // 1) already suspended for expiry
    assert.throws(
      () => svc.assertOperable({ status: 'suspended', suspendedReason: 'expired', expiresAt: new Date(Date.now() - 1) }),
      /SERVER_EXPIRED|free runtime/,
    );
    // 2) NOT yet suspended — the sweep simply has not run yet. This is the case
    //    that proves the gate is independent of the scheduler.
    assert.throws(
      () => svc.assertOperable({ status: 'online', suspendedReason: null, expiresAt: new Date(Date.now() - 1) }),
      /SERVER_EXPIRED|free runtime/,
    );
    // 3) a healthy server is untouched
    assert.doesNotThrow(() =>
      svc.assertOperable({ status: 'online', suspendedReason: null, expiresAt: new Date(Date.now() + HOUR) }),
    );
    // 4) a paid server with no deadline is never expired
    assert.doesNotThrow(() => svc.assertOperable({ status: 'online', suspendedReason: null, expiresAt: null }));
    // 5) an admin suspension keeps its own distinct message
    assert.throws(
      () => svc.assertOperable({ status: 'suspended', suspendedReason: 'admin', expiresAt: null }),
      /SERVER_SUSPENDED|administration/,
    );
    void server;
  });
});