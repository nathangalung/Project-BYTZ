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
