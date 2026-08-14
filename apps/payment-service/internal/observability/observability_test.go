package observability

import (
	"context"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// tracedContext returns a context carrying a real, sampled span, which is what
// the propagator needs before it will write anything.
func tracedContext(t *testing.T) (context.Context, trace.Span) {
	t.Helper()
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{}))
	tp := sdktrace.NewTracerProvider()
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })

	ctx, span := tp.Tracer("test").Start(context.Background(), "op")
	t.Cleanup(func() { span.End() })
	return ctx, span
}

/*
The outbox stores a trace context so the publish that happens seconds later
joins the request that produced the event, rather than starting a trace of its
own. A capture that survives a round trip through the database is the property;
a carrier that does not restore leaves every published event orphaned.
*/
func TestTraceContext_SurvivesARoundTrip(t *testing.T) {
	ctx, span := tracedContext(t)

	carrier := CaptureTraceContext(ctx)
	if len(carrier) == 0 {
		t.Fatal("an active span produced no carrier")
	}
	if _, ok := carrier["traceparent"]; !ok {
		t.Errorf("carrier has no traceparent: %v", carrier)
	}

	restored := RestoreTraceContext(context.Background(), carrier)
	got := trace.SpanContextFromContext(restored)
	if !got.IsValid() {
		t.Fatal("the restored context carries no span context")
	}
	if got.TraceID() != span.SpanContext().TraceID() {
		t.Errorf("trace id = %s, want %s", got.TraceID(), span.SpanContext().TraceID())
	}
	if got.SpanID() != span.SpanContext().SpanID() {
		t.Errorf("span id = %s, want %s", got.SpanID(), span.SpanContext().SpanID())
	}
}

// Outside a trace there is nothing to store, and nil is what keeps the column
// NULL rather than holding an empty object.
func TestTraceContext_EmptyCarrierIsNotStoredOrRestored(t *testing.T) {
	otel.SetTextMapPropagator(propagation.TraceContext{})

	if got := CaptureTraceContext(context.Background()); got != nil {
		t.Errorf("CaptureTraceContext outside a trace = %v, want nil", got)
	}

	base := context.Background()
	for _, carrier := range []map[string]string{nil, {}} {
		if RestoreTraceContext(base, carrier) != base {
			t.Errorf("RestoreTraceContext(%v) replaced the context", carrier)
		}
	}
}

// NATS headers are the transport for the same trace context between services.
func TestNATSHeaders_CarryTheTraceAcrossAPublish(t *testing.T) {
	ctx, span := tracedContext(t)

	hdr := nats.Header{}
	InjectNATSHeaders(ctx, hdr)
	if hdr.Get("traceparent") == "" {
		t.Fatalf("no traceparent written into the headers: %v", hdr)
	}

	got := trace.SpanContextFromContext(ExtractNATSHeaders(context.Background(), hdr))
	if got.TraceID() != span.SpanContext().TraceID() {
		t.Errorf("trace id = %s, want %s", got.TraceID(), span.SpanContext().TraceID())
	}

	// A message with no headers must leave the context alone rather than
	// panicking on a nil map.
	base := context.Background()
	if ExtractNATSHeaders(base, nil) != base {
		t.Error("nil headers replaced the context")
	}
}

// The carrier adapts nats.Header, whose values are slices, to the single-value
// interface the propagator expects.
func TestNATSHeaderCarrier(t *testing.T) {
	c := natsHeaderCarrier(nats.Header{})

	if got := c.Get("traceparent"); got != "" {
		t.Errorf("Get on an absent key = %q, want empty", got)
	}
	c.Set("traceparent", "00-abc-def-01")
	c.Set("tracestate", "vendor=1")
	if got := c.Get("traceparent"); got != "00-abc-def-01" {
		t.Errorf("Get = %q, want the value just set", got)
	}
	// Multi-valued headers read as the first value, not a joined string.
	nats.Header(c).Add("baggage", "a=1")
	nats.Header(c).Add("baggage", "b=2")
	if got := c.Get("baggage"); got != "a=1" {
		t.Errorf("Get on a multi-valued key = %q, want the first value", got)
	}

	keys := c.Keys()
	if len(keys) != 3 {
		t.Errorf("Keys() = %v, want three", keys)
	}
	seen := map[string]bool{}
	for _, k := range keys {
		seen[k] = true
	}
	// nats.Header does not canonicalise, unlike net/http, so keys come back
	// exactly as the propagator wrote them.
	for _, want := range []string{"traceparent", "tracestate", "baggage"} {
		if !seen[want] {
			t.Errorf("Keys() is missing %q: %v", want, keys)
		}
	}
}

func TestEnvDefault(t *testing.T) {
	tests := []struct {
		name     string
		set      bool
		value    string
		fallback string
		want     string
	}{
		{name: "unset falls back", fallback: "http://localhost:4318", want: "http://localhost:4318"},
		{name: "set wins", set: true, value: "http://collector:4318", fallback: "http://localhost:4318", want: "http://collector:4318"},
		// An explicitly empty variable is treated as unset, so a blank entry in
		// a compose file does not point the exporter at nothing.
		{name: "set to empty falls back", set: true, value: "", fallback: "0.0.1", want: "0.0.1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			const key = "PAYMENT_SERVICE_TEST_ENV"
			if tt.set {
				t.Setenv(key, tt.value)
			}
			if got := envDefault(key, tt.fallback); got != tt.want {
				t.Errorf("envDefault = %q, want %q", got, tt.want)
			}
		})
	}
}

/*
Init installs the global providers and hands back a shutdown. The contract
main.go depends on is that the shutdown is non-nil and safe to call whichever
way Init went, because main defers the call before it checks the error - a nil
one would panic every process exit.

The early return at resource.Merge that used to make most of Init unreachable
is fixed, in packages/go-observability/otel.go: the semconv import now matches
the schema the pinned SDK builds resource.Default() from. Init reaches the
exporters, so the coverage note that used to sit here no longer applies.

That fix did turn this test red, contrary to what the note predicted. Once Init
succeeds, the shutdown it returns is a real one that flushes the last batch, and
the flush reports a refused connection because no collector is listening. The
call stays - it is the contract being tested - but its error is no longer
asserted, because requiring nil there asserts a collector is up.
*/
func TestInit_AlwaysReturnsACallableShutdown(t *testing.T) {
	for _, disabled := range []string{"true", "false"} {
		t.Run("OTEL_DISABLED="+disabled, func(t *testing.T) {
			t.Setenv("OTEL_DISABLED", disabled)
			t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:14318")
			t.Setenv("SERVICE_VERSION", "1.2.3")
			t.Setenv("DEPLOYMENT_ENV", "test")

			shutdown, _ := Init(context.Background(), "payment-service")
			if shutdown == nil {
				t.Fatal("Init returned no shutdown function; main defers it unconditionally")
			}

			shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			// Not asserted on: see the export-flush note above.
			_ = shutdown(shutdownCtx)
		})
	}

	// The short-circuit is the one branch with a documented contract: it must
	// succeed outright, so tests and offline runs buffer nothing.
	t.Setenv("OTEL_DISABLED", "true")
	if _, err := Init(context.Background(), "payment-service"); err != nil {
		t.Errorf("OTEL_DISABLED=true returned %v, want no error", err)
	}
}
