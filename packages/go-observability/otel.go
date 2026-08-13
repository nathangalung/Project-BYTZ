package observability

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Init wires OpenTelemetry tracing and metrics into the global providers.
// Returns a shutdown func; caller must invoke it on process exit.
// Set OTEL_DISABLED=true to short-circuit (useful for tests and offline runs).
func Init(ctx context.Context, service string) (func(context.Context) error, error) {
	noop := func(context.Context) error { return nil }
	if os.Getenv("OTEL_DISABLED") == "true" {
		return noop, nil
	}

	endpoint := envDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
	version := envDefault("SERVICE_VERSION", "0.0.1")
	env := envDefault("DEPLOYMENT_ENV", "development")

	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(service),
		semconv.ServiceVersion(version),
		semconv.DeploymentEnvironment(env),
	))
	if err != nil {
		return noop, fmt.Errorf("otel resource: %w", err)
	}

	traceExp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(endpoint+"/v1/traces"),
	)
	if err != nil {
		return noop, fmt.Errorf("otel trace exporter: %w", err)
	}

	metricExp, err := otlpmetrichttp.New(ctx,
		otlpmetrichttp.WithEndpointURL(endpoint+"/v1/metrics"),
	)
	if err != nil {
		_ = traceExp.Shutdown(ctx)
		return noop, fmt.Errorf("otel metric exporter: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(traceExp),
	)
	mp := metric.NewMeterProvider(
		metric.WithResource(res),
		metric.WithReader(metric.NewPeriodicReader(metricExp, metric.WithInterval(30*time.Second))),
	)

	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	slog.Info("otel initialized", "service", service, "endpoint", endpoint)

	return func(shutdownCtx context.Context) error {
		return errors.Join(
			tp.Shutdown(shutdownCtx),
			mp.Shutdown(shutdownCtx),
		)
	}, nil
}

func envDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
