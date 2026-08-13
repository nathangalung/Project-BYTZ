-- CREATE INDEX takes a SHARE lock for the whole build, and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available here. These timeouts do not remove the lock; they bound it, so a
-- migration that would queue behind or ahead of live writes fails fast and can
-- be retried in a window instead of holding the table.
SET lock_timeout = '3s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
-- The BM25 arm of hybrid_search builds a tsvector from every row's JSONB on
-- every scoping message, then sorts the matches. The expression has to match
-- the one in services/rag.py byte for byte or the index is skipped.
CREATE INDEX IF NOT EXISTS "idx_brd_documents_content_fts"
  ON "brd_documents" USING gin (to_tsvector('english', content::text));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prd_documents_content_fts"
  ON "prd_documents" USING gin (to_tsvector('english', content::text));
--> statement-breakpoint
-- Nothing queries skills by vector distance. hybrid_search is only ever called
-- with brd_documents, and skill matching loads the embeddings into JS and
-- computes cosine there. This index was maintained on every skill write and
-- never read.
DROP INDEX IF EXISTS "skills_embedding_hnsw_idx";
