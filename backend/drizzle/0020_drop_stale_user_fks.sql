--> statement-breakpoint
-- Migration 0017 was hand-written SQL, so Postgres auto-named its constraints
-- "<table>_<column>_fkey" instead of drizzle's "..._users_id_fk". Those older
-- NO ACTION constraints are still enforced next to the ones 0019 added, so a
-- hard user delete kept failing. Drop the stale ones here.
--
-- Idempotent: each block checks the catalog first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_actor_id_fkey') THEN
    ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_fkey";
  END IF;
  -- keep exactly one well-named, SET NULL constraint on the actor
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_actor_id_users_id_fk') THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_assignment_log_actor_id_fkey') THEN
    ALTER TABLE "ticket_assignment_log" DROP CONSTRAINT "ticket_assignment_log_actor_id_fkey";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_assignment_log_from_assignee_fkey') THEN
    ALTER TABLE "ticket_assignment_log" DROP CONSTRAINT "ticket_assignment_log_from_assignee_fkey";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_assignment_log_to_assignee_fkey') THEN
    ALTER TABLE "ticket_assignment_log" DROP CONSTRAINT "ticket_assignment_log_to_assignee_fkey";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_escalations_requested_by_fkey') THEN
    ALTER TABLE "ticket_escalations" DROP CONSTRAINT "ticket_escalations_requested_by_fkey";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_escalations_responder_id_fkey') THEN
    ALTER TABLE "ticket_escalations" DROP CONSTRAINT "ticket_escalations_responder_id_fkey";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_messages_author_id_fkey') THEN
    ALTER TABLE "ticket_messages" DROP CONSTRAINT "ticket_messages_author_id_fkey";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_messages_read_by_fkey') THEN
    ALTER TABLE "ticket_messages" DROP CONSTRAINT "ticket_messages_read_by_fkey";
  END IF;
END $$;
