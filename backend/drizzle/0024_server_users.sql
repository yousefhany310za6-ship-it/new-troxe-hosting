--> statement-breakpoint
-- Subusers: users (other than the owner) granted scoped access to a server.
-- Permissions are stored as an array of permission keys (see
-- server-access-policy.ts); only whitelisted keys are ever written.
CREATE TABLE "server_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "server_users_pair_unique" UNIQUE("server_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX "server_users_user_idx" ON "server_users" ("user_id");
--> statement-breakpoint
CREATE INDEX "server_users_server_idx" ON "server_users" ("server_id");
