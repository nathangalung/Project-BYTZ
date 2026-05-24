package observability

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

// Serialize active trace context for JSONB persistence.
func CaptureTraceContext(ctx context.Context) map[string]string {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if len(carrier) == 0 {
		return nil
	}
	return carrier
}

// Rehydrate persisted carrier into ctx.
func RestoreTraceContext(ctx context.Context, m map[string]string) context.Context {
	if len(m) == 0 {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, propagation.MapCarrier(m))
}
