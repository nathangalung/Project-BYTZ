package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/bytz/notification-service/internal/config"
	"github.com/bytz/notification-service/internal/store"
	"github.com/gofiber/fiber/v2"
)

// stubPinger and stubEvents stand in for the pool and the NATS consumer behind
// the readiness probe. Only Ping and IsConnected are reachable from buildApp.
type stubPinger struct{ err error }

func (p stubPinger) Ping(context.Context) error { return p.err }

type stubEvents struct{ connected bool }

func (e stubEvents) IsConnected() bool { return e.connected }

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

func testApp(t *testing.T, pool pinger, events connectivityReporter) *fiber.App {
	t.Helper()
	return buildApp(
		&config.Config{
			CorsOrigin:            "https://app.example",
			AuthServiceURL:        "http://127.0.0.1:1",
			CentrifugoTokenSecret: "secret",
		},
		pool,
		events,
		&store.MockStore{},
	)
}

/*
The readiness probe gates traffic, and this service has two dependencies, not
one. Reporting ready while NATS is disconnected is the dangerous case: the HTTP
side answers normally, so nothing looks wrong, while every event published in
the meantime is never turned into a notification. The reason string is asserted
too, because "not ready" without it sends an operator to the wrong system.
*/
func TestBuildApp_ReadinessCoversBothDependencies(t *testing.T) {
	tests := []struct {
		name      string
		pingErr   error
		connected bool
		wantCode  int
		wantBody  string
	}{
		{
			name:      "both up",
			pingErr:   nil,
			connected: true,
			wantCode:  fiber.StatusOK,
			wantBody:  `"status":"ready"`,
		},
		{
			name:      "database down",
			pingErr:   errors.New("connection refused"),
			connected: true,
			wantCode:  fiber.StatusServiceUnavailable,
			wantBody:  `"reason":"database unreachable"`,
		},
		{
			name:      "nats disconnected",
			pingErr:   nil,
			connected: false,
			wantCode:  fiber.StatusServiceUnavailable,
			wantBody:  `"reason":"nats disconnected"`,
		},
		{
			name:      "database checked before nats",
			pingErr:   errors.New("connection refused"),
			connected: false,
			wantCode:  fiber.StatusServiceUnavailable,
			wantBody:  `"reason":"database unreachable"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := testApp(t, stubPinger{err: tt.pingErr}, stubEvents{connected: tt.connected})

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

// Liveness must not consult either dependency: a NATS outage that also failed
// /health would have Docker restart a process whose only problem is elsewhere.
func TestBuildApp_LivenessIgnoresBothDependencies(t *testing.T) {
	app := testApp(t, stubPinger{err: errors.New("down")}, stubEvents{connected: false})

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/health", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200 while dependencies are down", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"service":"notification-service"`) {
		t.Errorf("body = %s, want it to name the service", body)
	}
}

/*
Notifications are per-user, so every read and write route must be guarded. The
comments in routes.go warn that Fiber's Group(prefix, middleware) applies at
path level and would bleed one guard across the whole prefix; this asserts the
result of registering them per route instead. A user route answered 2xx without
a session would leak another user's notifications.
*/
func TestBuildApp_UserRoutesRequireASession(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		pattern string
		path    string
	}{
		{"list", http.MethodGet, "/api/v1/notifications", "/api/v1/notifications"},
		{"mark read", http.MethodPatch, "/api/v1/notifications/:id/read", "/api/v1/notifications/n-1/read"},
		{"mark all read", http.MethodPatch, "/api/v1/notifications/read-all", "/api/v1/notifications/read-all"},
		{"unread count", http.MethodGet, "/api/v1/notifications/unread-count", "/api/v1/notifications/unread-count"},
		{"ws token", http.MethodGet, "/api/v1/notifications/ws-token", "/api/v1/notifications/ws-token"},
	}

	app := testApp(t, stubPinger{}, stubEvents{connected: true})

	registered := map[string]bool{}
	for _, r := range app.GetRoutes(true) {
		registered[r.Method+" "+r.Path] = true
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !registered[tt.method+" "+tt.pattern] {
				t.Errorf("%s %s is not in the route table", tt.method, tt.pattern)
			}

			resp, err := app.Test(httptest.NewRequest(tt.method, tt.path, nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != fiber.StatusUnauthorized {
				t.Errorf("%s %s = %d, want 401; an unauthenticated caller reached a user's notifications",
					tt.method, tt.path, resp.StatusCode)
			}
		})
	}
}

// The create endpoint is internal. It takes a service secret, not a session,
// so an ordinary caller must be refused: anyone able to post here could
// fabricate a payment or milestone notification for any user.
func TestBuildApp_CreateIsServiceOnly(t *testing.T) {
	app := testApp(t, stubPinger{}, stubEvents{connected: true})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/notifications", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == fiber.StatusNotFound {
		t.Fatal("the internal create route is missing; no service could raise a notification")
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want 401 without a service secret", resp.StatusCode)
	}
}

// The service guard must not bleed onto the user routes registered on the same
// prefix, which is the failure routes.go documents. GET and POST on
// /api/v1/notifications are guarded by different middleware on purpose.
func TestBuildApp_ServiceGuardDoesNotBleedOntoUserRoutes(t *testing.T) {
	app := testApp(t, stubPinger{}, stubEvents{connected: true})

	// A GET with no service header must be refused by session auth, not by
	// the service guard, and must still reach a registered route.
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/notifications", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == fiber.StatusNotFound {
		t.Fatal("the user list route was shadowed by the internal POST registration")
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

// Browser clients send credentials, so the allow-list must be the configured
// origin rather than a wildcard.
func TestBuildApp_CORSAllowsOnlyTheConfiguredOrigin(t *testing.T) {
	app := testApp(t, stubPinger{}, stubEvents{connected: true})

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
The drain order is what keeps a deploy from becoming a redelivery burst. The
consumer's Close waits for in-flight handlers; the context cancel behind it
reaches those same handlers. Run them in the other order, or concurrently, and
every message being processed is aborted at t=0 and redelivered.
*/
func TestDrainInOrder_ClosesTheConsumerBeforeCancellingItsContext(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})

	var mu sync.Mutex
	var order []string
	step := func(name string) func() {
		return func() {
			// Long enough that a caller which merely launched the step would
			// be recorded out of order.
			time.Sleep(20 * time.Millisecond)
			mu.Lock()
			defer mu.Unlock()
			order = append(order, name)
		}
	}

	drainInOrder(app, time.Second, step("consumer.Close"), step("cancel"))

	want := []string{"consumer.Close", "cancel"}
	mu.Lock()
	defer mu.Unlock()
	if !reflect.DeepEqual(order, want) {
		t.Errorf("drain order = %v, want %v; cancelling first aborts every in-flight handler", order, want)
	}
}

// A shutdown that times out must not abort the drain behind it, or the
// consumer is never closed and its handlers are cut rather than drained.
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

	go func() {
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
		t.Error("a shutdown timeout skipped the drain; the consumer would never be closed")
	}
}
