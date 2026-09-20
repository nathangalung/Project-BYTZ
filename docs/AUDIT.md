# System Audit — September 2026

Full-stack read-only audit of every service in `apps/`, run as five parallel
reviews (frontend, TypeScript backend, Go services, AI service, and
cross-cutting DB/security/infra). Findings are grouped by status and severity,
deduplicated where the same issue surfaced in more than one review, and each
carries a file reference so it can be picked up directly.

Scope note: the MCP browser tools were unavailable during this audit, so UI
findings come from reading the code and running the headless e2e suite, not
from live visual inspection. Live GUI review is still outstanding.

## Already fixed and deployed

- Login and register both broke in production once email delivery was
  configured: `requireEmailVerification` turned on as a side effect, register
  never routed to the verify page, and every seeded account was unverified.
  Fixed by gating enforcement behind an explicit `REQUIRE_EMAIL_VERIFICATION`
  flag (default off), routing register to `/check-email` when there is no
  session, and showing a real message on `EMAIL_NOT_VERIFIED`. Verified live:
  both flows return a session.
- The session middleware refused every organically registered account with
  `403 "Account suspended"` because it gated on `is_verified`, which defaults
  false at sign-up. It now gates on `deleted_at`. Verified live.
- `X-Service-Auth` was an edge-reachable admin credential: the gateway did not
  strip it and admin-service short-circuited on it before the role check. The
  gateway now strips it on every proxied location and admin-service no longer
  treats it as a bypass.

## Open blockers

- Project status transitions validate on an unlocked read and write
  unconditionally, so a cancel that refunds escrow can race a
  `matched -> in_progress` and leave a running project with its escrow
  returned. Needs a compare-and-swap on the status write plus `FOR UPDATE`
  and re-validation inside the transaction.
  `apps/project-service/src/repositories/project.repository.ts`.
- A challenged Midtrans capture funds escrow: `fraud_status` is decoded and
  never read, and `capture` maps straight to `completed`. Money can be booked
  for a payment still under review or later denied.
  `apps/payment-service/internal/handler/webhook.go`.
- Admin sign-out does not clear the query cache, so the next operator on the
  same browser reads the previous operator's users, finance rows and disputes
  from cache. `apps/admin/src/stores/auth.ts`.

## High — security

- The whole stack shares one flat external Docker network, so datastores
  (Valkey, NATS, MinIO, Temporal) and internal routes are reachable without
  the gateway. `docker-compose.prod.yml`. Fix: a second non-external network
  for datastores and non-ingress services.
- One static `SERVICE_AUTH_SECRET` spans five services and also keys the
  upload-token HMAC. Split the upload key out now; scope the service secret
  per callee.
- The session cache key is the first 64 bytes of the raw cookie, not a hash:
  two callers sharing a cookie prefix collide and receive each other's session.
  `apps/project-service/src/middleware/session-cache.ts`. Fix: SHA-256 the
  cookie value.
- The three Go services have no rate limiting, including the public Midtrans
  webhook and DLQ reprocess.
- `assertProjectParties` admits terminated and unaccepted talents, so a
  removed talent can be seated in a live project chat thread.
  `apps/project-service/src/lib/project-access.ts`.
- Non-constant-time comparison of the service secret on
  `POST /api/v1/matching/recommend`. `apps/project-service/src/routes/matching.ts`.
- `change-password` verifies the old password by HTTP-POSTing sign-in to
  itself: it mints a throwaway session per attempt, shares one rate-limit
  bucket platform-wide, and reports 429 as a wrong password. Use
  `auth.api.changePassword` in-process. `apps/auth-service/src/routes/me.ts`.

## High — data and correctness

- Cancellation refund walks deposits with no `ORDER BY` while idempotency keys
  freeze per-deposit amounts, so a retry in a different row order under- or
  over-refunds silently. `apps/project-service/src/lib/escrow-refund.ts`. The
  dispute path already orders; apply the same.
- OTP attempt counter is a lost update, so the five-attempt cap does not hold
  under parallel guesses. `apps/auth-service/src/routes/phone-verification.ts`.
- `incrementRevisionCount` writes milestone status with no compare-and-swap; a
  concurrent approve can release escrow and then lose the status write, paying
  a talent while returning the work to them.
  `apps/project-service/src/repositories/milestone.repository.ts`.
- `talent_skills` has no primary key and no index leading with `skill_id`, so
  the first stage of every staffing query sequentially scans; the missing PK
  also blocks the read-replica step in the data roadmap.
- Twelve tables carry no index beyond their primary key; the ones that hurt
  now are `project_status_logs(project_id, created_at)` (two hourly sweeps
  scan the whole audit table), `tasks(milestone_id)`, `milestone_files`, and
  `dead_letter_events`.
- `chat_participants` has no index leading with `user_id`, so listing a user's
  conversations scans the table.

## High — availability and scale

- No application container declares a healthcheck, though the endpoints exist
  and work; the orchestrator routes to cold or wedged containers.
- project-service cannot run more than one replica: two scheduled sweeps
  (`runPenaltyJobs` and the embedding/skill backfill) take no advisory lease,
  so a second replica double-applies penalties and double-charges the
  embedding provider. `apps/project-service/src/services/scheduled-jobs.ts`.
- No retry, backoff, or circuit breaker on any model call in ai-service; one
  transient upstream blip fails a BRD or empties a RAG context.
  `apps/ai-service/app/services/llm.py`, `embedding.py`.
- The outbox publisher has no backoff: three failed ticks against unreachable
  NATS permanently dead-letter `payment.settled`, leaving a paid owner with a
  locked document. `apps/payment-service/internal/publisher/outbox.go`.

## Medium and lower

Recorded in the per-area reports and worth batching:

- Frontend: talent dashboard redirect loop on any non-404; checkout stuck
  spinner on popup close; matching page fans out 2N requests before first
  paint; owner dashboard stat cards count one page not the total; scoping chat
  never auto-scrolls; two API clients and two auth stores that diverge on
  timeout, session-ended handling, and error mapping (extract one shared
  client).
- AI service: model numbers reach arithmetic uncoerced and 500 the BRD route;
  synchronous document parsing blocks the event loop; the vector arm has no
  cosine floor; retrieved text and revision instructions reach prompts without
  a data fence.
- Go services: idempotency claim held for seven days loses a notification on
  crash; email failure is logged then acked; pool queries issued inside an
  open transaction can self-deadlock at the default `MaxConns`; no explicit
  pool sizing.
- DB: the twelve `NOT VALID` CHECK constraints from migration 0029 were never
  validated; partition-target tables cannot be partitioned as keyed; escrow
  balance has no non-negative constraint.

## Verdict on further microservice splitting

Not warranted. The current split is nominal: seven services share one Postgres
database in one `public` schema with no enforced boundary, one service secret,
and one flat network, with project-service holding in-process singletons. That
is a distributed monolith paying the cost of distribution without the
isolation. The work that pays is consolidation, not more splitting: move each
domain into its own schema with per-service grants, scope the shared secret per
callee, and move the sweeps and outbox worker out of project-service into the
`project-worker` container so project-service becomes stateless and replicable.

## Suggested order

1. Blockers: project status CAS, Midtrans `fraud_status`, admin cache clear.
2. Security batch: split the Docker network, hash the session-cache key, add
   rate limiting to the Go services, split the upload-token key.
3. One index migration: FK indexes on the bare tables, `skill_id` and a real
   primary key on `talent_skills`, `user_id` on `chat_participants`.
4. Availability: app healthchecks, lease the two unleased sweeps, outbox
   backoff, ai-service retry and breaker.
5. Correctness batch: refund ordering, OTP counter, revision-count CAS,
   change-password in-process.
6. Frontend batch: extract the shared API client and auth store, then the
   individual redirect and rendering fixes.
