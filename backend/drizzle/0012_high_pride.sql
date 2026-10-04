CREATE TYPE "public"."avatar_source" AS ENUM('oauth', 'custom', 'default');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_source" "avatar_source" DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_changed_at" timestamp;