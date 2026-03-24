package config

import (
	"os"
	"testing"
)

// clearEnv unsets all config-related environment variables.
func clearEnv(t *testing.T) {
	t.Helper()
	envVars := []string{
		"DATABASE_URL", "PORT", "BETTER_AUTH_URL", "CORS_ORIGIN",
		"SERVICE_AUTH_SECRET",
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
	if cfg.Port != 3006 {
		t.Errorf("Port = %d, want %d", cfg.Port, 3006)
	}
}

func TestLoad_CustomPort(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("PORT", "9090")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != 9090 {
		t.Errorf("Port = %d, want %d", cfg.Port, 9090)
	}
}

func TestLoad_InvalidPort(t *testing.T) {
	tests := []struct {
		name    string
		portVal string
	}{
		{"non-numeric port", "abc"},
		{"float port", "3.14"},
		{"empty after spaces", " "},
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

func TestLoad_DefaultAuthURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AuthURL != "http://localhost:3001" {
		t.Errorf("AuthURL = %q, want %q", cfg.AuthURL, "http://localhost:3001")
	}
}

func TestLoad_CustomAuthURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("BETTER_AUTH_URL", "http://auth-svc:3001")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AuthURL != "http://auth-svc:3001" {
		t.Errorf("AuthURL = %q, want %q", cfg.AuthURL, "http://auth-svc:3001")
	}
}

func TestLoad_DefaultCORSOrigin(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CORSOrigin != "http://localhost:5173" {
		t.Errorf("CORSOrigin = %q, want %q", cfg.CORSOrigin, "http://localhost:5173")
	}
}

func TestLoad_CustomCORSOrigin(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("CORS_ORIGIN", "https://admin.bytz.id")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CORSOrigin != "https://admin.bytz.id" {
		t.Errorf("CORSOrigin = %q, want %q", cfg.CORSOrigin, "https://admin.bytz.id")
	}
}

func TestLoad_ServiceAuthSecret(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SERVICE_AUTH_SECRET", "super-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ServiceAuthSecret != "super-secret" {
		t.Errorf("ServiceAuthSecret = %q, want %q", cfg.ServiceAuthSecret, "super-secret")
	}
}

func TestLoad_FullConfig(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://prod:secret@db.example.com:5432/bytz")
	t.Setenv("PORT", "8080")
	t.Setenv("BETTER_AUTH_URL", "http://auth-svc:3001")
	t.Setenv("CORS_ORIGIN", "https://admin.bytz.id")
	t.Setenv("SERVICE_AUTH_SECRET", "shared-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.DatabaseURL != "postgres://prod:secret@db.example.com:5432/bytz" {
		t.Errorf("DatabaseURL mismatch")
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want %d", cfg.Port, 8080)
	}
	if cfg.AuthURL != "http://auth-svc:3001" {
		t.Errorf("AuthURL = %q, want %q", cfg.AuthURL, "http://auth-svc:3001")
	}
	if cfg.CORSOrigin != "https://admin.bytz.id" {
		t.Errorf("CORSOrigin = %q, want %q", cfg.CORSOrigin, "https://admin.bytz.id")
	}
	if cfg.ServiceAuthSecret != "shared-secret" {
		t.Errorf("ServiceAuthSecret = %q, want %q", cfg.ServiceAuthSecret, "shared-secret")
	}
}
