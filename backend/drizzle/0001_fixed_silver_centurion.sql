ALTER TABLE "auth_sessions" ADD COLUMN "prev_refresh_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "prev_rotated_at" timestamp;