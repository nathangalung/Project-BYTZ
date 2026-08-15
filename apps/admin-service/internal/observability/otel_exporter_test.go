package observability

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
)

// writeCAFile writes a self-signed CA and returns its path. It has to be a
// certificate that actually parses: the SDK only installs a TLS config when the
// PEM loads, so a junk file would leave the branch under test unreachable.
func writeCAFile(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "otel-test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	path := filepath.Join(t.TempDir(), "ca.pem")
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(path, pemBytes, 0o600); err != nil {
		t.Fatalf("write certificate: %v", err)
	}
	return path
}

/*
A CA pointed at a plain-http endpoint is the one exporter misconfiguration the
SDK reports instead of swallowing, and it is a realistic half-migration:
OTEL_EXPORTER_OTLP_ENDPOINT still names the http listener while the certificate
for the TLS one is already in the environment.

It is worth pinning because the alternative symptom is the one the schema note
in this package describes - telemetry silently absent and OpenObserve empty.
main.go downgrades Init's error to a Warn and serves on, so that error string is
the only operator-visible signal, and it has to say which of the two exporters
failed rather than just that telemetry is off.

Malformed endpoints and unreadable certificate files are deliberately not
tested: otlpconfig.WithEndpointURL and envconfig.WithCertPool route both to the
SDK's global error handler and hand back a working exporter, so Init has no
error to return and the branch stays unreachable through them. Checked against
the exporters at the pinned v1.43.0.

This lives per service rather than in the generator because half of what it
asserts is this service's main.go contract: the deferred shutdown is called
whether or not Init failed.
*/
func TestInit_ReportsWhichExporterItCouldNotBuild(t *testing.T) {
	tests := []struct {
		name    string
		certEnv string
		wantErr string
	}{
		{
			name:    "trace exporter fails first",
			certEnv: "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE",
			wantErr: "otel trace exporter",
		},
		{
			// Metrics are built after traces, so this is the branch that has an
			// already-constructed trace exporter to shut down rather than leak.
			name:    "metric exporter fails after the trace exporter is built",
			certEnv: "OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE",
			wantErr: "otel metric exporter",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("OTEL_DISABLED", "false")
			t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:14318")
			t.Setenv(tt.certEnv, writeCAFile(t))

			// A failed Init must not install half a telemetry stack. Captured
			// either side of the call rather than compared to a constant, so
			// the assertion holds whatever an earlier test left installed.
			tracerBefore := otel.GetTracerProvider()
			meterBefore := otel.GetMeterProvider()

			shutdown, err := Init(context.Background(), "admin-service")

			if err == nil {
				t.Fatal("Init succeeded on a TLS/endpoint mismatch; the service would boot believing telemetry works")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want it to name %q so an operator knows which exporter to fix", err, tt.wantErr)
			}

			// main defers the shutdown unconditionally - it warns on the error
			// and serves on - so a nil here turns a bad endpoint into a panic
			// during every subsequent shutdown.
			if shutdown == nil {
				t.Fatal("Init returned a nil shutdown alongside its error; main defers it unconditionally")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := shutdown(ctx); err != nil {
				t.Errorf("shutdown after a failed Init returned %v, want nil", err)
			}

			if otel.GetTracerProvider() != tracerBefore {
				t.Error("a failed Init replaced the global tracer provider")
			}
			if otel.GetMeterProvider() != meterBefore {
				t.Error("a failed Init replaced the global meter provider")
			}
		})
	}
}
