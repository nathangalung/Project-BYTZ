package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/contrib/otelfiber/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bytz/admin-service/internal/config"
	"github.com/bytz/admin-service/internal/handler"
	"github.com/bytz/admin-service/internal/middleware"
	"github.com/bytz/admin-service/internal/observability"
	"github.com/bytz/admin-service/internal/publisher"
	"github.com/bytz/admin-service/internal/store"
)

var startTime = time.Now()

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	otelCtx, otelCancel := context.WithCancel(context.Background())
	defer otelCancel()
	shutdownOTel, err := observability.Init(otelCtx, "admin-service")
	if err != nil {
		slog.Warn("otel init failed; continuing without telemetry", "error", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownOTel(shutdownCtx); err != nil {
			slog.Error("otel shutdown", "error", err)
		}
	}()

	// Database connection pool
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("create database pool: %w", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}
	slog.Info("database connected")

	pub, closePublisher := connectPublisher(cfg.NATSURL)
	defer closePublisher()

	// Stores
	dashboardStore := store.NewDashboardStore(pool)
	userStore := store.NewUserStore(pool)
	dlqStore := store.NewDLQStore(pool)
	projectStore := store.NewProjectStore(pool)
	financeStore := store.NewFinanceStore(pool)
	disputeStore := store.NewDisputeStore(pool)

	app := buildApp(cfg, pool, handlers{
		dashboard: handler.NewDashboardHandler(dashboardStore, userStore),
		users:     handler.NewUsersHandler(userStore),
		dlq:       handler.NewDLQHandler(dlqStore, userStore, pub),
		projects:  handler.NewProjectsHandler(projectStore),
		finance:   handler.NewFinanceHandler(financeStore),
		disputes:  handler.NewDisputesHandler(disputeStore),
	})

	// Graceful shutdown. Notify is registered before the listener so a SIGTERM
	// arriving during startup is drained rather than taking the default
	// disposition and killing the process mid-boot.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	slog.Info("admin service starting", "port", cfg.Port)
	if err := serveUntilSignal(app, fmt.Sprintf(":%d", cfg.Port), quit); err != nil {
		return err
	}

	drainInOrder(app, shutdownTimeout)
	slog.Info("admin service stopped")
	return nil
}

// shutdownTimeout bounds how long in-flight admin requests may finish in.
// Dashboard aggregates are the slow ones, so this is generous.
const shutdownTimeout = 30 * time.Second

// connectPublisher returns the DLQ publisher and its closer. A NATS outage is
// not fatal: the admin panel must keep serving, and ReprocessDLQEvent checks
// for a nil publisher per request. The nil is returned as an untyped nil so
// that check actually fires - handing back a (*NATSPublisher)(nil) would make
// the interface non-nil and turn the guard into a nil dereference.
func connectPublisher(natsURL string) (publisher.Publisher, func()) {
	natsPub, err := publisher.Connect(natsURL)
	if err != nil {
		slog.Warn("nats publisher unavailable; dlq reprocess will fail until configured", "error", err)
		return nil, func() {}
	}
	return natsPub, natsPub.Close
}

// handlers groups the route handlers so buildApp keeps one parameter per
// concern rather than six positional ones.
type handlers struct {
	dashboard *handler.DashboardHandler
	users     *handler.UsersHandler
	dlq       *handler.DLQHandler
	projects  *handler.ProjectsHandler
	finance   *handler.FinanceHandler
	disputes  *handler.DisputesHandler
}

// pinger is the pool subset the readiness probe uses. *pgxpool.Pool satisfies
// it unchanged, so the route table is reachable without a database.
type pinger interface {
	Ping(context.Context) error
}

var _ pinger = (*pgxpool.Pool)(nil)

// buildApp assembles the HTTP surface: middleware, health probes and routes.
// Split from run so the admin route table and its authorization guard can be
// exercised over app.Test without a database or a listening socket.
func buildApp(cfg *config.Config, pool pinger, h handlers) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:               "admin-service",
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           30 * time.Second,
	})

	app.Use(recover.New())
	app.Use(otelfiber.Middleware())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORSOrigin,
		AllowCredentials: true,
	}))

	// Health endpoints (no auth)
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "admin-service",
			"uptime":  time.Since(startTime).Seconds(),
		})
	})
	app.Get("/health/ready", func(c *fiber.Ctx) error {
		if err := pool.Ping(c.UserContext()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "not ready"})
		}
		return c.JSON(fiber.Map{"status": "ready"})
	})

	// Admin routes (auth required)
	admin := app.Group("/api/v1/admin", middleware.AdminAuth(cfg.AuthURL))

	admin.Get("/dashboard", h.dashboard.GetDashboard)
	admin.Get("/audit-logs", h.dashboard.GetAuditLogs)
	admin.Get("/settings", h.dashboard.GetSettings)
	admin.Patch("/settings/:key", h.dashboard.UpdateSetting)

	admin.Get("/users", h.users.ListUsers)
	admin.Get("/users/:id", h.users.GetUser)
	admin.Get("/users/:id/talent-detail", h.users.GetTalentDetail)
	admin.Patch("/users/:id/suspend", h.users.SuspendUser)
	admin.Patch("/users/:id/unsuspend", h.users.UnsuspendUser)

	admin.Get("/projects", h.projects.ListProjects)
	admin.Get("/projects/:id", h.projects.GetProject)

	admin.Get("/finance/summary", h.finance.GetSummary)
	admin.Get("/finance/escrow", h.finance.GetEscrow)
	admin.Get("/finance/transactions", h.finance.ListTransactions)
	admin.Get("/finance/reconciliation", h.finance.GetLedgerReconciliation)

	admin.Get("/disputes", h.disputes.ListDisputes)
	admin.Get("/disputes/status-counts", h.disputes.GetStatusCounts)
	admin.Get("/disputes/:id", h.disputes.GetDispute)

	admin.Get("/dlq", h.dlq.ListDLQ)
	admin.Get("/dlq/:id", h.dlq.GetDLQEvent)
	admin.Patch("/dlq/:id/reprocess", h.dlq.ReprocessDLQEvent)

	return app
}

// serveUntilSignal listens and blocks until the listener fails or a signal
// arrives. The listener reports its failure instead of exiting here: os.Exit
// from that goroutine skipped every defer in run, leaking the pool and the
// NATS connection.
func serveUntilSignal(app *fiber.App, addr string, quit <-chan os.Signal) error {
	srvErr := make(chan error, 1)
	go func() {
		if err := app.Listen(addr); err != nil {
			srvErr <- err
		}
	}()

	select {
	case err := <-srvErr:
		return fmt.Errorf("listen: %w", err)
	case <-quit:
		slog.Info("shutting down")
		return nil
	}
}

// drainInOrder stops the listener, then runs each drain step in sequence. A
// shutdown that times out must not skip the steps behind it, which are what
// release the resources the timed-out requests were using.
func drainInOrder(app *fiber.App, timeout time.Duration, steps ...func()) {
	if err := app.ShutdownWithTimeout(timeout); err != nil {
		slog.Error("shutdown error", "error", err)
	}
	for _, step := range steps {
		step()
	}
}
