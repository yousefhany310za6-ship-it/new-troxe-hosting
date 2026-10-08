-- 2FA (TOTP) secrets, recovery codes, and temporary login challenges.
--> statement-breakpoint
CREATE TABLE "two_factor_secrets" (
	"user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
	"secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_used_counter" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes"("user_id");
--> statement-breakpoint
CREATE TABLE "mfa_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"ip" varchar(45),
	"user_agent" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mfa_challenges_user_idx" ON "mfa_challenges"("user_id");
--> statement-breakpoint
CREATE INDEX "mfa_challenges_expires_idx" ON "mfa_challenges"("expires_at");
