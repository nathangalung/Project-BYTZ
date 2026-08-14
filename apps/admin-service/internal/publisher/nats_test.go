package publisher

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/bytz/admin-service/internal/observability"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// recordingJS captures what would have gone to JetStream.
type recordingJS struct {
	err error

	msgs   []*nats.Msg
	optSet []int // number of publish opts per call
}

func (r *recordingJS) PublishMsg(_ context.Context, msg *nats.Msg, opts ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	r.msgs = append(r.msgs, msg)
	r.optSet = append(r.optSet, len(opts))
	if r.err != nil {
		return nil, r.err
	}
	return &jetstream.PubAck{Stream: "TEST", Sequence: 1}, nil
}

var _ msgPublisher = (*recordingJS)(nil)

func decodeEnvelope(t *testing.T, msg *nats.Msg) Envelope {
	t.Helper()
	var e Envelope
	if err := json.Unmarshal(msg.Data, &e); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	return e
}

// The replayed envelope must keep the original event id, or consumer-side
// idempotency stops recognising the event and a replay double-notifies.
func TestRepublish_KeepsOriginalEventID(t *testing.T) {
	js := &recordingJS{}
	p := &NATSPublisher{js: js}

	payload := json.RawMessage(`{"projectId":"p-1","amount":500000}`)
	if err := p.Republish(context.Background(), "evt-original", "payment.released", payload, nil); err != nil {
		t.Fatalf("error = %v", err)
	}

	if len(js.msgs) != 1 {
		t.Fatalf("published %d messages, want 1", len(js.msgs))
	}
	msg := js.msgs[0]
	if msg.Subject != "payment.released" {
		t.Errorf("subject = %q, want payment.released", msg.Subject)
	}

	env := decodeEnvelope(t, msg)
	if env.ID != "evt-original" {
		t.Errorf("envelope id = %q, want evt-original (consumer dedup keys on it)", env.ID)
	}
	if env.Type != "payment.released" {
		t.Errorf("type = %q", env.Type)
	}
	if env.Source != serviceSource {
		t.Errorf("source = %q, want %q so a replay is distinguishable from the original", env.Source, serviceSource)
	}
	if string(env.Data) != string(payload) {
		t.Errorf("data = %s, want the original payload verbatim", env.Data)
	}
	if env.Timestamp == "" {
		t.Error("timestamp is empty")
	}
}

// A fresh publish msgID must accompany every replay, or JetStream's 2-minute
// dedup window silently swallows a reprocess that lands inside it.
func TestRepublish_UsesAFreshMsgIDPerCall(t *testing.T) {
	js := &recordingJS{}
	p := &NATSPublisher{js: js}

	for i := 0; i < 2; i++ {
		if err := p.Republish(context.Background(), "evt-same", "payment.released", json.RawMessage(`{}`), nil); err != nil {
			t.Fatalf("error = %v", err)
		}
	}

	for i, n := range js.optSet {
		if n != 1 {
			t.Errorf("call %d passed %d publish opts, want 1 (the dedup-bypassing msgID)", i, n)
		}
	}
	// Both replays carry the same envelope id, which is the point: the dedup
	// bypass is in the publish opt, not the envelope.
	a := decodeEnvelope(t, js.msgs[0])
	b := decodeEnvelope(t, js.msgs[1])
	if a.ID != b.ID || a.ID != "evt-same" {
		t.Errorf("envelope ids = %q and %q, want both evt-same", a.ID, b.ID)
	}
}

// A stored trace context must be restored so the replay joins the original
// trace rather than starting an orphan.
func TestRepublish_RestoresStoredTraceContext(t *testing.T) {
	prev := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() { otel.SetTextMapPropagator(prev) })

	js := &recordingJS{}
	p := &NATSPublisher{js: js}

	const traceHex = "4bf92f3577b34da6a3ce929d0e0e4736"
	stored, err := json.Marshal(map[string]string{
		"traceparent": "00-" + traceHex + "-00f067aa0ba902b7-01",
	})
	if err != nil {
		t.Fatalf("marshal carrier: %v", err)
	}

	if err := p.Republish(context.Background(), "evt-1", "payment.released", json.RawMessage(`{}`), stored); err != nil {
		t.Fatalf("error = %v", err)
	}

	msg := js.msgs[0]
	if msg.Header.Get("traceparent") == "" {
		t.Fatal("no traceparent on the outgoing message")
	}
	restored := trace.SpanContextFromContext(
		observability.ExtractNATSHeaders(context.Background(), msg.Header))
	if restored.TraceID().String() != traceHex {
		t.Errorf("outgoing trace id = %s, want %s (the replay left the original trace)",
			restored.TraceID(), traceHex)
	}

	env := decodeEnvelope(t, msg)
	if env.CorrelationID != traceHex {
		t.Errorf("correlationId = %q, want the original trace id %s", env.CorrelationID, traceHex)
	}
}

// A DLQ row with no or unparseable trace context must still replay.
func TestRepublish_TraceContextEdgeCases(t *testing.T) {
	tests := []struct {
		name         string
		traceContext []byte
	}{
		{"nil", nil},
		{"empty", []byte{}},
		{"malformed json", []byte(`{not json`)},
		{"wrong shape", []byte(`["a","b"]`)},
		{"empty object", []byte(`{}`)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			js := &recordingJS{}
			p := &NATSPublisher{js: js}

			if err := p.Republish(context.Background(), "evt-1", "a.b", json.RawMessage(`{}`), tt.traceContext); err != nil {
				t.Fatalf("error = %v, want the replay to proceed", err)
			}
			if len(js.msgs) != 1 {
				t.Fatalf("published %d messages, want 1", len(js.msgs))
			}
			if decodeEnvelope(t, js.msgs[0]).ID != "evt-1" {
				t.Error("envelope id was lost")
			}
		})
	}
}

// A publish failure must reach the caller, or the admin panel would report a
// replay that never happened.
func TestRepublish_PublishFailurePropagates(t *testing.T) {
	sentinel := errors.New("no responders")
	p := &NATSPublisher{js: &recordingJS{err: sentinel}}

	err := p.Republish(context.Background(), "evt-1", "a.b", json.RawMessage(`{}`), nil)
	if !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want %v", err, sentinel)
	}
}

// An unmarshallable payload must fail before publishing.
func TestRepublish_UnmarshallablePayload(t *testing.T) {
	js := &recordingJS{}
	p := &NATSPublisher{js: js}

	// json.RawMessage is embedded verbatim, so invalid JSON breaks the
	// envelope marshal rather than producing a corrupt message on the wire.
	err := p.Republish(context.Background(), "evt-1", "a.b", json.RawMessage(`{invalid`), nil)
	if err == nil {
		t.Fatal("an invalid payload published anyway; the consumer would get unparseable data")
	}
	if !strings.Contains(err.Error(), "marshal envelope") {
		t.Errorf("error = %v, want it to name the marshal step", err)
	}
	if len(js.msgs) != 0 {
		t.Errorf("published %d messages despite the failure", len(js.msgs))
	}
}

// Close on a publisher that never connected must not panic; the admin service
// runs without NATS when the broker is down.
func TestClose_NilConnectionIsSafe(t *testing.T) {
	(&NATSPublisher{}).Close()
}

func TestConnect_InvalidURL(t *testing.T) {
	p, err := Connect("://not-a-url")
	if err == nil {
		t.Fatal("Connect returned nil for an unparseable url")
	}
	if p != nil {
		t.Error("a failed Connect returned a publisher")
	}
	if !strings.Contains(err.Error(), "connect nats") {
		t.Errorf("error = %v, want it to name the connect step", err)
	}
}

// MockPublisher must record every call, or handler tests asserting on it are
// vacuous.
func TestMockPublisher_RecordsCalls(t *testing.T) {
	m := &MockPublisher{}

	if err := m.Republish(context.Background(), "evt-1", "a.b", []byte(`{"x":1}`), []byte(`{"t":"c"}`)); err != nil {
		t.Fatalf("error = %v", err)
	}
	if len(m.Calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(m.Calls))
	}
	c := m.Calls[0]
	if c.OriginalEventID != "evt-1" || c.EventType != "a.b" {
		t.Errorf("call = %+v", c)
	}
	if string(c.Payload) != `{"x":1}` || string(c.TraceContext) != `{"t":"c"}` {
		t.Errorf("call payload/trace = %s / %s", c.Payload, c.TraceContext)
	}

	m.Close()
}

func TestMockPublisher_HonoursTheStub(t *testing.T) {
	sentinel := errors.New("stubbed")
	m := &MockPublisher{
		RepublishFn: func(context.Context, string, string, []byte, []byte) error {
			return sentinel
		},
	}

	if err := m.Republish(context.Background(), "evt-1", "a.b", nil, nil); !errors.Is(err, sentinel) {
		t.Errorf("error = %v, want the stubbed error", err)
	}
	// The call is still recorded even when the stub fails.
	if len(m.Calls) != 1 {
		t.Errorf("calls = %d, want 1", len(m.Calls))
	}
}
