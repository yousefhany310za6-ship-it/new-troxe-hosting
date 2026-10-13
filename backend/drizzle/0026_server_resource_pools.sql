-- Account-wide resource ceilings: the sum of every server an owner holds must
-- stay inside the plan, while cpu_milli/ram_mb/storage_gb stay the per-server
-- ceiling (unchanged meaning — they are the numbers the pricing pages show).
--
-- Backfill = perServer x maxServers, capped at the largest plan we sell
-- (8000 milli / 24576 MB / 100 GB) so existing servers never become illegal
-- after the migration and no plan can be seeded over the platform cap.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "pool_cpu_milli" integer;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "pool_ram_mb" integer;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "pool_storage_gb" integer;
--> statement-breakpoint
UPDATE "plans"
SET "pool_cpu_milli" = LEAST("cpu_milli" * GREATEST("max_servers", 1), 8000),
    "pool_ram_mb" = LEAST("ram_mb" * GREATEST("max_servers", 1), 24576),
    "pool_storage_gb" = LEAST("storage_gb" * GREATEST("max_servers", 1), 100)
WHERE "pool_cpu_milli" IS NULL
   OR "pool_ram_mb" IS NULL
   OR "pool_storage_gb" IS NULL;
--> statement-breakpoint
-- A pool can never be tighter than a single server: otherwise the per-server
-- ceiling would be unreachable and the plan would be self-contradictory.
UPDATE "plans"
SET "pool_cpu_milli" = GREATEST(COALESCE("pool_cpu_milli", "cpu_milli"), "cpu_milli"),
    "pool_ram_mb" = GREATEST(COALESCE("pool_ram_mb", "ram_mb"), "ram_mb"),
    "pool_storage_gb" = GREATEST(COALESCE("pool_storage_gb", "storage_gb"), "storage_gb");