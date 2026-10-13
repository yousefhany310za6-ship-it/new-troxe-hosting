# Troxe template catalog

Every workload a customer can run is a **template**: a data record that decides
the runtime, the install and build steps, the ports it publishes and the
default startup command.

## Why this layer exists

Until this existed, `RUNTIME_IMAGES` was simultaneously the image allowlist
*and* the list of things a client could create. That had three consequences:

- **One flavour per runtime.** "Node.js" had to serve a Discord bot, an
  Express app and a cron worker alike, so it could only have one startup
  command and one install strategy.
- **No install or build step beyond three hardcoded ones.** `npm install`,
  `bun install` and `pip install -r requirements.txt` were `switch` cases in
  `sandbox.ts`. That is why Composer, pnpm, Yarn, Poetry, Bundler, `go build`,
  `cargo build`, Maven, Gradle and `dotnet publish` did not exist — not a
  policy decision, just nowhere to declare them.
- **The landing page advertised products that could not be created.** See
  "Advertising gap" below.

## How the layers fit

```
catalog.ts   TemplateDefinition[]     <- what a customer picks (DATA)
   │            id, category, runtime, versions, install[], build[],
   │            startup, ports, recommended resources, status, docs
   │
   ├─ steps.ts       compileInstallPrelude / compileBuildPrelude
   │                 declarative steps  ->  fixed shell fragments
   │
   ├─ discovery.ts   lockfile/manifest detection (pnpm vs yarn vs npm, …)
   ├─ schema-check.ts validateCatalog()  <- build-time gate, runs in CI
   └─ runtime: RUNTIME_IMAGES (images.ts)
                the ALLOWED images. A template carries no image of its own.
```

**The allowlist is not bypassable.** A template names a *runtime* and a set of
*version selectors*; the concrete image is always resolved through
`RUNTIME_IMAGES` + `resolveVersion()`. `schema-check.ts` fails the build if a
template references an unknown runtime or a version the runtime does not have.
Adding a template can therefore never widen what is allowed to run on the host.

## Security model

Templates are data, never code:

- **Install and build steps are declarative.** `{ kind: 'npm', mode: 'install' }`,
  not a shell string. `steps.ts` owns every character of the resulting command.
- **No client input reaches command construction.** The only string a step can
  carry is a maintainer-written script name, and even that is passed through
  `shq()`. File names a client controls are only ever used as `[ -f '…' ]`
  existence tests inside quotes — a file called `a;touch /etc/passwd` is a
  test, not an injection.
- **A failed install aborts the start.** Silently starting against a
  half-installed tree is what produces "installed fine, then the bot died with
  MODULE_NOT_FOUND at 3am".
- **The startup command is still client-editable**, and that is deliberate: it
  is confined inside the sandbox that `sandbox.ts` already hardens
  (`CapDrop: ALL`, read-only rootfs, no-new-privileges, non-root uid, PID and
  memory caps, no docker socket, per-server network). See
  `SECURITY-AUDIT-2026-10-07.md`.

`test/unit/template-security.test.ts` asserts these properties directly rather
than trusting the comments.

## Lifecycle phases

The platform tracks five states **separately**, because conflating them is how
"it installed" gets reported as "it works":

| Phase | Meaning |
|---|---|
| `install_status` | dependencies resolved into the volume |
| `build_status` | the project compiled |
| `startup_status` | the process stayed up |
| `health_status` | it answered a real request, where measurable |
| `verification_status` | a test suite ran this template and it passed |

A template is `verified` **only** when its own integration case passes. The unit
suite enforces this: a template claiming `verified` without a matching case in
`test/templates/integration.test.ts` fails the build.

## Status values

| Status | Meaning |
|---|---|
| `verified` | its integration case passed against real containers |
| `unverified` | no test has actually run it (every such template carries a `note` saying why) |
| `broken` | a test ran and failed |
| `deprecated` | still runnable, no longer recommended |
| `disabled` | hidden from creation entirely |

A disabled or deprecated template stays **resolvable**, so a server already
running on one is never bricked by a later disable.

## Images

Every image is pinned **by digest**, never by tag, and never `latest`. Digests
were resolved from the upstream registry and recorded in `images.ts` next to the
tag they correspond to, so a rotation is a one-line change plus a re-run of the
integration suite.

Two platform-built images exist because the official ones cannot deliver what
the catalog promises:

- **`docker/images/php-composer`** — `php:8.3-cli` ships **no composer, no git
  and no unzip** (verified by probing the image). Composer is installed at BUILD
  time with a checksum taken from upstream, never downloaded and executed inside
  a sandbox. Build with `npm run image:php-composer`.

pnpm and Yarn are bootstrapped into the *volume* on first start instead of the
image, because `corepack enable` writes into the image's own `/usr/local` and
the sandbox root filesystem is read-only. That limitation is why those tools
land on the volume, and it is verified by the integration suite.

## Testing

| Level | What it proves | How to run |
|---|---|---|
| 1. schema | the catalog is internally consistent | `npm run test:unit` |
| 2. static | commands are bounded, quoted, non-interpolating | `npm run test:unit` |
| 3. Docker | real install → build → start → restart → persistence | `TROXE_TEMPLATE_TESTS=1 npm run test:templates` |
| 4. negative | injection, traversal, bad versions, failed builds | `npm run test:unit` |
| 5. end-to-end | create a server through the real API | requires a running API + DB |

Level 3 is opt-in on purpose: it pulls images and runs compilers, and must never
fire by accident on a machine serving customers. Its containers are named
`troxetpl-*` and deliberately carry **no `troxe.*` labels**, so the platform's
own reconciler cannot mistake them for customer workloads or sweep them up.

## Currently verified

Six templates have a passing integration case. Everything else is honestly
`unverified` and says why in its `note` — the catalog is a work list, not a
wish list. Run the suite to see the current state rather than trusting this
table.

## Advertising gap

The landing page (`src/data/services.jsx`) advertises Managed MySQL,
PostgreSQL, MongoDB and Redis. **None of them exist**, and this work did not add
them: managed databases need their own provisioning, isolation, network policy
and backup subsystem, which is a separate project rather than a template.

The same file advertises static-site hosting on a global edge, which is not
something a Docker-sandbox platform provides.

`src/data/pricing.jsx` lists six games in its carousel; only Minecraft is in
scope here. The comment already in that file states the intended rule — drop
what is not actually offered rather than advertise it.