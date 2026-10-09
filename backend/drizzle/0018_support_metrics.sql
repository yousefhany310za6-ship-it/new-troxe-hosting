--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_response_at" timestamp;
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reopen_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" varchar(80);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "notifications" ("user_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "support_tickets_assignee_created_idx" ON "support_tickets" ("assignee_id", "created_at");
--> statement-breakpoint
CREATE INDEX "support_tickets_resolved_idx" ON "support_tickets" ("resolved_at");
--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_author_idx" ON "ticket_messages" ("ticket_id", "author_role", "created_at");
