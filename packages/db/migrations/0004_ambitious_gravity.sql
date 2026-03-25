ALTER TABLE "projects" ADD COLUMN "completeness_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "document_file_url" text;