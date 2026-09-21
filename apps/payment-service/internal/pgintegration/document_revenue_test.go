package pgintegration

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kerjacus/payment-service/internal/handler"
	"github.com/kerjacus/payment-service/internal/store"
	"github.com/kerjacus/payment-service/internal/testsupport"
)

const webhookServerKey = "integration-server-key"

// seedPendingCheckout inserts the row a Snap checkout leaves behind: priced,
// pending, keyed by the order id the gateway will quote back.
func seedPendingCheckout(t *testing.T, pool *pgxpool.Pool, f *testsupport.Fixture, txType, orderID string, amount int64) string {
	t.Helper()
	id := f.ID("transaction")
	if _, err := pool.Exec(testsupport.Ctx(t), `
		INSERT INTO transactions (id, project_id, type, amount, status, idempotency_key)
		VALUES ($1, $2, $3::transaction_type, $4, 'pending', $5)
	`, id, f.ProjectID, txType, amount, orderID); err != nil {
		t.Fatalf("seed pending checkout: %v", err)
	}
	return id
}

// postMidtransNotification drives one correctly signed notification through the
// real webhook handler against the real database.
func postMidtransNotification(t *testing.T, pool *pgxpool.Pool, orderID string, amount int64, transactionStatus, fraudStatus string) int {
	t.Helper()

	wh := handler.NewWebhookHandler(
		store.NewTransactionStore(pool), store.NewLedgerStore(pool),
		webhookServerKey, "", "secret")
	app := fiber.New()
	wh.Register(app)
	t.Cleanup(wh.WaitForCallbacks)

	const statusCode = "200"
	gross := fmt.Sprint(amount)
	hash := sha512.Sum512([]byte(orderID + statusCode + gross + webhookServerKey))
	sig := hex.EncodeToString(hash[:])

	body := fmt.Sprintf(
		`{"order_id":"%s","status_code":"%s","gross_amount":"%s","signature_key":"%s","transaction_status":"%s","fraud_status":"%s"}`,
		orderID, statusCode, gross, sig, transactionStatus, fraudStatus)
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/midtrans", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req, 10_000)
	if err != nil {
		t.Fatalf("webhook request failed: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

// platformBalance reads the singleton platform revenue account, or zero when no
// document payment has opened it yet.
func platformBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool) int64 {
	t.Helper()
	var balance int64
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE owner_type = 'platform' AND owner_id IS NULL`,
	).Scan(&balance)
	if err != nil {
		t.Fatalf("read platform balance: %v", err)
	}
	return balance
}

/*
TestDocumentPaymentBooksBalancedLedgerLegs settles a real brd, prd and revision
payment through the webhook against the real schema.

These three settled with no ledger record at all. The transaction flipped to
completed, project-service unlocked the document, and ledger_entries - the
append-only record the admin reconciliation checks every account balance against
- said nothing had happened. The only place that revenue appeared was the
transactions table, which is why the admin finance summary had to count it from
there and ended up counting a seeded database's document revenue twice: once off
transactions and once off the platform legs the seed writes.

The assertion is the one CreateLedgerEntriesTx enforces and nothing was calling
for these types: one debit, one credit, equal, for the amount that was paid.
*/
func TestDocumentPaymentBooksBalancedLedgerLegs(t *testing.T) {
	pool := testsupport.Pool(t)

	tests := []struct {
		name     string
		txType   string
		orderTag string
		amount   int64
	}{
		{"brd payment", store.TxTypeBRDPayment, "BRD", 250_000},
		{"prd payment", store.TxTypePRDPayment, "PRD", 500_000},
		{"revision fee", store.TxTypeRevisionFee, "REV", 175_000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := testsupport.Ctx(t)
			f := testsupport.NewFixture(t, pool)
			ledger := store.NewLedgerStore(pool)

			orderID := tt.orderTag + "-" + f.ID("order")
			txnID := seedPendingCheckout(t, pool, f, tt.txType, orderID, tt.amount)

			platformBefore := platformBalance(t, ctx, pool)

			if got := postMidtransNotification(t, pool, orderID, tt.amount, "settlement", ""); got != fiber.StatusOK {
				t.Fatalf("webhook status = %d, want %d", got, fiber.StatusOK)
			}

			var status string
			if err := pool.QueryRow(ctx, `SELECT status FROM transactions WHERE id = $1`, txnID).Scan(&status); err != nil {
				t.Fatalf("read settled status: %v", err)
			}
			if status != store.TxStatusCompleted {
				t.Fatalf("transaction status = %q, want %q", status, store.TxStatusCompleted)
			}

			entries, err := ledger.GetEntriesByTransaction(ctx, txnID)
			if err != nil {
				t.Fatalf("read ledger entries: %v", err)
			}
			if len(entries) != 2 {
				t.Fatalf("a settled %s booked %d ledger entries, want 2", tt.txType, len(entries))
			}

			var debits, credits int64
			var platformLeg, ownerLeg *store.LedgerEntry
			for i := range entries {
				e := &entries[i]
				if e.EntryType == store.EntryDebit {
					debits += e.Amount
				} else {
					credits += e.Amount
				}

				var ownerType string
				var ownerID *string
				if err := pool.QueryRow(ctx,
					`SELECT owner_type, owner_id FROM accounts WHERE id = $1`, e.AccountID,
				).Scan(&ownerType, &ownerID); err != nil {
					t.Fatalf("read account %s: %v", e.AccountID, err)
				}
				switch ownerType {
				case store.OwnerPlatform:
					if ownerID != nil {
						t.Errorf("platform leg landed on a per-owner account %q", *ownerID)
					}
					platformLeg = e
				case store.OwnerOwner:
					if ownerID == nil || *ownerID != f.UserID {
						t.Errorf("owner leg landed on %v, want the payer %s", ownerID, f.UserID)
					}
					ownerLeg = e
				default:
					t.Errorf("a document payment touched a %q account", ownerType)
				}
			}

			if debits != credits {
				t.Errorf("document payment does not balance: debit=%d, credit=%d", debits, credits)
			}
			if platformLeg == nil || platformLeg.EntryType != store.EntryDebit || platformLeg.Amount != tt.amount {
				t.Errorf("platform leg = %+v, want a debit of %d", platformLeg, tt.amount)
			}
			if ownerLeg == nil || ownerLeg.EntryType != store.EntryCredit || ownerLeg.Amount != tt.amount {
				t.Errorf("owner leg = %+v, want a credit of %d", ownerLeg, tt.amount)
			}

			// The balances move with the legs, which is what the admin
			// reconciliation compares the ledger against.
			if got := platformBalance(t, ctx, pool) - platformBefore; got != tt.amount {
				t.Errorf("platform balance moved %d, want %d", got, tt.amount)
			}
			ownerID := f.UserID
			ownerAccount, err := ledger.FindAccountByOwner(ctx, store.OwnerOwner, &ownerID)
			if err != nil {
				t.Fatalf("find owner account: %v", err)
			}
			if ownerAccount == nil || ownerAccount.Balance != -tt.amount {
				t.Errorf("owner balance = %+v, want %d paid out", ownerAccount, -tt.amount)
			}
		})
	}
}

/*
TestRefundedDocumentPaymentIsUnwound closes the loop the new legs open.

Before a document payment was booked at all, refunding one needed no reversal:
there was nothing in the ledger to take back, and the admin summary stopped
counting it the moment the transaction left status completed. Now that the
settlement books a platform revenue leg, a refund that left that leg standing
would report income the platform had given back - the same class of error the
escrow reversal exists to prevent, one account over.
*/
func TestRefundedDocumentPaymentIsUnwound(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)

	f := testsupport.NewFixture(t, pool)
	ledger := store.NewLedgerStore(pool)

	const price = 300_000
	orderID := "PRD-" + f.ID("order")
	txnID := seedPendingCheckout(t, pool, f, store.TxTypePRDPayment, orderID, price)

	platformBefore := platformBalance(t, ctx, pool)

	if got := postMidtransNotification(t, pool, orderID, price, "settlement", ""); got != fiber.StatusOK {
		t.Fatalf("settlement status = %d, want %d", got, fiber.StatusOK)
	}
	if got := platformBalance(t, ctx, pool) - platformBefore; got != price {
		t.Fatalf("platform balance moved %d on settlement, want %d", got, price)
	}

	// The merchant refunds it from the Midtrans dashboard.
	if got := postMidtransNotification(t, pool, orderID, price, "refund", ""); got != fiber.StatusOK {
		t.Fatalf("refund status = %d, want %d", got, fiber.StatusOK)
	}

	entries, err := ledger.GetEntriesByTransaction(ctx, txnID)
	if err != nil {
		t.Fatalf("read ledger entries: %v", err)
	}
	if len(entries) != 4 {
		t.Fatalf("a refunded document payment has %d ledger entries, want 4 (two booked, two reversed)", len(entries))
	}
	var debits, credits int64
	for _, e := range entries {
		if e.EntryType == store.EntryDebit {
			debits += e.Amount
		} else {
			credits += e.Amount
		}
	}
	if debits != credits {
		t.Errorf("the reversed document payment does not balance: debit=%d, credit=%d", debits, credits)
	}

	if got := platformBalance(t, ctx, pool) - platformBefore; got != 0 {
		t.Errorf("platform still holds %d of a refunded document payment", got)
	}
	ownerID := f.UserID
	ownerAccount, err := ledger.FindAccountByOwner(ctx, store.OwnerOwner, &ownerID)
	if err != nil {
		t.Fatalf("find owner account: %v", err)
	}
	if ownerAccount == nil || ownerAccount.Balance != 0 {
		t.Errorf("owner account = %+v, want a zero balance after the refund", ownerAccount)
	}
}

/*
TestChallengedCaptureFundsNothing is the fraud_status half, against the real
schema.

Midtrans sends a card capture with fraud_status=challenge when it is holding the
charge for the merchant to review by hand: the money is not the platform's yet
and may never be. fraud_status was parsed off the notification and then ignored,
so that capture mapped to completed, funded escrow, and a later milestone
release could pay a talent out of a deposit that was subsequently cancelled.

The resolving notification still settles: challenge leaves the row at
processing, which supersedes lets through to completed.
*/
func TestChallengedCaptureFundsNothing(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)

	f := testsupport.NewFixture(t, pool)
	ledger := store.NewLedgerStore(pool)

	const deposit = 12_000_000
	orderID := "ESC-" + f.ID("order")
	txnID := seedPendingCheckout(t, pool, f, store.TxTypeEscrowIn, orderID, deposit)

	// The charge is held for review.
	if got := postMidtransNotification(t, pool, orderID, deposit, "capture", "challenge"); got != fiber.StatusOK {
		t.Fatalf("webhook status = %d, want %d", got, fiber.StatusOK)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM transactions WHERE id = $1`, txnID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != store.TxStatusProcessing {
		t.Errorf("a challenged capture left the transaction %q, want %q", status, store.TxStatusProcessing)
	}

	entries, err := ledger.GetEntriesByTransaction(ctx, txnID)
	if err != nil {
		t.Fatalf("read ledger entries: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("a challenged capture funded %d ledger entries", len(entries))
	}
	accounts, err := ledger.FindEscrowAccountsForProject(ctx, f.ProjectID)
	if err != nil {
		t.Fatalf("find escrow accounts: %v", err)
	}
	for _, a := range accounts {
		if a.Balance != 0 {
			t.Errorf("escrow account %s holds %d against a charge still under review", a.ID, a.Balance)
		}
	}

	// The merchant approves it; the resolving notification settles the payment.
	if got := postMidtransNotification(t, pool, orderID, deposit, "capture", "accept"); got != fiber.StatusOK {
		t.Fatalf("resolving webhook status = %d, want %d", got, fiber.StatusOK)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM transactions WHERE id = $1`, txnID).Scan(&status); err != nil {
		t.Fatalf("read settled status: %v", err)
	}
	if status != store.TxStatusCompleted {
		t.Errorf("an accepted capture left the transaction %q, want %q", status, store.TxStatusCompleted)
	}

	entries, err = ledger.GetEntriesByTransaction(ctx, txnID)
	if err != nil {
		t.Fatalf("read ledger entries after settlement: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("the settled deposit booked %d ledger entries, want 2", len(entries))
	}
	var funded int64
	accounts, err = ledger.FindEscrowAccountsForProject(ctx, f.ProjectID)
	if err != nil {
		t.Fatalf("find escrow accounts after settlement: %v", err)
	}
	for _, a := range accounts {
		funded += a.Balance
	}
	if funded != deposit {
		t.Errorf("escrow holds %d after settlement, want %d", funded, deposit)
	}
}
