# BYTZ — Virtual Software House Platform

Managed marketplace untuk proyek digital Indonesia. Client mengajukan kebutuhan proyek, AI menganalisis dan menghasilkan dokumen bisnis/teknis, platform mencocokkan dengan worker terkurasi.

## Architecture

```
┌─────────────┐  ┌──────────────┐
│  Web (5173)  │  │ Admin (5174) │
│ Client+Worker│  │  Admin Only  │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌──────────────────────────────────┐
│         Traefik (80)             │
└──┬──────┬──────┬──────┬──────┬──┘
   │      │      │      │      │
   ▼      ▼      ▼      ▼      ▼
 Auth  Project  Payment Notif  Admin
 3001   3002    3004    3005   3006
   │      │      │      │      │
   └──────┴──────┴──────┴──────┘
          │
    ┌─────┴─────┐
    │PostgreSQL │  Redis  NATS  MinIO
    │  (5432)   │  6379   4222  9000
    └───────────┘
```

**Web App** (port 5173) — React 19, TanStack Router, Tailwind v4. Client creates projects, worker browses and applies.

**Admin Panel** (port 5174) — Separate app, separate login. Dispute mediation, user management, finance dashboard.

**Backend** — 6 Hono microservices + 1 FastAPI AI service, communicating via NATS JetStream.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.3, Python 3.12 (AI) |
| Frontend | React 19, TanStack Router v1, TanStack Query v5, Zustand v5, Tailwind v4 |
| Backend | Hono v4 (TypeScript), FastAPI (Python) |
| Database | PostgreSQL 17 + pgvector, Drizzle ORM v0.45 |
| Auth | Better Auth v1.5 (email+phone, Google OAuth) |
| State Machine | XState v5 (18 project states) |
| AI Gateway | TensorZero (Rust, <1ms latency) |
| Message Broker | NATS JetStream |
| Real-time | Centrifugo v6 |
| Monorepo | Turborepo, Bun workspaces |
| Linting | Biome 2.4 |
| Testing | Vitest 4.1, 251 tests |
| CI/CD | GitHub Actions |

## Quick Start

```bash
# Prerequisites: Bun 1.3+, Docker, PostgreSQL client

# 1. Clone and install
git clone https://github.com/nathangalung/Project-BYTZ.git
cd Project-BYTZ
make install

# 2. Start infrastructure
make docker-up

# 3. Setup database
make setup    # or: bun run db:generate && bun run db:migrate && bun run db:seed

# 4. Start all services
make dev

# 5. Open browser
# Web:   http://localhost:5173
# Admin: http://localhost:5174
```

## Project Structure

```
apps/
  web/                 # Client + Worker frontend (port 5173)
  admin/               # Admin panel frontend (port 5174)
  auth-service/        # Authentication (port 3001)
  project-service/     # Projects, milestones, matching (port 3002)
  ai-service/          # AI/ML endpoints (port 3003)
  payment-service/     # Payments, escrow, ledger (port 3004)
  notification-service/# Notifications (port 3005)
  admin-service/       # Admin API (port 3006)
  gateway/             # Traefik + TensorZero + Centrifugo configs

packages/
  shared/              # Zod schemas, types, enums, error codes
  db/                  # Drizzle schema (48 tables), migrations, seed
  logger/              # Pino structured logging
  config/              # Zod env validation per service
  nats-events/         # NATS event subjects and types
  testing/             # Test fixture factories
```

## Commands

```bash
make setup        # Full setup (install + docker + db + seed)
make dev          # Start all services + frontends
make stop         # Stop all services
make check        # Lint + typecheck + test
make test         # Run 251 tests
make build        # Build all services
make docker-build # Build Docker images
make clean        # Remove artifacts
make db-reset     # Drop and recreate database
```

## Auth

Phone number and email are both required and unique per user. Login accepts either.

```bash
# Register
curl -X POST http://localhost:3001/api/v1/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"Pass1234!","phone":"+6281234567890","role":"client"}'

# Login (email or phone)
curl -X POST http://localhost:3001/api/v1/auth/sign-in/email-or-phone \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"Pass1234!"}'
```

Admin accounts are blocked from the main app. Admin uses separate login at port 5174.

## Seed Data

`bun run db:seed` creates:
- 8 users (1 admin, 2 clients, 5 workers)
- 35 skills, 5 worker profiles with portfolio
- 6 projects (draft → completed)
- Milestones, tasks, time logs, transactions
- Chat conversations, notifications, reviews

## Public Access

Anyone can browse without login:
- `/browse-projects` — all active/completed projects
- `/project-detail/:id` — full project detail
- `/request-project` — fill project request form (submit requires login)

## RBAC

| Role | App | Access |
|------|-----|--------|
| Client | Web (5173) | Create projects, review BRD/PRD, manage milestones, payments |
| Worker | Web (5173) | Browse projects, apply, time tracking, profile management |
| Admin | Admin (5174) | Mediation, user management, finance, disputes, audit log |

## API Endpoints

### Auth Service (3001)
- `POST /api/v1/auth/sign-up/email` — register
- `POST /api/v1/auth/sign-in/email-or-phone` — login
- `GET /api/v1/me` — current user profile
- `POST /api/v1/phone/request-otp` — phone verification

### Project Service (3002)
- `GET /api/v1/projects/public` — public project listing
- `GET /api/v1/projects/stats` — platform statistics
- `GET /api/v1/projects/available` — worker project discovery
- `POST /api/v1/projects` — create project
- `POST /api/v1/projects/:id/transition` — change status
- `POST /api/v1/matching/recommend` — worker matching
- `POST /api/v1/applications` — apply to project
- `POST /api/v1/worker-profiles` — create worker profile
- `GET /api/v1/reviews/public` — public reviews

### Payment Service (3004)
- `POST /api/v1/payments/escrow` — create escrow
- `POST /api/v1/payments/release` — release to worker
- `POST /api/v1/payments/webhook/midtrans` — payment webhook

### Notification Service (3005)
- `GET /api/v1/notifications` — list notifications
- `PATCH /api/v1/notifications/:id/read` — mark read

## Database

48 tables in PostgreSQL 17. Single `user` table (Better Auth). All FKs reference `user.id`.

Key tables: `user`, `projects`, `milestones`, `work_packages`, `transactions`, `accounts`, `ledger_entries` (double-entry bookkeeping), `reviews`, `disputes`, `chat_conversations`, `chat_messages`.

Materialized views for analytics: `mv_project_overview`, `mv_revenue_daily`, `mv_worker_stats`, `mv_matching_metrics`, `mv_ai_cost`.

## Matching Algorithm

```
score = (skill_match × 0.30) + (pemerataan × 0.35) + (track_record × 0.20) + (rating × 0.15)
```

Epsilon-greedy: 30% exploration (new workers), 70% exploitation (best scored). New workers get +0.2 boost.

## Color Palette

Dark editorial design based on brand colors:

| Color | Hex | Usage |
|-------|-----|-------|
| Dark Teal | `#152e34` | Main background |
| Slate Blue | `#3b526a` | Card backgrounds |
| Cream | `#f6f3ab` | Headlines, accent text |
| Green | `#9fc26e` | CTA buttons, success |
| Coral | `#e59a91` | Alerts, badges |
| Gray | `#5e677d` | Body text |

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

```
DATABASE_URL=postgresql://bytz:bytz@localhost:5432/bytz
REDIS_URL=redis://localhost:6379
NATS_URL=nats://localhost:4222
BETTER_AUTH_SECRET=<min-32-chars>
BETTER_AUTH_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:5173
```

## Docker

```bash
# Start infrastructure
docker compose up -d postgres pgbouncer redis nats minio traefik centrifugo openobserve

# All services (except ollama)
docker compose up -d

# Build images
make docker-build
```

14 Docker services: PostgreSQL 17, PgBouncer, Redis 7, NATS 2, MinIO, Traefik v3.6, TensorZero, Centrifugo v6, Temporal, Langfuse, OpenObserve, Uptime Kuma, Flagsmith.

## Testing

```bash
make test         # 251 tests, 8 test files
make test-cov     # with coverage (95% threshold per package)
```

Coverage: packages/shared 100%, packages/nats-events 100%, project-service state machine and matching algorithm tested.

## License

Private — all rights reserved.
