-- Mark that a generation is holding this document's version.
--
-- A revision claims the next version before calling the model, so a process
-- killed mid-generation left the row sitting at that version with the old
-- content. Nothing could tell that apart from a generation that finished, so
-- the owner's slot was spent for good; the version-0 reservation path already
-- had a reclaim, this one did not. The timestamp is what makes an abandoned
-- claim recognisable.
--
-- Additive and nullable, no backfill. Every existing row stays NULL, and the
-- reclaim requires the column to be set, so no document that finished before
-- this migration can have its version taken back.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE "brd_documents"
  ADD COLUMN IF NOT EXISTS "generation_claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "prd_documents"
  ADD COLUMN IF NOT EXISTS "generation_claimed_at" timestamp with time zone;
