--> statement-breakpoint
-- Ticket content is only meaningful together with its ticket and its actor: once
-- either is gone the rows go with it. NO ACTION here made any hard delete fail,
-- because the ticket cascade and the actor FK fought over the same row.
--
-- Every statement is idempotent (guarded by a catalog check), so re-running the
-- migration is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_messages_author_id_users_id_fk') THEN
    ALTER TABLE "ticket_messages" DROP CONSTRAINT "ticket_messages_author_id_users_id_fk";
  END IF;
  ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_users_id_fk"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_messages_read_by_users_id_fk') THEN
    ALTER TABLE "ticket_messages" DROP CONSTRAINT "ticket_messages_read_by_users_id_fk";
  END IF;
  ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_read_by_users_id_fk"
    FOREIGN KEY ("read_by") REFERENCES "users"("id") ON DELETE SET NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_assignment_log_actor_id_users_id_fk') THEN
    ALTER TABLE "ticket_assignment_log" DROP CONSTRAINT "ticket_assignment_log_actor_id_users_id_fk";
  END IF;
  ALTER TABLE "ticket_assignment_log" ADD CONSTRAINT "ticket_assignment_log_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_assignment_log_from_assignee_users_id_fk') THEN
    ALTER TABLE "ticket_assignment_log" DROP CONSTRAINT "ticket_assignment_log_from_assignee_users_id_fk";
  END IF;
  ALTER TABLE "ticket_assignment_log" ADD CONSTRAINT "ticket_assignment_log_from_assignee_users_id_fk"
    FOREIGN KEY ("from_assignee") REFERENCES "users"("id") ON DELETE CASCADE;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_assignment_log_to_assignee_users_id_fk') THEN
    ALTER TABLE "ticket_assignment_log" DROP CONSTRAINT "ticket_assignment_log_to_assignee_users_id_fk";
  END IF;
  ALTER TABLE "ticket_assignment_log" ADD CONSTRAINT "ticket_assignment_log_to_assignee_users_id_fk"
    FOREIGN KEY ("to_assignee") REFERENCES "users"("id") ON DELETE CASCADE;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_escalations_requested_by_users_id_fk') THEN
    ALTER TABLE "ticket_escalations" DROP CONSTRAINT "ticket_escalations_requested_by_users_id_fk";
  END IF;
  ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_escalations_responder_id_users_id_fk') THEN
    ALTER TABLE "ticket_escalations" DROP CONSTRAINT "ticket_escalations_responder_id_users_id_fk";
  END IF;
  ALTER TABLE "ticket_escalations" ADD CONSTRAINT "ticket_escalations_responder_id_users_id_fk"
    FOREIGN KEY ("responder_id") REFERENCES "users"("id") ON DELETE SET NULL;
END $$;
--> statement-breakpoint
-- The audit trail outlives the account: keep the entry, drop the identity link
-- (the actor's email is already stored on the row).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_actor_id_users_id_fk') THEN
    ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_users_id_fk";
  END IF;
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;
END $$;
