-- Admin search is ILIKE '%term%'. A leading wildcard rules out btree entirely,
-- so every keystroke ran a sequential scan - twice, because the grids also run
-- the same predicate for their COUNT(*).
--
-- gin_trgm_ops is the index type that can serve a leading wildcard.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- store/users.go: name ILIKE $1 OR email ILIKE $1
CREATE INDEX IF NOT EXISTS "idx_user_name_trgm"
  ON "user" USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_email_trgm"
  ON "user" USING gin (email gin_trgm_ops);
--> statement-breakpoint

-- store/projects.go and store/finance.go both search on the project title.
CREATE INDEX IF NOT EXISTS "idx_projects_title_trgm"
  ON "projects" USING gin (title gin_trgm_ops);
