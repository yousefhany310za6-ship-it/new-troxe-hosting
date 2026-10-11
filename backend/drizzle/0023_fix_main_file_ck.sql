--> statement-breakpoint
-- Migration 0021 wrote the control-character test as '[\\r\\n\\t]'. With
-- standard_conforming_strings on, that literal is the character class
-- { backslash, r, n, t } — so the constraint rejected perfectly ordinary
-- entry points ("main.py" contains an n, "index.js" contains an n) and every
-- write of a main file failed with CONSTRAINT_VIOLATED.
--
-- The check is rebuilt with POSIX [[:cntrl:]] (real control characters), plus
-- the same traversal/absolute-path rules as before.
ALTER TABLE "servers" DROP CONSTRAINT IF EXISTS "servers_main_file_path_ck";
--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_main_file_path_ck"
  CHECK ("main_file" IS NULL OR (
    length("main_file") BETWEEN 1 AND 160
    AND "main_file" !~ '^\.'
    AND "main_file" !~ '(^|/)\\.\\.(/|$)'
    AND "main_file" !~ '^/'
    AND "main_file" !~ '[[:cntrl:]]'
  ));
