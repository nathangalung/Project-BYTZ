# KerjaCUS! — Managed Marketplace Platform

Managed marketplace for digital projects in Indonesia. An owner submits a project need, AI produces the business and technical documents, and the platform matches the work to curated talent. The repo is named `BYTZ` and package names keep that prefix; `KerjaCUS!` is the product name in the UI.

## Architecture

```
  Web (5173)          Admin (5174)
  Owner + Talent      Admin only
        |                   |
        +---------+---------+
                  |
          nginx API gateway
     (path routing, CORS, internal-route denial)
                  |
  +---------+-----+-----+---------+---------+
  |         |           |         |         |
 Auth    Project    Payment    Notif     Admin      AI
 3001      3002       3004      3005      3006     3003
  |         |           |         |         |        |
  +---------+-----------+---------+---------+--------+
                  |
   PostgreSQL 17 + pgvector, PgBouncer, Valkey,
   NATS JetStream, MinIO, Temporal, Centrifugo
```

In production Dokploy's Traefik terminates TLS and routes by host; nginx sits behind it and routes by path. Both dev and prod render the same `apps/gateway/nginx-api-gateway.conf.template`.

**Web** (5173) — React 19, TanStack Router, Tailwind v4. Owners create projects, talent browses and applies.

**Admin** (5174) — separate app, separate login, separate API. Dispute mediation, user management, finance dashboard.

**Backend** — three Hono services (auth, project, admin-facing web APIs), three Go services (payment, notification, admin), one Python FastAPI service (AI). Async events over NATS JetStream, sync calls over REST.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.3, Go 1.26, Python 3.12 |
| Frontend | React 19, TanStack Router v1, TanStack Query v5, Zustand v5, Tailwind v4 |
| Backend | Hono v4 (TypeScript), Fiber v2 (Go), FastAPI (Python) |
| Database | PostgreSQL 17 + pgvector, Drizzle ORM, PgBouncer |
| Cache | Valkey (rate limiting, consumer idempotency) |
| Auth | Better Auth v1.5 (email+password, phone OTP, Google OAuth) |
| State Machine | XState v5 (18 project states) |
| LLM | z-ai/glm-5.3 via OpenRouter; embeddings voyage-4-large at 1024 dims |
| Message Broker | NATS JetStream |
| Workflows | Temporal (escrow release, team formation, dispute resolution) |
| Real-time | Centrifugo v6 |
| Observability | OpenObserve (logs + traces + metrics), OpenTelemetry |
| Monorepo | Turborepo, Bun workspaces |
| Linting | Biome 2 |
| Testing | Vitest 4, Playwright, godog, pytest |
| CI/CD | GitHub Actions, Dokploy |

## Quick Start

```bash
# Prerequisites: Bun 1.3+, Docker, Go 1.26, uv

git clone https://github.com/nathangalung/Project-BYTZ.git
cd Project-BYTZ
make install

make docker-up    # postgres, pgbouncer, valkey, nats, minio, gateway, centrifugo, temporal
make setup        # migrate + seed + storage + nats streams
make dev          # all services and both frontends

# Web:   http://localhost:5173
# Admin: http://localhost:5174
```

## Project Structure

```
apps/
  web/                 # Owner + talent frontend (5173)
  admin/               # Admin panel (5174)
  auth-service/        # Better Auth, sessions, OTP (3001)
  project-service/     # Projects, milestones, matching, chat (3002)
  ai-service/          # BRD/PRD generation, CV parsing, RAG (3003)
  payment-service/     # Escrow, ledger, Midtrans (3004)
  notification-service/# In-app, email, Centrifugo fan-out (3005)
  admin-service/       # Admin API, dashboard queries, audit (3006)
  gateway/             # nginx template, Centrifugo and Temporal config

packages/
  shared/              # Zod schemas, types, constants, error codes, pricing
  db/                  # Drizzle schema (46 tables), migrations, seed, test harness
  nats-events/         # Event subjects, publisher helpers, outbox
  logger/              # Pino config, correlation ID middleware
  config/              # Zod env validation per service
  ui-kit/              # Formatters and design tokens shared by web and admin
  go-observability/    # Canonical OTLP bootstrap, generated into each Go service
```

Some cross-language tables are generated, not hand-written: the fee brackets, the scoping completeness keywords, the notification templates, and the Go OTLP helpers all have one canonical source in `packages/` and a CI gate that fails on drift.

## Commands

```bash
make setup        # install + docker + migrate + seed
make dev          # all services and frontends
make stop         # stop everything
make check        # lint + typecheck + test
make test         # Vitest across workspaces
make test-all     # plus Go and Python suites
make test-cov     # with coverage thresholds
make build        # build all workspaces
make docker-build # build images
make db-reset     # drop and recreate the database
```

## Auth

Email is required and unique. Phone is optional at signup (null until an OAuth user adds one) and unique when set. Login accepts either.

```bash
curl -X POST http://localhost:3001/api/v1/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"Pass1234!","role":"talent"}'

curl -X POST http://localhost:3001/api/v1/auth/sign-in/email-or-phone \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"Pass1234!"}'
```

Admin accounts cannot sign in to the main app. Admin has its own login on 5174.

## RBAC

| Role | App | Access |
|------|-----|--------|
| Owner | Web (5173) | Create projects, review BRD/PRD, approve milestones, pay escrow |
| Talent | Web (5173) | Browse and apply, work packages, time tracking, profile |
| Admin | Admin (5174) | Mediation, users, finance, disputes, DLQ, audit log |

Talent tiers and internal ratings exist but are never shown to owners or to talent. They feed matching and admin monitoring only.

## Public Access

No login required:

- `/browse-projects` — projects that are matching or further along
- `/project-detail/:id` — project detail, minus owner budget band and platform economics
- `/request-project` — the intake wizard; submitting requires login

## API Endpoints

All routes are versioned under `/api/v1`. Two services publish OpenAPI docs: `/api/v1/auth/docs` and `/api/v1/projects/docs` (Scalar). The AI service serves FastAPI's own `/docs`.

### Auth Service (3001)
- `POST /auth/sign-up/email`, `POST /auth/sign-in/email-or-phone`
- `POST /auth/forget-password`, `POST /auth/reset-password`
- `GET /me`, `PATCH /me`
- `POST /phone/request-otp`, `POST /phone/verify-otp`

### Project Service (3002)
- `GET /projects/public`, `GET /projects/stats`, `GET /projects/available`
- `POST /projects`, `POST /projects/:id/transition`
- `GET /projects/:id/brd`, `GET /projects/:id/prd`
- `POST /matching/recommend`, `POST /assignments/:id/accept`
- `POST /applications`, `POST /talent-profiles`, `POST /talent-profiles/parse-cv`
- `GET /projects/:id/milestones`, `PATCH /milestones/:id/status`
- `POST /chat/stream`, `GET /chat/conversations`
- `GET /reviews/public`

### AI Service (3003)
- `POST /ai/chat`, `POST /ai/chat/stream` (SSE), `POST /ai/generate-brd`, `POST /ai/generate-prd`
- `POST /ai/parse-cv`, `POST /ai/parse-spec`, `POST /ai/embed-document`

### Payment Service (3004)
- `POST /payments/create-snap-token`
- `POST /payments/webhook/midtrans`
- `POST /payments/internal/release`, `/internal/refund`, `/internal/escrow-balance`

Escrow is only ever credited by a settled Midtrans payment. The `internal/` prefix is service-to-service and nginx refuses to proxy it.

### Notification Service (3005)
- `GET /notifications`, `PATCH /notifications/:id/read`, `GET /notifications/unread-count`

### Admin Service (3006)
- `GET /admin/dashboard`, `GET /admin/users`, `GET /admin/projects`, `GET /admin/disputes`, `GET /admin/dlq`

## Database

46 tables in one PostgreSQL 17 database, all in schema `public`. Domain separation is by Drizzle schema file, not by PostgreSQL schema, so nothing is enforced at the database boundary. UUID v7 primary keys, `timestamptz` everywhere, soft delete on users, projects, and transactions.

Key tables: `user`, `talent_profiles`, `projects`, `work_packages`, `project_assignments`, `milestones`, `contracts`, `disputes`, `transactions`, `accounts`, `ledger_entries` (double-entry), `chat_conversations`, `chat_messages`, `document_chunks` (pgvector), `outbox_events`.

There are no materialized views. Migration 0000 created some as plain tables and migration 0014 dropped them; the admin dashboard queries base tables directly.

## Pricing

The AI estimates a project price per work package. The sum picks one fee bracket, and the bracket splits that total into talent payout and platform fee. Talent receives 100% of the amount quoted to them; the fee is inside the price the owner sees.

```
final_price = talent_payout + platform_fee
```

The bracket table lives in `packages/shared/src/pricing.ts` and is generated into the Go payment service. The admin panel shows it read-only because the engine reads the constant, not the database.

## Matching

```
score = (skill_match × 0.30) + (pemerataan × 0.35) + (track_record × 0.20) + (rating × 0.15)
```

Epsilon-greedy: 30% of recommendation slots go to talent with few or no projects, 70% to best score. Talent with zero projects gets a further +0.2. The distribution weight is the largest one on purpose — the platform optimises for spreading work, not for ranking.

## Color Palette

| Color | Hex | Role |
|-------|-----|------|
| Dark Teal | `#152e34` | Brand anchor, primary fills |
| Slate Blue | `#3b526a` | Body text, info |
| Cream | `#f6f3ab` | Badges and highlights, never text |
| Green | `#9fc26e` | Success backgrounds and icons |
| Coral | `#e59a91` | Error backgrounds and badges |
| Gray | `#5e677d` | Secondary text |

Web supports light and dark through role tokens (`--color-brand`, `--color-brand-text`, and friends) rather than palette slots, because the same palette value has to read as text in one theme and as a fill in the other. Admin is dark-first with no toggle. Contrast is checked twice: arithmetic over the stylesheets, and a Playwright probe that composites real backgrounds in the browser.

## Environment Variables

Copy `.env.example` to `.env`.

```
DATABASE_URL=postgresql://kerjacus:kerjacus@localhost:6432/kerjacus
DATABASE_DIRECT_URL=postgresql://kerjacus:kerjacus@localhost:5432/kerjacus
REDIS_URL=redis://localhost:6379
NATS_URL=nats://localhost:4222
BETTER_AUTH_SECRET=<min-32-chars>
BETTER_AUTH_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:5173
OPENROUTER_API_KEY=
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_SANDBOX=true
EMAIL_FROM=KerjaCUS! <noreply@notify.kerjacus.id>
RESEND_API_KEY=
```

`VITE_*` variables are inlined at build time, so changing one needs a rebuild rather than a redeploy.

## Docker

```bash
make docker-up        # core infrastructure
make docker-up-all    # plus observability and monitoring profiles
make docker-build     # build service images
```

Local compose runs PostgreSQL 17, PgBouncer, Valkey, NATS, MinIO, the nginx gateway, Centrifugo, and Temporal (with its own database and UI). OpenObserve and Uptime Kuma are opt-in profiles. Production adds the eight application containers plus a migration job.

## Testing

```bash
make test         # Vitest: unit, integration, BDD
make test-all     # plus go test and pytest
make test-cov     # with per-workspace coverage thresholds
cd apps/web && bun run test:e2e   # Playwright, chromium
```

Coverage is gated per workspace and thresholds are baselines that only move up. Latest measured statement/branch/function/line:

| Workspace | Coverage | Tests |
|-----------|----------|-------|
| web | 99.01 / 97.33 / 99.06 / 99.65 | 2079 |
| admin | 99.33 / 98.27 / 100 / 100 | 479 |
| auth-service | 100 / 100 / 100 / 100 | 290 |
| project-service | 98.62 / 93.71 / 99.40 / 98.10 | 2329 |
| ai-service | 100 statements, 100 branches | 732 |

Go services sit between 97% and 99% statements. Integration tests run against a real PostgreSQL through `TEST_DATABASE_URL`; run `bun run db:test:setup` once first, or they skip while still reporting green.

The 42 Playwright tests cover what no other layer can see: contrast against composited backgrounds, dialog focus trapping, the real SVAR Gantt store, and the skip-to-content link. They mock the API, so they test the browser against the frontend, not the full service path.

## Conventions

Code, comments, identifiers, logs, and error codes are English. User-facing text goes through i18n (`t()`), Indonesian by default with English available. Comments stay under five words per section and exist only where the logic is not self-evident. No emoji or decorative separators in code.

`CLAUDE.md` holds the full architecture notes, including the code-writing rules under "Aturan Penulisan Kode" and a running log of defects with the reasoning behind each fix.

## License

Private, all rights reserved.
