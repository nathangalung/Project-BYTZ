-- Additive columns with a constant default: metadata-only in PG11+, no rewrite.
-- Bound the brief ACCESS EXCLUSIVE lock so a busy window fails fast, not queues.
SET lock_timeout = '5s';--> statement-breakpoint
SET statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "meterai_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "meterai_document_url" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "meterai_affixed_at" timestamp with time zone;