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

// ai-service reaches NATS or it silently loses events.
//
// nats_client defaults NATS_URL to nats://localhost:4222, so an ai-service
// with no NATS_URL cannot publish ai.* events or consume embed requests; it
// just logs connection-refused on a loop.
func TestProdAiServiceReachesNats(t *testing.T) {
	compose := readProdCompose(t)

	start := strings.Index(compose, "\n  ai-service:")
	if start == -1 {
		t.Fatal("ai-service block not found in docker-compose.prod.yml")
	}
	block := compose[start:]
	if next := strings.Index(compose[start+1:], "\n  payment-service:"); next != -1 {
		block = compose[start : start+1+next]
	}
	if !strings.Contains(block, "NATS_URL") {
		t.Error("ai-service has no NATS_URL; it defaults to localhost and cannot publish ai.* events")
	}
}

// project-service settles milestones through payment-service.
//
// Escrow release became a service-to-service call: the talent is anonymous to
// the browser, so the owner-approve route and the Temporal auto-release worker
// resolve the talent and pay via payment-service. Without PAYMENT_SERVICE_URL
// both default to localhost and every milestone payout silently fails.
func TestProdProjectServicesReachPayment(t *testing.T) {
	compose := readProdCompose(t)

	if strings.Count(compose, "PAYMENT_SERVICE_URL") < 2 {
		t.Error("project-service and project-worker must both set PAYMENT_SERVICE_URL, or milestone settlement never reaches payment-service")
	}
}

// One service block, start marker to the next service.
func prodServiceBlock(t *testing.T, name, next string) string {
	t.Helper()
	compose := readProdCompose(t)
	start := strings.Index(compose, "\n  "+name+":")
	if start == -1 {
		t.Fatalf("%s block not found in docker-compose.prod.yml", name)
	}
	if offset := strings.Index(compose[start+1:], "\n  "+next+":"); offset != -1 {
		return compose[start : start+1+offset]
	}
	return compose[start:]
}

// payment-service drains its outbox to NATS.
//
// The outbox publisher reads cfg.NATSURL, which defaults to localhost when the
// variable is unset, so a payment-service without NATS_URL logs
// connection-refused and never publishes a payment.* event.
func TestProdPaymentServiceReachesNats(t *testing.T) {
	block := prodServiceBlock(t, "payment-service", "notification-service")
	if !strings.Contains(block, "NATS_URL") {
		t.Error("payment-service has no NATS_URL; the outbox publisher defaults to localhost and drops every payment.* event")
	}
}

// admin-service republishes DLQ events to NATS.
func TestProdAdminServiceReachesNats(t *testing.T) {
	block := prodServiceBlock(t, "admin-service", "web")
	if !strings.Contains(block, "NATS_URL") {
		t.Error("admin-service has no NATS_URL; DLQ reprocess defaults to localhost and always fails")
	}
}

// notification-service dedupes consumers through Valkey.
//
// newIdempotency falls back to a NoOp when REDIS_URL is empty, so a redelivered
// NATS event sends the same email twice with no record that it was a duplicate.
func TestProdNotificationServiceHasRedis(t *testing.T) {
	block := prodServiceBlock(t, "notification-service", "admin-service")
	if !strings.Contains(block, "REDIS_URL") {
		t.Error("notification-service has no REDIS_URL; consumer idempotency falls back to NoOp and redelivered events resend")
	}
}
