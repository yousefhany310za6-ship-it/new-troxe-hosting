CREATE TYPE "public"."backup_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_type" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."server_runtime" AS ENUM('Node.js', 'Python', 'Bun', 'PHP');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('provisioning', 'online', 'offline', 'restarting', 'deleting', 'error');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_email" varchar(255),
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"ip" varchar(45),
	"user_agent" varchar(255),
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" varchar(64) NOT NULL,
	"ip" varchar(45),
	"device" varchar(255),
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"size_bytes" bigint,
	"storage_key" text NOT NULL,
	"status" "backup_status" DEFAULT 'pending' NOT NULL,
	"type" "backup_type" DEFAULT 'manual' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"cpu_milli" integer DEFAULT 250 NOT NULL,
	"ram_mb" integer DEFAULT 256 NOT NULL,
	"storage_gb" integer DEFAULT 1 NOT NULL,
	"max_servers" integer DEFAULT 1 NOT NULL,
	"max_backup_slots" integer DEFAULT 0 NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "server_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" varchar(48) NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "server_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"cpu" integer NOT NULL,
	"ram" integer NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"runtime" "server_runtime" NOT NULL,
	"runtime_version" varchar(64),
	"status" "server_status" DEFAULT 'provisioning' NOT NULL,
	"last_error" text,
	"region" varchar(32) DEFAULT 'fra-de' NOT NULL,
	"plan_id" varchar(32),
	"cpu_milli" integer DEFAULT 250 NOT NULL,
	"ram_mb" integer DEFAULT 256 NOT NULL,
	"storage_gb" integer DEFAULT 1 NOT NULL,
	"startup" text NOT NULL,
	"env_encrypted" text,
	"image" varchar(128),
	"container_id" varchar(64),
	"container_name" varchar(64),
	"network_name" varchar(64),
	"network_subnet" varchar(64),
	"volume_name" varchar(64),
	"auto_restart" boolean DEFAULT true NOT NULL,
	"auto_backup" boolean DEFAULT true NOT NULL,
	"provisioned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" varchar(45),
	"device" varchar(255),
	"location" varchar(255),
	"country_code" varchar(2),
	"status" "session_status" DEFAULT 'success' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(30) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"plan_id" varchar(32) DEFAULT 'free' NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"password_changed_at" timestamp DEFAULT now() NOT NULL,
	"notify_restarts" boolean DEFAULT true NOT NULL,
	"notify_invoices" boolean DEFAULT true NOT NULL,
	"notify_marketing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backups" ADD CONSTRAINT "backups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_events" ADD CONSTRAINT "server_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_events" ADD CONSTRAINT "server_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_metrics" ADD CONSTRAINT "server_metrics_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "servers" ADD CONSTRAINT "servers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "servers" ADD CONSTRAINT "servers_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_hash_idx" ON "auth_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_family_idx" ON "auth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backups_server_idx" ON "backups" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "server_events_server_idx" ON "server_events" USING btree ("server_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "server_metrics_server_at_idx" ON "server_metrics" USING btree ("server_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "servers_owner_name_idx" ON "servers" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "servers_owner_idx" ON "servers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "servers_status_idx" ON "servers" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_created_idx" ON "sessions" USING btree ("user_id","created_at");