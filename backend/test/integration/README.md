# Port tests

Port behaviour is split across three suites because the guarantees live in
three different places. Running only one of them proves much less than it looks
like it does.

| Suite | Proves | Needs |
|---|---|---|
| `npm run test:unit` | range discipline, reserved ports, candidate ordering, address resolution | nothing |
| `npm run test:ports:db` | atomicity, the partial unique index, release semantics, tri-state health | a **throwaway** PostgreSQL |
| `npm run test:ports:docker` | real publishing, protocol, real traffic, restart, drift, isolation | the Docker socket |

## The database suite

`test:ports:db` **truncates tables**. It takes a deliberately awkward env var:

```sh
DESTRUCTIVE_DATABASE_URL=postgresql://postgres:porttest@127.0.0.1:55432/troxe_porttest \
  npm run test:ports:db
```

Not `DATABASE_URL`. There is no way to point it at the fleet by accident, and
`scripts/prepare-port-test-db.mjs` additionally refuses any database whose name
does not look throwaway (`test` / `tmp` / `scratch` / `throwaway`).

To bring one up:

```sh
docker run -d --name troxe-porttest-pg \
  -e POSTGRES_PASSWORD=porttest -e POSTGRES_DB=troxe_porttest \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
```

The schema is built by the script from the **shipped migration files**
(`drizzle/0022` + `drizzle/0029`), not hand-written, so the indexes and
constraints under test are the ones that actually run in production. Run it as
a user that can write `test/integration/.schema.sql`.

## The Docker suite

Needs the Docker socket. It creates its own networks, volumes and containers,
all namespaced `troxe_porttest_*`, and removes them in `after()` — including on
failure. It:

- uses a dedicated high port block (`39000+`), never the platform's published
  pool, so a live customer server can never be touched
- **installs and removes no iptables rule** — the isolation rules are verified
  separately and non-destructively by `evaluateHardeningRules()` in the unit
  suite
- skips (does not fail) when the daemon is unreachable

```sh
docker run --rm --network host --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD":/app -w /app \
  --entrypoint sh troxe-hosting-api \
  'npm run test:ports:docker'
```

## What the Docker suite catches that no mock would

One case is worth knowing about, because it invalidated a design:

```
published port, container has NO listener  →  connect() SUCCEEDS
published port, container IS listening     →  connect() succeeds and holds
```

Docker's userland proxy accepts the handshake before it knows whether anything
is on the far side. A naive "is the port open?" check therefore reports a dead
port as reachable. The suite pins this down as a precondition
(`bareConnect(...) === true` on a dead port) and asserts that the shipped probe
(`probeService`) returns `false` for it.