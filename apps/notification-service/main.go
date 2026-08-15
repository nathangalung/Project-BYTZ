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
	"github.com/bytz/notification-service/internal/idempotency"
	authmw "github.com/bytz/notification-service/internal/middleware"
	"github.com/bytz/notification-service/internal/observability"
	"github.com/bytz/notification-service/internal/sender"
	"github.com/bytz/notification-service/internal/store"
	"github.com/gofiber/contrib/otelfiber/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Docker stops the container 30s after SIGTERM, and shutdown spends it in
// three parts: this, then consumer.drainTimeout (5s) for in-flight handlers,
// then the deferred 5s telemetry flush.
const httpShutdownTimeout = 20 * time.Second

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

	shutdownOTel, err := observability.Init(ctx, "notification-service")
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

	// Consumer idempotency via Redis; fall back to NoOp if Redis is unreachable.
	idem := newIdempotency(ctx, cfg.RedisURL)

	// NATS consumer
	natsConsumer := consumer.New(notifStore, pool, emailSender, centrifugoSender, idem)
	if err := natsConsumer.Start(ctx, cfg.NatsURL); err != nil {
		slog.Warn("nats consumer failed to start, running without event processing", "error", err)
	} else {
		defer natsConsumer.Close()
	}

	app := buildApp(cfg, pool, natsConsumer, notifStore)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	slog.Info("notification service running", "port", cfg.Port)
	if err := serveUntilSignal(app, fmt.Sprintf(":%d", cfg.Port), quit); err != nil {
		return err
	}

	// Order matters. ctx reaches every in-flight NATS handler, so cancelling it
	// first aborted all of them at t=0 and turned each deploy into a redelivery
	// burst. Stop taking new work, let what is running finish, cancel last.
	drainInOrder(app, httpShutdownTimeout, natsConsumer.Close, cancel)

	slog.Info("shutdown complete")
	return nil
}

// pinger is the pool subset the readiness probe uses, and connectivityReporter
// the consumer subset. *pgxpool.Pool and *consumer.Consumer satisfy them
// unchanged, so the route table is reachable without a database or a broker.
type pinger interface {
	Ping(context.Context) error
}

type connectivityReporter interface {
	IsConnected() bool
}

var (
	_ pinger               = (*pgxpool.Pool)(nil)
	_ connectivityReporter = (*consumer.Consumer)(nil)
)

// buildApp assembles the HTTP surface: middleware, routes and the readiness
// probe. Split from run so the probe and the route table can be exercised over
// app.Test without a database, a broker or a listening socket.
func buildApp(cfg *config.Config, pool pinger, events connectivityReporter, notifStore store.StoreInterface) *fiber.App {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           120 * time.Second,
	})

	app.Use(recover.New())
	app.Use(otelfiber.Middleware())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CorsOrigin,
		AllowCredentials: true,
		AllowMethods:     "GET,POST,PATCH,PUT,DELETE,OPTIONS",
		AllowHeaders:     "Origin,Content-Type,Accept,Authorization,X-Request-ID,X-Service-Auth",
	}))

	h := handler.New(notifStore)
	h.SetCentrifugoTokenSecret(cfg.CentrifugoTokenSecret)
	h.Register(app, authmw.ServiceOnly())
	h.RegisterWithAuth(app, authmw.SessionAuth(cfg.AuthServiceURL))

	// Readiness probe: DB must be reachable and NATS consumer must be connected.
	// Liveness (/health) stays cheap; /health/ready is what orchestrators gate on.
	app.Get("/health/ready", func(c *fiber.Ctx) error {
		if err := pool.Ping(c.UserContext()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).
				JSON(fiber.Map{"status": "not ready", "reason": "database unreachable"})
		}
		if !events.IsConnected() {
			return c.Status(fiber.StatusServiceUnavailable).
				JSON(fiber.Map{"status": "not ready", "reason": "nats disconnected"})
		}
		return c.JSON(fiber.Map{"status": "ready"})
	})

	return app
}

// serveUntilSignal listens and blocks until the listener fails or a signal
// arrives. The listener reports its failure instead of cancelling here: ctx
// reaches every in-flight NATS handler, so cancelling aborted all of them at
// t=0 and then <-quit blocked forever, leaving a process that served nothing
// and never restarted.
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

// drainInOrder stops the listener, then runs each drain step in sequence.
// The sequence is the point: the consumer must finish its in-flight handlers
// before the context they run on is cancelled, or every deploy becomes a
// redelivery burst.
func drainInOrder(app *fiber.App, timeout time.Duration, steps ...func()) {
	if err := app.ShutdownWithTimeout(timeout); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
	for _, step := range steps {
		step()
	}
}

func newIdempotency(ctx context.Context, redisURL string) idempotency.Idempotency {
	if redisURL == "" {
		slog.Warn("REDIS_URL empty; consumer idempotency disabled")
		return idempotency.NoOp{}
	}
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Warn("parse REDIS_URL failed; consumer idempotency disabled", "error", err)
		return idempotency.NoOp{}
	}
	client := redis.NewClient(opts)
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		slog.Warn("redis ping failed; consumer idempotency disabled", "error", err)
		_ = client.Close()
		return idempotency.NoOp{}
	}
	slog.Info("consumer idempotency enabled", "backend", "redis")
	return idempotency.NewRedisStore(client, "notif:idem:", 7*24*time.Hour)
}
