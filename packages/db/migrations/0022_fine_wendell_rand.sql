--> Nothing stopped two concurrent settlements from creating a second account
--> for the same owner, which split the escrow balance and failed every payout
--> for money that was in the ledger. Merge the duplicates onto the oldest row
--> and rebuild its balance from the entries BEFORE the unique indexes below,
--> or the deploy dies on existing data.
--> CONCURRENTLY is not an option: drizzle-orm runs every migration inside one
--> transaction (pg-core/dialect.js session.transaction), where it is illegal.
WITH survivors AS (
	SELECT DISTINCT ON (owner_type, owner_id) owner_type, owner_id, id AS keep_id
	FROM accounts
	ORDER BY owner_type, owner_id, created_at, id
)
UPDATE ledger_entries le
SET account_id = s.keep_id
FROM accounts a
JOIN survivors s ON a.owner_type = s.owner_type AND a.owner_id IS NOT DISTINCT FROM s.owner_id
WHERE le.account_id = a.id AND a.id <> s.keep_id;--> statement-breakpoint
DELETE FROM accounts a
USING (
	SELECT DISTINCT ON (owner_type, owner_id) owner_type, owner_id, id AS keep_id
	FROM accounts
	ORDER BY owner_type, owner_id, created_at, id
) s
WHERE a.owner_type = s.owner_type
	AND a.owner_id IS NOT DISTINCT FROM s.owner_id
	AND a.id <> s.keep_id;--> statement-breakpoint
UPDATE accounts a
SET balance = l.balance, updated_at = now()
FROM (
	SELECT account_id, SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END)::integer AS balance
	FROM ledger_entries
	GROUP BY account_id
) l
WHERE l.account_id = a.id AND a.balance <> l.balance;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accounts_owner" ON "accounts" USING btree ("owner_type","owner_id") WHERE owner_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accounts_owner_platform" ON "accounts" USING btree ("owner_type") WHERE owner_id IS NULL;