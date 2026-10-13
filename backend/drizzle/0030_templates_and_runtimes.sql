-- Templates + wider runtime enum.
--
-- WHAT THIS DOES
--   1. adds `servers.template_id` — which catalog template a server was
--      created from (install/build steps, port plan, default startup);
--   2. widens the `server_runtime` enum with Go, Rust, Java, Ruby, .NET, Deno;
--   3. records per-template verification results so an admin can see WHY a
--      template is unverified/broken, not just a flag.
--
-- WHY template_id IS NULLABLE
-- Every server that exists today predates templates. Rather than backfill them
-- with a guessed template (which would silently attach install steps to a
-- running customer's server), the column stays NULL for existing rows and they
-- keep resolving through their `runtime` exactly as before. A NULL is a
-- normal, supported state — not an unfinished migration.
--
-- WHY ALTER TYPE IS NOT WRAPPED IN A TRANSACTION
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on
-- PostgreSQL < 12. Leaving it unwrapped keeps this migration runnable on the
-- older engines a self-hosted node may still be on. The ADD VALUE calls are
-- idempotent via the guard below, so re-running is safe.

-- ---------------------------------------------------------------------------
-- 1. new runtimes
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'server_runtime' AND e.enumlabel = 'Go') THEN
    ALTER TYPE server_runtime ADD VALUE 'Go';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'server_runtime' AND e.enumlabel = 'Rust') THEN
    ALTER TYPE server_runtime ADD VALUE 'Rust';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'server_runtime' AND e.enumlabel = 'Java') THEN
    ALTER TYPE server_runtime ADD VALUE 'Java';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'server_runtime' AND e.enumlabel = 'Ruby') THEN
    ALTER TYPE server_runtime ADD VALUE 'Ruby';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'server_runtime' AND e.enumlabel = '.NET') THEN
    ALTER TYPE server_runtime ADD VALUE '.NET';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'server_runtime' AND e.enumlabel = 'Deno') THEN
    ALTER TYPE server_runtime ADD VALUE 'Deno';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. template column (nullable — see header)
-- ---------------------------------------------------------------------------
ALTER TABLE servers ADD COLUMN IF NOT EXISTS template_id varchar(64);

CREATE INDEX IF NOT EXISTS servers_template_idx ON servers (template_id);

-- ---------------------------------------------------------------------------
-- 3. verification results
--
-- One row per (template, run). Keeping every run rather than overwriting means
-- an admin can see whether a template was ever green and when it last was —
-- which is the only honest way to present "verified" to anyone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id varchar(64) NOT NULL,
  -- the catalog definition version that was exercised
  template_version integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL CHECK (status IN ('verified','unverified','broken','deprecated','disabled')),
  install_status varchar(16) NOT NULL DEFAULT 'unknown'
    CHECK (install_status IN ('ok','failed','skipped','pending','unknown')),
  build_status varchar(16) NOT NULL DEFAULT 'unknown'
    CHECK (build_status IN ('ok','failed','skipped','pending','unknown')),
  startup_status varchar(16) NOT NULL DEFAULT 'unknown'
    CHECK (startup_status IN ('ok','failed','skipped','pending','unknown')),
  health_status varchar(16) NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('ok','failed','skipped','pending','unknown')),
  -- machine-readable detail per level, kept opaque to the API
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- client-safe one-line explanation; never contains secrets or daemon internals
  reason text,
  -- which runtime version was exercised, so a pin can be re-tested in isolation
  runtime_version varchar(16),
  duration_ms integer,
  ran_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_verifications_tpl_idx
  ON template_verifications (template_id, ran_at DESC);

-- Every run is kept on purpose: an admin asking "was this EVER green?" needs
-- history, and overwriting the previous row is what lets a flaky template hide
-- its own flakiness. The DESC index above makes "newest result" a single index
-- scan rather than a max()/join.