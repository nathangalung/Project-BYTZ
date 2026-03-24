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
	docker compose up -d postgres pgbouncer redis nats minio traefik tensorzero centrifugo temporal-db temporal temporal-ui langfuse-db langfuse flagsmith-db flagsmith signoz-clickhouse signoz-otel-collector signoz-query-service signoz uptime-kuma
	@echo "Waiting for PostgreSQL..."
	@until docker compose exec -T postgres pg_isready -U kerjacus > /dev/null 2>&1; do sleep 1; done
	@echo "Infrastructure ready"

docker-down:
	docker compose down

db-setup:
	bun run db:generate
	bun run db:migrate
	bun run db:seed

db-reset:
	PGPASSWORD=kerjacus psql -h localhost -U kerjacus -d kerjacus -c "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null
	rm -rf packages/db/migrations
	mkdir -p packages/db/migrations
	$(MAKE) db-setup

storage-setup:
	@docker compose exec -T minio mc alias set local http://localhost:9000 minioadmin minioadmin 2>/dev/null || true
	@docker compose exec -T minio mc mb local/kerjacus-uploads --ignore-existing 2>/dev/null || true
	@docker compose exec -T minio mc anonymous set download local/kerjacus-uploads 2>/dev/null || true
	@echo "Storage bucket ready"

setup: install docker-up db-setup storage-setup
	@echo ""
	@echo "Setup complete. Run 'make dev' to start all services."

# ── Development ────────────────────────────────────────
dev-services: stop
	@echo "Starting backend services..."
	@bun run dev:auth-service &
	@bun run dev:project-service &
	@set -a && . ./.env && set +a && cd apps/ai-service && uv run uvicorn main:app --host 0.0.0.0 --port 3003 --reload &
	@set -a && . ./.env && set +a && cd apps/payment-service && go run . &
	@set -a && . ./.env && set +a && cd apps/notification-service && go run . &
	@set -a && . ./.env && set +a && cd apps/admin-service && go run . &
	@echo "Auth:3001 Project:3002 AI:3003(Py) Payment:3004(Go) Notification:3005(Go) Admin:3006(Go)"

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
	@echo "  Web:           http://localhost:5173"
	@echo "  Admin:         http://localhost:5174"
	@echo "  Auth API (TS): http://localhost:3001"
	@echo "  Project (TS):  http://localhost:3002"
	@echo "  AI (Python):   http://localhost:3003"
	@echo "  Payment (Go):  http://localhost:3004"
	@echo "  Notify (Go):   http://localhost:3005"
	@echo "  Admin (Go):    http://localhost:3006"
	@echo "  Traefik:       http://localhost:80"
	@echo "  TensorZero:    http://localhost:3333"
	@echo "  Centrifugo:    http://localhost:8000"
	@echo "  SigNoz:        http://localhost:3301"
	@echo ""
	@wait

stop:
	@# Kill only non-Docker processes on dev ports
	@for p in 3001 3002 3003 3004 3005 3006 5173 5174; do \
		lsof -ti:$$p 2>/dev/null | while read pid; do \
			if ! grep -q docker /proc/$$pid/cgroup 2>/dev/null; then \
				kill $$pid 2>/dev/null || true; \
			fi; \
		done; \
	done
	@sleep 1
	@echo "Dev services stopped (Docker containers preserved)"

# ── Quality ────────────────────────────────────────────
lint:
	bun run check

lint-fix:
	bun run check:fix

typecheck:
	bun run typecheck

test:
	bun run test

test-go:
	@cd apps/payment-service && go test ./... -count=1 && echo "payment: PASS"
	@cd apps/notification-service && go test ./... -count=1 && echo "notification: PASS"
	@cd apps/admin-service && go test ./... -count=1 && echo "admin: PASS"

test-python:
	@cd apps/ai-service && uv run pytest tests/ -q --tb=short

test-all: test test-go test-python

test-cov:
	bunx turbo run test:coverage

check: lint typecheck test

lighthouse:
	@echo "Run 'make dev' first in another terminal for best results."
	bun run lighthouse

lighthouse-prod:
	@echo "Building production bundles..."
	@cd apps/web && bun run build
	@cd apps/admin && bun run build
	@echo "Starting preview servers..."
	@cd apps/web && npx --yes vite preview --port 5173 &
	@cd apps/admin && npx --yes vite preview --port 5174 &
	@sleep 3
	@echo "Running Lighthouse against production builds..."
	@bun run lighthouse || true
	@echo "Stopping preview servers..."
	@pkill -f "vite preview" 2>/dev/null || true

lighthouse-ci:
	bun run lighthouse:ci

# ── Build ──────────────────────────────────────────────
build:
	bun run build

docker-build:
	@for svc in auth-service project-service payment-service notification-service admin-service ai-service web admin; do \
		echo "Building $$svc..."; \
		docker build -t kerjacus/$$svc:latest -f apps/$$svc/Dockerfile . 2>/dev/null || echo "No Dockerfile for $$svc"; \
	done

# ── Clean ──────────────────────────────────────────────
clean:
	rm -rf node_modules/.cache
	find . -name 'dist' -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	find . -name '.turbo' -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name 'coverage' -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	@echo "Clean complete"
