package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"log/slog"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/bytz/notification-service/internal/idempotency"
)

// Redis is optional. Every way of not having it must degrade to NoOp rather
// than return nil, which the consumer would dereference on the first Claim.
func TestNewIdempotency_DegradesToNoOp(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{"empty url", ""},
		{"unparseable url", "not-a-redis-url"},
		{"wrong scheme", "http://localhost:6379"},
		{"nothing listening", "redis://127.0.0.1:1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := newIdempotency(context.Background(), tt.url)
			if got == nil {
				t.Fatal("returned nil; the first Claim would panic")
			}
			if _, ok := got.(idempotency.NoOp); !ok {
				t.Errorf("backend = %T, want idempotency.NoOp", got)
			}
		})
	}
}

// A reachable Redis must produce the real store, not the silent fallback.
func TestNewIdempotency_UsesRedisWhenReachable(t *testing.T) {
	mr := miniredis.RunT(t)

	got := newIdempotency(context.Background(), "redis://"+mr.Addr())
	if got == nil {
		t.Fatal("returned nil")
	}
	if _, ok := got.(idempotency.NoOp); ok {
		t.Fatal("fell back to NoOp with Redis up; duplicate events would be reprocessed")
	}

	// Prove it is wired to that server: a claim must be visible in it.
	acquired, err := got.Claim(context.Background(), "evt-1")
	if err != nil {
		t.Fatalf("Claim error = %v", err)
	}
	if !acquired {
		t.Error("first claim was not acquired")
	}
	again, err := got.Claim(context.Background(), "evt-1")
	if err != nil {
		t.Fatalf("second Claim error = %v", err)
	}
	if again {
		t.Error("the same event id was claimed twice; redelivery would notify twice")
	}
}

/*
run wires the process together and must fail fast rather than start serving on
a broken configuration. A notification service that binds its port without a
database accepts events it cannot record: the JetStream consumer acks them and
the notification is gone.

Only the failing paths are reachable without live infrastructure. Everything
past the database ping - the consumer, the Fiber app, the listener, the
shutdown ordering - needs a real Postgres and NATS, and is exercised by the
compose stack instead.
*/
func TestRun_FailsFastOnBrokenConfiguration(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{
			name:    "no database url",
			env:     map[string]string{"DATABASE_URL": ""},
			wantErr: "load config: DATABASE_URL is required",
		},
		{
			name:    "unparseable port",
			env:     map[string]string{"DATABASE_URL": "postgres://u:p@127.0.0.1:1/db", "PORT": "not-a-number"},
			wantErr: "load config: invalid PORT",
		},
		{
			name:    "unparseable database url",
			env:     map[string]string{"DATABASE_URL": "not-a-dsn"},
			wantErr: "connect to database",
		},
		{
			name:    "database unreachable",
			env:     map[string]string{"DATABASE_URL": "postgres://u:p@127.0.0.1:1/db"},
			wantErr: "ping database",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Telemetry is not what is under test, and its exporters would
			// otherwise buffer for a collector that is not there.
			t.Setenv("OTEL_DISABLED", "true")
			t.Setenv("PORT", "")
			for k, v := range tt.env {
				t.Setenv(k, v)
			}

			err := run()
			if err == nil {
				t.Fatal("run started the service on a broken configuration")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want it to mention %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// main must turn a fatal startup error into a non-zero exit. Exiting zero would
// look like a clean shutdown to Docker, so a container that can never serve
// traffic would not be restarted or reported as failed.
func TestMain_ExitsNonZeroWhenRunFails(t *testing.T) {
	if os.Getenv("NOTIFICATION_SERVICE_MAIN_UNDER_TEST") == "1" {
		main()
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=TestMain_ExitsNonZeroWhenRunFails")
	cmd.Env = append(os.Environ(),
		"NOTIFICATION_SERVICE_MAIN_UNDER_TEST=1",
		"OTEL_DISABLED=true",
		"DATABASE_URL=postgres://u:p@127.0.0.1:1/db",
	)
	output, err := cmd.CombinedOutput()

	var exitErr *exec.ExitError
	if err == nil {
		t.Fatalf("main exited zero on a fatal error:\n%s", output)
	}
	if !errors.As(err, &exitErr) {
		t.Fatalf("main did not exit: %v", err)
	}
	if code := exitErr.ExitCode(); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if !strings.Contains(string(output), "fatal") {
		t.Errorf("the fatal error was not logged:\n%s", output)
	}
}

// writeCAFile writes a self-signed CA and returns its path. Loading a CA while
// the endpoint is still plain http is the one exporter misconfiguration the
// OTLP SDK reports instead of swallowing, so it is how a failing
// observability.Init is staged here. The certificate has to parse for the SDK
// to install a TLS config at all.
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
Telemetry is optional; delivering the notifications a milestone approval depends on is not. run downgrades both telemetry failures
to a log line and carries on, and that has to stay true in both directions:
neither an exporter it cannot build nor a collector that is down may stop the
service booting or turn an ordinary shutdown into a crash.

Each case asserts run still failed on the database, which is the first thing
past the telemetry block. A change turning either log into a returned error
would surface here as an otel error in place of the ping - the failure being
guarded against, rather than a coverage detail.

The log line is asserted too. Neither failure is returned to anyone, so it is
the only evidence an operator has for why traces stopped arriving - the
silent-telemetry symptom the observability package documents.
*/
func TestRun_TelemetryFailureDoesNotStopTheService(t *testing.T) {
	tests := []struct {
		name string
		// A CA loaded against a plain-http endpoint is the one exporter
		// misconfiguration the OTLP SDK reports rather than swallows, so it is
		// how Init is made to fail. Without it Init succeeds and the failure
		// moves to the deferred flush, which has no collector to reach.
		breakExporter bool
		wantLog       string
	}{
		{name: "exporter cannot be built", breakExporter: true, wantLog: "otel init failed"},
		{name: "flush finds no collector at shutdown", breakExporter: false, wantLog: "otel shutdown"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("OTEL_DISABLED", "false")
			// Nothing listens here, which is what makes the deferred flush fail.
			t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:14318")
			if tt.breakExporter {
				t.Setenv("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", writeCAFile(t))
			}
			t.Setenv("PORT", "")
			t.Setenv("DATABASE_URL", "postgres://u:p@127.0.0.1:1/db")

			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelWarn})))
			t.Cleanup(func() { slog.SetDefault(previous) })

			err := run()

			if err == nil {
				t.Fatal("run returned no error; it cannot have reached the unreachable database")
			}
			if !strings.Contains(err.Error(), "ping database") {
				t.Errorf("error = %q, want the database failure; a telemetry error here means run stopped booting over optional telemetry", err)
			}
			if !strings.Contains(logs.String(), tt.wantLog) {
				t.Errorf("telemetry failure was not logged as %q; nothing else records it:\n%s", tt.wantLog, logs.String())
			}
		})
	}
}
