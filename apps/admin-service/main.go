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

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
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
		slog.Error("failed to create database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("failed to ping database", "error", err)
		os.Exit(1)
	}
	slog.Info("database connected")

	// NATS publisher for DLQ reprocess. Best-effort: a NATS outage must not
	// block service startup, but the reprocess endpoint will fail until NATS
	// becomes reachable on next request via the handler's nil-publisher check.
	var pub publisher.Publisher
	natsPub, err := publisher.Connect(cfg.NATSURL)
	if err != nil {
		slog.Warn("nats publisher unavailable; dlq reprocess will fail until configured", "error", err)
	} else {
		pub = natsPub
		defer natsPub.Close()
	}

	// Stores
	dashboardStore := store.NewDashboardStore(pool)
	userStore := store.NewUserStore(pool)
	dlqStore := store.NewDLQStore(pool)
	projectStore := store.NewProjectStore(pool)
	financeStore := store.NewFinanceStore(pool)
	disputeStore := store.NewDisputeStore(pool)

	// Handlers
	dashboardHandler := handler.NewDashboardHandler(dashboardStore, userStore)
	usersHandler := handler.NewUsersHandler(userStore)
	dlqHandler := handler.NewDLQHandler(dlqStore, userStore, pub)
	projectsHandler := handler.NewProjectsHandler(projectStore)
	financeHandler := handler.NewFinanceHandler(financeStore)
	disputesHandler := handler.NewDisputesHandler(disputeStore)

	// Fiber app
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

	admin.Get("/dashboard", dashboardHandler.GetDashboard)
	admin.Get("/audit-logs", dashboardHandler.GetAuditLogs)
	admin.Get("/settings", dashboardHandler.GetSettings)
	admin.Patch("/settings/:key", dashboardHandler.UpdateSetting)

	admin.Get("/users", usersHandler.ListUsers)
	admin.Get("/users/:id", usersHandler.GetUser)
	admin.Get("/users/:id/talent-detail", usersHandler.GetTalentDetail)
	admin.Patch("/users/:id/suspend", usersHandler.SuspendUser)
	admin.Patch("/users/:id/unsuspend", usersHandler.UnsuspendUser)

	admin.Get("/projects", projectsHandler.ListProjects)
	admin.Get("/projects/:id", projectsHandler.GetProject)

	admin.Get("/finance/summary", financeHandler.GetSummary)
	admin.Get("/finance/escrow", financeHandler.GetEscrow)
	admin.Get("/finance/transactions", financeHandler.ListTransactions)

	admin.Get("/disputes", disputesHandler.ListDisputes)
	admin.Get("/disputes/status-counts", disputesHandler.GetStatusCounts)
	admin.Get("/disputes/:id", disputesHandler.GetDispute)

	admin.Get("/dlq", dlqHandler.ListDLQ)
	admin.Get("/dlq/:id", dlqHandler.GetDLQEvent)
	admin.Patch("/dlq/:id/reprocess", dlqHandler.ReprocessDLQEvent)

	// Graceful shutdown
	go func() {
		addr := fmt.Sprintf(":%d", cfg.Port)
		slog.Info("admin service starting", "port", cfg.Port)
		if err := app.Listen(addr); err != nil {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down")
	if err := app.ShutdownWithTimeout(30 * time.Second); err != nil {
		slog.Error("shutdown error", "error", err)
	}
	slog.Info("admin service stopped")
}
