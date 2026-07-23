package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Production compose has to set the flag Load actually reads.
//
// docker-compose.prod.yml set MIDTRANS_SNAP_URL, which Load never looks at, and
// left MIDTRANS_IS_SANDBOX unset. Load defaults that to true, so production ran
// against app.sandbox.midtrans.com and no real payment could clear. The dead
// variable made it look configured.

func readProdCompose(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "docker-compose.prod.yml")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(body)
}

func TestProdComposeSetsSandboxFlag(t *testing.T) {
	compose := readProdCompose(t)

	if !strings.Contains(compose, "MIDTRANS_IS_SANDBOX:") {
		t.Error("docker-compose.prod.yml does not set MIDTRANS_IS_SANDBOX; Load defaults it to sandbox")
	}
}

func TestProdComposeHasNoDefaultForSandboxFlag(t *testing.T) {
	compose := readProdCompose(t)

	for _, line := range strings.Split(compose, "\n") {
		if !strings.Contains(line, "MIDTRANS_IS_SANDBOX:") {
			continue
		}
		// ":?" aborts the deploy when unset. ":-" would hide the choice again.
		if strings.Contains(line, ":-") {
			t.Errorf("MIDTRANS_IS_SANDBOX carries a silent default: %s", strings.TrimSpace(line))
		}
		if !strings.Contains(line, ":?") {
			t.Errorf("MIDTRANS_IS_SANDBOX is not required at deploy: %s", strings.TrimSpace(line))
		}
	}
}

func TestProdComposeDoesNotSetVariablesLoadIgnores(t *testing.T) {
	// Load builds the Snap URL from the sandbox flag. Setting the URL directly
	// reads as the control and is not one.
	for _, line := range strings.Split(readProdCompose(t), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.HasPrefix(trimmed, "MIDTRANS_SNAP_URL:") {
			t.Error("docker-compose.prod.yml sets MIDTRANS_SNAP_URL, which config.Load never reads")
		}
	}
}

// Fresh volume needs schema migrated.
//
// The prod compose had nats-init and minio-init but no migration step, so a
// clean database never got its tables. Every query 500d, including the public
// stats the landing page renders, which then span forever on the skeleton.
func TestProdComposeMigratesSchema(t *testing.T) {
	compose := readProdCompose(t)

	if !strings.Contains(compose, "db-migrate:") {
		t.Error("docker-compose.prod.yml has no db-migrate service; a fresh database is never migrated")
	}
	if !strings.Contains(compose, "bun run db:migrate") {
		t.Error("db-migrate does not run the drizzle migration command")
	}
}

// Consumers wait for migration.
func TestProdMigrateGatesDbConsumers(t *testing.T) {
	compose := readProdCompose(t)

	// Without this gate a service can boot before the schema exists.
	if !strings.Contains(compose, "service_completed_successfully") {
		t.Error("nothing depends on db-migrate completing; startup races the schema")
	}
}

func TestFrontendSharesTheSameFlag(t *testing.T) {
	compose := readProdCompose(t)

	// Sandbox and production Snap tokens are not interchangeable, so the
	// browser has to load the host the backend minted the token against.
	if !strings.Contains(compose, "VITE_MIDTRANS_IS_SANDBOX:") {
		t.Error("web build does not receive VITE_MIDTRANS_IS_SANDBOX; snap.js host can diverge from the token")
	}
}
