-- DDL here takes a lock for the whole operation, and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available. These timeouts do not remove the lock; they bound it, so a
-- migration that would queue behind or ahead of live writes fails fast and can
-- be retried in a window instead of holding the table.
SET lock_timeout = '3s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
-- Money and range invariants, at the layer that cannot be bypassed.
--
-- Twenty-eight migrations carried no CHECK at all. Every one of these was
-- enforced only by Zod on the HTTP path, so anything that did not arrive over
-- HTTP skipped them: migration 0023 writes ledger rows in raw SQL, the seed
-- writes directly, and time_logs.duration_minutes was taken from the client
-- verbatim by time-log.service.ts with no bound anywhere.
--
-- Added NOT VALID so the migration takes no full-table lock and cannot fail a
-- deploy on pre-existing rows. New and updated rows are checked immediately,
-- which is what stops the drift. Validating the history is a separate step:
--   ALTER TABLE <t> VALIDATE CONSTRAINT <c>;
-- Run those only after the corresponding SELECT finds nothing.

ALTER TABLE "work_packages"
  ADD CONSTRAINT "work_packages_amount_positive" CHECK (amount > 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_packages"
  ADD CONSTRAINT "work_packages_hours_positive" CHECK (estimated_hours > 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "work_packages"
  ADD CONSTRAINT "work_packages_payout_within_amount"
  CHECK (talent_payout >= 0 AND talent_payout <= amount) NOT VALID;
--> statement-breakpoint

-- Zero is allowed: a milestone can carry no payment of its own.
ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_amount_non_negative" CHECK (amount >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_revision_count_non_negative"
  CHECK (revision_count >= 0) NOT VALID;
--> statement-breakpoint

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_budget_range"
  CHECK (
    (budget_min IS NULL OR budget_min >= 0)
    AND (budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min)
  ) NOT VALID;
--> statement-breakpoint

-- final_price = talent_payout + platform_fee is the fee primitive. All three
-- are nullable until pricing runs, so the check only bites once they are set.
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_price_split"
  CHECK (
    final_price IS NULL OR talent_payout IS NULL OR platform_fee IS NULL
    OR final_price = talent_payout + platform_fee
  ) NOT VALID;
--> statement-breakpoint

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive" CHECK (amount > 0) NOT VALID;
--> statement-breakpoint

-- ledger.go validates this in Go before inserting; 0023 wrote rows around it.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive" CHECK (amount > 0) NOT VALID;
--> statement-breakpoint

-- Feeds the 0.15 rating term of the recommendation score.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK (rating >= 1 AND rating <= 5) NOT VALID;
--> statement-breakpoint

ALTER TABLE "time_logs"
  ADD CONSTRAINT "time_logs_interval_ordered"
  CHECK (ended_at IS NULL OR ended_at > started_at) NOT VALID;
--> statement-breakpoint
ALTER TABLE "time_logs"
  ADD CONSTRAINT "time_logs_duration_non_negative"
  CHECK (duration_minutes IS NULL OR duration_minutes >= 0) NOT VALID;
