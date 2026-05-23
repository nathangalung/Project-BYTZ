-- Wave 4.4: Add project_invoices table for generated invoice PDFs
CREATE TABLE IF NOT EXISTS "project_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"pdf_url" text NOT NULL,
	"is_admin_copy" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_invoices_invoice_number_unique" UNIQUE("invoice_number")
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_project_invoices_project" ON "project_invoices" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_invoices_milestone" ON "project_invoices" ("milestone_id");
