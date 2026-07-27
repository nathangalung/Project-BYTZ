--> Escrow was one pool per project, so approving one talent's milestones drew
--> down the money quoted to another: the second talent's release then failed
--> for lack of funds on work already delivered under an executed contract.
--> Escrow is keyed by work package from here on, so the running balance has to
--> be re-keyed with it or every release on an existing project looks unfunded.
--> Run this BEFORE deploying the services that read the new keys.
-->
--> The ledger is append-only, so nothing here rewrites history: the money moves
--> from the project pool to the work package pools as a balanced transfer,
--> hung off the deposit transaction that funded it. gen_random_uuid stands in
--> for uuidv7, which SQL has no generator for; these ids are opaque.
--> Projects with no work packages are untouched and keep their project pool.
INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at)
SELECT gen_random_uuid()::text, 'escrow', wp.id, 'liability',
       'Escrow - Work Package ' || wp.id, 0, a.currency, a.created_at, now()
  FROM accounts a
  JOIN work_packages wp ON wp.project_id = a.owner_id
 WHERE a.owner_type = 'escrow'
ON CONFLICT (owner_type, owner_id) WHERE owner_id IS NOT NULL DO NOTHING;--> statement-breakpoint
--> Each package gets the share of the pool its unpaid work is worth, read off
--> the ledger: its quoted amount less what its own milestones have already
--> released. Never an even split - a Rp 40 juta backend package and a Rp 10
--> juta design package are not owed the same. Refund credits inherit the
--> milestone of the transaction they reverse, so they count as released too,
--> which understates that package slightly and is the accepted approximation.
--> A project whose packages are all fully paid falls back to package amounts.
WITH project_pool AS (
	SELECT a.id AS account_id, a.owner_id AS project_id, a.balance
	  FROM accounts a
	 WHERE a.owner_type = 'escrow'
	   AND a.balance > 0
	   AND EXISTS (SELECT 1 FROM work_packages wp WHERE wp.project_id = a.owner_id)
),
anchor AS (
	SELECT p.account_id,
	       COALESCE(
	         (SELECT t.id FROM transactions t
	           WHERE t.project_id = p.project_id AND t.type = 'escrow_in' AND t.status = 'completed'
	           ORDER BY t.created_at DESC LIMIT 1),
	         (SELECT le.transaction_id FROM ledger_entries le
	           WHERE le.account_id = p.account_id
	           ORDER BY le.created_at DESC LIMIT 1)
	       ) AS transaction_id
	  FROM project_pool p
),
released AS (
	SELECT m.work_package_id, SUM(le.amount) AS amount
	  FROM ledger_entries le
	  JOIN project_pool p ON p.account_id = le.account_id
	  JOIN transactions t ON t.id = le.transaction_id
	  JOIN milestones m ON m.id = t.milestone_id
	 WHERE le.entry_type = 'credit' AND m.work_package_id IS NOT NULL
	 GROUP BY m.work_package_id
),
weighted AS (
	SELECT p.account_id, p.balance, wpa.id AS wp_account_id, wp.amount AS wp_amount,
	       GREATEST(wp.amount - COALESCE(r.amount, 0), 0) AS unpaid
	  FROM project_pool p
	  JOIN work_packages wp ON wp.project_id = p.project_id
	  JOIN accounts wpa ON wpa.owner_type = 'escrow' AND wpa.owner_id = wp.id
	  LEFT JOIN released r ON r.work_package_id = wp.id
),
weights AS (
	SELECT account_id, balance, wp_account_id,
	       CASE WHEN SUM(unpaid) OVER (PARTITION BY account_id) > 0 THEN unpaid ELSE wp_amount END AS weight
	  FROM weighted
),
shares AS (
	SELECT account_id, balance, wp_account_id, weight,
	       SUM(weight) OVER (PARTITION BY account_id) AS total_weight,
	       ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY weight DESC, wp_account_id) AS pos
	  FROM weights
),
allocated AS (
	SELECT account_id, balance, wp_account_id, pos,
	       (balance::bigint * weight::bigint) / total_weight AS base
	  FROM shares
	 WHERE total_weight > 0
),
transfer AS (
	SELECT account_id, wp_account_id,
	       (base + CASE WHEN pos = 1
	                    THEN balance - SUM(base) OVER (PARTITION BY account_id)
	                    ELSE 0 END)::integer AS amount
	  FROM allocated
)
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, description, metadata, created_at)
SELECT gen_random_uuid()::text, anchor.transaction_id, leg.account_id,
       leg.entry_type::ledger_entry_type, transfer.amount,
       'Escrow re-keyed to work package',
       jsonb_build_object(
         'migration', '0023_escrow_per_work_package',
         'fromAccountId', transfer.account_id,
         'toAccountId', transfer.wp_account_id
       ),
       now()
  FROM transfer
  JOIN anchor ON anchor.account_id = transfer.account_id
 CROSS JOIN LATERAL (VALUES ('credit', transfer.account_id), ('debit', transfer.wp_account_id)) AS leg(entry_type, account_id)
 WHERE transfer.amount > 0 AND anchor.transaction_id IS NOT NULL;--> statement-breakpoint
--> accounts.balance is application-maintained, so bring the accounts this
--> migration wrote entries for back in step with the ledger. Scoped to exactly
--> those: a blanket recompute would erase any pre-existing drift, which the
--> admin reconciliation endpoint exists to report rather than hide.
UPDATE accounts a
SET balance = l.balance, updated_at = now()
FROM (
	SELECT le.account_id,
	       SUM(CASE WHEN le.entry_type = 'debit' THEN le.amount ELSE -le.amount END)::integer AS balance
	  FROM ledger_entries le
	 WHERE le.account_id IN (
	         SELECT account_id FROM ledger_entries
	          WHERE metadata->>'migration' = '0023_escrow_per_work_package'
	       )
	 GROUP BY le.account_id
) l
WHERE l.account_id = a.id AND a.balance <> l.balance;
