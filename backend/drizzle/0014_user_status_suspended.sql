ALTER TYPE "public"."server_status" ADD VALUE 'suspended';
--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "public"."user_status" DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;
