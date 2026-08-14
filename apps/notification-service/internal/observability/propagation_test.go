package observability

import (
	"context"
	"sort"
	"testing"

	"github.com/nats-io/nats.go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

/*
Trace context has to survive the hop through NATS, or a consumer span is an
orphan and the click-through from a request to the notification it produced is
gone. These exercise the carrier both ways against a real propagator.

Note this file is a per-service copy: the code under test is generated into all
three Go services from packages/go-observability and guarded by a CI drift gate,
but a _test.go beside it is not, so this can silently diverge from its sibling.
*/

// withPropagator installs the W3C propagator for the duration of a test.
// Not parallel-safe: otel.SetTextMapPropagator is process global.
func withPropagator(t *testing.T) {
	t.Helper()
	prev := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() { otel.SetTextMapPropagator(prev) })
}

// knownSpanContext is a fixed, valid, sampled span context.
func knownSpanContext(t *testing.T) trace.SpanContext {
	t.Helper()
	traceID, err := trace.TraceIDFromHex("4bf92f3577b34da6a3ce929d0e0e4736")
	if err != nil {
		t.Fatalf("trace id: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("00f067aa0ba902b7")
	if err != nil {
		t.Fatalf("span id: %v", err)
	}
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
}

// A trace id put on the wire must come back off it unchanged.
func TestNATSHeaders_RoundTripPreservesTraceID(t *testing.T) {
	withPropagator(t)

	want := knownSpanContext(t)
	ctx := trace.ContextWithSpanContext(context.Background(), want)

	hdr := nats.Header{}
	InjectNATSHeaders(ctx, hdr)

	if hdr.Get("traceparent") == "" {
		t.Fatal("no traceparent header written; the consumer span would be an orphan")
	}

	got := trace.SpanContextFromContext(ExtractNATSHeaders(context.Background(), hdr))
	if got.TraceID() != want.TraceID() {
		t.Errorf("trace id = %s, want %s", got.TraceID(), want.TraceID())
	}
	if got.SpanID() != want.SpanID() {
		t.Errorf("span id = %s, want %s", got.SpanID(), want.SpanID())
	}
	if !got.IsSampled() {
		t.Error("the sampled flag was lost; the downstream span would be dropped")
	}
}

// Publishers that send no headers must not crash the consumer.
func TestExtractNATSHeaders_NilAndEmpty(t *testing.T) {
	withPropagator(t)
	base := context.Background()

	if got := ExtractNATSHeaders(base, nil); got != base {
		t.Error("a nil header set must return the context unchanged")
	}

	got := trace.SpanContextFromContext(ExtractNATSHeaders(base, nats.Header{}))
	if got.IsValid() {
		t.Error("empty headers produced a valid span context")
	}
}

// Injecting with no active span must write nothing rather than a zero id.
func TestInjectNATSHeaders_NoActiveSpan(t *testing.T) {
	withPropagator(t)

	hdr := nats.Header{}
	InjectNATSHeaders(context.Background(), hdr)

	if v := hdr.Get("traceparent"); v != "" {
		t.Errorf("traceparent = %q with no active span, want empty", v)
	}
}

func TestNATSHeaderCarrier_Get(t *testing.T) {
	hdr := nats.Header{}
	hdr.Set("traceparent", "value-1")
	c := natsHeaderCarrier(hdr)

	if got := c.Get("traceparent"); got != "value-1" {
		t.Errorf("Get = %q, want value-1", got)
	}
	if got := c.Get("missing"); got != "" {
		t.Errorf("Get(missing) = %q, want empty", got)
	}
}

func TestNATSHeaderCarrier_SetAndKeys(t *testing.T) {
	hdr := nats.Header{}
	c := natsHeaderCarrier(hdr)
	c.Set("traceparent", "a")
	c.Set("tracestate", "b")

	if hdr.Get("traceparent") != "a" {
		t.Errorf("Set did not write through to the header")
	}

	keys := c.Keys()
	sort.Strings(keys)
	// nats.Header does not canonicalise like http.Header, so a key round-trips
	// with the exact casing the propagator wrote.
	if len(keys) != 2 || keys[0] != "traceparent" || keys[1] != "tracestate" {
		t.Errorf("Keys = %v, want [traceparent tracestate] verbatim", keys)
	}
	if c.Get("Traceparent") != "" {
		t.Error("Get matched a differently-cased key; nats.Header lookups are case-sensitive")
	}
}

func TestNATSHeaderCarrier_KeysOnEmpty(t *testing.T) {
	if got := natsHeaderCarrier(nats.Header{}).Keys(); len(got) != 0 {
		t.Errorf("Keys = %v, want none", got)
	}
}

// The persisted carrier is what lets an outbox row resume its original trace.
func TestTraceContext_RoundTripThroughMap(t *testing.T) {
	withPropagator(t)

	want := knownSpanContext(t)
	ctx := trace.ContextWithSpanContext(context.Background(), want)

	carrier := CaptureTraceContext(ctx)
	if len(carrier) == 0 {
		t.Fatal("nothing captured; a persisted event would lose its trace")
	}

	got := trace.SpanContextFromContext(RestoreTraceContext(context.Background(), carrier))
	if got.TraceID() != want.TraceID() {
		t.Errorf("trace id = %s, want %s", got.TraceID(), want.TraceID())
	}
	if got.SpanID() != want.SpanID() {
		t.Errorf("span id = %s, want %s", got.SpanID(), want.SpanID())
	}
}

// Nothing to capture must be nil, not an empty map: the column is JSONB and {}
// is not the same as absent.
func TestCaptureTraceContext_NoSpanReturnsNil(t *testing.T) {
	withPropagator(t)
	if got := CaptureTraceContext(context.Background()); got != nil {
		t.Errorf("CaptureTraceContext = %v, want nil with no active span", got)
	}
}

func TestRestoreTraceContext_EmptyCarrierIsIdentity(t *testing.T) {
	withPropagator(t)
	base := context.Background()

	if got := RestoreTraceContext(base, nil); got != base {
		t.Error("a nil carrier must return the context unchanged")
	}
	if got := RestoreTraceContext(base, map[string]string{}); got != base {
		t.Error("an empty carrier must return the context unchanged")
	}
}
