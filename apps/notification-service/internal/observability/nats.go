package observability

import (
	"context"

	"github.com/nats-io/nats.go"
	"go.opentelemetry.io/otel"
)

// natsHeaderCarrier adapts nats.Header to TextMapCarrier.
type natsHeaderCarrier nats.Header

func (c natsHeaderCarrier) Get(key string) string {
	vs := nats.Header(c).Values(key)
	if len(vs) == 0 {
		return ""
	}
	return vs[0]
}

func (c natsHeaderCarrier) Set(key, value string) {
	nats.Header(c).Set(key, value)
}

func (c natsHeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	return keys
}

// InjectNATSHeaders writes the active span context into nats headers.
func InjectNATSHeaders(ctx context.Context, hdr nats.Header) {
	otel.GetTextMapPropagator().Inject(ctx, natsHeaderCarrier(hdr))
}

// ExtractNATSHeaders pulls trace context from nats headers into ctx.
func ExtractNATSHeaders(ctx context.Context, hdr nats.Header) context.Context {
	if hdr == nil {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, natsHeaderCarrier(hdr))
}
