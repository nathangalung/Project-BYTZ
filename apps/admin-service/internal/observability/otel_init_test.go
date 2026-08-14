package observability

import (
	"context"
	"testing"
	"time"
)

/*
Init used to return an error on every boot in all three Go services, and no
test noticed: main.go downgrades the failure to a slog.Warn and serves traffic
without telemetry, so the only symptom was an empty OpenObserve.

The cause was resource.Merge refusing to merge two different schema URLs - the
SDK's resource.Default() against the semconv version otel.go imports. That
makes it a compile-time-shaped bug with a runtime-only symptom: bumping
go.opentelemetry.io/otel/sdk moves Default()'s schema and silently breaks this
again. So the assertion is on Init's error, not on any schema constant, since a
constant restated here would drift with the import it is supposed to police.

One copy of this test, not three. otel.go is generated identically into all
three services from packages/go-observability, and all three pin the same
go.opentelemetry.io/otel/sdk, so the property is shared. If the pins ever
diverge per service, this needs to move into the generator and run everywhere.
*/
func TestInit_SucceedsWhenEnabled(t *testing.T) {
	t.Setenv("OTEL_DISABLED", "false")
	// A port nothing listens on: the OTLP HTTP exporters resolve their endpoint
	// at construction and only dial on export, so Init must not need a
	// collector to be up.
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:14318")

	shutdown, err := Init(context.Background(), "admin-service")
	if err != nil {
		t.Fatalf("Init returned %v; the service would boot with no traces and no metrics", err)
	}

	// Called to release the providers, not asserted on: a real shutdown flushes
	// the last batch, and with no collector listening that flush reports a
	// refused connection. Requiring nil here would assert a collector is up.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = shutdown(ctx)
}
