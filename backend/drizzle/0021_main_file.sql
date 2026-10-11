--> statement-breakpoint
-- Main File becomes a first-class server setting. It used to live only as the
-- MAIN_FILE egg variable inside the startup template (`node {{MAIN_FILE}}`),
-- so the column is backfilled from the decrypted env of every existing server
-- and the variable is kept in sync afterwards (the template keeps working).
ALTER TABLE "servers" ADD COLUMN "main_file" varchar(160);
--> statement-breakpoint
-- Relative paths only, no traversal, no leading slash. Enforced in the database
-- as well as in the DTO so a bad write cannot come from anywhere else.
ALTER TABLE "servers" ADD CONSTRAINT "servers_main_file_path_ck"
  CHECK ("main_file" IS NULL OR (
    length("main_file") BETWEEN 1 AND 160
    AND "main_file" !~ '^\\.'
    AND "main_file" !~ '(^|/)\\.\\.(/|$)'
    AND "main_file" !~ '^/'
    AND "main_file" !~ '[\\r\\n\\t]'
  ));
