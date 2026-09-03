-- Embeddings move from gemini-embedding-001 at 768 to voyage-4 at 1024.
--
-- Free right now and never again: all three columns are entirely NULL because
-- the embedding path has never run against a configured key, so this rewrites
-- no rows and re-embeds nothing. The same change after the backfill is a full
-- re-embed of every BRD, PRD and skill, paid per token.
--
-- CREATE INDEX takes a SHARE lock for the whole build and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available. These timeouts do not remove the lock; they bound it, so a
-- migration that would queue behind live writes fails fast and can be retried.
SET lock_timeout = '3s';--> statement-breakpoint
SET statement_timeout = '60s';--> statement-breakpoint

-- Dropped before the type change rather than left to be rebuilt implicitly:
-- an HNSW index carries the dimension in its own opclass state, and dropping
-- it makes the rebuild an explicit line in this file instead of a side effect.
DROP INDEX IF EXISTS "brd_embedding_hnsw_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "prd_embedding_hnsw_idx";--> statement-breakpoint
-- 0028 already dropped this one; IF EXISTS covers a database behind on it.
DROP INDEX IF EXISTS "skills_embedding_hnsw_idx";--> statement-breakpoint

ALTER TABLE "skills" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "brd_documents" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "prd_documents" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint

-- Same m and ef_construction as before. Only the dimension changed, and
-- hybrid_search still compares with <=>, so the opclass stays cosine.
CREATE INDEX "brd_embedding_hnsw_idx" ON "brd_documents" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 200);--> statement-breakpoint
CREATE INDEX "prd_embedding_hnsw_idx" ON "prd_documents" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 200);
