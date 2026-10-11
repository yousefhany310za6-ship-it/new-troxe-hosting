--> statement-breakpoint
-- Scheduled tasks: cron-driven backup / power actions per server.
-- Times are stored in UTC; the UI converts next_run_at to local time.
CREATE TYPE "public"."schedule_action" AS ENUM('backup', 'start', 'stop', 'restart');
--> statement-breakpoint
CREATE TABLE "server_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
	"name" varchar(64) NOT NULL,
	"cron" varchar(64) NOT NULL,
	"action" "public"."schedule_action" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"last_run_at" timestamp,
	"last_status" varchar(16),
	"last_error" varchar(500),
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "server_schedules_server_idx" ON "server_schedules" ("server_id");
--> statement-breakpoint
CREATE INDEX "server_schedules_due_idx" ON "server_schedules" ("enabled", "next_run_at");
