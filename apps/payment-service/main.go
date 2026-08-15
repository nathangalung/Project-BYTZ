package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bytz/payment-service/internal/config"
	"github.com/bytz/payment-service/internal/handler"
	authmw "github.com/bytz/payment-service/internal/middleware"
	"github.com/bytz/payment-service/internal/observability"
	"github.com/bytz/payment-service/internal/publisher"
	"github.com/bytz/payment-service/internal/service"
	"github.com/bytz/payment-service/internal/store"
	"github.com/gofiber/contrib/otelfiber/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Docker stops the container 30s after SIGTERM, and shutdown spends it in
// three parts: this, then draining settlement callbacks (each bounded by
// handler.callbackCtxTimeout, 15s), then the deferred 5s telemetry flush.
const httpShutdownTimeout = 10 * time.Second

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

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
	shutdownOTel, err := observability.Init(otelCtx, "payment-service")
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

	// Connect to PostgreSQL
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()

	if err = pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}
	slog.Info("connected to database")

	// Initialize stores
	txnStore := store.NewTransactionStore(pool)
	ledgerStore := store.NewLedgerStore(pool)

	// Initialize service
	paymentSvc := service.NewPaymentService(txnStore, ledgerStore, cfg.MidtransServerKey, cfg.MidtransSnapURL)

	// Initialize handlers
	paymentHandler := handler.NewPaymentHandler(paymentSvc)
	webhookHandler := handler.NewWebhookHandler(txnStore, ledgerStore, cfg.MidtransServerKey, cfg.ProjectServiceURL, cfg.ServiceAuthSecret)

	// Start outbox publisher
	outboxPub := publisher.New(pool, cfg.NATSURL)
	publisherCtx, publisherCancel := context.WithCancel(context.Background())
	defer publisherCancel()
	if err := outboxPub.Start(publisherCtx); err != nil {
		return fmt.Errorf("start outbox publisher: %w", err)
	}

	app := buildApp(cfg, pool, paymentHandler, webhookHandler)

	// Graceful shutdown. Notify is registered before the listener so a SIGTERM
	// arriving during startup is drained rather than taking the default
	// disposition and killing the process mid-boot.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	slog.Info("payment service starting", "port", cfg.Port)
	if err := serveUntilSignal(app, fmt.Sprintf(":%s", cfg.Port), quit); err != nil {
		return err
	}

	// Settlement callbacks outlive their request, so drain them before the
	// pool goes. payment.settled is the durable path, but a callback cut
	// mid-flight leaves an unclosed span and a wasted round trip.
	drainInOrder(app, httpShutdownTimeout,
		webhookHandler.WaitForCallbacks,
		outboxPub.Stop,
		publisherCancel,
		pool.Close,
	)
	slog.Info("payment service stopped")
	return nil
}

// pinger is the pool subset the readiness probe uses. *pgxpool.Pool satisfies
// it unchanged, so the route table is reachable without a database.
type pinger interface {
	Ping(context.Context) error
}

var _ pinger = (*pgxpool.Pool)(nil)

// buildApp assembles the HTTP surface: middleware, health probes and routes.
// Split from run so the readiness probe and the route table can be exercised
// over app.Test without a database or a listening socket.
func buildApp(cfg *config.Config, pool pinger, payments *handler.PaymentHandler, webhooks *handler.WebhookHandler) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:               "payment-service",
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           30 * time.Second,
	})

	app.Use(recover.New())
	app.Use(otelfiber.Middleware())
	app.Use(requestid.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORSOrigin,
		AllowCredentials: true,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, X-Request-ID, X-Service-Auth",
		AllowMethods:     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
	}))

	// Request logging middleware
	app.Use(func(c *fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		slog.Info("request",
			"method", c.Method(),
			"path", c.Path(),
			"status", c.Response().StatusCode(),
			"duration", time.Since(start).String(),
			"requestId", c.Locals("requestid"),
		)
		return err
	})

	// Health routes
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "payment-service",
			"uptime":  time.Since(startTime).Seconds(),
		})
	})
	app.Get("/health/ready", func(c *fiber.Ctx) error {
		if err := pool.Ping(c.UserContext()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "not ready"})
		}
		return c.JSON(fiber.Map{"status": "ready"})
	})

	// register routes (order matters - see handler.RegisterAll)
	handler.RegisterAll(
		app,
		payments,
		webhooks,
		authmw.SessionAuth(cfg.AuthServiceURL),
		authmw.ServiceOnly(),
	)

	return app
}

// serveUntilSignal listens and blocks until the listener fails or a signal
// arrives. The listener reports its failure instead of exiting here: os.Exit
// from that goroutine skipped every defer in run, leaking the pool and never
// flushing telemetry.
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
		slog.Info("shutting down gracefully")
		return nil
	}
}

// drainInOrder stops the listener, then runs each drain step in sequence.
// The sequence is the point: every step depends on the ones before it still
// being alive, so running them concurrently or reordering them cuts in-flight
// work instead of draining it.
func drainInOrder(app *fiber.App, timeout time.Duration, steps ...func()) {
	if err := app.ShutdownWithTimeout(timeout); err != nil {
		slog.Error("shutdown error", "error", err)
	}
	for _, step := range steps {
		step()
	}
}

var startTime = time.Now()
