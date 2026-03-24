package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bytz/notification-service/internal/config"
	"github.com/bytz/notification-service/internal/consumer"
	"github.com/bytz/notification-service/internal/handler"
	authmw "github.com/bytz/notification-service/internal/middleware"
	"github.com/bytz/notification-service/internal/sender"
	"github.com/bytz/notification-service/internal/store"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

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

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Database
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}
	slog.Info("database connected")

	// Store
	notifStore := store.New(pool)

	// Senders
	emailSender := sender.NewEmailSender(cfg.ResendAPIKey)
	centrifugoSender := sender.NewCentrifugoSender(cfg.CentrifugoURL, cfg.CentrifugoAPIKey)

	// NATS consumer
	natsConsumer := consumer.New(notifStore, pool, emailSender, centrifugoSender)
	if err := natsConsumer.Start(ctx, cfg.NatsURL); err != nil {
		slog.Warn("nats consumer failed to start, running without event processing", "error", err)
	} else {
		defer natsConsumer.Close()
	}

	// HTTP server
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           120 * time.Second,
	})

	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CorsOrigin,
		AllowCredentials: true,
		AllowMethods:     "GET,POST,PATCH,PUT,DELETE,OPTIONS",
		AllowHeaders:     "Origin,Content-Type,Accept,Authorization,X-Request-ID,X-Service-Auth",
	}))

	h := handler.New(notifStore)
	h.Register(app)
	h.RegisterWithAuth(app, authmw.SessionAuth(cfg.AuthServiceURL))

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		addr := fmt.Sprintf(":%d", cfg.Port)
		slog.Info("notification service running", "port", cfg.Port)
		if err := app.Listen(addr); err != nil {
			slog.Error("server error", "error", err)
			cancel()
		}
	}()

	<-quit
	slog.Info("shutting down")
	cancel()

	if err := app.ShutdownWithTimeout(30 * time.Second); err != nil {
		slog.Error("server shutdown error", "error", err)
	}

	slog.Info("shutdown complete")
	return nil
}
