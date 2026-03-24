package config

import (
	"os"
	"testing"
)

// clearEnv unsets all config-related environment variables.
func clearEnv(t *testing.T) {
	t.Helper()
	envVars := []string{
		"DATABASE_URL", "PORT", "NATS_URL", "RESEND_API_KEY",
		"CENTRIFUGO_URL", "CENTRIFUGO_API_KEY", "CORS_ORIGIN",
		"AUTH_SERVICE_URL", "SERVICE_AUTH_SECRET",
	}
	for _, key := range envVars {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}
}

func TestLoad_RequiresDatabaseURL(t *testing.T) {
	clearEnv(t)

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when DATABASE_URL is missing, got nil")
	}
	if err.Error() != "DATABASE_URL is required" {
		t.Errorf("error = %q, want %q", err.Error(), "DATABASE_URL is required")
	}
}

func TestLoad_DefaultPort(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != 3005 {
		t.Errorf("Port = %d, want %d", cfg.Port, 3005)
	}
}

func TestLoad_CustomPort(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("PORT", "7070")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != 7070 {
		t.Errorf("Port = %d, want %d", cfg.Port, 7070)
	}
}

func TestLoad_InvalidPort(t *testing.T) {
	tests := []struct {
		name    string
		portVal string
	}{
		{"non-numeric port", "abc"},
		{"float port", "3.14"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("DATABASE_URL", "postgres://localhost/test")
			t.Setenv("PORT", tt.portVal)

			_, err := Load()
			if err == nil {
				t.Fatal("expected error for invalid PORT, got nil")
			}
		})
	}
}

func TestLoad_DefaultNatsURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.NatsURL != "nats://localhost:4222" {
		t.Errorf("NatsURL = %q, want %q", cfg.NatsURL, "nats://localhost:4222")
	}
}

func TestLoad_CustomNatsURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("NATS_URL", "nats://nats-server:4222")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.NatsURL != "nats://nats-server:4222" {
		t.Errorf("NatsURL = %q, want %q", cfg.NatsURL, "nats://nats-server:4222")
	}
}

func TestLoad_DefaultCORSOrigin(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CorsOrigin != "http://localhost:5173" {
		t.Errorf("CorsOrigin = %q, want %q", cfg.CorsOrigin, "http://localhost:5173")
	}
}

func TestLoad_DefaultAuthServiceURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AuthServiceURL != "http://localhost:3001" {
		t.Errorf("AuthServiceURL = %q, want %q", cfg.AuthServiceURL, "http://localhost:3001")
	}
}

func TestLoad_OptionalFields(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("RESEND_API_KEY", "re_test123")
	t.Setenv("CENTRIFUGO_URL", "http://centrifugo:8000")
	t.Setenv("CENTRIFUGO_API_KEY", "centrifugo-key")
	t.Setenv("SERVICE_AUTH_SECRET", "shared-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ResendAPIKey != "re_test123" {
		t.Errorf("ResendAPIKey = %q, want %q", cfg.ResendAPIKey, "re_test123")
	}
	if cfg.CentrifugoURL != "http://centrifugo:8000" {
		t.Errorf("CentrifugoURL = %q, want %q", cfg.CentrifugoURL, "http://centrifugo:8000")
	}
	if cfg.CentrifugoAPIKey != "centrifugo-key" {
		t.Errorf("CentrifugoAPIKey = %q, want %q", cfg.CentrifugoAPIKey, "centrifugo-key")
	}
	if cfg.ServiceAuthSecret != "shared-secret" {
		t.Errorf("ServiceAuthSecret = %q, want %q", cfg.ServiceAuthSecret, "shared-secret")
	}
}

func TestLoad_FullConfig(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://prod:pass@db:5432/bytz")
	t.Setenv("PORT", "8080")
	t.Setenv("NATS_URL", "nats://nats:4222")
	t.Setenv("RESEND_API_KEY", "re_prod")
	t.Setenv("CENTRIFUGO_URL", "http://centrifugo:8000")
	t.Setenv("CENTRIFUGO_API_KEY", "centrifugo-prod-key")
	t.Setenv("CORS_ORIGIN", "https://bytz.id")
	t.Setenv("AUTH_SERVICE_URL", "http://auth:3001")
	t.Setenv("SERVICE_AUTH_SECRET", "prod-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want %d", cfg.Port, 8080)
	}
	if cfg.DatabaseURL != "postgres://prod:pass@db:5432/bytz" {
		t.Errorf("DatabaseURL mismatch")
	}
	if cfg.NatsURL != "nats://nats:4222" {
		t.Errorf("NatsURL = %q, want %q", cfg.NatsURL, "nats://nats:4222")
	}
	if cfg.ResendAPIKey != "re_prod" {
		t.Errorf("ResendAPIKey mismatch")
	}
	if cfg.CentrifugoURL != "http://centrifugo:8000" {
		t.Errorf("CentrifugoURL mismatch")
	}
	if cfg.CentrifugoAPIKey != "centrifugo-prod-key" {
		t.Errorf("CentrifugoAPIKey mismatch")
	}
	if cfg.CorsOrigin != "https://bytz.id" {
		t.Errorf("CorsOrigin = %q, want %q", cfg.CorsOrigin, "https://bytz.id")
	}
	if cfg.AuthServiceURL != "http://auth:3001" {
		t.Errorf("AuthServiceURL = %q, want %q", cfg.AuthServiceURL, "http://auth:3001")
	}
	if cfg.ServiceAuthSecret != "prod-secret" {
		t.Errorf("ServiceAuthSecret mismatch")
	}
}
