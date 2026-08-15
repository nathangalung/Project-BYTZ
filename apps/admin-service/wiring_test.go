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

	"github.com/bytz/admin-service/internal/config"
	"github.com/bytz/admin-service/internal/handler"
	"github.com/bytz/admin-service/internal/store"
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

// authStub answers get-session with the supplied body and status, standing in
// for the auth service. The middleware's real HTTP client runs against it, so
// what is exercised is the middleware, not a substitute for it.
func authStub(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/get-session" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// testApp builds the real route table over mock stores, with AdminAuth pointed
// at the supplied auth service.
func testApp(t *testing.T, pool pinger, authURL string) *fiber.App {
	t.Helper()

	userStore := &store.MockUserStore{}
	return buildApp(
		&config.Config{CORSOrigin: "https://admin.example", AuthURL: authURL},
		pool,
		handlers{
			dashboard: handler.NewDashboardHandler(&store.MockDashboardStore{}, userStore),
			users:     handler.NewUsersHandler(userStore),
			dlq:       handler.NewDLQHandler(&store.MockDLQStore{}, userStore, nil),
			projects:  handler.NewProjectsHandler(&store.MockProjectStore{}),
			finance:   handler.NewFinanceHandler(&store.MockFinanceStore{}),
			disputes:  handler.NewDisputesHandler(&store.MockDisputeStore{}),
		},
	)
}

// adminRoutes is the full admin surface: the pattern it is registered under
// and a concrete path to send at it. Every entry must exist in the route table
// and be behind AdminAuth.
var adminRoutes = []struct {
	name    string
	method  string
	pattern string
	path    string
}{
	{"dashboard", http.MethodGet, "/api/v1/admin/dashboard", "/api/v1/admin/dashboard"},
	{"audit logs", http.MethodGet, "/api/v1/admin/audit-logs", "/api/v1/admin/audit-logs"},
	{"settings", http.MethodGet, "/api/v1/admin/settings", "/api/v1/admin/settings"},
	{"update setting", http.MethodPatch, "/api/v1/admin/settings/:key", "/api/v1/admin/settings/platform_fee_brackets"},
	{"list users", http.MethodGet, "/api/v1/admin/users", "/api/v1/admin/users"},
	{"get user", http.MethodGet, "/api/v1/admin/users/:id", "/api/v1/admin/users/u-1"},
	{"talent detail", http.MethodGet, "/api/v1/admin/users/:id/talent-detail", "/api/v1/admin/users/u-1/talent-detail"},
	{"suspend user", http.MethodPatch, "/api/v1/admin/users/:id/suspend", "/api/v1/admin/users/u-1/suspend"},
	{"unsuspend user", http.MethodPatch, "/api/v1/admin/users/:id/unsuspend", "/api/v1/admin/users/u-1/unsuspend"},
	{"list projects", http.MethodGet, "/api/v1/admin/projects", "/api/v1/admin/projects"},
	{"get project", http.MethodGet, "/api/v1/admin/projects/:id", "/api/v1/admin/projects/p-1"},
	{"finance summary", http.MethodGet, "/api/v1/admin/finance/summary", "/api/v1/admin/finance/summary"},
	{"finance escrow", http.MethodGet, "/api/v1/admin/finance/escrow", "/api/v1/admin/finance/escrow"},
	{"finance transactions", http.MethodGet, "/api/v1/admin/finance/transactions", "/api/v1/admin/finance/transactions"},
	{"finance reconciliation", http.MethodGet, "/api/v1/admin/finance/reconciliation", "/api/v1/admin/finance/reconciliation"},
	{"list disputes", http.MethodGet, "/api/v1/admin/disputes", "/api/v1/admin/disputes"},
	{"dispute status counts", http.MethodGet, "/api/v1/admin/disputes/status-counts", "/api/v1/admin/disputes/status-counts"},
	{"get dispute", http.MethodGet, "/api/v1/admin/disputes/:id", "/api/v1/admin/disputes/d-1"},
	{"list dlq", http.MethodGet, "/api/v1/admin/dlq", "/api/v1/admin/dlq"},
	{"get dlq event", http.MethodGet, "/api/v1/admin/dlq/:id", "/api/v1/admin/dlq/e-1"},
	{"reprocess dlq", http.MethodPatch, "/api/v1/admin/dlq/:id/reprocess", "/api/v1/admin/dlq/e-1/reprocess"},
}

/*
The route table itself, read from Fiber rather than inferred from a status
code. The inference does not work here: AdminAuth is registered with
Group(prefix, middleware), which Fiber applies as a path-level Use, so every
path under /api/v1/admin is answered 403 whether or not a route was ever
registered for it. A guard test alone would keep passing if every route below
were deleted.
*/
func TestBuildApp_RegistersEveryAdminRoute(t *testing.T) {
	app := testApp(t, stubPinger{}, "http://127.0.0.1:1")

	registered := map[string]bool{}
	for _, r := range app.GetRoutes(true) {
		registered[r.Method+" "+r.Path] = true
	}

	for _, rt := range adminRoutes {
		t.Run(rt.name, func(t *testing.T) {
			if !registered[rt.method+" "+rt.pattern] {
				t.Errorf("%s %s is not in the route table; callers get a generic 403 with no handler behind it",
					rt.method, rt.pattern)
			}
		})
	}
}

/*
The authorization guard, asserted through the real route table rather than on
the middleware alone. A valid session is not enough: this service suspends
users, moves money between accounts and re-publishes events, so a logged-in
talent or owner reaching any of it is a privilege escalation. The middleware's
own tests prove it returns 403 when asked; this proves it is actually attached
to every route, which is the half a unit test cannot see.
*/
func TestBuildApp_EveryAdminRouteRefusesANonAdminSession(t *testing.T) {
	nonAdminRoles := []string{"talent", "owner", ""}

	for _, role := range nonAdminRoles {
		t.Run("role="+role, func(t *testing.T) {
			auth := authStub(t, http.StatusOK,
				`{"user":{"id":"u-1","name":"Budi","role":"`+role+`"}}`)
			app := testApp(t, stubPinger{}, auth.URL)

			for _, rt := range adminRoutes {
				t.Run(rt.name, func(t *testing.T) {
					req := httptest.NewRequest(rt.method, rt.path, nil)
					req.Header.Set("Cookie", "session=valid-but-not-admin")

					resp, err := app.Test(req)
					if err != nil {
						t.Fatalf("app.Test: %v", err)
					}
					defer resp.Body.Close()

					// Registration is asserted separately, over the route
					// table: a 403 here proves only the guard, since Fiber
					// applies it to the whole prefix.
					if resp.StatusCode != fiber.StatusForbidden {
						body, _ := io.ReadAll(resp.Body)
						t.Errorf("%s %s = %d, want 403; a %q session reached an admin route\nbody: %s",
							rt.method, rt.path, resp.StatusCode, role, body)
					}
				})
			}
		})
	}
}

// A session that is missing entirely is unauthenticated, not merely
// unauthorized: 401 tells the admin panel to send the operator to log in,
// where 403 would tell it the login it has is the wrong one.
func TestBuildApp_AdminRoutesRejectAMissingSession(t *testing.T) {
	auth := authStub(t, http.StatusOK, `{"user":{"id":"u-1","role":"admin"}}`)
	app := testApp(t, stubPinger{}, auth.URL)

	for _, rt := range adminRoutes {
		t.Run(rt.name, func(t *testing.T) {
			resp, err := app.Test(httptest.NewRequest(rt.method, rt.path, nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != fiber.StatusUnauthorized {
				t.Errorf("%s %s = %d, want 401 with no cookie", rt.method, rt.path, resp.StatusCode)
			}
		})
	}
}

// The guard must let a real admin through, or the panel is uniformly broken.
// Asserting only the refusals would pass against a middleware that rejects
// everyone. Reaching the handler at all is the property; what the handler then
// returns is its own test's business, since the stores here are empty mocks.
func TestBuildApp_AdminSessionPassesTheGuard(t *testing.T) {
	auth := authStub(t, http.StatusOK, `{"user":{"id":"u-1","name":"Admin","role":"admin"}}`)
	app := testApp(t, stubPinger{}, auth.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard", nil)
	req.Header.Set("Cookie", "session=admin")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == fiber.StatusUnauthorized || resp.StatusCode == fiber.StatusForbidden {
		t.Fatalf("status = %d; a genuine admin was refused, so the panel serves nobody", resp.StatusCode)
	}
}

// An auth service that is down must not read as authorized. 503 keeps the
// door shut while saying the refusal is ours, not the operator's.
func TestBuildApp_AuthServiceOutageDoesNotAdmit(t *testing.T) {
	app := testApp(t, stubPinger{}, "http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	req.Header.Set("Cookie", "session=whatever")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 400 {
		t.Fatalf("status = %d; an unreachable auth service admitted the caller", resp.StatusCode)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 when the auth service is unreachable", resp.StatusCode)
	}
}

// Health endpoints sit outside the auth group on purpose: Docker and Traefik
// probe them without a session, so a guard here would mark every container
// unhealthy and stop all traffic.
func TestBuildApp_HealthEndpointsAreUnauthenticated(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		pingErr  error
		wantCode int
		wantBody string
	}{
		{"liveness ignores the database", "/health", errors.New("down"), fiber.StatusOK, `"service":"admin-service"`},
		{"readiness with database up", "/health/ready", nil, fiber.StatusOK, `"status":"ready"`},
		{"readiness with database down", "/health/ready", errors.New("down"), fiber.StatusServiceUnavailable, `"status":"not ready"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := testApp(t, stubPinger{err: tt.pingErr}, "http://127.0.0.1:1")

			resp, err := app.Test(httptest.NewRequest(http.MethodGet, tt.path, nil))
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

// The admin panel sends credentials cross-origin, so the allow-list must be
// the configured origin rather than a wildcard.
func TestBuildApp_CORSAllowsOnlyTheConfiguredOrigin(t *testing.T) {
	app := testApp(t, stubPinger{}, "http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "https://admin.example")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "https://admin.example" {
		t.Errorf("Access-Control-Allow-Origin = %q, want the configured origin", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
	}
}

/*
connectPublisher must hand back an untyped nil when NATS cannot be configured.
ReprocessDLQEvent guards on `h.pub == nil`; a (*NATSPublisher)(nil) stored in
the interface is non-nil to that comparison, so the guard would fall through
and the handler would nil-dereference on a request an operator makes precisely
when things are already going wrong.
*/
func TestConnectPublisher_ReturnsAnUntypedNilWhenUnconfigured(t *testing.T) {
	pub, closeFn := connectPublisher("://not-a-url")
	t.Cleanup(closeFn)

	if pub != nil {
		t.Fatalf("publisher = %#v, want nil so the handler's nil check fires", pub)
	}
	// reflect sees through the interface: a typed nil compares != nil above
	// only if the type word is set, which is exactly the bug being excluded.
	if v := reflect.ValueOf(pub); v.IsValid() {
		t.Errorf("publisher carries type %s; the nil check in ReprocessDLQEvent would not fire", v.Type())
	}
}

// A NATS server that is merely down is not a configuration error:
// RetryOnFailedConnect keeps the connection retrying, so the publisher is
// real and DLQ reprocess recovers on its own once NATS is back.
func TestConnectPublisher_KeepsThePublisherWhileNATSIsDown(t *testing.T) {
	pub, closeFn := connectPublisher("nats://127.0.0.1:1")
	t.Cleanup(closeFn)

	if pub == nil {
		t.Fatal("a NATS outage disabled DLQ reprocess permanently instead of retrying")
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

// Each drain step must be waited for, not merely started: a step that is
// launched concurrently is cut short by the process exiting behind it.
func TestDrainInOrder_RunsEveryStepToCompletionInSequence(t *testing.T) {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})

	var mu sync.Mutex
	var order []string
	step := func(name string) func() {
		return func() {
			time.Sleep(20 * time.Millisecond)
			mu.Lock()
			defer mu.Unlock()
			order = append(order, name)
		}
	}

	drainInOrder(app, time.Second, step("first"), step("second"), step("third"))

	want := []string{"first", "second", "third"}
	mu.Lock()
	defer mu.Unlock()
	if !reflect.DeepEqual(order, want) {
		t.Errorf("drain order = %v, want %v", order, want)
	}
}

// A shutdown that times out must not abort the drain behind it, or the
// resources the timed-out requests were holding are never released.
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

	deadline := time.Now().Add(5 * time.Second)
	client := &http.Client{Timeout: 200 * time.Millisecond}
	for time.Now().Before(deadline) {
		if _, err := client.Get("http://" + addr + "/slow"); err != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	drained := false
	drainInOrder(app, 50*time.Millisecond, func() { drained = true })

	if !drained {
		t.Error("a shutdown timeout skipped the drain; held resources would never be released")
	}
}
