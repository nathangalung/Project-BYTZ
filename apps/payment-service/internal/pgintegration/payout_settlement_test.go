package pgintegration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kerjacus/payment-service/internal/handler"
	"github.com/kerjacus/payment-service/internal/iris"
	"github.com/kerjacus/payment-service/internal/service"
	"github.com/kerjacus/payment-service/internal/store"
	"github.com/kerjacus/payment-service/internal/testsupport"
)

/*
The payout settlement path, against the schema production runs.

What these cover that a mock cannot: the status compare-and-set and the row lock
that make a redelivered payout notification a no-op, the partial unique indexes
that decide whether a platform cash account can exist at all, and the balance
arithmetic CreateLedgerEntriesTx does in Postgres. A mock pool accepts any
isolation level and any SELECT ... FOR UPDATE identically, so asserting
"the second delivery books nothing" against one asserts nothing.

Before this work no payout ever left 'queued': MarkExecuted recorded the Iris
reference and set no status, and the status callback its comment deferred to was
never built. Every successful payout was stuck, and the money that left the
platform was booked nowhere.
*/

const payoutMerchantKey = "IRIS-integration-merchant-key"

// payoutFixture is one settled release: a talent whose asset account already
// carries what the release said they were owed, and a queued payout for it.
type payoutFixture struct {
	pool          *pgxpool.Pool
	f             *testsupport.Fixture
	talentID      string
	transactionID string
	milestoneID   string
	talentAccount string
	amount        int64
}

func newPayoutFixture(t *testing.T, amount int64) *payoutFixture {
	t.Helper()
	pool := testsupport.Pool(t)
	f := testsupport.NewFixture(t, pool)

	talentID := f.SeedTalentProfile(t)
	milestoneID := f.SeedMilestone(t, 0, amount)
	transactionID := f.SeedTransaction(t, "escrow_release", amount)

	// The release already debited the talent's asset account by the net
	// amount: that balance is what the platform still owes them.
	talentAccount := f.SeedAccount(t, store.OwnerTalent, talentID, store.AcctAsset, amount)

	return &payoutFixture{
		pool: pool, f: f, talentID: talentID, transactionID: transactionID,
		milestoneID: milestoneID, talentAccount: talentAccount, amount: amount,
	}
}

func (p *payoutFixture) seedQueued(t *testing.T, referenceNo string) string {
	t.Helper()
	return p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementQueued, referenceNo, p.amount, time.Now().UTC())
}

// stubIris answers status queries from a script, and records every create so a
// test can assert that nothing was sent twice.
type stubIris struct {
	mu        sync.Mutex
	status    *iris.PayoutStatus
	statusErr error
	createRes *iris.PayoutResult
	createErr error
	creates   int
	approves  int
}

func (s *stubIris) Enabled() bool { return true }

func (s *stubIris) CreatePayout(context.Context, iris.PayoutRequest) (*iris.PayoutResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.creates++
	return s.createRes, s.createErr
}

func (s *stubIris) ApprovePayout(context.Context, []string, string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.approves++
	return nil
}

func (s *stubIris) GetPayout(_ context.Context, ref string) (*iris.PayoutStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.statusErr != nil {
		return nil, s.statusErr
	}
	out := *s.status
	if out.ReferenceNo == "" {
		out.ReferenceNo = ref
	}
	return &out, nil
}

func (s *stubIris) createCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.creates
}

func newDisbursementService(pool *pgxpool.Pool, ir *stubIris) *service.DisbursementService {
	return service.NewDisbursementService(
		store.NewDisbursementStore(pool), store.NewLedgerStore(pool), ir, "")
}

// --- reads ---

func payoutStatusOf(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(testsupport.Ctx(t),
		`SELECT status FROM disbursements WHERE id = $1`, id).Scan(&status); err != nil {
		t.Fatalf("read disbursement status: %v", err)
	}
	return status
}

// payoutLegs returns the ledger entries this payout booked, matched the way
// PayoutBookedTx matches them.
func payoutLegs(t *testing.T, pool *pgxpool.Pool, disbursementID string) []store.LedgerEntry {
	t.Helper()
	rows, err := pool.Query(testsupport.Ctx(t), `
		SELECT id, transaction_id, account_id, entry_type, amount, description, metadata, created_at
		FROM ledger_entries
		WHERE metadata->>'disbursementId' = $1
		ORDER BY entry_type
	`, disbursementID)
	if err != nil {
		t.Fatalf("read payout legs: %v", err)
	}
	defer rows.Close()

	var out []store.LedgerEntry
	for rows.Next() {
		var e store.LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.AccountID, &e.EntryType,
			&e.Amount, &e.Description, &e.Metadata, &e.CreatedAt); err != nil {
			t.Fatalf("scan payout leg: %v", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate payout legs: %v", err)
	}
	return out
}

func platformCashBalance(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	var balance int64
	err := pool.QueryRow(testsupport.Ctx(t), `
		SELECT balance FROM accounts WHERE owner_type = 'platform' AND owner_id = $1
	`, store.PlatformCashOwnerID).Scan(&balance)
	if err != nil {
		t.Fatalf("read platform cash balance: %v", err)
	}
	return balance
}

// assertBalancedPayout checks the one invariant the ledger exists for, plus the
// directions this payout must move the two accounts in.
func assertBalancedPayout(t *testing.T, legs []store.LedgerEntry, talentAccount string, amount int64) {
	t.Helper()
	if len(legs) != 2 {
		t.Fatalf("a payout books exactly two legs, got %d: %+v", len(legs), legs)
	}

	var debits, credits int64
	byAccount := map[string]store.LedgerEntry{}
	for _, e := range legs {
		byAccount[e.AccountID] = e
		if e.EntryType == store.EntryDebit {
			debits += e.Amount
		} else {
			credits += e.Amount
		}
	}
	if debits != credits {
		t.Fatalf("payout legs do not balance: debits %d, credits %d", debits, credits)
	}
	if debits != amount {
		t.Fatalf("payout booked %d, want %d", debits, amount)
	}

	talentLeg, ok := byAccount[talentAccount]
	if !ok {
		t.Fatalf("no leg on the talent's account: %+v", legs)
	}
	// A credit is what takes the money off the account giving it up. The
	// release debited this account by what the talent was owed; paying it must
	// clear that, not add to it.
	if talentLeg.EntryType != store.EntryCredit {
		t.Fatalf("the talent leg is a %s, want a credit: paying a talent must reduce what they are owed",
			talentLeg.EntryType)
	}
}

// --- the callback endpoint, end to end ---

func payoutCallbackApp(t *testing.T, pool *pgxpool.Pool, ir *stubIris) *fiber.App {
	t.Helper()
	txnStore := store.NewTransactionStore(pool)
	ledgerStore := store.NewLedgerStore(pool)
	paymentSvc := service.NewPaymentService(txnStore, ledgerStore, webhookServerKey, "")

	h := handler.NewPaymentHandler(paymentSvc)
	h.SetDisbursements(newDisbursementService(pool, ir))
	h.SetIrisMerchantKey(payoutMerchantKey)

	app := fiber.New()
	app.Post("/api/v1/payments/webhook/iris", h.IrisPayoutNotification)
	return app
}

func postPayoutNotification(t *testing.T, app *fiber.App, referenceNo, status string) (int, map[string]any) {
	t.Helper()
	body := `{"reference_no":"` + referenceNo + `","status":"` + status + `","amount":"1.0","updated_at":"2026-01-01T00:00:00Z"}`

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/iris", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Iris-Signature", iris.NotificationSignature([]byte(body), payoutMerchantKey))

	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("payout notification request: %v", err)
	}
	defer resp.Body.Close()

	var parsed struct {
		Data map[string]any `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&parsed)
	return resp.StatusCode, parsed.Data
}

/*
C1: the stuck-forever bug.

A payout sat in 'queued' for good because nothing ever wrote 'processed' or
'completed'. The notification endpoint is the transition, and it is also where
the money leaving is booked: the talent's asset account is credited down to
nothing and the platform's cash account carries what went out.
*/
func TestPayoutNotification_SettlesQueuedAndBooksTheLedger(t *testing.T) {
	const amount = int64(3_575_000)
	p := newPayoutFixture(t, amount)
	app := payoutCallbackApp(t, p.pool, &stubIris{})

	ref := p.f.ID("iris-ref")
	disbursementID := p.seedQueued(t, ref)

	cashBefore := int64(0)
	if err := p.pool.QueryRow(testsupport.Ctx(t), `
		SELECT COALESCE((SELECT balance FROM accounts WHERE owner_type = 'platform' AND owner_id = $1), 0)
	`, store.PlatformCashOwnerID).Scan(&cashBefore); err != nil {
		t.Fatalf("read platform cash balance: %v", err)
	}

	code, data := postPayoutNotification(t, app, ref, iris.PayoutCompleted)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %v)", code, data)
	}
	if data["changed"] != true {
		t.Fatalf("the first delivery must report a change, got %v", data)
	}

	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementCompleted {
		t.Fatalf("payout status = %q, want completed: this is the stuck-forever bug", got)
	}

	legs := payoutLegs(t, p.pool, disbursementID)
	assertBalancedPayout(t, legs, p.talentAccount, amount)

	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d, want 0: the payable is settled once the payout lands", got)
	}
	if got := platformCashBalance(t, p.pool) - cashBefore; got != amount {
		t.Fatalf("platform cash moved %d, want %d", got, amount)
	}
}

// Midtrans retries a notification until it gets a 200, and the sweep can reach
// the same payout first. A second delivery must change nothing.
func TestPayoutNotification_ReplayBooksNothingTwice(t *testing.T) {
	const amount = int64(1_250_000)
	p := newPayoutFixture(t, amount)
	app := payoutCallbackApp(t, p.pool, &stubIris{})

	ref := p.f.ID("iris-ref")
	disbursementID := p.seedQueued(t, ref)

	for i := 0; i < 3; i++ {
		code, data := postPayoutNotification(t, app, ref, iris.PayoutCompleted)
		if code != http.StatusOK {
			t.Fatalf("delivery %d: status = %d, want 200 (body %v)", i, code, data)
		}
		wantChanged := i == 0
		if data["changed"] != wantChanged {
			t.Fatalf("delivery %d: changed = %v, want %v", i, data["changed"], wantChanged)
		}
	}

	legs := payoutLegs(t, p.pool, disbursementID)
	assertBalancedPayout(t, legs, p.talentAccount, amount)
	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d after three deliveries, want 0: the payout was booked more than once", got)
	}
}

// Iris reports 'processed' and then 'completed' for one payout. Both are
// legitimate advances; together they must still produce one set of entries.
func TestPayoutNotification_ProcessedThenCompletedBooksOnce(t *testing.T) {
	const amount = int64(900_000)
	p := newPayoutFixture(t, amount)
	app := payoutCallbackApp(t, p.pool, &stubIris{})

	ref := p.f.ID("iris-ref")
	disbursementID := p.seedQueued(t, ref)

	if code, data := postPayoutNotification(t, app, ref, iris.PayoutProcessed); code != http.StatusOK || data["changed"] != true {
		t.Fatalf("processed: status %d, body %v", code, data)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementProcessed {
		t.Fatalf("status = %q, want processed", got)
	}

	if code, data := postPayoutNotification(t, app, ref, iris.PayoutCompleted); code != http.StatusOK || data["changed"] != true {
		t.Fatalf("completed: status %d, body %v", code, data)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementCompleted {
		t.Fatalf("status = %q, want completed", got)
	}

	legs := payoutLegs(t, p.pool, disbursementID)
	assertBalancedPayout(t, legs, p.talentAccount, amount)
	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d, want 0: processed and completed each booked the payout", got)
	}
}

// A late 'failed' after the money has gone must not walk the payout back:
// 'failed' is claimable, and a claimable paid payout is a second payout.
func TestPayoutNotification_LateFailureCannotUndoASettledPayout(t *testing.T) {
	const amount = int64(500_000)
	p := newPayoutFixture(t, amount)
	app := payoutCallbackApp(t, p.pool, &stubIris{})

	ref := p.f.ID("iris-ref")
	disbursementID := p.seedQueued(t, ref)

	if code, _ := postPayoutNotification(t, app, ref, iris.PayoutCompleted); code != http.StatusOK {
		t.Fatalf("settle: status %d", code)
	}
	code, data := postPayoutNotification(t, app, ref, iris.PayoutFailed)
	if code != http.StatusOK {
		t.Fatalf("late failure: status %d, body %v", code, data)
	}
	if data["changed"] != false {
		t.Fatalf("a late failure must change nothing, got %v", data)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementCompleted {
		t.Fatalf("status = %q, want completed", got)
	}

	// And it must still be unclaimable.
	claimed, err := store.NewDisbursementStore(p.pool).ClaimForExecution(testsupport.Ctx(t), disbursementID)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if claimed != nil {
		t.Fatal("a settled payout must never be claimable again")
	}
}

// Two deliveries of one notification arriving at once. The row lock inside the
// settlement is what serialises them; without it both read 'queued', both find
// the ledger unbooked, and the payout is booked twice.
func TestPayoutNotification_ConcurrentDeliveriesBookOnce(t *testing.T) {
	const amount = int64(2_000_000)
	p := newPayoutFixture(t, amount)
	app := payoutCallbackApp(t, p.pool, &stubIris{})

	ref := p.f.ID("iris-ref")
	disbursementID := p.seedQueued(t, ref)

	const deliveries = 4
	var wg sync.WaitGroup
	changed := make([]bool, deliveries)
	codes := make([]int, deliveries)
	start := make(chan struct{})

	for i := 0; i < deliveries; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			code, data := postPayoutNotification(t, app, ref, iris.PayoutCompleted)
			codes[i] = code
			changed[i] = data["changed"] == true
		}(i)
	}
	close(start)
	wg.Wait()

	wins := 0
	for i, c := range codes {
		if c != http.StatusOK {
			t.Fatalf("delivery %d: status = %d, want 200", i, c)
		}
		if changed[i] {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("%d of %d concurrent deliveries reported a change, want exactly 1", wins, deliveries)
	}

	legs := payoutLegs(t, p.pool, disbursementID)
	assertBalancedPayout(t, legs, p.talentAccount, amount)
	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d after %d concurrent deliveries, want 0", got, deliveries)
	}
}

// A forged notification must not settle a payout, and an unknown reference must
// not answer 200 - Midtrans stops retrying on a 200.
func TestPayoutNotification_RefusesForgedAndUnknown(t *testing.T) {
	p := newPayoutFixture(t, 100_000)
	app := payoutCallbackApp(t, p.pool, &stubIris{})

	ref := p.f.ID("iris-ref")
	disbursementID := p.seedQueued(t, ref)

	body := `{"reference_no":"` + ref + `","status":"completed"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/iris", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Iris-Signature", iris.NotificationSignature([]byte(body), "not-the-merchant-key"))
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("forged signature: status = %d, want 403", resp.StatusCode)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementQueued {
		t.Fatalf("a forged notification settled the payout: status = %q", got)
	}
	if legs := payoutLegs(t, p.pool, disbursementID); len(legs) != 0 {
		t.Fatalf("a forged notification booked %d ledger legs", len(legs))
	}

	if code, _ := postPayoutNotification(t, app, p.f.ID("unknown-ref"), iris.PayoutCompleted); code != http.StatusNotFound {
		t.Fatalf("unknown reference: status = %d, want 404", code)
	}
}

/*
C2 / M2: the no-double-pay proof.

A create whose outcome is unknown used to be marked 'failed', which is in
ClaimForExecution's claimable set, so the next execute POSTed a second payout
for the same milestone. Here the second execute must reach Iris zero more times.
*/
func TestExecute_AmbiguousCreateLeavesNothingToRetry(t *testing.T) {
	p := newPayoutFixture(t, 750_000)
	ir := &stubIris{createErr: &iris.AmbiguousError{Op: "create payout", Err: context.DeadlineExceeded}}
	svc := newDisbursementService(p.pool, ir)

	// A pending payout, the state a release leaves behind.
	disbursementID := p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementPending, "", p.amount, time.Now().UTC())

	if _, err := svc.Execute(testsupport.Ctx(t), disbursementID, p.f.UserID); err == nil {
		t.Fatal("an unresolved create must surface as an error")
	}
	if got := ir.createCount(); got != 1 {
		t.Fatalf("iris creates = %d after the first execute, want 1", got)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementQueued {
		t.Fatalf("status = %q, want queued: anything else is claimable and pays twice", got)
	}

	// The retry an operator or a job would make.
	_, err := svc.Execute(testsupport.Ctx(t), disbursementID, p.f.UserID)
	if err == nil {
		t.Fatal("the retry must refuse rather than create a second payout")
	}
	if got := ir.createCount(); got != 1 {
		t.Fatalf("iris creates = %d after the retry, want 1: the payout was sent twice", got)
	}

	var reason *string
	if err := p.pool.QueryRow(testsupport.Ctx(t),
		`SELECT failure_reason FROM disbursements WHERE id = $1`, disbursementID).Scan(&reason); err != nil {
		t.Fatalf("read failure reason: %v", err)
	}
	if reason == nil || !strings.Contains(*reason, "outcome unknown") {
		t.Fatalf("failure_reason = %v, want the ambiguity recorded for the operator queue", reason)
	}
}

// C2 / M3: an approve retry resumes the payout the reference names. The old
// code walked back into CreatePayout and sent a second one.
func TestExecute_ApproveRetryResumesTheExistingPayout(t *testing.T) {
	p := newPayoutFixture(t, 640_000)
	ref := p.f.ID("iris-ref")
	ir := &stubIris{
		status:    &iris.PayoutStatus{Status: iris.PayoutQueued},
		createRes: &iris.PayoutResult{ReferenceNo: "REF-SECOND-PAYOUT"},
	}
	svc := newDisbursementService(p.pool, ir)

	// The state a failed approve leaves: failed, with the reference kept.
	disbursementID := p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementFailed, ref, p.amount, time.Now().UTC())

	if _, err := svc.Execute(testsupport.Ctx(t), disbursementID, p.f.UserID); err != nil {
		t.Fatalf("the retry must succeed: %v", err)
	}
	if got := ir.createCount(); got != 0 {
		t.Fatalf("iris creates = %d, want 0: a payout with a reference must never be created again", got)
	}

	var stored *string
	if err := p.pool.QueryRow(testsupport.Ctx(t),
		`SELECT iris_reference_no FROM disbursements WHERE id = $1`, disbursementID).Scan(&stored); err != nil {
		t.Fatalf("read reference: %v", err)
	}
	if stored == nil || *stored != ref {
		t.Fatalf("reference = %v, want the original %q", stored, ref)
	}
}

// A retry of a payout Iris has already completed settles it rather than
// approving anything, ledger included.
func TestExecute_ResumeSettlesAPayoutIrisAlreadyCompleted(t *testing.T) {
	const amount = int64(410_000)
	p := newPayoutFixture(t, amount)
	ref := p.f.ID("iris-ref")
	ir := &stubIris{
		status:    &iris.PayoutStatus{Status: iris.PayoutCompleted},
		createRes: &iris.PayoutResult{ReferenceNo: "REF-SECOND-PAYOUT"},
	}
	svc := newDisbursementService(p.pool, ir)

	disbursementID := p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementFailed, ref, amount, time.Now().UTC())

	if _, err := svc.Execute(testsupport.Ctx(t), disbursementID, p.f.UserID); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if got := ir.createCount(); got != 0 {
		t.Fatalf("iris creates = %d, want 0", got)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementCompleted {
		t.Fatalf("status = %q, want completed", got)
	}
	assertBalancedPayout(t, payoutLegs(t, p.pool, disbursementID), p.talentAccount, amount)
	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d, want 0", got)
	}
}

// The store guard on its own: MarkFailed used to reset any row, including one a
// notification had already settled, which put a paid payout back in the
// claimable set.
func TestMarkFailed_CannotWalkBackASettledPayout(t *testing.T) {
	p := newPayoutFixture(t, 300_000)
	st := store.NewDisbursementStore(p.pool)
	ctx := testsupport.Ctx(t)

	for _, settled := range []string{store.DisbursementProcessed, store.DisbursementCompleted} {
		t.Run(settled, func(t *testing.T) {
			ref := p.f.ID("iris-ref")
			id := p.f.SeedDisbursement(t, p.talentID, "", p.milestoneID, settled, ref, p.amount, time.Now().UTC())

			if err := st.MarkFailed(ctx, id, "approve response timed out", &ref); err != nil {
				t.Fatalf("mark failed: %v", err)
			}
			if got := payoutStatusOf(t, p.pool, id); got != settled {
				t.Fatalf("status = %q after MarkFailed, want %q: a paid payout became claimable", got, settled)
			}

			claimed, err := st.ClaimForExecution(ctx, id)
			if err != nil {
				t.Fatalf("claim: %v", err)
			}
			if claimed != nil {
				t.Fatal("a settled payout must never be claimable")
			}
		})
	}
}

/*
C4: the reconciliation sweep.

A payout whose notification never arrived is money booked as owed and never paid
off. The sweep asks Iris about anything that has been still past the threshold
and settles the answer through the same code the notification uses, so a payout
resolved either way reads identically on the books.
*/
func TestReconcileSweep_SettlesAPayoutWhoseNotificationNeverArrived(t *testing.T) {
	const amount = int64(1_100_000)
	p := newPayoutFixture(t, amount)
	ir := &stubIris{status: &iris.PayoutStatus{Status: iris.PayoutCompleted}}
	svc := newDisbursementService(p.pool, ir)
	sweeper := service.NewDisbursementReconciler(svc, time.Hour, time.Hour)

	ref := p.f.ID("iris-ref")
	stuckSince := time.Now().UTC().Add(-48 * time.Hour)
	disbursementID := p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementQueued, ref, amount, stuckSince)

	settled, err := sweeper.Sweep(testsupport.Ctx(t))
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if settled < 1 {
		t.Fatalf("sweep settled %d payouts, want at least the stuck one", settled)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementCompleted {
		t.Fatalf("status = %q, want completed", got)
	}
	assertBalancedPayout(t, payoutLegs(t, p.pool, disbursementID), p.talentAccount, amount)
	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d, want 0", got)
	}

	// Running it again must find nothing left to do and book nothing more.
	if _, err := sweeper.Sweep(testsupport.Ctx(t)); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d after a second sweep, want 0", got)
	}
	if legs := payoutLegs(t, p.pool, disbursementID); len(legs) != 2 {
		t.Fatalf("a second sweep booked more legs: %d", len(legs))
	}
}

// A sweep and a notification racing for the same payout. Either may win; only
// one may book.
func TestReconcileSweep_RacingTheNotificationBooksOnce(t *testing.T) {
	const amount = int64(870_000)
	p := newPayoutFixture(t, amount)
	ir := &stubIris{status: &iris.PayoutStatus{Status: iris.PayoutCompleted}}
	svc := newDisbursementService(p.pool, ir)
	sweeper := service.NewDisbursementReconciler(svc, time.Hour, time.Hour)
	app := payoutCallbackApp(t, p.pool, ir)

	ref := p.f.ID("iris-ref")
	disbursementID := p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementQueued, ref, amount, time.Now().UTC().Add(-48*time.Hour))

	var wg sync.WaitGroup
	start := make(chan struct{})
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		if _, err := sweeper.Sweep(testsupport.Ctx(t)); err != nil {
			t.Errorf("sweep: %v", err)
		}
	}()
	go func() {
		defer wg.Done()
		<-start
		if code, _ := postPayoutNotification(t, app, ref, iris.PayoutCompleted); code != http.StatusOK {
			t.Errorf("notification status = %d", code)
		}
	}()
	close(start)
	wg.Wait()

	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementCompleted {
		t.Fatalf("status = %q, want completed", got)
	}
	assertBalancedPayout(t, payoutLegs(t, p.pool, disbursementID), p.talentAccount, amount)
	if got := p.f.Balance(t, p.talentAccount); got != 0 {
		t.Fatalf("talent balance = %d, want 0: the sweep and the notification both booked", got)
	}
}

// A payout whose create timed out has no reference, so nothing can look it up
// at Iris. The sweep must report it and create nothing: Midtrans's idempotency
// window is five minutes, and a sweep is a day late.
func TestReconcileSweep_NeverRecreatesAReferencelessPayout(t *testing.T) {
	p := newPayoutFixture(t, 220_000)
	ir := &stubIris{
		status:    &iris.PayoutStatus{Status: iris.PayoutCompleted},
		createRes: &iris.PayoutResult{ReferenceNo: "REF-SECOND-PAYOUT"},
	}
	svc := newDisbursementService(p.pool, ir)
	sweeper := service.NewDisbursementReconciler(svc, time.Hour, time.Hour)

	disbursementID := p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementQueued, "", p.amount, time.Now().UTC().Add(-48*time.Hour))

	if _, err := sweeper.Sweep(testsupport.Ctx(t)); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if got := ir.createCount(); got != 0 {
		t.Fatalf("the sweep created %d payouts, want 0", got)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementQueued {
		t.Fatalf("status = %q, want queued: the sweep must not guess at an unknown outcome", got)
	}
	if legs := payoutLegs(t, p.pool, disbursementID); len(legs) != 0 {
		t.Fatalf("the sweep booked %d legs for a payout it could not confirm", len(legs))
	}
}

// The threshold is what keeps the sweep off payouts that are simply in flight.
func TestReconcileSweep_LeavesRecentPayoutsAlone(t *testing.T) {
	p := newPayoutFixture(t, 130_000)
	ir := &stubIris{status: &iris.PayoutStatus{Status: iris.PayoutCompleted}}
	svc := newDisbursementService(p.pool, ir)
	sweeper := service.NewDisbursementReconciler(svc, time.Hour, 24*time.Hour)

	ref := p.f.ID("iris-ref")
	disbursementID := p.f.SeedDisbursement(t, p.talentID, p.transactionID, p.milestoneID,
		store.DisbursementQueued, ref, p.amount, time.Now().UTC())

	if _, err := sweeper.Sweep(testsupport.Ctx(t)); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if got := payoutStatusOf(t, p.pool, disbursementID); got != store.DisbursementQueued {
		t.Fatalf("status = %q, want queued: a payout minutes old is in flight, not stuck", got)
	}
}

// The platform cash account has to be openable at all. accounts carries two
// partial unique indexes, and the NULL-owner_id one already holds Platform
// Revenue, so the cash account must go in beside it under a named owner_id
// rather than as a second platform singleton.
func TestPlatformCashAccountCoexistsWithPlatformRevenue(t *testing.T) {
	pool := testsupport.Pool(t)
	ctx := testsupport.Ctx(t)
	ledger := store.NewLedgerStore(pool)

	revenue, err := ledger.GetOrCreateAccount(ctx, store.CreateAccountInput{
		OwnerType:   store.OwnerPlatform,
		AccountType: store.AcctRevenue,
		Name:        "Platform Revenue",
	})
	if err != nil {
		t.Fatalf("platform revenue account: %v", err)
	}

	cashOwner := store.PlatformCashOwnerID
	cash, err := ledger.GetOrCreateAccount(ctx, store.CreateAccountInput{
		OwnerType:   store.OwnerPlatform,
		OwnerID:     &cashOwner,
		AccountType: store.AcctAsset,
		Name:        store.PlatformCashAccountName,
	})
	if err != nil {
		t.Fatalf("platform cash account: %v", err)
	}
	if cash == nil || revenue == nil {
		t.Fatal("both platform accounts must exist")
	}
	if cash.ID == revenue.ID {
		t.Fatal("the cash account must be a separate row from platform revenue")
	}

	// And it is a singleton of its own: a second get returns the same row.
	again, err := ledger.GetOrCreateAccount(ctx, store.CreateAccountInput{
		OwnerType:   store.OwnerPlatform,
		OwnerID:     &cashOwner,
		AccountType: store.AcctAsset,
		Name:        store.PlatformCashAccountName,
	})
	if err != nil {
		t.Fatalf("second platform cash get: %v", err)
	}
	if again.ID != cash.ID {
		t.Fatalf("a second get opened another cash account: %s then %s", cash.ID, again.ID)
	}
}
