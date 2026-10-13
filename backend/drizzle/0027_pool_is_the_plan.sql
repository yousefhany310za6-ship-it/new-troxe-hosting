-- Roll back the account-pool columns: plans.cpu_milli / ram_mb / storage_gb
-- ARE the account budget.
--
-- They were first introduced (0026) as a second, larger ceiling on top of a
-- "per server" reading of the same numbers, which made a Platinum account hold
-- 1500 x 12 = 18 vCPU of Docker limits. A plan advertises "1.5 vCPU, 3 GB RAM,
-- 12 GB disk" — that is the whole account, divided across its servers, not a
-- per-server allowance that multiplies by the server count.
--
-- One number per resource is also what the admin UI has always edited.
DROP INDEX IF EXISTS "plans_pool_check";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "pool_cpu_milli";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "pool_ram_mb";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "pool_storage_gb";