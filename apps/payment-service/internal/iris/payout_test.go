package iris

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

/*
The signature scheme, pinned against the documented formula.

Midtrans "Validating Payout Notification": the Iris-Signature header is
SHA512(stringFromHttpNotificationBody + merchantKey), hex encoded. The expected
value here is computed from that sentence rather than from NotificationSignature,
so a change to the production formula fails this test instead of moving with it.
*/
func TestNotificationSignature_MatchesTheDocumentedFormula(t *testing.T) {
	const body = `{"reference_no":"TLtXjaG7LxcbEhgo7S","amount":"12333.0","status":"processed","updated_at":"2023-03-31T10:12:28Z"}`
	const merchantKey = "IRIS-merchant-abc123"

	sum := sha512.Sum512([]byte(body + merchantKey))
	want := hex.EncodeToString(sum[:])

	if got := NotificationSignature([]byte(body), merchantKey); got != want {
		t.Fatalf("signature = %q, want %q", got, want)
	}
}

func TestVerifyNotification(t *testing.T) {
	const body = `{"reference_no":"REF-1","status":"completed"}`
	const merchantKey = "IRIS-merchant-abc123"
	valid := NotificationSignature([]byte(body), merchantKey)

	cases := []struct {
		name        string
		body        string
		signature   string
		merchantKey string
		want        bool
	}{
		{"genuine", body, valid, merchantKey, true},
		{"body altered after signing", `{"reference_no":"REF-1","status":"failed"}`, valid, merchantKey, false},
		{"signed with another key", body, NotificationSignature([]byte(body), "other"), merchantKey, false},
		{"no signature", body, "", merchantKey, false},
		// Without the secret nothing can be distinguished from a forgery, so
		// an unconfigured verifier must refuse rather than wave everything
		// through - including an empty signature against an empty key.
		{"no merchant key", body, valid, "", false},
		{"no merchant key and no signature", body, "", "", false},
		{"truncated signature", body, valid[:64], merchantKey, false},
		// Whitespace matters: the digest is over the bytes as they arrived.
		{"reformatted body", `{"reference_no": "REF-1", "status": "completed"}`, valid, merchantKey, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := VerifyNotification([]byte(tc.body), tc.signature, tc.merchantKey); got != tc.want {
				t.Fatalf("VerifyNotification = %v, want %v", got, tc.want)
			}
		})
	}
}

// The classification is what decides whether a payout may be created again, so
// every failure mode has to land on the right side of it.
func TestCreatePayout_ClassifiesFailures(t *testing.T) {
	cases := []struct {
		name          string
		status        int
		body          string
		wantRejected  bool
		wantAmbiguous bool
	}{
		{"bad request", http.StatusBadRequest, `{"error_message":"invalid beneficiary"}`, true, false},
		{"unauthorized", http.StatusUnauthorized, `{"error_message":"bad key"}`, true, false},
		{"unprocessable", http.StatusUnprocessableEntity, `{"errors":["amount too small"]}`, true, false},
		// 408 and 429 are NOT rejections: the request may have been accepted
		// before the gateway gave up or shed it.
		{"request timeout", http.StatusRequestTimeout, `{}`, false, true},
		{"rate limited", http.StatusTooManyRequests, `{}`, false, true},
		{"internal error", http.StatusInternalServerError, `{}`, false, true},
		{"bad gateway", http.StatusBadGateway, `{}`, false, true},
		// A 2xx we cannot read is ambiguous: the payout exists and we do not
		// know its reference.
		{"success with unparseable body", http.StatusOK, `not json`, false, true},
		{"success with no reference", http.StatusOK, `{"payouts":[{"status":"queued"}]}`, false, true},
		{"success with no payouts", http.StatusOK, `{"payouts":[]}`, false, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()

			_, err := NewClient(srv.URL, "key").CreatePayout(context.Background(), PayoutRequest{
				BeneficiaryName: "Budi", BeneficiaryAccount: "123", BeneficiaryBank: "bca",
				Amount: 1000, IdempotencyKey: "idem-1",
			})
			if err == nil {
				t.Fatal("expected an error")
			}

			var rejected *PayoutRejectedError
			var ambiguous *AmbiguousError
			if errors.As(err, &rejected) != tc.wantRejected {
				t.Fatalf("rejected = %v, want %v (err %v)", !tc.wantRejected, tc.wantRejected, err)
			}
			if errors.As(err, &ambiguous) != tc.wantAmbiguous {
				t.Fatalf("ambiguous = %v, want %v (err %v)", !tc.wantAmbiguous, tc.wantAmbiguous, err)
			}
		})
	}
}

// A client timeout is the case the whole classification exists for: the request
// may have created a payout we never heard about.
func TestCreatePayout_TimeoutIsAmbiguous(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"payouts":[{"status":"queued","reference_no":"REF-1"}]}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "key")
	c.http = &http.Client{Timeout: 20 * time.Millisecond}

	_, err := c.CreatePayout(context.Background(), PayoutRequest{
		BeneficiaryName: "Budi", BeneficiaryAccount: "123", BeneficiaryBank: "bca",
		Amount: 1000, IdempotencyKey: "idem-1",
	})
	var ambiguous *AmbiguousError
	if !errors.As(err, &ambiguous) {
		t.Fatalf("a timed out create must be ambiguous, got %v", err)
	}
	var rejected *PayoutRejectedError
	if errors.As(err, &rejected) {
		t.Fatal("a timed out create must never read as a definitive rejection")
	}
}

// The header spelling is the one the Create Payout reference names. The Core
// API's Idempotency-Key is a different header on a different API.
func TestCreatePayout_SendsDocumentedIdempotencyHeader(t *testing.T) {
	var got, coreSpelling string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("X-Idempotency-Key")
		coreSpelling = r.Header.Get("Idempotency-Key")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"payouts":[{"status":"queued","reference_no":"REF-1"}]}`))
	}))
	defer srv.Close()

	res, err := NewClient(srv.URL, "key").CreatePayout(context.Background(), PayoutRequest{
		BeneficiaryName: "Budi", BeneficiaryAccount: "123", BeneficiaryBank: "bca",
		Amount: 1000, IdempotencyKey: "disburse:milestone-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.ReferenceNo != "REF-1" {
		t.Fatalf("reference = %q", res.ReferenceNo)
	}
	if got != "disburse:milestone-1" {
		t.Fatalf("X-Idempotency-Key = %q, want the payout's key", got)
	}
	if coreSpelling != "" {
		t.Fatalf("Idempotency-Key must not be sent to Iris, got %q", coreSpelling)
	}
}

func TestGetPayout(t *testing.T) {
	cases := []struct {
		name          string
		status        int
		body          string
		wantStatus    string
		wantErr       error
		wantAmbiguous bool
	}{
		{
			name: "completed", status: http.StatusOK,
			body:       `{"reference_no":"REF-1","status":"completed","amount":"3575000.00"}`,
			wantStatus: PayoutCompleted,
		},
		{
			name: "failed with details", status: http.StatusOK,
			body:       `{"reference_no":"REF-1","status":"failed","error_details":{"code":"invalid_account"}}`,
			wantStatus: PayoutFailed,
		},
		{
			name: "unknown reference", status: http.StatusNotFound,
			body: `{"error_message":"not found"}`, wantErr: ErrPayoutNotFound,
		},
		{
			name: "gateway down", status: http.StatusBadGateway,
			body: `{}`, wantAmbiguous: true,
		},
		{
			name: "status missing from the body", status: http.StatusOK,
			body: `{"reference_no":"REF-1"}`, wantAmbiguous: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var path string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				path = r.URL.Path
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()

			res, err := NewClient(srv.URL, "key").GetPayout(context.Background(), "REF-1")

			if path != "/api/v1/payouts/REF-1" {
				t.Fatalf("path = %q, want /api/v1/payouts/REF-1", path)
			}
			switch {
			case tc.wantErr != nil:
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("error = %v, want %v", err, tc.wantErr)
				}
			case tc.wantAmbiguous:
				var ambiguous *AmbiguousError
				if !errors.As(err, &ambiguous) {
					t.Fatalf("error = %v, want an ambiguous error", err)
				}
			default:
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if res.Status != tc.wantStatus {
					t.Fatalf("status = %q, want %q", res.Status, tc.wantStatus)
				}
			}
		})
	}
}

func TestPayoutStatus_FailureReason(t *testing.T) {
	cases := []struct {
		name string
		in   PayoutStatus
		want string
	}{
		{"no details", PayoutStatus{}, ""},
		{"json null", PayoutStatus{ErrorDetails: []byte("null")}, ""},
		{"object", PayoutStatus{ErrorDetails: []byte(`{"code":"x"}`)}, `{"code":"x"}`},
		{"array", PayoutStatus{ErrorDetails: []byte(`["bad account"]`)}, `["bad account"]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.in.FailureReason(); got != tc.want {
				t.Fatalf("FailureReason = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGetPayout_RefusesWithoutConfiguration(t *testing.T) {
	if _, err := NewClient(SandboxBaseURL, "").GetPayout(context.Background(), "REF-1"); err == nil {
		t.Fatal("a disabled client must refuse to read payout status")
	}
	if _, err := NewClient(SandboxBaseURL, "key").GetPayout(context.Background(), ""); err == nil {
		t.Fatal("an empty reference must be refused")
	}
}
