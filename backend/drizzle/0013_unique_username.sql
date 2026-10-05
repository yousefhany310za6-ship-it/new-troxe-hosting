-- Usernames become unique (case-insensitive). Existing duplicates are
-- deterministically disambiguated with a short suffix before the index is
-- created, so the migration is safe on populated databases.
WITH ranked AS (
  SELECT id,
         name,
         row_number() OVER (PARTITION BY lower(name) ORDER BY created_at, id) AS rn
  FROM users
)
UPDATE users u
SET name = left(u.name, 24) || '-' || substr(u.id::text, 1, 4)
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;--> statement-breakpoint

CREATE UNIQUE INDEX "users_name_lower_unique" ON "users" (lower(name));--> statement-breakpoint
