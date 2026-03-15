.PHONY: install setup db dev dev-services dev-web dev-admin dev-all stop build lint typecheck test test-coverage clean docker-up docker-down help

# Default
help:
	@echo "BYTZ Platform - Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install      Install all dependencies"
	@echo "  make setup        Full setup (install + docker + db + seed)"
	@echo "  make db-reset     Drop and recreate database"
	@echo ""
	@echo "Development:"
	@echo "  make dev          Start all services + frontend"
	@echo "  make dev-services Start backend services only"
	@echo "  make dev-web      Start web frontend (port 5173)"
	@echo "  make dev-admin    Start admin frontend (port 5174)"
	@echo "  make stop         Stop all running services"
	@echo ""
	@echo "Quality:"
	@echo "  make lint         Run Biome linter"
	@echo "  make lint-fix     Auto-fix lint issues"
	@echo "  make typecheck    TypeScript type checking"
	@echo "  make test         Run all tests"
	@echo "  make test-cov     Run tests with coverage (95% threshold)"
	@echo "  make check        Run lint + typecheck + test"
	@echo ""
	@echo "Build:"
	@echo "  make build        Build all services"
	@echo "  make docker-build Build Docker images"
	@echo ""
	@echo "Infrastructure:"
	@echo "  make docker-up    Start Docker infrastructure"
	@echo "  make docker-down  Stop Docker infrastructure"
	@echo "  make clean        Remove build artifacts"

# ── Setup ──────────────────────────────────────────────
install:
	bun install

docker-up:
	docker compose up -d postgres pgbouncer redis nats minio traefik centrifugo openobserve uptime-kuma
	@echo "Waiting for PostgreSQL..."
	@until docker compose exec -T postgres pg_isready -U bytz > /dev/null 2>&1; do sleep 1; done
	@echo "Infrastructure ready"

docker-down:
	docker compose down

db-setup:
	bun run db:generate
	bun run db:migrate
	bun run db:seed

db-reset:
	PGPASSWORD=bytz psql -h localhost -U bytz -d bytz -c "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null
	rm -rf packages/db/migrations
	mkdir -p packages/db/migrations
	$(MAKE) db-setup

setup: install docker-up db-setup
	@echo ""
	@echo "Setup complete. Run 'make dev' to start all services."

# ── Development ────────────────────────────────────────
dev-services: stop
	@echo "Starting backend services..."
	@bun run dev:auth-service &
	@bun run dev:project-service &
	@bun run dev:payment-service &
	@bun run dev:notification-service &
	@bun run dev:admin-service &
	@echo "Auth:3001 Project:3002 Payment:3004 Notification:3005 Admin:3006"

dev-web:
	bun run dev:web

dev-admin:
	bun run dev:admin

dev: dev-services
	@sleep 2
	@echo "Starting frontends..."
	@bun run dev:web &
	@bun run dev:admin &
	@echo ""
	@echo "All services running:"
	@echo "  Web:          http://localhost:5173"
	@echo "  Admin:        http://localhost:5174"
	@echo "  Auth API:     http://localhost:3001"
	@echo "  Project API:  http://localhost:3002"
	@echo "  Payment API:  http://localhost:3004"
	@echo "  Notify API:   http://localhost:3005"
	@echo "  Admin API:    http://localhost:3006"
	@echo "  Traefik:      http://localhost:80"
	@echo ""
	@wait

stop:
	@for p in 3001 3002 3004 3005 3006 5173 5174; do \
		lsof -ti:$$p 2>/dev/null | xargs kill -9 2>/dev/null || true; \
	done
	@sleep 1
	@echo "All services stopped"

# ── Quality ────────────────────────────────────────────
lint:
	bun run check

lint-fix:
	bun run check:fix

typecheck:
	bun run typecheck

test:
	bun run test

test-cov:
	bunx turbo run test:coverage

check: lint typecheck test

# ── Build ──────────────────────────────────────────────
build:
	bun run build

docker-build:
	@for svc in auth-service project-service payment-service notification-service admin-service web admin; do \
		echo "Building $$svc..."; \
		docker build -t bytz/$$svc:latest -f apps/$$svc/Dockerfile . 2>/dev/null || echo "No Dockerfile for $$svc"; \
	done

# ── Clean ──────────────────────────────────────────────
clean:
	rm -rf node_modules/.cache
	find . -name 'dist' -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	find . -name '.turbo' -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name 'coverage' -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	@echo "Clean complete"
