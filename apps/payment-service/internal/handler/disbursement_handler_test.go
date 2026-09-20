package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/kerjacus/payment-service/internal/iris"
	"github.com/kerjacus/payment-service/internal/service"
	"github.com/kerjacus/payment-service/internal/store"
)

// handlerDisbStore satisfies the service's disbursement store, enough to drive
// the endpoints. The service package's own tests cover the store contract in
// depth; here we only need the handler-to-service wiring.
type handlerDisbStore struct {
	claim *store.Disbursement
	byID  map[string]*store.Disbursement
	list  []store.Disbursement
}

func (f *handlerDisbStore) GetVerifiedPayoutAccountTx(context.Context, pgx.Tx, string) (*store.TalentPayoutAccount, error) {
	return nil, nil
}
func (f *handlerDisbStore) InsertPendingTx(context.Context, pgx.Tx, store.EnqueueDisbursementInput) error {
	return nil
}
func (f *handlerDisbStore) GetByID(_ context.Context, id string) (*store.Disbursement, error) {
	return f.byID[id], nil
}
func (f *handlerDisbStore) ClaimForExecution(context.Context, string) (*store.Disbursement, error) {
	return f.claim, nil
}
func (f *handlerDisbStore) MarkExecuted(context.Context, string, string, string) error { return nil }
func (f *handlerDisbStore) MarkFailed(context.Context, string, string, *string) error  { return nil }
func (f *handlerDisbStore) ListByStatus(_ context.Context, _ string, _ int) ([]store.Disbursement, error) {
	return f.list, nil
}

type handlerIris struct{ ref string }

func (f *handlerIris) Enabled() bool { return true }
func (f *handlerIris) CreatePayout(context.Context, iris.PayoutRequest) (*iris.PayoutResult, error) {
	return &iris.PayoutResult{ReferenceNo: f.ref}, nil
}
func (f *handlerIris) ApprovePayout(context.Context, []string, string) error { return nil }

func disbApp(configure bool, st *handlerDisbStore) *fiber.App {
	h := mockHandler()
	if configure {
		h.SetDisbursements(service.NewDisbursementService(st, &handlerIris{ref: "REF-1"}, ""))
	}
	app := fiber.New()
	app.Get("/disbursements", h.ListDisbursements)
	app.Post("/disbursements/:id/execute", h.ExecuteDisbursement)
	return app
}

func doJSON(t *testing.T, app *fiber.App, method, path, body string) (*http.Response, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	var parsed map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&parsed)
	return resp, parsed
}

func TestDisbursementEndpoints_DisabledReturn503(t *testing.T) {
	app := disbApp(false, &handlerDisbStore{})
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/disbursements", ""},
		{http.MethodPost, "/disbursements/d1/execute", `{"approvedBy":"a1"}`},
	} {
		resp, _ := doJSON(t, app, tc.method, tc.path, tc.body)
		if resp.StatusCode != fiber.StatusServiceUnavailable {
			t.Fatalf("%s %s: status = %d, want 503", tc.method, tc.path, resp.StatusCode)
		}
	}
}

func TestExecuteDisbursement_RequiresApprovedBy(t *testing.T) {
	app := disbApp(true, &handlerDisbStore{})
	resp, _ := doJSON(t, app, http.MethodPost, "/disbursements/d1/execute", `{}`)
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestExecuteDisbursement_HappyPath(t *testing.T) {
	d := &store.Disbursement{
		ID: "d1", ProjectID: "p1", TalentID: "t1", Amount: 100,
		BeneficiaryProvider: "bca", BeneficiaryAccount: "123", BeneficiaryName: "Budi",
		Status: store.DisbursementQueued, IdempotencyKey: "disburse:m1",
	}
	app := disbApp(true, &handlerDisbStore{claim: d, byID: map[string]*store.Disbursement{"d1": d}})
	resp, body := doJSON(t, app, http.MethodPost, "/disbursements/d1/execute", `{"approvedBy":"admin1"}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200 (body %v)", resp.StatusCode, body)
	}
	if body["success"] != true {
		t.Fatalf("body = %v", body)
	}
}

func TestListDisbursements_RejectsUnknownStatus(t *testing.T) {
	app := disbApp(true, &handlerDisbStore{})
	resp, _ := doJSON(t, app, http.MethodGet, "/disbursements?status=bogus", "")
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestListDisbursements_ReturnsRows(t *testing.T) {
	app := disbApp(true, &handlerDisbStore{list: []store.Disbursement{{ID: "d1", Status: store.DisbursementPending}}})
	resp, body := doJSON(t, app, http.MethodGet, "/disbursements?status=pending", "")
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	data, ok := body["data"].([]any)
	if !ok || len(data) != 1 {
		t.Fatalf("data = %v", body["data"])
	}
}
