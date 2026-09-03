-- Section-aware chunks for BRD and PRD retrieval.
--
-- The embedding column on each document table holds one vector for the whole
-- document, which averages an executive summary, a price estimate and every
-- functional requirement into a single 1024-float point. A query about one
-- feature competes with the entire document and the section that answers it
-- never stands out, because it was never represented on its own.
--
-- Those columns stay for now. They are entirely NULL and nothing reads them
-- after this change, but dropping a column an already-deployed container still
-- names in its SQL is the two-deploy dance this repo documents rather than a
-- free tidy-up. A later migration removes them once no running version refers.
--
-- CREATE INDEX takes a SHARE lock for the whole build and drizzle wraps every
-- migration file in a transaction, so CONCURRENTLY is unavailable. The
-- timeouts bound the lock rather than removing it.
SET lock_timeout = '3s';--> statement-breakpoint
SET statement_timeout = '120s';--> statement-breakpoint
CREATE TYPE "public"."document_chunk_type" AS ENUM('brd', 'prd');--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"document_type" "document_chunk_type" NOT NULL,
	"project_id" text NOT NULL,
	"section_title" text NOT NULL,
	"section_order" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_doc_order_unique" ON "document_chunks" USING btree ("document_id","section_order");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_document" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_project" ON "document_chunks" USING btree ("project_id");--> statement-breakpoint
-- Vector arm of hybrid_search. Same m and ef_construction as the document
-- indexes it replaces, and cosine because the query uses <=>.
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 200);--> statement-breakpoint
-- BM25 arm. The expression has to match rag.py exactly or the planner ignores
-- the index and sequentially scans every chunk on every scoping message.
CREATE INDEX "idx_document_chunks_content_fts" ON "document_chunks" USING gin (to_tsvector('english', "content"));
