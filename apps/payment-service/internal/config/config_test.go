package config

import (
	"os"
	"testing"
)

// clearEnv unsets all config-related environment variables.
func clearEnv(t *testing.T) {
	t.Helper()
	envVars := []string{
		"DATABASE_URL", "PORT", "CORS_ORIGIN", "PROJECT_SERVICE_URL",
		"AUTH_SERVICE_URL", "MIDTRANS_IS_SANDBOX", "MIDTRANS_SERVER_KEY",
		"MIDTRANS_CLIENT_KEY", "SERVICE_AUTH_SECRET",
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
	if cfg.Port != "3004" {
		t.Errorf("Port = %q, want %q", cfg.Port, "3004")
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
	if cfg.Port != "9090" {
		t.Errorf("Port = %q, want %q", cfg.Port, "9090")
	}
}

func TestLoad_SandboxURL(t *testing.T) {
	tests := []struct {
		name       string
		sandboxEnv string
		wantURL    string
	}{
		{
			name:       "default (no env set) uses sandbox",
			sandboxEnv: "",
			wantURL:    "https://app.sandbox.midtrans.com/snap/v1/transactions",
		},
		{
			name:       "explicit true uses sandbox",
			sandboxEnv: "true",
			wantURL:    "https://app.sandbox.midtrans.com/snap/v1/transactions",
		},
		{
			name:       "value 1 uses sandbox",
			sandboxEnv: "1",
			wantURL:    "https://app.sandbox.midtrans.com/snap/v1/transactions",
		},
		{
			name:       "random string uses sandbox",
			sandboxEnv: "yes",
			wantURL:    "https://app.sandbox.midtrans.com/snap/v1/transactions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("DATABASE_URL", "postgres://localhost/test")
			if tt.sandboxEnv != "" {
				t.Setenv("MIDTRANS_IS_SANDBOX", tt.sandboxEnv)
			}

			cfg, err := Load()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.MidtransSnapURL != tt.wantURL {
				t.Errorf("MidtransSnapURL = %q, want %q", cfg.MidtransSnapURL, tt.wantURL)
			}
			if !cfg.MidtransIsSandbox {
				t.Error("MidtransIsSandbox = false, want true")
			}
		})
	}
}

func TestLoad_ProductionURL(t *testing.T) {
	tests := []struct {
		name       string
		sandboxEnv string
		wantURL    string
	}{
		{
			name:       "false uses production",
			sandboxEnv: "false",
			wantURL:    "https://app.midtrans.com/snap/v1/transactions",
		},
		{
			name:       "FALSE uses production",
			sandboxEnv: "FALSE",
			wantURL:    "https://app.midtrans.com/snap/v1/transactions",
		},
		{
			name:       "False uses production",
			sandboxEnv: "False",
			wantURL:    "https://app.midtrans.com/snap/v1/transactions",
		},
		{
			name:       "0 uses production",
			sandboxEnv: "0",
			wantURL:    "https://app.midtrans.com/snap/v1/transactions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("DATABASE_URL", "postgres://localhost/test")
			t.Setenv("MIDTRANS_IS_SANDBOX", tt.sandboxEnv)

			cfg, err := Load()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.MidtransSnapURL != tt.wantURL {
				t.Errorf("MidtransSnapURL = %q, want %q", cfg.MidtransSnapURL, tt.wantURL)
			}
			if cfg.MidtransIsSandbox {
				t.Error("MidtransIsSandbox = true, want false")
			}
		})
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
	t.Setenv("CORS_ORIGIN", "https://bytz.id")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CORSOrigin != "https://bytz.id" {
		t.Errorf("CORSOrigin = %q, want %q", cfg.CORSOrigin, "https://bytz.id")
	}
}

func TestLoad_DefaultProjectServiceURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://localhost/test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ProjectServiceURL != "http://localhost:3002" {
		t.Errorf("ProjectServiceURL = %q, want %q", cfg.ProjectServiceURL, "http://localhost:3002")
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

func TestLoad_FullConfig(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_URL", "postgres://prod:secret@db.example.com:5432/bytz")
	t.Setenv("PORT", "8080")
	t.Setenv("CORS_ORIGIN", "https://app.bytz.id")
	t.Setenv("PROJECT_SERVICE_URL", "http://project-svc:3002")
	t.Setenv("AUTH_SERVICE_URL", "http://auth-svc:3001")
	t.Setenv("MIDTRANS_IS_SANDBOX", "false")
	t.Setenv("MIDTRANS_SERVER_KEY", "SB-Mid-server-xxx")
	t.Setenv("MIDTRANS_CLIENT_KEY", "SB-Mid-client-yyy")
	t.Setenv("SERVICE_AUTH_SECRET", "shared-secret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.DatabaseURL != "postgres://prod:secret@db.example.com:5432/bytz" {
		t.Errorf("DatabaseURL mismatch")
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}
	if cfg.CORSOrigin != "https://app.bytz.id" {
		t.Errorf("CORSOrigin = %q, want %q", cfg.CORSOrigin, "https://app.bytz.id")
	}
	if cfg.ProjectServiceURL != "http://project-svc:3002" {
		t.Errorf("ProjectServiceURL mismatch")
	}
	if cfg.AuthServiceURL != "http://auth-svc:3001" {
		t.Errorf("AuthServiceURL mismatch")
	}
	if cfg.MidtransIsSandbox {
		t.Error("MidtransIsSandbox = true, want false")
	}
	if cfg.MidtransSnapURL != "https://app.midtrans.com/snap/v1/transactions" {
		t.Errorf("MidtransSnapURL = %q, want production URL", cfg.MidtransSnapURL)
	}
	if cfg.MidtransServerKey != "SB-Mid-server-xxx" {
		t.Errorf("MidtransServerKey mismatch")
	}
	if cfg.MidtransClientKey != "SB-Mid-client-yyy" {
		t.Errorf("MidtransClientKey mismatch")
	}
	if cfg.ServiceAuthSecret != "shared-secret" {
		t.Errorf("ServiceAuthSecret mismatch")
	}
}
