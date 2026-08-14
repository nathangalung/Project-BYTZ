"""OTEL bootstrap: endpoint wiring, idempotency, and shutdown.

Every global this function touches is stubbed. trace.set_tracer_provider,
metrics.set_meter_provider and propagate.set_global_textmap are process-wide
and effectively write-once, and BatchSpanProcessor starts an exporter thread.
Letting any of them run for real would reconfigure telemetry for every other
test in the session and leave a thread posting spans at localhost:4318, so the
providers, the exporters and the three setters are all replaced here.

What is worth pinning: the endpoint suffixes, because CLAUDE.md is explicit
that our exporters are HTTP and the OTLP path is :5080/api/{org} rather than
the gRPC port; and the composite propagator, because the NATS consumer
restores its parent span from a W3C traceparent header that this call is what
configures.
"""

from unittest.mock import MagicMock

import pytest

from app.observability import otel


@pytest.fixture
def otel_stubs(monkeypatch):
    """Replace every global-mutating symbol and reset the module singletons."""
    monkeypatch.delenv("OTEL_DISABLED", raising=False)
    otel._tracer_provider = None
    otel._meter_provider = None

    stubs = {
        name: MagicMock(name=name)
        for name in (
            "TracerProvider",
            "BatchSpanProcessor",
            "OTLPSpanExporter",
            "MeterProvider",
            "PeriodicExportingMetricReader",
            "OTLPMetricExporter",
            "trace",
            "metrics",
            "propagate",
        )
    }
    for name, stub in stubs.items():
        monkeypatch.setattr(otel, name, stub)

    yield stubs

    otel._tracer_provider = None
    otel._meter_provider = None


class TestInit:
    def test_disabled_is_a_noop(self, monkeypatch):
        """The whole test suite runs under this flag, so it has to short-circuit."""
        monkeypatch.setenv("OTEL_DISABLED", "true")
        otel.init_otel("ai-service")
        assert otel._tracer_provider is None

    def test_providers_are_installed(self, otel_stubs):
        otel.init_otel("ai-service")

        assert otel._tracer_provider is otel_stubs["TracerProvider"].return_value
        assert otel._meter_provider is otel_stubs["MeterProvider"].return_value
        otel_stubs["trace"].set_tracer_provider.assert_called_once_with(otel._tracer_provider)
        otel_stubs["metrics"].set_meter_provider.assert_called_once_with(otel._meter_provider)

    def test_the_signal_paths_are_appended_to_the_base_endpoint(self, otel_stubs, monkeypatch):
        """OTEL_EXPORTER_OTLP_ENDPOINT is the base; each signal adds its own path."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://openobserve:5080/api/default")

        otel.init_otel("ai-service")

        assert otel_stubs["OTLPSpanExporter"].call_args.kwargs["endpoint"] == (
            "http://openobserve:5080/api/default/v1/traces"
        )
        assert otel_stubs["OTLPMetricExporter"].call_args.kwargs["endpoint"] == (
            "http://openobserve:5080/api/default/v1/metrics"
        )

    def test_the_endpoint_defaults_to_a_local_collector(self, otel_stubs, monkeypatch):
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
        otel.init_otel("ai-service")
        assert otel_stubs["OTLPSpanExporter"].call_args.kwargs["endpoint"] == (
            "http://localhost:4318/v1/traces"
        )

    def test_the_resource_identifies_the_service(self, otel_stubs, monkeypatch):
        monkeypatch.setenv("SERVICE_VERSION", "1.4.2")
        monkeypatch.setenv("DEPLOYMENT_ENV", "production")

        otel.init_otel("ai-service")

        resource = otel_stubs["TracerProvider"].call_args.kwargs["resource"]
        attributes = dict(resource.attributes)
        assert attributes["service.name"] == "ai-service"
        assert attributes["service.version"] == "1.4.2"
        assert attributes["deployment.environment"] == "production"

    def test_deployment_env_falls_back_to_node_env(self, otel_stubs, monkeypatch):
        """Compose sets NODE_ENV for the TypeScript services; one variable serves both."""
        monkeypatch.delenv("DEPLOYMENT_ENV", raising=False)
        monkeypatch.setenv("NODE_ENV", "staging")

        otel.init_otel("ai-service")

        resource = otel_stubs["TracerProvider"].call_args.kwargs["resource"]
        assert dict(resource.attributes)["deployment.environment"] == "staging"

    def test_the_environment_defaults_to_development(self, otel_stubs, monkeypatch):
        monkeypatch.delenv("DEPLOYMENT_ENV", raising=False)
        monkeypatch.delenv("NODE_ENV", raising=False)
        monkeypatch.delenv("SERVICE_VERSION", raising=False)

        otel.init_otel("ai-service")

        resource = otel_stubs["TracerProvider"].call_args.kwargs["resource"]
        attributes = dict(resource.attributes)
        assert attributes["deployment.environment"] == "development"
        assert attributes["service.version"] == "0.0.1"

    def test_spans_are_batched_rather_than_sent_one_at_a_time(self, otel_stubs):
        """A span per request on the hot path would put an HTTP POST inside it."""
        otel.init_otel("ai-service")

        otel_stubs["BatchSpanProcessor"].assert_called_once_with(
            otel_stubs["OTLPSpanExporter"].return_value
        )
        otel._tracer_provider.add_span_processor.assert_called_once_with(
            otel_stubs["BatchSpanProcessor"].return_value
        )

    def test_metrics_are_exported_on_a_fixed_interval(self, otel_stubs):
        otel.init_otel("ai-service")
        kwargs = otel_stubs["PeriodicExportingMetricReader"].call_args.kwargs
        assert kwargs["export_interval_millis"] == 30_000

    def test_the_propagator_carries_both_trace_context_and_baggage(self, otel_stubs):
        """The NATS consumer extracts a W3C traceparent from message headers.

        Without tracecontext in the global propagator that extract returns an
        empty context, and every consumer span becomes a new trace root -
        which is precisely the cross-service link it exists to preserve.
        """
        otel.init_otel("ai-service")

        composite = otel_stubs["propagate"].set_global_textmap.call_args.args[0]
        names = {type(p).__name__ for p in composite._propagators}
        assert "TraceContextTextMapPropagator" in names
        assert "W3CBaggagePropagator" in names

    def test_a_second_call_does_not_reconfigure_telemetry(self, otel_stubs):
        """set_tracer_provider is write-once; a second call logs an override warning."""
        otel.init_otel("ai-service")
        otel.init_otel("ai-service")

        assert otel_stubs["TracerProvider"].call_count == 1
        assert otel_stubs["trace"].set_tracer_provider.call_count == 1


class TestShutdown:
    def test_both_providers_are_flushed_and_cleared(self, otel_stubs):
        """Shutdown flushes pending spans; skipping it drops the last batch."""
        otel.init_otel("ai-service")
        tracer_provider = otel._tracer_provider
        meter_provider = otel._meter_provider

        otel.shutdown_otel()

        tracer_provider.shutdown.assert_called_once()
        meter_provider.shutdown.assert_called_once()
        assert otel._tracer_provider is None
        assert otel._meter_provider is None

    def test_shutdown_without_init_is_a_noop(self, otel_stubs):
        """Lifespan teardown runs even when startup short-circuited on OTEL_DISABLED."""
        otel.shutdown_otel()
        assert otel._tracer_provider is None

    def test_init_can_follow_a_shutdown(self, otel_stubs):
        """Clearing the singleton is what lets the guard admit a fresh provider."""
        otel.init_otel("ai-service")
        otel.shutdown_otel()
        otel.init_otel("ai-service")

        assert otel_stubs["TracerProvider"].call_count == 2
        assert otel._tracer_provider is not None
