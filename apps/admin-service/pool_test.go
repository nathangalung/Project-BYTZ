package main

import (
	"testing"
	"time"
)

// The production DSN, shape for shape, including the pgx query parameter that
// keeps this service usable through pgbouncer's transaction pooling. A
// ParseConfig failure on it would take the service down at boot.
const prodDSN = "postgresql://kerjacus:secret@pgbouncer:5432/kerjacus?sslmode=disable&default_query_exec_mode=exec"

func TestNewPoolConfigSizesTheBudget(t *testing.T) {
	t.Parallel()

	cfg, err := newPoolConfig(prodDSN)
	if err != nil {
		t.Fatalf("newPoolConfig: %v", err)
	}

	tests := []struct {
		name string
		got  any
		want any
	}{
		{"MaxConns", cfg.MaxConns, int32(4)},
		{"MinConns", cfg.MinConns, int32(1)},
		{"MaxConnLifetime", cfg.MaxConnLifetime, 30 * time.Minute},
		{"MaxConnIdleTime", cfg.MaxConnIdleTime, 5 * time.Minute},
		{"HealthCheckPeriod", cfg.HealthCheckPeriod, 30 * time.Second},
	}
	for _, tt := range tests {
		if tt.got != tt.want {
			t.Errorf("%s = %v, want %v", tt.name, tt.got, tt.want)
		}
	}
}

// pgxpool's own default is max(4, NumCPU), which makes the ceiling a property
// of the host. The point of the fix is that it is not.
func TestNewPoolConfigIsHostIndependent(t *testing.T) {
	t.Parallel()

	cfg, err := newPoolConfig(prodDSN)
	if err != nil {
		t.Fatalf("newPoolConfig: %v", err)
	}
	if cfg.MaxConns > 8 {
		t.Errorf("MaxConns = %d; the pgbouncer budget allows at most 8 per Go service", cfg.MaxConns)
	}
	if cfg.MinConns > cfg.MaxConns {
		t.Errorf("MinConns %d exceeds MaxConns %d", cfg.MinConns, cfg.MaxConns)
	}
}

func TestNewPoolConfigKeepsTheExecQueryMode(t *testing.T) {
	t.Parallel()

	cfg, err := newPoolConfig(prodDSN)
	if err != nil {
		t.Fatalf("newPoolConfig: %v", err)
	}
	if got := cfg.ConnConfig.DefaultQueryExecMode.String(); got != "exec" {
		t.Errorf("DefaultQueryExecMode = %q, want %q", got, "exec")
	}
}

func TestNewPoolConfigRejectsAnUnparseableDSN(t *testing.T) {
	t.Parallel()

	if _, err := newPoolConfig("://not a dsn"); err == nil {
		t.Fatal("expected an error for an unparseable DSN")
	}
}
