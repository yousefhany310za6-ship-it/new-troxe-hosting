--> statement-breakpoint
CREATE TYPE "public"."announcement_kind" AS ENUM('info', 'success', 'warning', 'critical');
--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'scheduled', 'published', 'paused', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."display_policy" AS ENUM('once', 'every_visit', 'interval', 'until_ack');
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"title" varchar(140) NOT NULL,
	"body" text NOT NULL,
	"kind" "public"."announcement_kind" DEFAULT 'info' NOT NULL,
	"status" "public"."announcement_status" DEFAULT 'draft' NOT NULL,
	"policy" "public"."display_policy" DEFAULT 'once' NOT NULL,
	"require_ack" boolean DEFAULT false NOT NULL,
	"interval_hours" integer,
	"audience" jsonb DEFAULT '{"type":"all"}' NOT NULL,
	"action_label" varchar(40),
	"action_url" varchar(500),
	"event_start" timestamp,
	"event_end" timestamp,
	"publish_at" timestamp,
	"expires_at" timestamp,
	"content_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "announcements_status_idx" ON "announcements" ("status");
--> statement-breakpoint
CREATE INDEX "announcements_publish_idx" ON "announcements" ("publish_at");
--> statement-breakpoint
CREATE TABLE "announcement_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"version" integer NOT NULL,
	"last_shown_at" timestamp,
	"show_count" integer DEFAULT 0 NOT NULL,
	"acked_at" timestamp,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_ix_unique" UNIQUE("announcement_id","user_id","version")
);
--> statement-breakpoint
CREATE INDEX "announcement_ix_user_idx" ON "announcement_interactions" ("user_id");
--> statement-breakpoint
CREATE INDEX "announcement_ix_ann_idx" ON "announcement_interactions" ("announcement_id");
