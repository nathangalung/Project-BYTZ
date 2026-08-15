package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/bytz/payment-service/internal/config"
	"github.com/bytz/payment-service/internal/handler"
	"github.com/bytz/payment-service/internal/service"
	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

// stubPinger stands in for the pool behind the readiness probe. Only Ping is
// reachable from buildApp, so the rest of pgxpool is not needed here.
type stubPinger struct{ err error }

func (p stubPinger) Ping(context.Context) error { return p.err }

// reserveAddr returns a loopback address that was free a moment ago. The
// kernel picks the port, so parallel packages do not collide on a constant.
func reserveAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatalf("release port: %v", err)
	}
	return addr
}

// testApp builds the real route table over mock stores. The stores are never
// queried: every request below is rejected by auth first, which is the point -
// what is under test is the wiring, not the handlers.
func testApp(t *testing.T, pool pinger) *fiber.App {
	t.Helper()

	txnStore := &store.MockTransactionStore{}
	ledgerStore := &store.MockLedgerStore{}
	svc := service.NewPaymentService(txnStore, ledgerStore, "SB-Mid-server-x", "https://snap.example")

	return buildApp(
		&config.Config{CORSOrigin: "https://app.example", AuthServiceURL: "http://127.0.0.1:1"},
		pool,
		handler.NewPaymentHandler(svc),
		handler.NewWebhookHandler(txnStore, ledgerStore, "SB-Mid-server-x", "http://127.0.0.1:1", "secret"),
	)
}

// The readiness probe is what Docker and Traefik gate traffic on. It must
// report the database it actually depends on: answering "ready" while the pool
// is down routes payment traffic to a service that cannot record a settlement.
func TestBuildApp_ReadinessReflectsTheDatabase(t *testing.T) {
	tests := []struct {
		name     string
		pingErr  error
		wantCode int
		wantBody string
	}{
		{
			name:     "database reachable",
			pingErr:  nil,
			wantCode: fiber.StatusOK,
			wantBody: `"status":"ready"`,
		},
		{
			name:     "database down",
			pingErr:  errors.New("connection refused"),
			wantCode: fiber.StatusServiceUnavailable,
			wantBody: `"status":"not ready"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := testApp(t, stubPinger{err: tt.pingErr})

			resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/health/ready", nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tt.wantCode {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantCode)
			}
			body, _ := io.ReadAll(resp.Body)
			if !strings.Contains(string(body), tt.wantBody) {
				t.Errorf("body = %s, want it to contain %s", body, tt.wantBody)
			}
		})
	}
}

// Liveness must stay cheap and must not consult the database: a pool outage
// that fails /health as well would have Docker restart a process whose only
// problem is downstream, turning a database blip into a restart loop.
func TestBuildApp_LivenessIgnoresTheDatabase(t *testing.T) {
	app := testApp(t, stubPinger{err: errors.New("connection refused")})

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/health", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200 while the database is down", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"service":"payment-service"`) {
		t.Errorf("body = %s, want it to name the service", body)
	}
}

/*
Every money route must be registered and behind a guard. The two failure modes
this catches are opposite and both silent: a 404 means the route was dropped
from the table and the caller gets a generic miss instead of a payment, and a
2xx means the guard is missing and anyone reaching the port can move escrow.
*/
func TestBuildApp_MoneyRoutesAreRegisteredAndGuarded(t *testing.T) {
	app := testApp(t, stubPinger{})

	registered := map[string]bool{}
	for _, r := range app.GetRoutes(true) {
		registered[r.Method+" "+r.Path] = true
	}

	for _, tt := range moneyRoutes {
		t.Run(tt.name, func(t *testing.T) {
			// The route table is read from Fiber rather than inferred from a
			// status code: both guards are registered with
			// Group(prefix, middleware), which Fiber applies to the whole
			// prefix, so a 401 alone would still be returned for a route that
			// had been deleted.
			if !registered[tt.method+" "+tt.pattern] {
				t.Errorf("%s %s is not in the route table; the caller gets a guard response with no handler behind it",
					tt.method, tt.pattern)
			}

			resp, err := app.Test(httptest.NewRequest(tt.method, tt.path, nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != fiber.StatusUnauthorized {
				t.Errorf("%s %s = %d, want 401; an unauthenticated caller reached a money route",
					tt.method, tt.path, resp.StatusCode)
			}
		})
	}
}

// moneyRoutes is the full payment surface: the pattern it is registered under
// and a concrete path to send at it.
var moneyRoutes = []struct {
	name    string
	method  string
	pattern string
	path    string
}{
	{"payment summary", http.MethodGet, "/api/v1/payments/summary", "/api/v1/payments/summary"},
	{"snap token", http.MethodPost, "/api/v1/payments/create-snap-token", "/api/v1/payments/create-snap-token"},
	{"project transactions", http.MethodGet, "/api/v1/payments/project/:projectId", "/api/v1/payments/project/p-1"},
	{"list payments", http.MethodGet, "/api/v1/payments/list", "/api/v1/payments/list"},
	{"transaction by id", http.MethodGet, "/api/v1/payments/:id", "/api/v1/payments/tx-1"},
	{"release escrow", http.MethodPost, "/api/v1/payments/release", "/api/v1/payments/release"},
	{"process refund", http.MethodPost, "/api/v1/payments/refund", "/api/v1/payments/refund"},
	{"escrow balance", http.MethodGet, "/api/v1/payments/escrow-balance/:projectId", "/api/v1/payments/escrow-balance/p-1"},
}

// The webhook is registered before the authenticated group on the same prefix.
// If that order ever flips, Midtrans is answered 401, the settlement is retried
// for a while and then abandoned, and the owner's payment never lands.
func TestBuildApp_WebhookIsNotBehindSessionAuth(t *testing.T) {
	app := testApp(t, stubPinger{})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/midtrans", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == fiber.StatusUnauthorized {
		t.Fatal("the webhook is behind session auth; Midtrans has no session and every settlement would be rejected")
	}

	var found bool
	for _, r := range app.GetRoutes(true) {
		if r.Method == http.MethodPost && r.Path == "/api/v1/payments/webhook/midtrans" {
			found = true
			break
		}
	}
	if !found {
		t.Error("the webhook route is missing from the table; Midtrans settlements would 404")
	}
}

// Browser calls carry credentials, so the CORS allow-list has to be the
// configured origin. A wildcard here would let any site spend a logged-in
// owner's escrow, and an absent header breaks the real frontend.
func TestBuildApp_CORSAllowsOnlyTheConfiguredOrigin(t *testing.T) {
	app := testApp(t, stubPinger{})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "https://app.example")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "https://app.example" {
		t.Errorf("Access-Control-Allow-Origin = %q, want the configured origin", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
	}
}

// Every response carries a request id so a payment can be traced across
// services. Without it the correlation id in the logs is empty and a
// settlement dispute has no thread to pull.
func TestBuildApp_StampsARequestID(t *testing.T) {
	app := testApp(t, stubPinger{})

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/health", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get(fiber.HeaderXRequestID); got == "" {
		t.Error("no X-Request-ID on the response; requests cannot be correlated across services")
	}
}

// A listener that cannot bind must be reported, not swallowed. Returning nil
// would leave the process alive and idle: healthy to Docker, serving nothing.
func TestServeUntilSignal_ReportsAListenFailure(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	quit := make(chan os.Signal, 1)

	err := serveUntilSignal(app, "127.0.0.1:99999", quit)

	if err == nil {
		t.Fatal("serveUntilSignal returned nil for an unbindable address")
	}
	if !strings.Contains(err.Error(), "listen:") {
		t.Errorf("error = %q, want it to name the listen step", err.Error())
	}
}

// SIGTERM is a clean stop, not a failure. Returning an error here would make
// main log "fatal" and exit 1 on every ordinary deploy.
func TestServeUntilSignal_ReturnsNilOnSignal(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	t.Cleanup(func() { _ = app.Shutdown() })

	quit := make(chan os.Signal, 1)
	done := make(chan error, 1)
	go func() { done <- serveUntilSignal(app, "127.0.0.1:0", quit) }()

	quit <- syscall.SIGTERM

	select {
	case err := <-done:
		if err != nil {
			t.Errorf("error = %v, want nil; an ordinary SIGTERM must not look fatal", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serveUntilSignal ignored the signal and never returned")
	}
}

/*
The drain order is the whole point of the sequence. Each step depends on the
ones before it still being alive - settlement callbacks write through the pool,
so closing the pool first would fail them - and every step must be waited for,
not merely started. A step that is kicked off concurrently is cut, not drained.
*/
func TestDrainInOrder_RunsEveryStepToCompletionInSequence(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})

	var mu sync.Mutex
	var order []string
	// step records that it ran, after a pause long enough that a caller which
	// merely launched it would be recorded out of order.
	step := func(name string) func() {
		return func() {
			time.Sleep(20 * time.Millisecond)
			mu.Lock()
			defer mu.Unlock()
			order = append(order, name)
		}
	}

	drainInOrder(app, time.Second,
		step("callbacks"),
		step("outbox"),
		step("publisherCancel"),
		step("pool"),
	)

	want := []string{"callbacks", "outbox", "publisherCancel", "pool"}
	mu.Lock()
	defer mu.Unlock()
	if len(order) != len(want) {
		t.Fatalf("steps run = %v, want all of %v; an unrun step means work was cut", order, want)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("drain order = %v, want %v", order, want)
		}
	}
}

// Shutdown runs before the drain steps: new requests must stop arriving before
// the resources they use are torn down, or a request accepted mid-drain finds
// a closed pool.
func TestDrainInOrder_StopsTheListenerBeforeDraining(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Get("/health", func(c *fiber.Ctx) error { return c.SendString("ok") })

	addr := reserveAddr(t)
	quit := make(chan os.Signal, 1)
	go func() { _ = serveUntilSignal(app, addr, quit) }()

	// Wait for the listener to be up, so the shutdown below is a real one.
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(5 * time.Second)
	var up bool
	for time.Now().Before(deadline) {
		resp, err := client.Get("http://" + addr + "/health")
		if err == nil {
			resp.Body.Close()
			up = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !up {
		t.Fatal("listener never came up")
	}

	var listeningDuringDrain bool
	drainInOrder(app, 5*time.Second, func() {
		resp, err := client.Get("http://" + addr + "/health")
		if err == nil {
			listeningDuringDrain = true
			resp.Body.Close()
		}
	})

	if listeningDuringDrain {
		t.Error("the listener still accepted a request during the drain; requests can outlive the pool they use")
	}
}

/*
A shutdown that times out must not abort the drain. The steps behind it are
what flush in-flight settlement callbacks and close the pool, so returning
early on a stuck connection would strand exactly the work the timeout exists
to bound - and it would do so silently, since the timeout is the only signal
that a request outlived its budget.
*/
func TestDrainInOrder_KeepsDrainingWhenShutdownTimesOut(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	release := make(chan struct{})
	app.Get("/slow", func(c *fiber.Ctx) error {
		<-release
		return c.SendString("done")
	})
	t.Cleanup(func() { close(release) })

	addr := reserveAddr(t)
	quit := make(chan os.Signal, 1)
	go func() { _ = serveUntilSignal(app, addr, quit) }()

	// Hold a request open so the shutdown below has something to wait for.
	inFlight := make(chan struct{})
	go func() {
		defer close(inFlight)
		resp, err := (&http.Client{Timeout: 30 * time.Second}).Get("http://" + addr + "/slow")
		if err == nil {
			resp.Body.Close()
		}
	}()

	// Only a timeout proves a request is parked in the handler. Breaking on any
	// error accepted a connection refused by a listener that was not up yet,
	// which proves the opposite: the drain below then had nothing in flight,
	// finished well inside its 50ms budget, and the test passed having
	// exercised no timeout at all. That showed up as drainInOrder losing its
	// error branch on roughly one run in six.
	deadline := time.Now().Add(5 * time.Second)
	client := &http.Client{Timeout: 200 * time.Millisecond}
	blocked := false
	for time.Now().Before(deadline) {
		resp, err := client.Get("http://" + addr + "/slow")
		if resp != nil {
			resp.Body.Close()
		}
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			blocked = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("no request ever parked in the handler; the shutdown below would not time out, so the drain it must outlast would go untested")
	}

	drained := false
	drainInOrder(app, 50*time.Millisecond, func() { drained = true })

	if !drained {
		t.Error("a shutdown timeout skipped the drain; callbacks and the pool would be abandoned")
	}
}
