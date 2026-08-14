package sender

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestEmailSender points a real sender at a stub Resend.
func newTestEmailSender(apiKey, baseURL string) *EmailSender {
	s := NewEmailSender(apiKey)
	s.baseURL = baseURL
	return s
}

func TestNewEmailSender_DefaultsToResend(t *testing.T) {
	s := NewEmailSender("key")
	if s.baseURL != resendEndpoint {
		t.Errorf("baseURL = %q, want %q", s.baseURL, resendEndpoint)
	}
	if s.apiKey != "key" {
		t.Errorf("apiKey = %q, want key", s.apiKey)
	}
	if s.client == nil {
		t.Fatal("client is nil")
	}
	if s.client.Timeout == 0 {
		t.Error("client has no timeout; a hung Resend would block the consumer indefinitely")
	}
}

// With no API key the sender is a no-op rather than an error, so an unconfigured
// dev environment still processes events.
func TestEmailSend_NoAPIKeyDoesNotCallOut(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer srv.Close()

	s := newTestEmailSender("", srv.URL)
	if err := s.Send(context.Background(), SendEmailInput{To: "u@example.com", Subject: "s", HTML: "<p>h</p>"}); err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
	if called {
		t.Error("an unconfigured sender still called the API")
	}
}

// The request must carry the bearer key, JSON content type, and the payload
// Resend expects.
func TestEmailSend_RequestShape(t *testing.T) {
	var (
		gotAuth        string
		gotContentType string
		gotMethod      string
		gotBody        resendRequest
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		gotMethod = r.Method
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	s := newTestEmailSender("re_secret", srv.URL)
	err := s.Send(context.Background(), SendEmailInput{
		To:      "talent@example.com",
		Subject: "Payment released",
		HTML:    "<h2>Payment released</h2>",
	})
	if err != nil {
		t.Fatalf("error = %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotAuth != "Bearer re_secret" {
		t.Errorf("Authorization = %q, want Bearer re_secret", gotAuth)
	}
	if gotContentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotContentType)
	}
	if len(gotBody.To) != 1 || gotBody.To[0] != "talent@example.com" {
		t.Errorf("to = %v, want [talent@example.com]", gotBody.To)
	}
	if gotBody.Subject != "Payment released" {
		t.Errorf("subject = %q", gotBody.Subject)
	}
	if gotBody.HTML != "<h2>Payment released</h2>" {
		t.Errorf("html = %q", gotBody.HTML)
	}
	if gotBody.From == "" {
		t.Error("from is empty; Resend rejects a message with no sender")
	}
}

// A non-2xx from Resend must surface as an error. A silent failure here is a
// notification the user never receives and nobody can see was lost.
func TestEmailSend_UpstreamErrorsSurface(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		wantErr    bool
		wantInText string
	}{
		{"ok", http.StatusOK, `{"id":"e-1"}`, false, ""},
		{"created", http.StatusCreated, `{"id":"e-1"}`, false, ""},
		{"bad request", http.StatusBadRequest, `{"message":"invalid to"}`, true, "400"},
		{"unauthorized", http.StatusUnauthorized, `{"message":"bad key"}`, true, "401"},
		{"rate limited", http.StatusTooManyRequests, `{"message":"slow down"}`, true, "429"},
		{"server error", http.StatusInternalServerError, `{"message":"boom"}`, true, "500"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer srv.Close()

			s := newTestEmailSender("re_key", srv.URL)
			err := s.Send(context.Background(), SendEmailInput{To: "u@example.com", Subject: "s", HTML: "h"})

			if tt.wantErr {
				if err == nil {
					t.Fatalf("status %d returned nil; a failed send would be invisible", tt.status)
				}
				if !strings.Contains(err.Error(), tt.wantInText) {
					t.Errorf("error = %v, want it to name status %s", err, tt.wantInText)
				}
				if !strings.Contains(err.Error(), "resend API error") {
					t.Errorf("error = %v, want it to name the upstream", err)
				}
				return
			}
			if err != nil {
				t.Errorf("status %d returned %v, want nil", tt.status, err)
			}
		})
	}
}

// A transport failure must be reported, not swallowed.
func TestEmailSend_TransportFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close() // nothing is listening now

	s := newTestEmailSender("re_key", url)
	err := s.Send(context.Background(), SendEmailInput{To: "u@example.com", Subject: "s", HTML: "h"})
	if err == nil {
		t.Fatal("a dead upstream returned nil")
	}
	if !strings.Contains(err.Error(), "send email") {
		t.Errorf("error = %v, want it to name the send step", err)
	}
}

// A cancelled context must abort rather than block the shutdown budget.
func TestEmailSend_CancelledContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	s := newTestEmailSender("re_key", srv.URL)
	if err := s.Send(ctx, SendEmailInput{To: "u@example.com", Subject: "s", HTML: "h"}); err == nil {
		t.Fatal("a cancelled context returned nil")
	}
}

// An unbuildable URL must fail at request construction.
func TestEmailSend_InvalidURL(t *testing.T) {
	s := newTestEmailSender("re_key", "://bad")
	err := s.Send(context.Background(), SendEmailInput{To: "u@example.com", Subject: "s", HTML: "h"})
	if err == nil {
		t.Fatal("an unparseable endpoint returned nil")
	}
	if !strings.Contains(err.Error(), "create email request") {
		t.Errorf("error = %v, want it to name the request-build step", err)
	}
}

// recordingTransport captures the URL without touching the network.
type recordingTransport struct{ url string }

func (rt *recordingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	rt.url = r.URL.String()
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"id":"e-1"}`)),
		Header:     http.Header{},
		Request:    r,
	}, nil
}

// A sender built without the constructor must still reach Resend rather than
// POST to the empty string.
func TestEmailSend_EmptyBaseURLFallsBackToResend(t *testing.T) {
	rt := &recordingTransport{}
	s := &EmailSender{apiKey: "re_key", client: &http.Client{Transport: rt}}

	if err := s.Send(context.Background(), SendEmailInput{To: "u@example.com", Subject: "s", HTML: "h"}); err != nil {
		t.Fatalf("error = %v", err)
	}
	if rt.url != resendEndpoint {
		t.Errorf("posted to %q, want %q", rt.url, resendEndpoint)
	}
}
