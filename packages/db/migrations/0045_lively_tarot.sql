-- What the reader renders, alongside the English the row already carries.
--
-- Both nullable: every existing row has neither, and readers fall back to
-- title/message when template_key is null, so nothing needs backfilling.
--
-- Timeouts per the convention started in 0024. ADD COLUMN with no default takes
-- ACCESS EXCLUSIVE only long enough to write the catalog entry, but it still has
-- to reach the front of the lock queue, and the unread badge polls this table on
-- every page load. Failing fast is better than queueing writes behind it.
SET lock_timeout = '3s';--> statement-breakpoint
SET statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "template_params" jsonb;
