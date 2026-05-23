-- Wave 4.3: Add Gemini text-embedding-004 (768 dim) embedding columns for RAG
-- Requires pgvector extension (already enabled in initial migration)
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

-- Add embedding columns. If columns somehow exist with vector(1536), drop+readd as 768.
ALTER TABLE "brd_documents" DROP COLUMN IF EXISTS "embedding";--> statement-breakpoint
ALTER TABLE "brd_documents" ADD COLUMN "embedding" vector(768);--> statement-breakpoint

ALTER TABLE "prd_documents" DROP COLUMN IF EXISTS "embedding";--> statement-breakpoint
ALTER TABLE "prd_documents" ADD COLUMN "embedding" vector(768);--> statement-breakpoint

ALTER TABLE "skills" DROP COLUMN IF EXISTS "embedding";--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "embedding" vector(768);--> statement-breakpoint

-- HNSW indexes for fast approximate nearest neighbor search (cosine distance)
DROP INDEX IF EXISTS "brd_embedding_hnsw_idx";--> statement-breakpoint
CREATE INDEX "brd_embedding_hnsw_idx" ON "brd_documents" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 200);--> statement-breakpoint

DROP INDEX IF EXISTS "prd_embedding_hnsw_idx";--> statement-breakpoint
CREATE INDEX "prd_embedding_hnsw_idx" ON "prd_documents" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 200);--> statement-breakpoint

DROP INDEX IF EXISTS "skills_embedding_hnsw_idx";--> statement-breakpoint
CREATE INDEX "skills_embedding_hnsw_idx" ON "skills" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 200);
