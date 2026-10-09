--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'support';
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "contact_code" varchar(8);
--> statement-breakpoint
DO $$
DECLARE
  r RECORD;
  c varchar(8);
  done boolean;
  tries integer;
BEGIN
  FOR r IN SELECT id FROM servers WHERE contact_code IS NULL LOOP
    tries := 0;
    LOOP
      c := lpad((floor(random() * 100000000))::int::text, 8, '0');
      SELECT NOT EXISTS (SELECT 1 FROM servers WHERE contact_code = c) INTO done;
      IF done THEN
        UPDATE servers SET contact_code = c WHERE id = r.id;
        EXIT;
      END IF;
      tries := tries + 1;
      IF tries > 50 THEN RAISE EXCEPTION 'contact_code backfill collision overflow'; END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "servers" ALTER COLUMN "contact_code" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_contact_code_unique" UNIQUE("contact_code");
--> statement-breakpoint
CREATE INDEX "servers_contact_code_idx" ON "servers" ("contact_code");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp;
--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'in_progress', 'waiting_user', 'waiting_admin', 'resolved', 'closed');
--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('server_issue', 'server_crash', 'performance', 'billing', 'account', 'technical', 'other');
--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'urgent');
--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('pending', 'acknowledged', 'resolved');
--> statement-breakpoint
CREATE SEQUENCE "support_tickets_no_seq";
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_no" integer DEFAULT nextval('support_tickets_no_seq') NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"subject" varchar(140) NOT NULL,
	"category" "public"."ticket_category" DEFAULT 'technical' NOT NULL,
	"status" "public"."ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "public"."ticket_priority" DEFAULT 'medium' NOT NULL,
	"description" text NOT NULL,
	"server_id" uuid REFERENCES "servers"("id") ON DELETE SET NULL,
	"assignee_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_no_unique" UNIQUE("ticket_no")
);
--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "support_tickets" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" ("status");
--> statement-breakpoint
CREATE INDEX "support_tickets_assignee_idx" ON "support_tickets" ("assignee_id");
--> statement-breakpoint
CREATE INDEX "support_tickets_server_idx" ON "support_tickets" ("server_id");
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
	"author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"author_role" varchar(16) DEFAULT 'user' NOT NULL,
	"body" text NOT NULL,
	"client_msg_id" varchar(64),
	"delivered_at" timestamp,
	"read_at" timestamp,
	"read_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_msg_idem_unique" UNIQUE("ticket_id", "client_msg_id")
);
--> statement-breakpoint
CREATE INDEX "ticket_msg_ticket_idx" ON "ticket_messages" ("ticket_id", "created_at");
--> statement-breakpoint
CREATE TABLE "ticket_assignment_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
	"actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"action" varchar(32) NOT NULL,
	"from_assignee" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"to_assignee" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"from_status" varchar(24),
	"to_status" varchar(24),
	"reason" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ticket_log_ticket_idx" ON "ticket_assignment_log" ("ticket_id", "created_at");
--> statement-breakpoint
CREATE TABLE "ticket_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
	"requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"reason" varchar(500) NOT NULL,
	"status" "public"."escalation_status" DEFAULT 'pending' NOT NULL,
	"responder_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ticket_esc_ticket_idx" ON "ticket_escalations" ("ticket_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_esc_pending_unique" ON "ticket_escalations" ("ticket_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE TABLE "ticket_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"support_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"stars" integer NOT NULL,
	"resolved" varchar(8) NOT NULL,
	"comment" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_rating_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
CREATE INDEX "ticket_rating_support_idx" ON "ticket_ratings" ("support_id");
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"type" varchar(48) NOT NULL,
	"title" varchar(140) NOT NULL,
	"body" varchar(500) NOT NULL,
	"link" varchar(255),
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "created_at");
