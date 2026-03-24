package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bytz/admin-service/internal/config"
	"github.com/bytz/admin-service/internal/handler"
	"github.com/bytz/admin-service/internal/middleware"
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

	// Stores
	dashboardStore := store.NewDashboardStore(pool)
	userStore := store.NewUserStore(pool)

	// Handlers
	dashboardHandler := handler.NewDashboardHandler(dashboardStore, userStore)
	usersHandler := handler.NewUsersHandler(userStore)

	// Fiber app
	app := fiber.New(fiber.Config{
		AppName:               "admin-service",
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           30 * time.Second,
	})

	app.Use(recover.New())
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
	admin.Patch("/users/:id/suspend", usersHandler.SuspendUser)
	admin.Patch("/users/:id/unsuspend", usersHandler.UnsuspendUser)

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
