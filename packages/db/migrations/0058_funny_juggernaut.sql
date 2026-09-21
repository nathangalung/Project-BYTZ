-- document_status: four values -> three. 'paid' was never a position.
--
-- A document sits at draft, review or approved. 'paid' meant an approved
-- document the owner had also bought - so it restated approval, which the
-- column already held, and stood in for a purchase, which the column could not
-- hold: a revision writes the status back to 'review' and the purchase does not
-- come undone. The purchase is `paid_at` plus the completed brd_payment /
-- prd_payment row in the ledger, and every gate that matters - the buyer-view
-- projection, the watermark, the download, the revision cap - already reads
-- those two and not this column.
--
--   draft    -> draft
--   review   -> review
--   approved -> approved
--   paid     -> approved
--
-- The paid_at backstop below runs first and is what keeps the collapse
-- lossless. It is a no-op on rows written by the payment settlement path,
-- which stamps paid_at before anything reads a status; it exists for a row
-- that carried the purchase in the status alone, where dropping the literal
-- with nothing else set would turn a bought document back into an unbought
-- one. `updated_at` is the closest instant on the row to when it was bought,
-- and any instant at all is the difference between paid and unpaid.
--
-- Hand-written. drizzle-kit renders a value-drop as a round trip through
-- `text` with a bare cast back, which fails on the first row holding 'paid'.
--
-- The CASE has no ELSE on purpose: both columns are NOT NULL, so a value this
-- mapping does not name fails the migration instead of landing quietly in
-- 'draft'.
--
-- Neither table has an index whose predicate names a status literal - both
-- carry only the pkey, the project_id unique, the HNSW embedding index and the
-- content FTS index - so nothing is dropped and recreated here. The defaults
-- are of the old type and block the swap, so they come off first and go back
-- on after the rename; 'draft' is unaffected by the mapping.

UPDATE "brd_documents" SET "paid_at" = COALESCE("paid_at", "updated_at") WHERE "status"::text = 'paid';--> statement-breakpoint
UPDATE "prd_documents" SET "paid_at" = COALESCE("paid_at", "updated_at") WHERE "status"::text = 'paid';--> statement-breakpoint

ALTER TABLE "brd_documents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "prd_documents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint

CREATE TYPE "public"."document_status_new" AS ENUM('draft', 'review', 'approved');--> statement-breakpoint

ALTER TABLE "brd_documents" ALTER COLUMN "status" SET DATA TYPE "public"."document_status_new" USING (CASE
  WHEN "status"::text = 'draft' THEN 'draft'
  WHEN "status"::text = 'review' THEN 'review'
  WHEN "status"::text IN ('approved', 'paid') THEN 'approved'
END)::"public"."document_status_new";--> statement-breakpoint

ALTER TABLE "prd_documents" ALTER COLUMN "status" SET DATA TYPE "public"."document_status_new" USING (CASE
  WHEN "status"::text = 'draft' THEN 'draft'
  WHEN "status"::text = 'review' THEN 'review'
  WHEN "status"::text IN ('approved', 'paid') THEN 'approved'
END)::"public"."document_status_new";--> statement-breakpoint

DROP TYPE "public"."document_status";--> statement-breakpoint
ALTER TYPE "public"."document_status_new" RENAME TO "document_status";--> statement-breakpoint

ALTER TABLE "brd_documents" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."document_status";--> statement-breakpoint
ALTER TABLE "prd_documents" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."document_status";
