-- Free-plan servers run for a bounded time and can be extended through a
-- verified Work.ink renewal. Paid plans are untouched: server_lifetime_hours
-- stays NULL for them and expires_at stays NULL on their servers forever.
--
-- Additive only — no column or row is dropped or rewritten destructively.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "server_lifetime_hours" integer;
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "suspended_reason" varchar(16);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "servers_expires_at_idx" ON "servers" ("expires_at");
--> statement-breakpoint
-- A lifetime shorter than an hour could never host a working server.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plans_server_lifetime_hours_check') THEN
    ALTER TABLE "plans"
      ADD CONSTRAINT "plans_server_lifetime_hours_check"
      CHECK ("server_lifetime_hours" IS NULL OR "server_lifetime_hours" >= 1);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servers_suspended_reason_check') THEN
    ALTER TABLE "servers"
      ADD CONSTRAINT "servers_suspended_reason_check"
      CHECK ("suspended_reason" IS NULL OR "suspended_reason" IN ('admin', 'expired'));
  END IF;
END $$;
--> statement-breakpoint
CREATE TYPE "public"."renewal_session_status" AS ENUM('pending', 'verifying', 'completed', 'failed', 'expired');
--> statement-breakpoint
CREATE TABLE "server_renewal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
	"status" "public"."renewal_session_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"token_hash" varchar(64),
	"token_link_id" varchar(32),
	"token_created_at" timestamp,
	"token_ip" varchar(45),
	"failure_reason" varchar(64),
	"ip" varchar(45),
	"user_agent" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The replay guard: one Work.ink key can back AT MOST one session, ever.
-- Spanning every status (not just completed) means a key rejected once cannot
-- be retried against a different server.
CREATE UNIQUE INDEX "server_renewal_sessions_token_hash_unique" ON "server_renewal_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX "server_renewal_sessions_server_idx" ON "server_renewal_sessions" ("server_id", "created_at");
--> statement-breakpoint
CREATE INDEX "server_renewal_sessions_user_idx" ON "server_renewal_sessions" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "server_renewal_sessions_status_idx" ON "server_renewal_sessions" ("status", "expires_at");
--> statement-breakpoint
CREATE TABLE "server_renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
	"user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"session_id" uuid REFERENCES "server_renewal_sessions"("id") ON DELETE SET NULL,
	"hours" integer NOT NULL,
	"expires_before" timestamp NOT NULL,
	"expires_after" timestamp NOT NULL,
	"restarted" boolean DEFAULT false NOT NULL,
	"restart_error" varchar(300),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "server_renewals_hours_check" CHECK ("hours" >= 1)
);
--> statement-breakpoint
-- One attempt can produce at most one grant. A concurrent double-submit of
-- the same completion request loses here and cannot hand out a second 24h.
CREATE UNIQUE INDEX "server_renewals_session_unique" ON "server_renewals" ("session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "server_renewals_server_session_unique" ON "server_renewals" ("server_id", "session_id");
--> statement-breakpoint
CREATE INDEX "server_renewals_server_idx" ON "server_renewals" ("server_id", "created_at");
--> statement-breakpoint
CREATE INDEX "server_renewals_user_idx" ON "server_renewals" ("user_id", "created_at");
--> statement-breakpoint
-- The free plan is the only expiring one: 24 hours per server.
UPDATE "plans" SET "server_lifetime_hours" = 24 WHERE "id" = 'free' AND "server_lifetime_hours" IS NULL;
--> statement-breakpoint
-- Existing free-plan servers get a FULL day from the moment this migration
-- runs rather than being expired retroactively: without a backfill they would
-- carry expires_at = NULL and never expire, which is a different (wrong)
-- product. Every other server stays NULL = never expires.
--
-- The join on the OWNER's current plan is load-bearing. `servers.plan_id` is a
-- snapshot taken at creation, so a customer who has since UPGRADED still has
-- rows saying 'free'. Expiring those would suspend a paid server that can
-- never be renewed (its owner's plan has no lifetime), i.e. permanently brick
-- it. Only a server whose owner is on the free plan RIGHT NOW gets a deadline.
UPDATE "servers" s
SET "expires_at" = now() + interval '24 hours'
WHERE s."expires_at" IS NULL
  AND EXISTS (SELECT 1 FROM "users" u WHERE u.id = s."owner_id" AND u.plan_id = 'free');