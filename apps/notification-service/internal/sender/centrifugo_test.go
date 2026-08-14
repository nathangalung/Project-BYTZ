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

func TestNewCentrifugoSender(t *testing.T) {
	s := NewCentrifugoSender("http://centrifugo:8000", "api-key")
	if s.url != "http://centrifugo:8000" || s.apiKey != "api-key" {
		t.Errorf("sender = %+v, want the supplied url and key", s)
	}
	if s.client == nil || s.client.Timeout == 0 {
		t.Error("client has no timeout; a hung Centrifugo would stall event processing")
	}
}

// Centrifugo is optional infrastructure: unconfigured must be a no-op, not an
// error that naks every event.
func TestCentrifugoPublish_UnconfiguredIsANoOp(t *testing.T) {
	tests := []struct {
		name   string
		url    string
		apiKey string
	}{
		{"no url", "", "key"},
		{"no key", "http://example.invalid", ""},
		{"neither", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewCentrifugoSender(tt.url, tt.apiKey)
			if err := s.Publish(context.Background(), "project:p-1", map[string]any{"a": 1}); err != nil {
				t.Errorf("error = %v, want nil (an optional transport must not fail the event)", err)
			}
		})
	}
}

// The request must be the Centrifugo publish API shape with the apikey scheme.
func TestCentrifugoPublish_RequestShape(t *testing.T) {
	var (
		gotPath string
		gotAuth string
		gotBody centrifugoAPIRequest
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	s := NewCentrifugoSender(srv.URL, "secret-key")
	if err := s.Publish(context.Background(), "project:p-1", map[string]any{"type": "project.completed"}); err != nil {
		t.Fatalf("error = %v", err)
	}

	if gotPath != "/api" {
		t.Errorf("path = %q, want /api", gotPath)
	}
	if gotAuth != "apikey secret-key" {
		t.Errorf("Authorization = %q, want the apikey scheme", gotAuth)
	}
	if gotBody.Method != "publish" {
		t.Errorf("method = %q, want publish", gotBody.Method)
	}

	params, ok := gotBody.Params.(map[string]any)
	if !ok {
		t.Fatalf("params = %T, want an object", gotBody.Params)
	}
	if params["channel"] != "project:p-1" {
		t.Errorf("channel = %v, want project:p-1", params["channel"])
	}
}

// A user notification must land on the user-limited channel, or it would be
// readable by anyone subscribed to a shared channel.
func TestPublishUserNotification_UsesUserLimitedChannel(t *testing.T) {
	var gotChannel any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body centrifugoAPIRequest
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		if params, ok := body.Params.(map[string]any); ok {
			gotChannel = params["channel"]
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	s := NewCentrifugoSender(srv.URL, "key")
	if err := s.PublishUserNotification(context.Background(), "user-42", map[string]any{"id": "n-1"}); err != nil {
		t.Fatalf("error = %v", err)
	}

	if gotChannel != "notifications#user-42" {
		t.Errorf("channel = %v, want notifications#user-42 (the # form is what limits it to one user)", gotChannel)
	}
}

func TestCentrifugoPublish_UpstreamErrorsSurface(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		wantErr bool
	}{
		{"ok", http.StatusOK, false},
		{"unauthorized", http.StatusUnauthorized, true},
		{"not found", http.StatusNotFound, true},
		{"server error", http.StatusInternalServerError, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(`{"error":"nope"}`))
			}))
			defer srv.Close()

			s := NewCentrifugoSender(srv.URL, "key")
			err := s.Publish(context.Background(), "c", map[string]any{})

			if tt.wantErr && err == nil {
				t.Errorf("status %d returned nil", tt.status)
			}
			if tt.wantErr && err != nil && !strings.Contains(err.Error(), "centrifugo API error") {
				t.Errorf("error = %v, want it to name the upstream", err)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("status %d returned %v", tt.status, err)
			}
		})
	}
}

func TestCentrifugoPublish_TransportFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()

	s := NewCentrifugoSender(url, "key")
	err := s.Publish(context.Background(), "c", map[string]any{})
	if err == nil {
		t.Fatal("a dead upstream returned nil")
	}
	if !strings.Contains(err.Error(), "publish to centrifugo") {
		t.Errorf("error = %v, want it to name the publish step", err)
	}
}

func TestCentrifugoPublish_InvalidURL(t *testing.T) {
	s := NewCentrifugoSender("://bad", "key")
	err := s.Publish(context.Background(), "c", map[string]any{})
	if err == nil {
		t.Fatal("an unparseable url returned nil")
	}
	if !strings.Contains(err.Error(), "create centrifugo request") {
		t.Errorf("error = %v, want it to name the request-build step", err)
	}
}

// Data that cannot be marshalled must fail before the request is built.
func TestCentrifugoPublish_UnmarshallableData(t *testing.T) {
	s := NewCentrifugoSender("http://example.invalid", "key")
	err := s.Publish(context.Background(), "c", make(chan int))
	if err == nil {
		t.Fatal("an unmarshallable payload returned nil")
	}
	if !strings.Contains(err.Error(), "marshal centrifugo request") {
		t.Errorf("error = %v, want it to name the marshal step", err)
	}
}

func TestCentrifugoPublish_CancelledContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	s := NewCentrifugoSender(srv.URL, "key")
	if err := s.Publish(ctx, "c", map[string]any{}); err == nil {
		t.Fatal("a cancelled context returned nil")
	}
}
