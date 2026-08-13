-- DDL here takes a lock for the whole operation, and drizzle wraps every
-- migration file in a transaction (pg-core/dialect.cjs), so CONCURRENTLY is not
-- available. These timeouts do not remove the lock; they bound it, so a
-- migration that would queue behind or ahead of live writes fails fast and can
-- be retried in a window instead of holding the table.
SET lock_timeout = '3s';
--> statement-breakpoint
SET statement_timeout = '60s';
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_scoping_unique" ON "chat_conversations" USING btree ("project_id") WHERE type = 'ai_scoping';--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_assignment_type_unique" ON "contracts" USING btree ("assignment_id","type");