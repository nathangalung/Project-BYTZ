package publisher

import (
	"encoding/json"
	"testing"
	"time"
)

// The envelope is the cross-service contract: the notification consumer
// unmarshals exactly these fields, so shape drift breaks delivery silently.
func TestBuildEnvelope_Contract(t *testing.T) {
	created := time.Date(2026, 7, 24, 10, 30, 0, 123456789, time.FixedZone("WIB", 7*3600))
	payload := []byte(`{"projectId":"p-1","amount":5000000}`)

	body, err := buildEnvelope("evt-1", "payment.released", payload, created, "trace-abc")
	if err != nil {
		t.Fatalf("buildEnvelope: %v", err)
	}

	var out map[string]json.RawMessage
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	assertStr := func(key, want string) {
		var got string
		if err := json.Unmarshal(out[key], &got); err != nil {
			t.Fatalf("field %s: %v", key, err)
		}
		if got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
	assertStr("id", "evt-1")
	assertStr("type", "payment.released")
	assertStr("source", "payment-service")
	// Timestamps normalize to UTC RFC3339Nano regardless of the stored zone.
	assertStr("timestamp", "2026-07-24T03:30:00.123456789Z")
	assertStr("correlationId", "trace-abc")

	if string(out["data"]) != string(payload) {
		t.Errorf("data passthrough broken: %s", out["data"])
	}
}

func TestBuildEnvelope_OmitsEmptyCorrelation(t *testing.T) {
	body, err := buildEnvelope("evt-2", "payment.escrow.created", []byte(`{}`), time.Now(), "")
	if err != nil {
		t.Fatalf("buildEnvelope: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := out["correlationId"]; present {
		t.Error("empty correlationId must be omitted, not sent as \"\"")
	}
}
