ALTER TABLE "revision_requests" ADD CONSTRAINT "revision_requests_fee_transaction_id_transactions_id_fk" FOREIGN KEY ("fee_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outbox_unpublished" ON "outbox_events" USING btree ("created_at") WHERE published = false;--> statement-breakpoint
CREATE INDEX "idx_ledger_account_created" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ledger_transaction" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_project" ON "transactions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_milestone" ON "transactions" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_talent" ON "transactions" USING btree ("talent_id");