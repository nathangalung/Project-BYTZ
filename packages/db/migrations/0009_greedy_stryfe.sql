CREATE TABLE IF NOT EXISTS "project_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"pdf_url" text NOT NULL,
	"is_admin_copy" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
ALTER TABLE "brd_documents" ADD COLUMN IF NOT EXISTS "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "prd_documents" ADD COLUMN IF NOT EXISTS "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;