--> Existing rows point at PDFs rendered before the audience split, which put
--> the talent payout on the owner's copy. Backfilling would keep serving those
--> bytes, so drop the register instead: every copy regenerates on first access,
--> and no invoice PDF ever rendered successfully in production anyway.
DELETE FROM "project_invoices";--> statement-breakpoint
CREATE TYPE "public"."invoice_audience" AS ENUM('owner', 'talent', 'admin');--> statement-breakpoint
ALTER TABLE "project_invoices" DROP CONSTRAINT "project_invoices_invoice_number_unique";--> statement-breakpoint
ALTER TABLE "project_invoices" ADD COLUMN "audience" "invoice_audience" NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_invoices_milestone_audience" ON "project_invoices" USING btree ("milestone_id","audience");--> statement-breakpoint
CREATE INDEX "idx_project_invoices_project" ON "project_invoices" USING btree ("project_id");