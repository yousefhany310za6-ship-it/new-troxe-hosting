-- Host-port allocation: real health observation + admin-controlled per-node
-- port range.
--
-- THREE separate things, all additive and nullable, so no existing row is
-- rewritten and no allocation is invalidated:
--
--  1. The partial unique indexes are RECREATED. 0022 created them partial and
--     the Drizzle schema declared them WITHOUT the `WHERE state='allocated'`
--     predicate — so the next `drizzle-kit generate` would have emitted a DROP
--     + CREATE without the predicate. The result: a released port would stay
--     reserved forever, and after as few as ~100 create/delete cycles the node
--     would answer PORT_POOL_EXHAUSTED with an empty, permanently empty pool.
--     Recreating them here is a no-op for data (same predicate, same columns).
--  2. `nodes.port_range_from/to`: the pool a node publishes from, set in the
--     admin dashboard. NULL on both = fall back to PORT_RANGE_FROM/TO.
--  3. Health columns on the allocation: what was actually OBSERVED on the host.
--     NULL means "not measured / not measurable from here" and is deliberately
--     distinct from FALSE. They are a cache the reconciler refreshes — the
--     allocation row stays the source of truth for "who owns this port".

-- 1. restore the partial predicate on both unique indexes
DROP INDEX IF EXISTS "server_ports_node_port_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "server_ports_node_port_unique" ON "server_ports" ("node_id", "port") WHERE "state" = 'allocated';
--> statement-breakpoint
DROP INDEX IF EXISTS "server_ports_server_proto_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "server_ports_server_proto_unique" ON "server_ports" ("server_id", "protocol") WHERE "state" = 'allocated';
--> statement-breakpoint
-- 2. per-node port range (admin dashboard; NULL = platform default)
ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "port_range_from" integer;
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "port_range_to" integer;
--> statement-breakpoint
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "nodes" ADD CONSTRAINT "nodes_port_range_check"
    CHECK ("port_range_from" IS NULL OR "port_range_to" IS NULL OR ("port_range_from" >= 1024 AND "port_range_to" <= 65535 AND "port_range_from" <= "port_range_to"));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- 3. observed health of a published port (null = unknown, never "false")
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "container_listening" boolean;
--> statement-breakpoint
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "container_checked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "host_reachable" boolean;
--> statement-breakpoint
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "host_checked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "server_ports" ADD COLUMN IF NOT EXISTS "drift" varchar(16);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "server_ports" ADD CONSTRAINT "server_ports_drift_check"
    CHECK ("drift" IS NULL OR "drift" IN ('missing', 'extra'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;