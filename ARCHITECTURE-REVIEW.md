# KerjaCUS (BYTZ) — Architecture Review

**Scope:** six verified domain audits, synthesized. Read-only analysis. Every claim below is anchored to a file I or the domain auditors opened; where a verifier corrected or refuted a finding, I say so rather than smoothing it over.

---

# 1. Executive verdict

**Not production-ready to custody escrow money — but the gap is narrower and more fixable than the raw finding count suggests.** The money code is more careful than most codebases at this stage: `payment-service` row-locks before settling, enforces idempotency keys, runs ledger writes in serializable transactions, and asserts `sum(debit) == sum(credit)` per transaction (`apps/payment-service/internal/store/ledger.go:141-158`). The double-entry ledger is append-only, so the truth is always reconstructable from `ledger_entries`.

**The single biggest structural risk is that nothing ever reconstructs it.** `accounts.balance` is maintained by application arithmetic (`ledger.go:203-208`), is the sole gate on releasing and refunding money (`internal/service/payment.go:211`, `:434`), and is never compared against the ledger anywhere in the repo — I grepped for `reconcil` across all Go, TS and Python source and the only non-vendor hits are two comments and an unrelated pricing test. Three independent paths can silently drift it: a gateway-initiated refund updates transaction status and writes **no ledger legs at all** (`internal/handler/webhook.go:160` gates the only ledger write on `newStatus == TxStatusCompleted`); the platform fee arrives as a caller-supplied integer validated only as `>= 0 && < Amount` (`payment.go:147`); and I confirmed by direct inspection that **no unique index exists on `accounts(owner_type, owner_id)`** — `packages/db/src/schema/payment.ts:104-114` declares the table with no index array at all, and no migration adds one — while `GetOrCreateAccountTx` (`ledger.go:270-294`) is a read-then-insert under Read Committed.

The rest of the platform is in better shape than that paragraph implies: authorization is applied consistently across ~15 route files, the Midtrans webhook signature check is correct, JetStream streams are provisioned with proper retention and dedup, and the frontend's code splitting is genuinely correct. **The pattern across all six audits is the same: the hard parts were done well and the seams between them were not.** Fix the seams — one HTTP client, one uniqueness constraint, one reconciliation query, one authz predicate — and this is a defensible escrow platform.

---

# 2. Critical problem areas

Ranked by leverage — how much risk one change retires. Where I merge findings from different audits under one root cause, I say so.

---

## 2.1 There is no shared outbound HTTP client — and three separate audits each found a different symptom of that

**Merges three findings across two audits, one root cause.** Architecture filed "no timeouts, no breaker" (critical). Cross-cutting filed the same thing twice more: "Cockatiel wired to 1 of ~8 call sites" and "trace context propagated over NATS but not over HTTP."

**What it is.** `apps/project-service/src/lib/service-auth.ts:16` is the only shared outbound helper and it composes headers only. Every internal call therefore re-specifies transport from scratch, and every one of them forgets something different:

| Call site | Timeout | Breaker | Trace |
|---|---|---|---|
| `lib/payment-client.ts:39` (refund) | ✗ | ✗ | ✗ |
| `lib/payment-client.ts:58` (release) | ✗ | ✗ | ✗ |
| `lib/payment-client.ts:86` (escrow-balance) | ✗ | ✗ | ✗ |
| `lib/document-generation.ts:56` (generate-brd) | ✗ | ✗ | ✗ |
| `lib/document-generation.ts:88` (generate-prd) | ✗ | ✗ | ✗ |
| `routes/upload.ts:132` (parse-cv) | ✗ | ✗ | ✗ |
| `routes/projects.ts:876`, `:1019` (ai/chat) | ✗ | ✗ | ✗ |
| `routes/projects.ts:1174` (parse-spec) | 60s | ✗ | ✗ |
| `middleware/session.ts:54`, `:91` | 5s | ✓ | ✗ |

`makeResilientPolicy` exists at `lib/resilience.ts:10-19` and has exactly one non-test importer: `middleware/session.ts:4`.

**Root cause.** Resilience was added reactively at the one place a hang was felt (auth-service flakiness taking down every request) and never generalized. Because `fetch` has no default timeout in Bun/undici, the absence is invisible until a downstream hangs rather than fails.

**Blast radius.** project-service is capped at 160M with no replicas (`docker-compose.prod.yml`), and it is the entire domain — so a slow ai-service saturates the owner and talent product, not just documents. The existing policy makes it worse: `retry(handleAll, …)` at `resilience.ts:11` retries *every* rejection, so a deterministic 400 from `/payments/release` becomes ~11s of held capacity across three attempts. Separately, the async half of the system is fully traceable (`packages/logger/src/nats-tracing.ts:37`, `outbox-worker.ts:48` even round-trips trace context through the DB) while the synchronous half is not — so "why did BRD generation take 90 seconds" is unanswerable across the boundary, which is exactly the question the observability stack was stood up for.

**Correction to carry:** cross-cutting's verifier read `node_modules/.bun/cockatiel@3.2.1/…/ExponentialBackoff` and confirmed `decorrelatedJitterGenerator` is already the default. **Do not "add jitter"** — that step in the audit is a no-op.

→ **Fix in §7.1.**

---

## 2.2 Money invariants have no enforcement point in any language

**Merges four findings across three audits.** DB filed two criticals (accounts race, balance never reconciled). API filed the gateway-refund ledger gap (high). Architecture and code-quality both filed the caller-supplied fee.

**What it is.** Four independent gaps, one shape — *the derived value is trusted instead of derived*:

1. **No unique index on `accounts(owner_type, owner_id)`.** I verified this myself: `packages/db/src/schema/payment.ts:104-114` has no third-argument index array (contrast `ledgerEntries` at `:131-134`, which has two), and no migration creates one. `GetOrCreateAccountTx` (`ledger.go:270-294`) is `FindAccountByOwnerTx` → `INSERT`, no `ON CONFLICT`, no lock, called from `webhook.go:246` and `:259` inside a `pgx.TxOptions{}` (Read Committed) transaction. Two concurrent Midtrans settlements for one project create two escrow accounts; `FindAccountByOwner` (`ledger.go:102-121`) then picks one arbitrarily with `LIMIT 1` and no `ORDER BY`. Balance splits, `ReleaseEscrow` rejects every payout with `insufficient escrow balance` for money that is in the ledger, and recovery is manual SQL.
2. **`accounts.balance` is never reconciled.** Confirmed by grep — no query anywhere compares it to `SUM(amount) FILTER (entry_type='debit') - SUM(… credit)`.
3. **Gateway-initiated refunds write no ledger legs.** `webhook.go:369-382` maps `refund`/`partial_refund` to `TxStatusRefunded`, `:358-367` permits `completed → refunded`, and the only ledger write in the handler is gated on `completed` at `:160`. After a Midtrans-dashboard refund the escrow balance still shows the deposit, and `ProcessRefund` short-circuits at `payment.go:330-332` forever, so the internal path can never correct the books.
4. **Platform fee is a caller-supplied integer.** `packages/shared/src/pricing.ts:21-34` is the only bracket table in any language (code-quality grepped all three — the good news is there is *no* duplication). The bad news is the inverse: Go cannot re-derive it, so `payment.go:147` validates only `FeeAmount >= 0 && FeeAmount < Amount`. `settle-milestone.ts:50` and `:54-60` deliberately return a fee of **0** on anomalous pricing data, which Go accepts as valid.

**Root cause.** The fee was correctly centralized as a TypeScript pure function, but its *output* was then persisted into `projects.platform_fee` / `work_packages.talent_payout` and those columns became the de facto source of truth. Nothing downstream can ask "is this still what the bracket says?" — and CLAUDE.md's documented CHECK constraints do not exist (zero CHECKs across all 22 migrations, confirmed).

**Blast radius — and one correction.** Architecture's verifier is right that a zeroed fee still leaves the ledger *balanced* (talent receives the full gross, debits equal credits). So this is **unrecognized platform revenue and a silent margin leak, not an unreconcilable ledger** — a real problem, but do not overstate it to the owner. The accounts race and the refund gap are the ones that strand actual money.

→ **Fix in §7.2.**

---

## 2.3 The outbox pattern is applied non-atomically, and two pollers race on one table

**Merges three findings across three audits** — cross-cutting (high), architecture (medium), DB (medium). One root cause with two halves.

**What it is.** `appendOutboxEvent(db, …)` takes a structurally-typed `DbLike` (`lib/outbox.ts:15-19`: anything with `.insert().values()`), so a pool handle and a transaction handle are indistinguishable at the call site. Of 36 call sites in project-service, **21 pass `tx` (correct), 12 pass `db`, 3 pass `getDb()` directly** (`scheduled-jobs.ts:16`, `activities/team-formation.activities.ts:69`, `routes/talent-placement.ts:216`). In all nine files using the `db` form, `db` is bound as `const db = getDb()` — verified, with `grep -rn "transaction(async (db"` returning zero, so no shadowing.

Second half: `outbox-worker.ts:35-41` (TS, 1s loop) and `apps/payment-service/internal/publisher/outbox.go:91-97` (Go, 1s ticker) issue a **byte-identical** `SELECT … WHERE published = false AND retry_count < 3 ORDER BY created_at LIMIT 100` against the same table. Neither filters by service ownership. Neither uses `FOR UPDATE SKIP LOCKED`.

**Blast radius.** Every one of the 15 non-atomic sites is a live dual-write window. The sharpest is `routes/milestones.ts:224`, whose own comment claims "Outbox commit gives us durability so a crash here cannot drop the invoice work" — it cannot, because there is no shared commit. Crash there and the milestone is approved, escrow settles, and no invoice row or PDF ever exists, with nothing retrying.

Two corrections to carry: cross-cutting's verifier downgraded this from critical to high because `milestone.approved` is emitted inside the repository's own transaction (`milestone.repository.ts:110`) and settlement has an idempotent backstop — so the loss is the invoice, **not the payout**. And architecture's `retry_count` inflation claim is **refuted**: `outbox-worker.ts:100` computes `(event.retryCount ?? 0) + 1` and assigns it, so two replicas both write 1 — a lost update, which makes premature dead-lettering *less* likely, not more.

What the other audits missed and cross-cutting caught: because neither poller filters by domain, payment-service publishes project-service's rows stamped `source: "payment-service"` (`outbox.go:21`) and vice versa (`outbox-worker.ts:70`). No consumer branches on `source` today, so it is cosmetic — but the field is unreliable for debugging. Duplicate *delivery* is contained by `msgID: event.id` plus `--dupe-window 2m` on every stream (`apps/gateway/nats-init-streams.sh:51-84`); duplicate **DLQ rows** are not, since both pollers insert into `dead_letter_events` with no uniqueness constraint.

---

## 2.4 Three different definitions of "on this project", one missing object-level check, and suspension that never takes effect

**Merges two API findings and one architecture finding.**

**(a) `isAssignedTalent` ignores assignment status.** `lib/project-access.ts:85-96` — I read it — joins `projectAssignments` filtering only on `projectId` and `talentProfiles.userId`. The enum includes `terminated` and `replaced` (`packages/db/src/schema/project.ts:69-74`), so the row survives termination. Two other call sites independently discovered the problem and hardened locally: `routes/projects.ts:375` filters `status = 'active'`, and `routes/invoices.ts:47` defines `WORKED_STATUSES = ['active','completed']` with a comment explaining exactly why. Three definitions now coexist.

Blast radius: `assertProjectAccess` gates milestone amounts, milestone files and comments, time logs, work packages and the dependency graph, status logs, the activity feed, the full PRD, and **Centrifugo subscription tokens for live project channels** (`routes/realtime.ts:51`). A talent terminated for abandonment — the exact case the platform penalizes — keeps indefinite live read access to their replacement's payment schedule. The verifier added it is a write path too (`milestones.ts:170-190`, integration-milestone submit).

**(b) IDOR on `PATCH /disputes/:id/status`.** I read `routes/disputes.ts:194-217`: the handler passes only `user.role` into `service.changeStatus`. No `assertProjectAccess`, no check the caller is `initiatedBy` or `againstUserId` — while its siblings at `:157-168` and `:180-182` do check. `'resolved'` is deliberately absent from `ADMIN_ONLY_STATUSES` (`dispute.service.ts:71-73`) and `open → resolved` is permitted (`disputes.ts:25-30`). Dispute ids are handed to the accused party by `GET /disputes/project/:projectId`.

The verifier **refuted** the scariest part: "escrow held with no API path to release, recoverable only by direct SQL" is wrong — the owner retains `disputed → cancelled`, which triggers `refundRemainingEscrow`. The real impact is denial of the dispute-resolution path (both `changeStatus` and `resolve` hard-stop on `DISPUTE_ALREADY_RESOLVED`) plus a falsified audit record with NULL resolution fields. Still high: any signed-in user can do it to any dispute id they can obtain.

**(c) Suspension does not revoke access, and the audit's proposed fix does not fix it.** Architecture proposed migrating the in-memory session cache to Valkey plus a `session.revoked` NATS subject. Its verifier found the actual mechanism: `admin-service`'s `SuspendUser` (`internal/store/users.go:226`) only sets `is_verified = false`; auth-service enforces that at `middleware/session.ts:55`, but `/api/v1/auth/get-session` — the endpoint project-service calls — is served by the Better Auth catch-all (`routes/auth.ts:155`), which never runs that middleware. project-service's `SessionUser` type (`middleware/session.ts:9-15`) has no `isVerified` field and no check anywhere. **A suspended user keeps full project-service access indefinitely, not for five minutes.** The Valkey migration is worth doing for the rate limiter, but an `isVerified` check on the session resolution path must land first and independently.

→ **(a) and (b) fixed in §7.3.**

---

## 2.5 The 14-day auto-release clock is unreliable in three distinct ways

**Merges architecture (high) and cross-cutting (high).**

1. **No timer at all if Temporal is unreachable at submit time.** `routes/milestones.ts:384-386`: `const client = await getTemporalClient(); if (!client) return`. `lib/temporal-client.ts:13-20` returns null on connect failure. The invocation is fire-and-forget (`milestones.ts:269-271`). No reconciliation sweep exists — `scheduled-jobs.ts:7-10` documents that the previous inline interval was deliberately removed.
2. **The revision cycle never resets the clock.** `milestones.ts:382` excludes `revision_requested` from the Temporal trigger, and `workflows/milestoneAutoRelease.ts:30` is a single `sleep(14d)` from workflow start. Submit at T0, revision at T0+3d, resubmit at T0+10d → auto-release still fires at T0+14d, giving the owner 4 days to review, not 14. Escrow releases on work the owner has not had the contractual window to review.
3. **The reassuring comment is false.** `milestones.ts:237` claims "the 14 day auto-release retries the payout." The verifier traced `workflows/milestoneAutoRelease.ts:30-34`: the workflow sleeps the *full* 14 days and only then checks `approved`, returning `{released:false, reason:'already_approved'}`. It never retries a failed inline settle — even when Temporal is up.

Drop one sub-claim: "a resubmission after day 14 gets no timer" is backwards — a closed workflow is exactly what `ALLOW_DUPLICATE` permits, so that case does get a fresh timer.

---

## 2.6 The penalty job re-penalizes talents on every process restart

**Cross-cutting (high), amplified by architecture's replica-hostility finding.**

`scheduled-jobs.ts:59-61` schedules `runPenaltyJobs` 30 seconds after **every boot**, unconditionally, on top of the 6-hour interval at `:56`. `penalty.service.ts:47-63` then applies a cumulative `+0.5` via `incrementPemerataanPenalty` for every row returned by `matching.repository.ts:257-276` — a pure time-window scan (`status='terminated' AND completedAt >= now()-6h`) with no `already_penalized` marker of any kind.

Three redeploys in an afternoon apply `+1.5` instead of `+0.5`. `pemerataan_penalty` feeds `1 / (1 + active*2 + completed*0.1 + penalty)`, so this directly suppresses a talent's recommendation score — **the fairness system that `apps/web/PRODUCT.md` names as the product's core differentiator.** Duplicate `talent.abandon_penalized` events also mean duplicate notifications.

Correction to carry: cross-cutting's proposed fix ("record penalties in the existing `talent_penalties` table") does not fit the schema — that table has no `assignment_id`, and `findRecentAbandons` returns no `projectId`, so it cannot populate `related_project_id` either. The minimal correct fix is a new nullable `assignment_id` column (or a boolean flag on `project_assignments`) with a unique index, applied in the same transaction as the increment. The advisory-lock half of the fix is correct as written.

---

## 2.7 apps/admin has no component layer, no API layer, and has already shipped user-visible defects

**Frontend audit, two findings, one root cause.** 4,658 LOC across 8 route files with **no `src/components` directory at all**, and no `src/lib/api.ts`. Measured: 6 byte-identical table scaffolds, 26 `<th>` cells sharing one class string, the loading/error/empty tbody triad repeated verbatim in 5 files, 3 slide-overs with identical markup, and 15 hand-written fetch wrappers across 24 call sites each re-implementing `credentials: 'include'`. `packages/ui`, which CLAUDE.md lists in the monorepo layout, does not exist.

This is not aesthetic. It has produced two real defects:

- **Silent truncation.** `users.tsx:187`, `projects.tsx:246`, `dlq.tsx:103`, `disputes.tsx:171` and `finance.tsx` all hardcode `page: 1` with no pagination control. Only `audit-log.tsx:106` paginates properly — evidence the others are oversight.
- **Wrong counts today, not at 101 users.** The verifier caught what the audit missed: `fetchUsers` sends `role` to the server, so with `roleFilter='owner'` the response contains only owners, and `users.tsx:218-222` derives `tabCounts.all = users.length` from that filtered array. The panel renders "All Users (N)" as the owner count with "Talents (0)" beside it — **at 3 users.**
- **Zero dialog semantics.** No `role="dialog"`, no `aria-modal`, no focus management anywhere in apps/admin. Five Escape handlers are attached to `tabIndex={-1}` elements (`_authenticated.tsx:49`, `users.tsx:421`, `projects.tsx:445`, `dlq.tsx:317`, plus web's `_authenticated.tsx:119`) and therefore can never fire — the element is never focusable, so it is never the keydown target. `apps/admin/PRODUCT.md:86` explicitly commits to keyboard navigation mattering more here than in the main app.

---

## 2.8 The test suite cannot catch a money regression

**Code-quality, two findings, same root cause.** 32 of 123 TypeScript test files `readFileSync` a sibling source file and assert on its **text**. `routes/invoice-audience-rule.test.ts:45` asserts `expect(source).toContain("const WORKED_STATUSES = ['active', 'completed'] as const")` — character-for-character including `as const` — and `:63-76` asserts on the ordinal position of `"return 'owner'"` within a sliced string. Invert the access check inside the function and every one still passes.

Compounding it: **every money test takes the fee as an input.** `payment_mock_test.go:1153` passes `Amount: 50000, FeeAmount: 24250` — 48.5%, the >Rp 30 juta rate, applied to a Rp 50.000 amount that brackets at 18.5% — then asserts debit == credit, arithmetic that cannot fail for any supplied fee. `invoice.service.test.ts:6` mocks `computeMilestoneFee` entirely, then injects 2,425,000 against a 5,000,000 gross while the same fixture's project declares 12,000,000 / 2,000,000 (16.7%, and a 12M project brackets at 33.5%). Nothing at any level composes "project priced at X → milestone settles at Y" and checks Y against the bracket table.

---

## Also true, lower leverage

- **CLAUDE.md contradicts the code in ~8 places**, and the doc is the onboarding artifact. Verified divergences: schema separation per service (zero `pgSchema`/`CREATE SCHEMA` anywhere — all six services share flat `public`); Valkey as session store / rate limiter / AI cache (only `notification-service` opens a Redis connection); `hc()` type-safe RPC in the frontend (grep for `hono/client` in `apps/web/src` returns **zero** hits — the audit's claim that it's "imported but untyped" is itself inherited from CLAUDE.md, not read from code); `@hono/zod-openapi` (project-service serves `paths: {}` at `index.ts:107-121`); `packages/testing` as shared test utilities (the directory contains only `.turbo/`, `coverage/` and `node_modules/` — no `package.json`, so it isn't even resolved as a workspace member); materialized views (dropped in migration 0014).
- **Traefik: do NOT follow the architecture audit's proposed fix.** Its own verifier refuted the finding. `docker-compose.prod.yml:609-612` joins the external `dokploy-network`, CI deploys via Dokploy (`ci.yml:294`), and Dokploy's Traefik consumes those labels. The real topology is **Dokploy Traefik (TLS + host routing) → nginx (path routing on the api host only)**. Deleting the labels at `:240-244`/`:257-260` as proposed would drop TLS for `observe.kerjacus.id` and `status.kerjacus.id`, for which nginx has no `location` block. Carry the doc amendment; discard the deletion.

---

# 3. Clean architecture breakdown

## The honest topology

`project-service` **is** the domain — 18 route groups plus fee arithmetic, escrow orchestration, PDF rendering, AI proxying, CV-parse orchestration and Centrifugo token signing (`src/index.ts:127-144`). The other five are integrations, not bounded contexts: `admin-service` performs five writes in its entire store layer and is otherwise a read-only BI layer over project-service's tables. The services were split along *technology* lines (Go for money, Python for LLMs) rather than bounded contexts.

**Do not re-split.** That shape is right for this stage. What must change is that CLAUDE.md justifies microservices with "adding a new domain only needs a new service without changing existing ones" — which is false, because lifecycle, matching, escrow and documents all live in project-service. Amend the doc to describe **one domain core plus four integration services**, so future work is planned against the real graph. Also delete `ai-service`'s `/match-talents` (`app/routes/ai.py:1596-1612`), which POSTs back to project-service's own `/api/v1/matching/recommend` and remaps field names — a phantom cycle with no caller outside its own test.

## Layer responsibilities (project-service)

```
route handler   parse + validate (Zod) + authorize + shape response.   NO db access.
service         business rules, transaction boundaries, outbox emission.
repository      Drizzle queries only. Accepts a tx handle.
adapter (lib/)  outbound I/O: serviceFetch, temporal-client, s3, centrifugo.
```

The layer exists and is bypassed: `routes/projects.ts` holds **35 direct `getDb()`/`db.select|insert|update|transaction(` call sites** while importing `ProjectRepository`, `WorkPackageRepository`, `ProjectService` and `PaymentSettlementService` at `:47-50`. `routes/milestones.ts:212-218` inserts a comment row from the handler, then at `:246-260` runs a raw `count(*)` before constructing `new ProjectService(new ProjectRepository(db))` on the next line. `project.service.ts` is 4.8K against a 58.2K `projects.ts`.

Nothing enforces it. Add a `no-restricted-imports` rule banning `@kerjacus/db` from `src/routes/**` — as a **warning with per-file overrides first**, since 58+ existing call sites would fail it on day one.

## What must stop crossing boundaries

1. **Authorization must have exactly one definition.** Three exist (`project-access.ts:85`, `projects.ts:375`, `invoices.ts:47`), and `payment-service` has a fourth in Go (`internal/store/transaction.go:408-412`).
   **Reject** the architecture audit's proposed fix of a synchronous `/internal/projects/:id/access` call from Go — its own §2.1 finding says that call would have no timeout or breaker, putting money-path authz behind the exact gap flagged as critical. Use a shared SQL fragment or a generated Go constant. No network hop on the authz path.
2. **`appendOutboxEvent` must be structurally impossible to call outside a transaction.** Brand the type; do not rely on discipline.
3. **Outbound HTTP must go through one adapter.** No bare `fetch` to another service.
4. **Route handlers must not import `@kerjacus/db`.**
5. **Go services must not silently depend on Drizzle's schema.** Add a CI job running the Go integration tests against a DB built from current migrations, so a rename fails the build instead of the deploy.

## Patterns that genuinely apply

- **Outbox** — already implemented, correct at 21 of 36 sites. Fix atomicity + ownership. Keep.
- **Circuit breaker + timeout** — one per downstream. Highest leverage single change in the codebase.
- **Bulkhead** — worth adding to the same wrapper for ai-service specifically: it fronts a rate-limited paid API, and capping concurrent in-flight generations bounds both cost and event-loop pressure.
- **Idempotent consumer** — already correct in `notification-service` (`internal/idempotency/idempotency.go:29-58`, Valkey, 7-day TTL). Genuinely good; leave it.
- **Repository / hexagonal-lite** — the layer exists; enforce the boundary rather than redesigning.
- **Saga via Temporal** — three workflows defined and a `project-worker` container runs them. Real. Extend it (auto-release reconciliation, penalty cron) rather than adding a second scheduler.

## Patterns the codebase claims but should NOT adopt yet

- **Full CQRS with denormalized read models from NATS.** Documented as "Tahap 3." There is no production traffic. Adding eventual consistency to a system that currently has one correctness problem per seam would multiply the seams.
- **Read replicas.** Same reason. Cap the admin dashboard's date range instead — 5 lines versus a replication topology.
- **PostgreSQL schema separation (`pgSchema` per domain).** Correct in principle, and CLAUDE.md claims it exists. But it is a full-table migration touching three languages, and the *actual* risk (Go breaking on a Drizzle rename) is retired by a contract-test CI job costing a fraction as much. Defer until the contract tests exist.
- **Materialized views + pg_cron.** Migration 0014 already removed the fake ones. `pg_cron` is not installed. Sargable queries plus a 60s Valkey cache beat this at every scale you will see this year.
- **ClickHouse / dedicated analytics DB.** Two years out. Say so.
- **ML matching (CatBoost/MLflow/Thompson Sampling).** Needs 100+ completed projects. There are zero.
- **`packages/ui` as a cross-app design system.** apps/admin needs five local primitives, not a shared package. A shared package now means versioning overhead between two apps with genuinely different visual languages.
- **XState.** This one should be actively *reduced*. `lib/state-machine.ts` encodes the same graph four times (`EVENT_TO_STATUS:29`, `STATUS_TO_EVENTS:55`, `VALID_TRANSITIONS:77`, machine states `:100-210`), and `validateTransitionViaXState:265` calls `findTransitionEvent:222` first, which returns null unless `VALID_TRANSITIONS` **already approved** the target (`:228-231`). XState can therefore never reject a transition the map allows nor allow one it forbids. `:283-286` hand-mutates a snapshot and casts the event `as unknown as ProjectEvent`. It is a runtime dependency asserting that a table agrees with itself. Generate the maps from one authority, or drop XState and keep `VALID_TRANSITIONS`.
- **BFF layer.** Not needed. apps/admin needs an `api.ts`, which is 40 lines, not a service.

---

# 4. Proposed folder structure

Only the parts that need it. No speculative structure.

## apps/project-service

**Before (what matters):**
```
src/
  index.ts                  # mounts 18 routes AND starts 3 background singletons at import (:150-152)
  routes/                   # 35 direct db calls in projects.ts alone; 58.2K file
  services/                 # exists, partially adopted; project.service.ts is 4.8K
  repositories/             # 10 real implementations, routinely bypassed
  lib/                      # resilience.ts (1 importer), service-auth.ts (headers only), 8 bare fetches
  workers/temporal-worker.ts # correctly extracted already
```

**After:**
```
src/
  index.ts                  # HTTP only. No setInterval, no pollers.
  workers/
    temporal-worker.ts      # unchanged
    background.ts           # NEW entrypoint: outbox poller + scheduled jobs, run in project-worker
  lib/
    http/
      service-fetch.ts      # NEW: the one outbound client (timeout + breaker + trace + opt-in retry)
      upstream-error.ts     # NEW: typed upstream failure; carries status, never leaks body to client
    resilience.ts           # rewritten: per-service breakers, 5xx/network predicate
    outbox.ts               # DbLike branded to a tx type -> the 15 bad sites become compile errors
    payment-client.ts       # thin: builds payloads, calls serviceFetch
    document-generation.ts  # thin: same
    project-access.ts       # single source of truth for "on this project"
  routes/
    projects/               # split the 1818-line file by concern, NOT by size
      index.ts              # CRUD + list + browse
      documents.ts          # brd/prd generate, revise, pdf, paywall  (~600 lines today, 2 near-identical handlers)
      scoping.ts            # chat, chat/stream, upload-spec, scoping-status
      lifecycle.ts          # transition, status logs
```

| Move | Why |
|---|---|
| `index.ts` → `workers/background.ts` | The outbox poller and penalty scheduler are why project-service cannot be scaled to 2 replicas. `project-worker` already exists in prod compose and already owns Temporal. |
| `lib/http/service-fetch.ts` | One change point retires the timeout gap, the breaker gap and the HTTP trace gap simultaneously. |
| `routes/projects/documents.ts` | The BRD and PRD revision handlers are near-identical 110-line blocks (`:1599-1717`, `:1725-1818`); the generate handlers repeat the same limit→generate→upsert→transition sequence. Colocating them is the precondition for parameterizing them. |
| Branding `DbLike` | Converts a cultural invariant into a compile error at 15 sites. |

**Explicitly not proposed:** decomposing `projects.ts` by line count. The value is getting the money- and status-mutating paths behind services, not shrinking a file.

## apps/web

Structurally sound — `autoCodeSplitting: true` in both vite configs, SVAR Gantt reachable only from `projects/$projectId/milestones.tsx:6`, Recharts only from `time-tracking.tsx:17`, and the repeated `components/project/*/shared.ts` files are healthy per-feature colocation (one documents a deliberate 1635-line wizard decomposition). Three additions only:

```
src/
  lib/
    status.ts               # NEW: projectStatusStyle(status) keyed exhaustively off ProjectStatus
    i18n.ts                 # CHANGED: dynamic import per language, not 18 static imports
  components/ui/
    status-badge.tsx        # NEW: consumes lib/status.ts
    timer-display.tsx       # NEW: owns its own 1s interval
```

| Move | Why |
|---|---|
| `lib/status.ts` | Five independent status→colour maps have drifted: `matching` renders four different colours across `detail/shared.tsx:27`, `list/shared.ts:66`, `dashboard.tsx:105`, `browse.tsx:27`, and `browse.tsx` omits draft/scoping/brd_* entirely so they render unstyled. Keying off the `ProjectStatus` union makes an unhandled member a build failure. |
| `TimerDisplay` | `time-tracking.tsx:95-109` ticks `setTimerSeconds` every second in the same component as an unmemoized sort/group/reduce block (`:203-222`) and a Recharts tree. Extracting the readout re-renders ~10 lines instead of 634. |
| i18n dynamic import | 105KB raw of locale JSON in the entry chunk, of which one language is always dead weight. |

## apps/admin

**Before:** `src/{lib,locales,routes,stores}` + `main.tsx`. That is the whole app.

**After:**
```
src/
  lib/
    api.ts                  # NEW: mirrors web's apiFetch/apiUrl, incl. VITE_API_URL support
  hooks/
    use-admin-list.ts       # NEW: {rows,total,page,setPage,isLoading,isError}
  components/
    ui/
      data-table.tsx        # absorbs 6 scaffolds + the loading/error/empty triad + pagination footer
      slide-over.tsx        # absorbs 3 panels; the ONE place dialog a11y is written
      status-badge.tsx      # absorbs 8 pill strings + 11 Record<> colour maps
      filter-bar.tsx        # absorbs the shared search input + pill tabs
  routes/_authenticated/    # unchanged paths, ~600-900 fewer lines
```

Estimated removal: **600–900 lines with no behavior change**, plus it fixes the truncation and the dead Escape handlers in one pass because the pagination footer and the focus trap ship inside the primitives.

## packages/*

```
packages/
  shared/
    src/
      pricing.ts            # unchanged - correctly the only bracket table in any language
      pricing-guard.ts      # NEW: assertFeeMatchesBracket(gross, payout) for the settle path
      status-tuples.ts      # NEW: const-object -> readonly tuple for z.enum
      constants.ts          # PRUNE: 8 of 18 constants have zero consumers
  db/
    tsconfig.build.json     # NEW: excludes seed.ts (6223 lines type-checked on every build, never shipped)
  testing/                  # DELETE (no package.json; not a workspace member; CLAUDE.md lists it twice)
```

| Move | Why |
|---|---|
| `status-tuples.ts` | Seven route files retype status literals locally (`talents.ts:9`, `talent-profiles.ts:56`, `disputes.ts:20`, `applications.ts:19`, `contracts.ts:17`, `reviews.ts:11`, `work-packages.ts:24`). Adding a DB enum value silently leaves them rejecting it. The cause is mechanical: Zod's `z.enum` wants a readonly tuple, the shared enums are `as const` objects. |
| Prune `constants.ts` | `AUTO_RELEASE_DAYS`, `RATE_LIMITS`, `HEALTH_WEIGHTS`, `REVISION_FEES` and 4 others have **zero** consumers, while `milestoneAutoRelease.ts:13` redeclares `14 * 24 * 60 * 60 * 1000` and `rate-limit.ts:85-91` redeclares `100 / 60_000`. Changing `AUTO_RELEASE_DAYS` to 7 today is a no-op that looks like a config change. |
| Delete `packages/testing` | A declared-but-empty workspace is the worst of the three options. |

Leave `seed.ts` where it is — it correctly imports `computeProjectPricing` and routes all pricing through `priced()`/`pkg()` helpers, so it cannot drift. Its size is data volume, not duplication. Do add the `NODE_ENV` guard (§5).

---

# 5. Refactoring strategy

Dependency-ordered within each group.

## (A) Safe now — no behavior change

| # | Item | Effort | Risk of not doing |
|---|---|---|---|
| A1 | **`serviceFetch` + rewritten `resilience.ts`; migrate all 8 outbound calls** (§7.1) | M | One slow downstream saturates the only instance of the entire domain service. Retiring 3 findings at once. |
| A2 | **Add `AbortSignal` to the SSE send path** (`hooks/use-chat.ts:155`) | S | Navigating away mid-generation leaks the connection and lets billed Gemini generation run to completion. The load path already does this correctly (`:38`); only the send path was missed. Swallow the resulting AbortError at `:228` or it surfaces as a chat error. |
| A3 | **Ownership predicate + `FOR UPDATE SKIP LOCKED` on both outbox pollers; unique index on `dead_letter_events(original_event_id)`** | M | Duplicate DLQ rows corrupt the admin viewer's counts and make re-process double-fire; scaling either service past one replica is unsafe. |
| A4 | **Brand `DbLike` to a tx type; fix the 3 `getDb()` sites first** (`talent-placement.ts:216`, `team-formation.activities.ts:69`, `scheduled-jobs.ts:16`) | S (brand) + L (15 sites) | Silent, unreconciled event loss on the money and matching paths. Note honestly: wrapping the 15 requires threading a tx through `MilestoneService`/`WorkPackageService` — larger than the audit implied. |
| A5 | **Reconciliation query for `accounts.balance` vs `ledger_entries`**, run on a schedule and exposed in admin. Alert, do not auto-correct. | S | Balance drift is currently undetectable. Cheap because `idx_ledger_account_created` already exists. |
| A6 | **`no-restricted-imports` on `@kerjacus/db` from `src/routes/**`, as a warning** | S | The 58-site divergence keeps growing. |
| A7 | **`queryClient.clear()` + `disconnectCentrifugo()` in `stores/auth.ts` logout** (and admin's) | S | Cross-account data exposure on a shared machine. Correction: the audit's claim that user A's pushes invalidate user B's queries is wrong — `use-notifications.ts:105-117` does tear down the subscription. The real second effect is that the singleton stays connected on A's token, so B's `notifications#B` subscribe is **rejected** and B gets no realtime until a page reload. Same three-line fix. |
| A8 | **apps/admin: `lib/api.ts` + `DataTable`/`SlideOver`/`StatusBadge`/`FilterBar` + `useAdminList`** | M | Wrong tab counts today; six-file edits for any cross-cutting change; no keyboard dismissal on any panel. |
| A9 | **Cache `getAllSkillEmbeddings()`** (`matching.repository.ts:84-107`) at startup / in Valkey | S | ~6MB of vector(768) data re-materialized per matching request for admin-managed master data that changes rarely. Free win. |
| A10 | **Fix the invoice over-fetch** (`routes/invoices.ts:228-230` filters in JS after loading all project invoices) | S | Query-scope bug independent of pagination. |
| A11 | **Delete `packages/testing` + its two CLAUDE.md entries; delete `ai-service`'s `/match-talents`; exclude `seed.ts` from the db build tsconfig** | S | Docs lie about the monorepo shape; a phantom service cycle; 6223 lines type-checked per CI run for nothing. |
| A12 | **Amend CLAUDE.md** on: no schema separation, Valkey used only for consumer idempotency, no `hc()` in the frontend, empty OpenAPI spec, and the two-tier Dokploy-Traefik→nginx topology | S | It is the onboarding document and it is wrong in ~8 places. Do **not** delete the Traefik labels. |

## (B) Needs care — no behavior change, but sequencing or migration risk

| # | Item | Effort | Risk of not doing |
|---|---|---|---|
| B1 | **Unique index on `accounts(owner_type, owner_id)` + `ON CONFLICT` in `GetOrCreateAccountTx`** (§7.2) | M | Duplicate escrow accounts strand funds and block payouts with a misleading error. Care: a cleanup migration merging duplicates and re-pointing `ledger_entries.account_id` **must** precede index creation or the deploy fails. |
| B2 | **`isAssignedTalent` status filter + dispute IDOR** (§7.3) | S | Terminated talents keep live project read access including Centrifugo tokens; any signed-in user can permanently disable the dispute-resolution path on any dispute. |
| B3 | **`isVerified` on the session resolution path**, before any Valkey work | S | Admin suspension does nothing to existing sessions. Do this first; the Valkey migration does not fix it. |
| B4 | **Valkey-backed rate limiter**, IP-keyed in front of `sessionMiddleware` **plus** a second user-keyed limiter behind it | M | Reject the API audit's proposal to *move* the limiter after session resolution — that makes every unauthenticated flood request do a Better Auth lookup before being throttled. Current live defects are restart-reset buckets and NAT-shared/IPv6-cheap bucketing; replica multiplication is latent (single replica today). |
| B5 | **Reverse the ledger on gateway-initiated refunds** (`webhook.go` refunded branch), guarded on `txn.Type == TxTypeEscrowIn`, plus a `payment.refunded` outbox event | M | Escrow over-reports after a dashboard refund; the next milestone pays a talent out of refunded funds, and the internal refund path is permanently blocked. Note: the partial_refund sub-case is **unverified** — `webhook.go:99-105` rejects unless `paidAmount == txn.Amount`, and what Midtrans sends in `gross_amount` on a partial refund cannot be determined from this repo. |
| B6 | **Advisory lock + assignment-level dedup on the penalty job** (needs a small migration; the `talent_penalties` approach the audit proposed does not fit the schema) | M | Every restart re-penalizes; every redeploy distorts the fairness score. |
| B7 | **Move outbox poller + scheduled jobs into `project-worker`; remove from `index.ts:150-152`** | M | project-service cannot be scaled at all today. |
| B8 | **Cap the admin dashboard date span at 90 days + 60s Valkey cache** | S | Caller-controlled range × per-day scans = ~1,100 full sequential scans in one authenticated HTTP request against the shared PgBouncer-fronted DB. That is an availability path, not just a slow page. Do this even though the sargable rewrite is a 10x item. |
| B9 | **Cross-column CHECKs, all `NOT VALID` then `VALIDATE` in a follow-up**: `time_logs` interval + duration coherence, `projects.final_price = talent_payout + platform_fee` | M | `time-log.service.ts:20-22` accepts a caller-supplied `durationMinutes` verbatim while only checking `endedAt > startedAt`, so a 5-minute interval can carry 480 minutes. `work-package.service.ts:78-86` documents in its own comment that a broken price sum makes `computeMilestoneFee` wrong on every subsequent settlement. Care: adding these `VALID` takes an ACCESS EXCLUSIVE lock and fails on any pre-existing violating row. |
| B10 | **Contract-test CI job**: Go integration tests against a DB built from current Drizzle migrations | M | A column rename passes `bun run build`, passes every TS test, and breaks payment-service and notification-service at runtime **after** `db-migrate` succeeded. |
| B11 | **Missing indexes migration, all `CONCURRENTLY`** — `tasks.milestone_id`, `chat_conversations.project_id`, `project_activities(project_id, created_at DESC)`, `project_applications(talent_id, status)`, `reviews(reviewee_id, type)`, the three milestone children, plus `created_at` on transactions/projects/ai_interactions/user | M | See §6 — mostly a 10x item, but batch it with B8 since it's one migration. |
| B12 | **Replace source-text tests** on money and authz paths (`invoice-audience-*`, `read-authorization`, `chat-write-access`, `talent-anonymity-allowlist`) with an extracted pure predicate + table tests; add one composition test that runs `computeProjectPricing` → `work-package.service` → unmocked `computeMilestoneFee` and asserts against `talentShareRate` | M | ~26% of the TS suite is coverage-shaped reassurance that cannot detect the defect its own comment names. |

## (C) REQUIRES OWNER DECISION — product behavior changes

| # | Decision | Effort | Risk of not deciding |
|---|---|---|---|
| **C1** | **Auto-release reconciliation sweep.** Add a job that finds `status='submitted' AND submitted_at < now() - 14 days` and settles. This changes outcomes: milestones stuck since a Temporal outage will suddenly release. `settleMilestoneEscrow` is idempotent (`settle-milestone.ts:64-68`, key `release:${milestoneId}`) so it composes safely with a workflow that did start — but the owner must accept a one-time catch-up release. | M | Escrow held indefinitely with no timer and no alert, breaking a promise stated in `apps/web/PRODUCT.md` and CLAUDE.md. Invisible: the milestone sits in `submitted` and looks normal. |
| **C2** | **Should a revision cycle reset the 14-day clock?** The contract says 14 days per submission; the code gives 14 days from *first* submission. Fixing it means owners get more review time and talents wait longer for payout. **Owner picks the policy**, then implement (cancel-on-`revision_requested` is the smaller change than converting the workflow to a condition loop). | M | Escrow currently releases on work the owner has not had the contracted window to review. |
| **C3** | **Per-work-package escrow.** CLAUDE.md documents it; the code has exactly one escrow account per project (`webhook.go:259-263`, `payment.go:204`). Combined with owner-set milestone amounts validated against nothing (`routes/milestones.ts:52`), approving talent A's milestones can drain the pool so talent B's release fails with `PAYMENT_ESCROW_INSUFFICIENT_FUNDS` — and `milestones.ts:234-239` **swallows** that error, so the milestone shows approved with no payout. **Split the decision:** (a) validating milestone amount against the parent work package is pure debt, do it now; surfacing the swallowed error is also pure debt. (b) Re-keying escrow accounts on work package id is an accounting change and needs sign-off. | (a) S, (b) L | (a) A talent with an executed contract and delivered work goes unpaid, silently. |
| **C4** | **Fee derivation: where does authority live?** Either port the bracket table into Go as a CI-drift-checked generated constant and recompute server-side, or keep project-service authoritative and make the anomaly **loud** — `settle-milestone.ts:54-60` currently logs and returns 0. The cheaper option captures most of the value. Owner picks. | S–M | Silent margin leak: a project whose payout column drifted settles at the wrong rate forever with no alert. |
| **C5** | **Partitioning `chat_messages` / `time_logs` / `ai_interactions` by `created_at`.** Cheap now, expensive later — but the primary key must include the partition key, which is a breaking schema change. **The decision is timing, not whether.** | L | Doing it after these tables are large costs an outage instead of a migration. |
| **C6** | **Error-message contract.** `packages/shared/src/errors.ts:144-207` defines i18n keys for all 50 codes and **zero** frontend files reference them — `lib/api.ts:35-39` displays the server's message verbatim. So `projects.ts:1271` ships hardcoded Indonesian to English-locale users, and `projects.ts:884-887` embeds 200 chars of the AI service's raw response body into a user-visible message, violating CLAUDE.md's own rule. Fixing it changes every error string users see. **Note a defect the audit missed that also breaks its own fix:** the catalog values are prefixed `'errors.auth.…'` while `errors` is already the i18next *namespace*, so a naive `t(key, {ns:'errors'})` resolves to `errors:errors.auth.*` and misses every key — proof the mapping was never once exercised. | M | Localization is broken by construction; upstream error bodies leak to the browser. |
| **C7** | **List pagination envelope.** Changing `data: T[]` to `{items,total,page,pageSize}` on milestones/work-packages/time-logs is a coordinated frontend change. | M | Low urgency — every affected collection is bounded by one project's or task's data. |

---

# 6. Performance and scalability

## Matters now — at zero production traffic

1. **Missing timeouts (A1).** Not a throughput problem, an availability one. One hung downstream against a 160M single instance is a full product outage. **Highest expected win of anything in this document.**
2. **Admin dashboard span cap (B8).** `apps/admin-service/internal/store/dashboard.go:253-275` and `:310-319` join `generate_series` to a LATERAL subquery predicated on `created_at::date = d.day::date` — the cast defeats any index, so each generated day drives a full scan, twice for `GetDailyRevenue`. `handler/dashboard.go:34-66` validates the range format but enforces **no maximum span**. A one-year window is ~1,100 full sequential scans in a single request. Reachable from any authenticated admin session. Cap the span now; the sargable rewrite can wait.
3. **Time-tracking 1s re-render.** `time-tracking.tsx:95-109` drives a full 634-line component re-render plus an unmemoized `Object.keys().sort()` with a `new Date()` per comparison (`:220-222`) plus a Recharts reconcile, every second, indefinitely, on the page a talent leaves open for hours. Violates CLAUDE.md's own 400ms guidance. Two local changes, no behavior impact.
4. **`getAllSkillEmbeddings` cache (A9).** ~6MB of vectors per matching request for master data. Free.
5. **Locale bundle.** ~52KB raw of never-used translations in the entry chunk on every first load (105,071 bytes total across 18 files; `project.json` alone is 22KB per language). Modest, but a one-line change to `resourcesToBackend`.

## Matters at 10x (a few hundred talents, real projects)

- **~14 missing indexes (B11).** `tasks.milestone_id` (the whole Gantt view scans the tasks table), `chat_conversations.project_id` (hit on every AI-scoping message, on the path with a documented sub-1s first-token target), `project_activities.project_id` (twice per page — list and count). The subtle one: `project_applications` has a unique index on `(project_id, talent_id)` (`schema/project.ts:304`) but `routes/applications.ts:234` queries `WHERE talent_id = $1` — the non-leading column, which that btree cannot serve.
- **Sargable dashboard rewrite.** One range scan per table instead of N. Only worth it *after* the created_at indexes exist; the indexes are wasted without it.
- **Matching pool loading.** `matching.repository.ts:37-68` loads every verified+available talent with two correlated `COUNT(*)` subqueries **per row**, applies exclusions in JS at `:67`, then scores in-process with an O(len²) Jaro-Winkler per skill pair. The DB audit filed this high; the API audit filed it low on the grounds that it doesn't bite pre-launch. **Take the low.** The analysis is correct and there is no correctness or fairness defect — only latency growing with the talent table. The two SQL fixes (move exclusions into `notInArray`, replace the correlated subqueries with one grouped LEFT JOIN) are cheap and worth batching with B11.
- **Rate limiting across replicas.** Becomes a correctness gap the moment anything scales out.
- **Outbox published-row cleanup.** `outbox-worker.ts:93-96` marks rows published and never deletes them; `idx_outbox_unpublished` is partial so the *scan* stays fast while the heap grows forever. A batched delete of `published = true AND published_at < now() - 24h` from the existing scheduler is the cheapest, highest-value retention work in the repo.

## Matters at 100x — say plainly it does not matter for two years

Partitioning (except that the *migration* is cheap now — C5), read replicas, CQRS read models, ClickHouse, list virtualization, `chat_messages`/`time_logs`/`ai_interactions` retention automation, ML matching. **Do not spend engineering time on any of these in the next twelve months.** The one thing to do now is preserve optionality: keep `created_at` NOT NULL on the three partition candidates (it already is) and make the PK decision (C5) before the tables are large.

---

# 7. Production-grade code: the top 3 fixes

## 7.1 One outbound HTTP client — timeout, per-service breaker, trace propagation, opt-in retry

Retires three findings across two audits. Uses the codebase's existing `cockatiel` and `@kerjacus/logger` exports (I verified the cockatiel 3.2.1 typings: `handleWhen`, `isBrokenCircuitError`, `IPolicy` and `wrap` are all exported as used below).

### Before — `apps/project-service/src/lib/payment-client.ts:58-79`

```ts
export async function releaseMilestoneEscrow(input: ReleaseMilestoneEscrowInput): Promise<void> {
  const res = await fetch(`${env.PAYMENT_SERVICE_URL}/api/v1/payments/release`, {
    method: 'POST',
    headers: withServiceAuth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ /* ... */ idempotencyKey: `release:${input.milestoneId}` }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body?.error?.message ?? ''
    } catch {
      // Non-JSON error body, status alone has to do.
    }
    throw new Error(`payment release failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
}
```

No timeout, no breaker, no trace context — and that eleven-line detail-extraction block is copy-pasted verbatim into `refundEscrow` above it.

### After — new `apps/project-service/src/lib/http/upstream-error.ts`

```ts
import { AppError } from '@kerjacus/shared'

/**
 * A downstream service failed.
 *
 * `status` is the upstream HTTP status, or null for a transport failure,
 * timeout or open circuit. `detail` is the upstream error body and is for
 * logs only - `toAppError` is what reaches the browser, because CLAUDE.md
 * forbids exposing external service detail to users and routes/projects.ts
 * was slicing 200 characters of the AI service response into the message.
 */
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(`${service} call failed (${status ?? 'transport'})`)
    this.name = 'UpstreamError'
  }

  /** 4xx is a bug in our request; retrying it just holds capacity. */
  get retryable(): boolean {
    return this.status === null || this.status === 429 || this.status >= 500
  }

  toAppError(): AppError {
    return new AppError('EXTERNAL_SERVICE_ERROR', 'Layanan sedang tidak tersedia')
  }
}
```

### After — rewritten `apps/project-service/src/lib/resilience.ts`

```ts
import {
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  type IPolicy,
  retry,
  wrap,
} from 'cockatiel'
import { UpstreamError } from './http/upstream-error'

/**
 * Only transient faults count.
 *
 * The previous policy used handleAll, so a deterministic 400 from
 * /payments/release was retried three times with exponential backoff before
 * failing - about eleven seconds of held capacity per malformed request, and
 * five such requests would trip the breaker for a healthy downstream.
 */
const handleTransient = handleWhen((err) => err instanceof UpstreamError && err.retryable)

// One breaker per downstream. ai-service tripping must not open payment-service's
// circuit; the old signature took a service name and ignored it.
const breakers = new Map<string, IPolicy>()
const withRetry = new Map<string, IPolicy>()

function breakerFor(service: string): IPolicy {
  const existing = breakers.get(service)
  if (existing) return existing
  const policy = circuitBreaker(handleTransient, {
    halfOpenAfter: 30_000,
    breaker: new ConsecutiveBreaker(5),
  })
  breakers.set(service, policy)
  return policy
}

export function makeServicePolicy(service: string, retryTransient: boolean): IPolicy {
  const breaker = breakerFor(service)
  if (!retryTransient) return breaker

  const existing = withRetry.get(service)
  if (existing) return existing
  // ExponentialBackoff already applies decorrelated jitter by default.
  const policy = wrap(
    retry(handleTransient, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({ initialDelay: 1000, maxDelay: 8000 }),
    }),
    breaker,
  )
  withRetry.set(service, policy)
  return policy
}
```

### After — new `apps/project-service/src/lib/http/service-fetch.ts`

```ts
import { captureTraceContext } from '@kerjacus/logger'
import { isBrokenCircuitError } from 'cockatiel'
import { makeServicePolicy } from '../resilience'
import { withServiceAuth } from '../service-auth'
import { UpstreamError } from './upstream-error'

export type ServiceFetchOptions = {
  /** Names the breaker. One circuit per downstream service. */
  service: 'payment-service' | 'ai-service' | 'auth-service'
  /** Per-attempt budget. CLAUDE.md: 10s payments, 30s chat and CV, 60s BRD/PRD. */
  timeoutMs: number
  /**
   * Opt in only where the upstream is idempotent.
   *
   * /payments/release and /payments/refund carry an idempotency key, so a
   * retry replays. /generate-brd does not: a retry is a second billed Gemini
   * call that also burns a slot in the owner's free-generation quota.
   */
  retryTransient?: boolean
  /** Caller cancellation - request abort, SSE unmount. Distinct from timeout. */
  signal?: AbortSignal
}

// Body is a string so a retry can replay it; a stream body cannot be re-read.
type ServiceFetchInit = Omit<RequestInit, 'signal' | 'body'> & { body?: string }

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return body?.error?.message ?? ''
  } catch {
    return ''
  }
}

/**
 * The one way project-service talks to another service.
 *
 * Every call gets a deadline, a circuit and W3C trace context. Previously
 * eight of nine outbound calls had none of the three: a hung ai-service could
 * pin request handlers on the single project-service instance indefinitely,
 * and a slow BRD generation could not be followed into the ai-service span
 * even though the NATS path has propagated trace context all along.
 */
export async function serviceFetch(
  url: string,
  init: ServiceFetchInit,
  opts: ServiceFetchOptions,
): Promise<Response> {
  const policy = makeServicePolicy(opts.service, opts.retryTransient === true)
  const headers = withServiceAuth({
    ...(init.headers as Record<string, string> | undefined),
    // Same carrier the outbox uses, so HTTP and NATS spans join up.
    ...(captureTraceContext() ?? {}),
  })

  try {
    return await policy.execute(async () => {
      // Built per attempt. A signal created once outside the policy would
      // already be aborted by the time the second attempt ran.
      const deadline = AbortSignal.timeout(opts.timeoutMs)
      const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline

      let res: Response
      try {
        res = await fetch(url, { ...init, headers, signal })
      } catch (cause) {
        // Caller cancellation is not an upstream fault and must not trip the
        // breaker - an owner navigating away from a streaming chat is normal.
        if (opts.signal?.aborted) throw cause
        const reason = cause instanceof Error ? cause.message : 'transport failure'
        throw new UpstreamError(opts.service, null, reason)
      }

      if (!res.ok) {
        throw new UpstreamError(opts.service, res.status, await readErrorDetail(res))
      }
      return res
    })
  } catch (err) {
    // An open circuit is a fast local rejection, not an upstream response.
    if (isBrokenCircuitError(err)) {
      throw new UpstreamError(opts.service, null, 'circuit open')
    }
    throw err
  }
}
```

### After — `payment-client.ts` becomes payload construction

```ts
import { serviceFetch } from './http/service-fetch'
import { env } from './env'

const PAYMENT_TIMEOUT_MS = 10_000

export async function releaseMilestoneEscrow(input: ReleaseMilestoneEscrowInput): Promise<void> {
  await serviceFetch(
    `${env.PAYMENT_SERVICE_URL}/api/v1/payments/release`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        milestoneId: input.milestoneId,
        projectId: input.projectId,
        talentId: input.talentId,
        amount: input.amount,
        feeAmount: input.feeAmount,
        performedBy: input.performedBy,
        // Whichever of owner-approve and the 14 day auto-release fires first
        // wins; the other replays. This is what makes retryTransient safe.
        idempotencyKey: `release:${input.milestoneId}`,
      }),
    },
    { service: 'payment-service', timeoutMs: PAYMENT_TIMEOUT_MS, retryTransient: true },
  )
}
```

**Why the after is robust.** It closes five edge cases the original missed: (1) a per-attempt deadline, so a hung socket cannot hold a handler forever; (2) a fresh signal per attempt, so retry 2 is not born aborted; (3) `handleWhen` instead of `handleAll`, so a 400 fails in milliseconds instead of eleven seconds and does not trip the breaker; (4) per-service breakers, so ai-service degrading cannot block payments; (5) caller cancellation distinguished from upstream failure, so an SSE unmount is not counted as an outage. It also removes the duplicated detail-extraction block from four call sites and stops the upstream body reaching the browser — with `document-generation.ts` catching `UpstreamError` to keep its existing `unavailable()` quota-protection path, and `retryTransient` left **off** for all three ai-service endpoints.

---

## 7.2 Make escrow accounts unique — schema first, then the query

`GetOrCreateAccountTx` is a read-then-insert under Read Committed and there is no constraint behind it. Both halves are required; the query fix without the index still races, and the index without a cleanup migration fails the deploy.

### Before — `apps/payment-service/internal/store/ledger.go:270-294`

```go
func (s *LedgerStore) GetOrCreateAccountTx(ctx context.Context, tx pgx.Tx, in CreateAccountInput) (*Account, error) {
	existing, err := s.FindAccountByOwnerTx(ctx, tx, in.OwnerType, in.OwnerID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()
	currency := in.Currency
	if currency == "" {
		currency = "IDR"
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
	`, id, in.OwnerType, in.OwnerID, in.AccountType, in.Name, 0, currency, now, now)

	return scanAccount(row)
}
```

### After, step 1 — `packages/db/migrations/0022_accounts_owner_unique.sql`

```sql
-- Merge any duplicate accounts before the constraint can exist.
-- owner_id is polymorphic (a user id, a talent_profiles id, or a project id
-- depending on owner_type), so no FK is possible and a unique index is the
-- only enforcement mechanism available. Read-then-insert under Read Committed
-- created these; the escrow balance for a project split across the rows and
-- ReleaseEscrow then rejected valid payouts as insufficient funds.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY owner_type, owner_id ORDER BY created_at, id
         ) AS keeper
  FROM accounts
)
UPDATE ledger_entries le
SET account_id = r.keeper
FROM ranked r
WHERE le.account_id = r.id AND r.id <> r.keeper;

DELETE FROM accounts a
USING (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY owner_type, owner_id ORDER BY created_at, id
         ) AS keeper
  FROM accounts
) r
WHERE a.id = r.id AND r.id <> r.keeper;

-- Rebuild balances from the ledger, which is append-only and authoritative.
UPDATE accounts a
SET balance = COALESCE(d.derived, 0)
FROM (
  SELECT account_id,
         SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) AS derived
  FROM ledger_entries
  GROUP BY account_id
) d
WHERE d.account_id = a.id;

-- NULLS NOT DISTINCT needs PG15+; we run PG17. Without it the platform
-- account (owner_id IS NULL) would be exempt from the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_owner
  ON accounts (owner_type, owner_id) NULLS NOT DISTINCT;
```

### After, step 2 — `packages/db/src/schema/payment.ts`

Required, or the next `drizzle-kit generate` emits a `DROP INDEX`:

```ts
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    ownerType: accountOwnerTypeEnum('owner_type').notNull(),
    ownerId: text('owner_id'),
    accountType: accountTypeEnum('account_type').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    balance: integer('balance').default(0).notNull(),
    currency: varchar('currency', { length: 3 }).default('IDR').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One account per owner. owner_id is polymorphic so no FK is possible;
    // this index is the only thing that makes GetOrCreateAccountTx atomic.
    // nullsNotDistinct covers the platform revenue account (owner_id IS NULL).
    uniqueIndex('uq_accounts_owner').on(table.ownerType, table.ownerId).nullsNotDistinct(),
  ],
)
```

### After, step 3 — `ledger.go`

```go
// GetOrCreateAccountTx resolves the account for an owner, creating it if absent.
//
// One statement, not a read followed by a write. Two Midtrans webhooks settling
// escrow for the same project concurrently used to reach the INSERT together
// under Read Committed and each create its own account; the project's funded
// balance then split across two rows, FindAccountByOwner picked one with a bare
// LIMIT 1, and every subsequent milestone release was rejected as insufficient
// funds for money that was in the ledger. ON CONFLICT against uq_accounts_owner
// makes the loser read the winner's row instead.
func (s *LedgerStore) GetOrCreateAccountTx(ctx context.Context, tx pgx.Tx, in CreateAccountInput) (*Account, error) {
	id := uuid.Must(uuid.NewV7()).String()
	now := time.Now().UTC()

	currency := in.Currency
	if currency == "" {
		currency = "IDR"
	}

	// DO UPDATE rather than DO NOTHING: DO NOTHING returns no row on conflict,
	// which would force a second round trip. Touching updated_at is a no-op
	// write that guarantees RETURNING yields the surviving row either way.
	row := tx.QueryRow(ctx, `
		INSERT INTO accounts (id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (owner_type, owner_id) DO UPDATE
		SET updated_at = EXCLUDED.updated_at
		RETURNING id, owner_type, owner_id, account_type, name, balance, currency, created_at, updated_at
	`, id, in.OwnerType, in.OwnerID, in.AccountType, in.Name, 0, currency, now, now)

	acc, err := scanAccount(row)
	if err != nil {
		return nil, fmt.Errorf("get or create account (%s/%v): %w", in.OwnerType, in.OwnerID, err)
	}
	if acc == nil {
		return nil, fmt.Errorf("get or create account (%s/%v): no row returned", in.OwnerType, in.OwnerID)
	}
	return acc, nil
}
```

### The reconciliation that must accompany it

```go
// AccountDrift is one account whose cached balance disagrees with its ledger.
type AccountDrift struct {
	AccountID string
	OwnerType string
	OwnerID   *string
	Balance   int64
	Derived   int64
}

// FindBalanceDrift reports accounts where the cached balance no longer equals
// sum(debit) - sum(credit).
//
// accounts.balance is maintained by a separate UPDATE per ledger entry and is
// the sole gate on ReleaseEscrow and ProcessRefund. Drift low blocks a talent's
// payout with a misleading insufficient-funds error; drift high pays out money
// the platform never received. ledger_entries is append-only, so the truth is
// always recomputable - nothing was recomputing it. This alerts; it does not
// auto-correct, because a silent correction would hide the bug that caused it.
func (s *LedgerStore) FindBalanceDrift(ctx context.Context) ([]AccountDrift, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.owner_type, a.owner_id, a.balance,
		       COALESCE(SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount ELSE -l.amount END), 0) AS derived
		FROM accounts a
		LEFT JOIN ledger_entries l ON l.account_id = a.id
		GROUP BY a.id, a.owner_type, a.owner_id, a.balance
		HAVING a.balance <> COALESCE(SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount ELSE -l.amount END), 0)
	`)
	if err != nil {
		return nil, fmt.Errorf("query balance drift: %w", err)
	}
	defer rows.Close()

	var drift []AccountDrift
	for rows.Next() {
		var d AccountDrift
		if err := rows.Scan(&d.AccountID, &d.OwnerType, &d.OwnerID, &d.Balance, &d.Derived); err != nil {
			return nil, fmt.Errorf("scan balance drift: %w", err)
		}
		drift = append(drift, d)
	}
	return drift, rows.Err()
}
```

**Why the after is robust, and one honesty caveat.** The uniqueness is enforced by the database rather than by the shape of a Go helper, so it holds under concurrency, under a second replica, and under any future writer including `seed.ts` and manual SQL. `NULLS NOT DISTINCT` covers the platform account, which a plain unique index would silently exempt. The index also gives the escrow lookup an access path it never had — relevant because an unindexed predicate inside a serializable transaction escalates the SSI predicate lock toward relation granularity, making spurious 40001 failures more likely as `accounts` grows. `FindBalanceDrift` is cheap because `idx_ledger_account_created` already exists.

**Caveat, stated plainly:** I could not compile or run this. It is shaped to fit the file's existing conventions (`scanAccount`, `uuid.NewV7()`, `pgx.Tx`, wrapped errors). The cleanup migration must run and be verified against every deployed database **before** the index creation, or the deploy fails on the constraint.

---

## 7.3 One definition of "on this project", and the dispute IDOR

Two small diffs, both high severity, both in the authorization layer.

### Before — `apps/project-service/src/lib/project-access.ts:85-96`

```ts
export async function isAssignedTalent(projectId: string, userId: string): Promise<boolean> {
  const db = getDb()

  const [assignment] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(and(eq(projectAssignments.projectId, projectId), eq(talentProfiles.userId, userId)))
    .limit(1)

  return assignment !== undefined
}
```

### After

```ts
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Assignments that mean the talent is or was legitimately on this project.
 *
 * Deliberately excludes 'terminated' and 'replaced'. This is the same rule
 * routes/invoices.ts derived independently for the invoice audience, and the
 * same one routes/projects.ts:375 applies to the team roster - three copies
 * of one predicate, of which only this one, the shared helper, was missing the
 * status dimension entirely.
 *
 * 'completed' stays in: a talent whose project finished still needs their
 * invoices, their reviews and their own time logs.
 */
export const WORKED_ASSIGNMENT_STATUSES = ['active', 'completed'] as const

/**
 * True when this user holds a live assignment on this project.
 *
 * Without the status filter a talent terminated for abandonment kept full
 * project read access indefinitely - milestone amounts, the replacement
 * talent's time logs, the work-package dependency graph, the PRD, and a
 * Centrifugo subscription token for the live project channel (routes/
 * realtime.ts:51). It is a write path too: integration-milestone submit at
 * routes/milestones.ts:170-190 gates on the same helper.
 */
export async function isAssignedTalent(projectId: string, userId: string): Promise<boolean> {
  const db = getDb()

  const [assignment] = await db
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .innerJoin(talentProfiles, eq(talentProfiles.id, projectAssignments.talentId))
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        eq(talentProfiles.userId, userId),
        inArray(projectAssignments.status, WORKED_ASSIGNMENT_STATUSES),
      ),
    )
    .limit(1)

  return assignment !== undefined
}
```

`routes/invoices.ts:47` then imports `WORKED_ASSIGNMENT_STATUSES` instead of declaring a fourth copy.

### Before — `apps/project-service/src/routes/disputes.ts:194-217`

```ts
// PATCH /:id/status - update dispute status (admin only for escalation)
disputeRoute.patch('/:id/status', async (c) => {
  const user = getAuthUser(c)
  // Only admin or dispute parties can update status
  // Admin check: under_review, mediation, escalated transitions
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  const service = new DisputeService(new DisputeRepository(getDb()), refundEscrow, getEscrowBalance)
  const updated = await service.changeStatus(id, user.role, parsed.data.status, validTransitions)

  return c.json({ success: true, data: updated })
})
```

The comment states an invariant the code does not implement: `changeStatus` receives `user.role` and never `user.id`, so it cannot ask whether the caller is party to this dispute.

### After — route

```ts
// PATCH /:id/status - move a dispute along the three-step escalation.
disputeRoute.patch('/:id/status', async (c) => {
  const user = getAuthUser(c)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid status data', {
      issues: z.flattenError(parsed.error).fieldErrors,
    })
  }

  // The caller's identity, not just their role. Without it the accused party
  // could read their own dispute id from GET /disputes/project/:projectId and
  // PATCH it straight to 'resolved' with every resolution field NULL, which
  // permanently disables /:id/resolve and its refund for that dispute.
  const service = new DisputeService(new DisputeRepository(getDb()), refundEscrow, getEscrowBalance)
  const updated = await service.changeStatus(id, user.id, user.role, parsed.data.status, validTransitions)

  return c.json({ success: true, data: updated })
})
```

### After — `disputes.ts:25-30` and `services/dispute.service.ts`

```ts
// 'resolved' is reachable only through PATCH /:id/resolve, which is admin-only
// and moves money. Leaving it in these transition lists let a party close their
// own case with no resolution recorded.
const validTransitions: Record<string, string[]> = {
  open: ['under_review'],
  under_review: ['mediation'],
  mediation: ['escalated'],
  escalated: [],
}
```

```ts
/**
 * Move a dispute along the three-step escalation.
 *
 * Three rules: the caller must be party to this dispute or an admin, the
 * transition has to be one the state machine allows, and the steps that put
 * the platform in the middle belong to an admin. The first was documented in
 * the handler and implemented nowhere - only the role reached the service, so
 * any signed-in user holding a dispute id could drive it.
 */
async changeStatus(
  id: string,
  userId: string,
  userRole: string,
  toStatus: DisputeStatus,
  validTransitions: Record<string, readonly string[]>,
) {
  const existing = await this.repo.findById(id)
  if (!existing) {
    throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found')
  }

  const isParty = existing.initiatedBy === userId || existing.againstUserId === userId
  if (!isParty && userRole !== 'admin') {
    // Same shape as the read path at routes/disputes.ts:157-168, so probing an
    // id you are not party to tells you nothing you could not already see.
    throw new AppError('AUTH_FORBIDDEN', 'Not authorized')
  }

  if (existing.status === 'resolved') {
    throw new AppError('DISPUTE_ALREADY_RESOLVED', 'Dispute already resolved')
  }
  if (!validTransitions[existing.status]?.includes(toStatus)) {
    throw new AppError(
      'DISPUTE_INVALID_STATUS',
      `Cannot transition from ${existing.status} to ${toStatus}`,
    )
  }
  if (ADMIN_ONLY_STATUSES.includes(toStatus) && userRole !== 'admin') {
    throw new AppError('AUTH_FORBIDDEN', 'Only platform admin can escalate disputes')
  }

  return await this.repo.updateStatus(id, {
    projectId: existing.projectId,
    fromStatus: existing.status,
    toStatus,
  })
}
```

**Why the after is robust.** Authorization is asserted in the service, where the transition rules already live, so it cannot be bypassed by a second caller — `changeStatus` is now impossible to invoke without an identity. The party check runs **before** the already-resolved check, so a non-party probing dispute ids gets an identical 403 whether or not the dispute is resolved (no oracle). Removing `'resolved'` from the transition lists means the only path to a resolved dispute is `/:id/resolve`, which is admin-gated and moves money before writing the status (`dispute.service.ts`, deliberately in that order). And `isAssignedTalent` now has one definition, imported by the three sites that had each derived their own — so tightening it later reaches all of them.

**Behavior change to flag:** both diffs are in group B/C. A talent whose assignment is `terminated` loses access they have today, and a party who was closing their own disputes will now get a 403. Both are the intended behavior; both are visible to users.

---

# 8. Open questions for the owner

1. **Auto-release catch-up (C1).** If a reconciliation sweep lands, milestones stuck in `submitted` past 14 days settle on the first run. Do you want that catch-up to run automatically, or to produce an admin review list first?
2. **Does a revision cycle restart the 14-day clock (C2)?** The written contract says 14 days per submission; the code gives 14 from first submission. This is a policy call with money on both sides.
3. **Per-work-package escrow (C3b).** CLAUDE.md documents it, the code has one pool per project. Real separable balances would also make the documented per-talent termination freeze and per-work-package dispute freeze actually work. Is that a v1 requirement or a v2 one?
4. **Where does fee authority live (C4)?** Recompute in Go from a generated bracket constant, or keep project-service authoritative and make the anomaly loud? The second is a fraction of the work.
5. **Partitioning timing (C5).** The PK must include the partition key, which is a breaking schema change. Cheap this month, expensive next year. When?
6. **Talent workload vs escrow exposure.** `routes/talent-profiles.ts:279` defines an active project as `['in_progress','review','partially_active']`; `apps/admin-service/internal/store/finance.go:69-77` uses six statuses including `matched`, `disputed` and `on_hold`. Both are plausible, and a talent showing 0 active projects can be holding escrow the finance page counts as live — so `pemerataan_skor` and the finance dashboard tell different stories about the same person. Are these one concept or two? If two, name them separately.
7. **Error-message ownership (C6).** Adopting the i18n catalog changes every error string users see. Worth doing now, or after launch copy is settled?
8. **Suspension semantics.** Should suspension revoke *existing* sessions immediately, or only block new sign-ins? Today it does neither for project-service. The answer determines whether you need an `isVerified` check alone or that plus a revocation channel.
9. **TensorZero.** The container is deployed, wired to Google AI Studio, and is **not** in the inference path — ai-service calls Vertex AI directly and only probes `/ready`. Upstream was archived 2026-06-12 with no security patches. Remove it, or adopt the community fork and actually route through it?
10. **MinIO.** `docker-compose.prod.yml` runs self-hosted MinIO, whose community edition was archived 2026-04-25 — no reviewed patches. Uploaded CVs contain personal data. The move to R2 is a config change (`S3_ENDPOINT` + credentials). Timeline?
11. **Partial refunds from Midtrans.** `webhook.go:99-105` rejects a notification unless `paidAmount == txn.Amount`. What Midtrans places in `gross_amount` on a partial-refund notification cannot be determined from this repo — it may be filtered before ever reaching the refund branch. Needs a gateway-doc or sandbox answer before B5 is complete.
12. **Replica intent.** `docker-compose.prod.yml` has no `replicas:` key anywhere. Is single-replica a decision or an accident? Several findings (rate limiting, outbox, penalty job) are latent at one replica and immediate at two — and blue-green switchover runs two stacks concurrently by design, which is precisely when the penalty double-run is near-certain.

---

# Appendix — all 63 verified findings, by domain

## System architecture and service boundaries

_The service split is real at the process level but not at the data level: there are zero PostgreSQL schemas, so all six services share one flat `public` namespace, and three Go services hand-write SQL against tables whose only migration owner is `packages/db` (Drizzle). project-service is the domain — 18 route groups covering escrow fee math, matching, PDF/invoice rendering, disputes, contracts, chat and uploads — while payment/notification/admin/ai are thin peripherals; payment-service even re-implements project-service's authorization rules in Go. The most fixable problems are concrete: every money-path HTTP call is a bare `fetch` with no timeout and no breaker even though Cockatiel is installed (wired to exactly one call site), and three replica-hostile singletons (outbox poller, session cache, rate limiter) are started at import in a service that currently runs at one replica by accident, not by design. Several CLAUDE.md claims do not survive contact with the code: Traefik as API gateway (prod runs hand-written nginx), Valkey as session store and rate limiter (in-memory Maps), schema separation per service domain (none), and Cockatiel's "retry + circuit breaker + timeout + bulkhead" (only the first two)._

### [CRITICAL] Every money-path and AI HTTP call is a bare fetch with no timeout and no circuit breaker; Cockatiel is installed but wired to exactly one call site
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/lib/payment-client.ts:39 (refund), :58 (release), :86 (escrow-balance) are plain `await fetch(...)` with no `signal`, no retry and no breaker. Same in apps/project-service/src/lib/document-generation.ts:56 (generate-brd), :88 (generate-prd), apps/project-service/src/routes/upload.ts:132 (parse-cv), apps/project-service/src/routes/projects.ts:876 (ai/chat) and :1019 (ai/chat/stream). A repo-wide grep for AbortSignal in project-service returns only three hits: session.ts:54, session.ts:91 and projects.ts:1174 — so the AI parse-spec call is the single AI call that is bounded. apps/project-service/src/lib/resilience.ts:10-19 defines `makeResilientPolicy` and its only non-test importer is apps/project-service/src/middleware/session.ts:4,7. CLAUDE.md claims 'Cockatiel ... retry + circuit breaker + timeout + bulkhead in single wrap()'; resilience.ts wraps only `retry` and `circuitBreaker` — no `timeout`, no `bulkhead`. It also uses `retry(handleAll, ...)`, which retries every rejection including 4xx and validation failures.
- **Root cause:** Resilience was introduced to solve one concrete incident (auth-service flakiness taking down every request) and was never generalized into a client factory. Because `fetch` has no default timeout in Bun/undici, the absence of a policy is invisible until a downstream hangs rather than fails.
- **Impact:** A hung payment-service or ai-service leaks project-service request handlers indefinitely. project-service is capped at 160M memory (docker-compose.prod.yml, project-service deploy.resources.limits.memory) with no replicas configured, so a single stalled downstream exhausts the one instance and takes down the whole owner and talent product, not just payments. The `retry(handleAll)` policy compounds this: a payment-service returning 400 for a malformed release is retried 3 times with exponential backoff up to 8s, turning a deterministic client error into ~11s of held capacity per request.
- **Fix:** Add a single `internalFetch(url, init, {timeoutMs})` helper in lib that composes `AbortSignal.timeout` with `makeResilientPolicy` per target service (one policy instance per downstream so breakers are independent), and route payment-client.ts, document-generation.ts, upload.ts and the AI proxy calls in projects.ts through it. Extend resilience.ts to `wrap(retry, circuitBreaker, timeout, bulkhead)` to match the documented contract, and replace `handleAll` with a predicate that retries only network errors and 5xx — 4xx must fail fast. Suggested budgets, matching the CLAUDE.md performance targets: 10s payment, 30s chat, 90s BRD/PRD.
- **Edge cases:** The SSE stream at projects.ts:1019 must get an idle timeout rather than a total-duration timeout, or long BRD generations will be cut mid-stream. The retry policy must not be applied to non-idempotent payment calls beyond what the idempotency key already covers — release uses `release:${milestoneId}` (payment-client.ts:68) so it is safe, but refund takes a caller-chosen key (payment-client.ts:28) and depends on callers passing a stable one.

### [HIGH] No PostgreSQL schema separation exists; three Go services hand-write SQL against tables whose only migration owner is packages/db
`CONFIRMED` · behavior-change: `False`

- **Evidence:** `grep -rn "CREATE SCHEMA|pgSchema(" packages/db/src packages/db/migrations` returns zero matches — every table lives in flat `public`, contradicting CLAUDE.md's 'Schema separation per service domain: auth.*, project.*, payment.*, ai.*, admin.*'. Only apps/auth-service and apps/project-service import `@kerjacus/db`; the three Go services bypass it entirely with raw SQL. apps/payment-service/internal/store/transaction.go:323 (`SELECT owner_id FROM projects`), :344 (`SELECT final_price FROM projects`), :369 (`SELECT amount FROM milestones`), :394 and :436 (`SELECT id FROM talent_profiles WHERE user_id = $1`), :408-412 (`SELECT EXISTS(... FROM projects WHERE owner_id ...)` plus `FROM project_assignments pa`). apps/notification-service/internal/consumer/nats.go:435 (`SELECT owner_id FROM projects`), :516, :571, :604 (`SELECT user_id FROM talent_profiles`). apps/admin-service reads projects, milestones, work_packages, disputes, talent_profiles, talent_skills, ai_interactions directly.
- **Root cause:** 'Shared database with schema separation' was adopted as the pragmatic step-1 posture, but the schema-separation half was never implemented, so the only thing distinguishing this from a shared monolith database is that the reads are in a different language. Drizzle also owns migrations exclusively, so the Go queries have no compile-time or migration-time link to the schema they depend on.
- **Impact:** A column rename or table move in packages/db passes `bun run build`, passes every TypeScript test, and breaks payment-service and notification-service at runtime in production — after db-migrate has already succeeded (docker-compose.prod.yml, project-service depends_on db-migrate service_completed_successfully). Worse, payment-service/internal/store/transaction.go:408-412 re-implements project-service's 'owner or assigned talent' authorization rule in Go; the two copies can drift silently, and an authorization tightening in project-service does not reach the payment endpoints.
- **Fix:** Two independent moves. (1) Contract-test the Go reads: add a CI job that runs the Go integration tests against a database built from the current Drizzle migrations, so a schema change that breaks Go fails the build rather than the deploy. (2) Stop duplicating authorization: replace payment-service's `UserMayViewProjectTransactions` (transaction.go:394-412) with a call to a project-service `/internal/projects/:id/access` endpoint behind X-Service-Auth, making project-service the single authority on who may see a project. Actual schema separation (`pgSchema` per domain) is a larger migration and should be deferred until the contract tests exist.
- **Edge cases:** Moving the authz check to a network call introduces a new failure mode on the payment read path; it needs the timeout+breaker helper from the previous finding, and a documented fail-closed policy (deny on auth lookup failure).
- **Verifier correction:** Fix (1), the contract-test CI job, is correct and is the high-value half. Fix (2) is questionable: routing payment-service's authorization through a synchronous project-service `/internal/projects/:id/access` call makes money-path authz depend on project-service being up, and -- per finding 1 -- that call would itself have no timeout or breaker. A shared authorization SQL fragment or a generated Go constant is lower-risk than a network hop on the authz path. Recommend keeping fix (1) and dropping or redesigning fix (2).

### [HIGH] The 14-day auto-release backstop silently does not exist when Temporal is unreachable at submit time
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/routes/milestones.ts:384-386: `const client = await getTemporalClient(); if (!client) return` — the workflow start is skipped. apps/project-service/src/lib/temporal-client.ts:13-20 returns `null` on connect failure and caches nothing, logging that 'auto-release, dispute and team-formation workflows will NOT be started'. milestones.ts:269-271 invokes this fire-and-forget: `void triggerTemporalForMilestoneStatus(...).catch(err => logger.warn(...))`. Nothing reconciles afterward: apps/project-service/src/services/scheduled-jobs.ts:7-10 documents that the previous inline auto-release interval was deliberately removed, and the only remaining scheduled work is the 6-hourly penalty scan (:56). The comment at milestones.ts:237 — 'Milestone is approved; the 14 day auto-release retries the payout' — is circular: the same Temporal outage that would need the backstop is what prevented the workflow from existing.
- **Root cause:** Moving auto-release to Temporal correctly eliminated double-processing, but the migration treated workflow start as best-effort ('Optional — if Temporal is unavailable, project still works', milestones.ts:267-268) without adding the reconciliation sweep that a best-effort trigger requires. Note the normal path is fine — settlement on owner approve is inline at milestones.ts:235 — so the gap is narrow and easy to miss.
- **Impact:** For any milestone submitted during a Temporal outage or restart where the owner then goes silent, escrow is held indefinitely with no timer and no alert. This breaks a promise stated in apps/web/PRODUCT.md ('released per milestone with a 14-day auto-release if the owner goes silent') and in CLAUDE.md's escrow policy. There is no query or dashboard that would surface it: the milestone sits in `submitted` and looks normal.
- **Fix:** Add a reconciliation job (Temporal cron on the project-worker container, or the advisory-locked scheduler) that periodically selects milestones where `status='submitted'` and `submitted_at < now() - interval '14 days'` and calls `settleMilestoneEscrow` — which is already idempotent by milestone (lib/settle-milestone.ts:64-68, idempotency key `release:${milestoneId}` at payment-client.ts:68), so it composes safely with a workflow that did start. Separately, correct the misleading comment at milestones.ts:237.
- **Edge cases:** Enabling the sweep will release escrow on any milestones already stranded in `submitted` past 14 days in the current environment — that money movement needs owner sign-off and a dry-run count first. The sweep must also skip milestones whose project is in `disputed` or `on_hold`, which the Temporal workflow path handles via signals but a naive SQL sweep would not.
- **Verifier correction:** The comment at milestones.ts:237 is wrong for a stronger reason than the finding gives. workflows/milestoneAutoRelease.ts:30-34 sleeps the full 14 days and THEN checks `approved`; the milestoneApprovedSignal only sets a flag. So on the approve path the workflow returns {released:false, reason:'already_approved'} and never retries the payout -- meaning even when Temporal IS up, the comment's claim that 'the 14 day auto-release retries the payout' after a failed inline settle is false, not merely circular. The proposed reconciliation job is the right fix and composes safely: settleMilestoneEscrow guards on status==='approved' (settle-milestone.ts:88) and payment-client.ts:68 uses idempotencyKey `release:${milestoneId}`.

### [HIGH] Session cache and rate limiter are per-process in-memory Maps; Valkey is provisioned but no TypeScript service uses it
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/middleware/session-cache.ts:4 is a module-level `new Map<string, {user, expiresAt}>` with a 5-minute TTL (:3) and a `setInterval` sweeper (:25-33). `clearSessionCache` is exported at :20 and has zero non-test callers anywhere in the repo. apps/project-service/src/middleware/rate-limit.ts:13 self-documents the problem: 'In-memory rate limiter keyed by client IP. Single-instance only; use Redis in production.' apps/auth-service/src/middleware/rate-limit.ts:14 carries the identical comment. Valkey runs in production (docker-compose.prod.yml valkey service, `valkey/valkey:9-alpine`) and `REDIS_URL` is injected into project-service, yet a repo-wide grep shows the only real client is apps/notification-service (main.go:156-170 building `idempotency.NewRedisStore`). CLAUDE.md claims Valkey is 'Used for consumer idempotency, session store, rate limiting, AI response cache' — only the first is true.
- **Root cause:** packages/config/src/index.ts:7 makes `REDIS_URL` a required env var for every service, which made it look wired. The in-memory Map was the fast path to cutting auth-service round trips and nothing forced it to become shared state, because the system has never run at more than one replica.
- **Impact:** Two distinct consequences. Revocation: admin suspension (apps/admin-service/internal/handler/users.go:138-217) and sign-out (apps/auth-service/src/index.ts:214) have no way to invalidate a cached session, so a suspended or signed-out user keeps full access for up to 5 minutes — per replica, independently. apps/admin/PRODUCT.md names suspension as a consequential, audited intervention; today it is an eventually-consistent one with an undocumented 5-minute window. Rate limiting: the CLAUDE.md budgets (100/min general, 10/min strict on the AI endpoints) become 100·N and 10·N with N replicas, and the strict tier guards the PRD generation call that PRODUCT.md identifies as the most expensive operation the platform makes.
- **Fix:** Move both stores to Valkey. Session cache: same 5-minute TTL, keyed on a hash of the session token rather than the raw header, plus a `session.revoked` NATS subject that auth-service and admin-service publish on sign-out and suspension so project-service can delete the key immediately. Rate limiter: replace the Map with a Valkey `INCR`+`EXPIRE` fixed window; the IP-extraction logic at rate-limit.ts:33-45 (which already correctly distrusts the leftmost X-Forwarded-For) is sound and should be kept as-is.
- **Edge cases:** UNVERIFIED: session-cache.ts keys on `cookie.substring(0, 64)` — the first 64 characters of the raw Cookie header, not the session token. I could not prove a collision is reachable with the cookies this app actually sets, but the key is structurally prefix-dependent rather than token-dependent, and two users whose Cookie headers agreed on the first 64 bytes would be served each other's identity. Hashing the extracted token instead of slicing the header removes the question entirely and costs nothing.
- **Verifier correction:** The revocation mechanism is misdiagnosed, and the gap is worse than described. admin-service SuspendUser (store/users.go:226) only sets `is_verified = false`. auth-service enforces that at middleware/session.ts:55, but /api/v1/auth/get-session -- the endpoint project-service actually calls -- is served by the Better Auth catch-all `auth.handler(c.req.raw)` at routes/auth.ts:155, which never runs that middleware. project-service's SessionUser type (middleware/session.ts:9-15) has no isVerified field and no check anywhere. So a suspended user's existing session retains full project-service access indefinitely, not 'for up to 5 minutes'. The cache is an aggravator, not the cause. Consequently the proposed Valkey migration plus a session.revoked NATS subject does NOT fix suspension -- an isVerified check on the session resolution path does, and that must come first. Separately the cache key at session.ts:44 and :81 is `cookie.substring(0, 64)`, a raw cookie prefix rather than a hash, so the finding's incidental hashing note is correct. Also apps/auth-service/src/index.ts:214 is inside an OpenAPI spec JSON literal, not sign-out implementation code -- that citation is a misread. Severity stays high on the corrected mechanism.

### [MEDIUM] Three replica-hostile singletons start at module import; the outbox poller has no row claim, so a second replica double-publishes
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/index.ts:150-152 starts `startOutboxProcessor()`, `startScheduledJobs()` and `startInvoiceConsumer()` unconditionally at import. (a) apps/project-service/src/services/outbox-worker.ts:35-41 selects up to 100 unpublished rows with a plain `SELECT ... WHERE published=false AND retry_count<3 ORDER BY created_at LIMIT 100` — no `FOR UPDATE SKIP LOCKED`, no claim column, no worker id. Two replicas read the same 100 rows and both publish. (b) apps/project-service/src/services/scheduled-jobs.ts:56 is a bare `setInterval(runPenaltyJobs, SIX_HOURS)` with no advisory lock or leader election; every replica issues its own inactivity warnings and abandon penalties. (c) By contrast apps/project-service/src/services/invoice-consumer.ts:36-53 uses a named JetStream durable (`project-invoice-generator`, AckPolicy.Explicit) and is genuinely replica-safe — so the pattern was known and simply not applied to the other two. docker-compose.prod.yml has zero `replicas:` keys, so this is currently masked by running exactly one instance.
- **Root cause:** Background work was attached to the HTTP process as the simplest thing that worked at one replica. The Temporal worker was correctly extracted into its own container (docker-compose.prod.yml project-worker, `bun run src/workers/temporal-worker.ts`), which shows the split was understood — but the outbox and scheduler were left behind in the web process.
- **Impact:** Horizontal scaling of project-service, the platform's only bottleneck service, is unsafe today. At 2 replicas the penalty job double-penalizes: PenaltyService writes talent_penalties rows and pemerataan_penalty increments, directly distorting the fairness score that apps/web/PRODUCT.md names as the product's core differentiator. The outbox is partially protected — apps/gateway/nats-init-streams.sh:53-83 sets `--dupe-window 2m` on every stream and outbox-worker.ts:80 passes `msgID: event.id` — but the DB side still races: two replicas both run the `UPDATE outbox_events SET retry_count` path on failure (outbox-worker.ts:118-121), inflating retry_count to 3 in one cycle and dead-lettering an event (`:103-116`) that failed only once.
- **Fix:** Outbox: change the select at outbox-worker.ts:35-41 to `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction that also flips a `claimed_at`, or move the whole poller into the existing project-worker container and remove it from index.ts. Scheduler: wrap `runPenaltyJobs` in a `pg_advisory_lock` on a fixed key, or (cleaner, and consistent with the existing pattern) convert it to a Temporal cron schedule so the project-worker container owns it. The invoice consumer needs no change.
- **Edge cases:** apps/project-service/src/workers/temporal-worker.ts has no SIGTERM handler at all (only a top-level `run().catch` + `process.exit(1)`), unlike index.ts:174-175 — so if the outbox poller moves into that container it must bring the graceful-shutdown drain from index.ts:156-172 with it, or in-flight publishes will be dropped on redeploy.
- **Verifier correction:** The retry_count sub-claim is refuted. outbox-worker.ts:100 computes `const retryCount = (event.retryCount ?? 0) + 1` and lines 118-121 SET that value -- it is an assignment from a stale read, not an increment. Two replicas both read 0 and both write 1: a lost update, which makes premature dead-lettering LESS likely, not more. Also, PenaltyService writes no `talent_penalties` rows -- it increments talent_profiles.pemerataan_penalty and publishes outbox events (penalty.service.ts:50-60); any talent_penalties row would be a consumer's doing. Severity corrected from high to medium: no replicas are configured, so nothing is broken in production today; the cost is that scaling out the bottleneck service is currently unsafe. The proposed fixes (SKIP LOCKED or move to project-worker; advisory lock or Temporal cron) are correct.

### [MEDIUM] payment-service accepts the platform fee as a caller-supplied number and never recomputes it from the pricing table
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/lib/settle-milestone.ts:17-62 computes `feeAmount` in TypeScript from the work package's `talent_payout / amount` ratio, falling back to the project totals, and passes it over the wire (payment-client.ts:66). apps/payment-service/internal/handler/payments.go ReleaseEscrow reads `req.FeeAmount` and forwards it verbatim. apps/payment-service/internal/service/payment.go ReleaseEscrow validates only `in.FeeAmount < 0 || in.FeeAmount >= in.Amount`, then writes the ledger legs from `talentAmount := in.Amount - in.FeeAmount`. There is no reference to PLATFORM_FEE_BRACKETS or any bracket lookup anywhere in the Go service. Note settle-milestone.ts:50 and :54-60 both return a fee of 0 on anomalous pricing data, which payment-service accepts as valid.
- **Root cause:** packages/shared/src/pricing.ts is TypeScript-only, so the Go ledger has no access to the authoritative bracket table and the fee had to arrive as a parameter. The bounds check was added as a guard rail but is a sanity check, not a derivation.
- **Impact:** The double-entry ledger — which apps/admin/PRODUCT.md describes as the place 'where every movement must sum to zero' and the single surface where platform economics are fully visible — is only as correct as project-service's arithmetic. A pricing bug that makes `computeMilestoneFee` return 0 (two code paths do so deliberately, settle-milestone.ts:50 and :59) posts a ledger entry recognizing zero platform revenue, and nothing downstream flags it. The entries are append-only, so the correction is a compensating entry, not an edit.
- **Fix:** Either port the bracket table into payment-service (a small generated Go constant emitted from pricing.ts, checked in CI for drift) and recompute the fee server-side from `projects.final_price` — payment-service already reads that column at transaction.go:344 — or, if project-service must stay authoritative, make the anomaly loud: have settle-milestone.ts throw rather than log-and-return-0 (:54-60), and have payment-service reject a release whose implied fee ratio deviates from the project's `talent_payout/final_price` ratio beyond a rounding tolerance.
- **Edge cases:** Rejecting mismatched fees will fail releases on any project whose work-package payouts are already inconsistent with the project totals; those need to be found and reconciled before the check is enforced, or approved milestones will start failing to pay out.
- **Verifier correction:** One framing correction: because both `return 0` paths pay the talent the full gross (settle-milestone.ts:52-53 with fee 0 means talentAmount == Amount), the ledger still sums to zero and stays balanced. The consequence is unrecognized platform revenue and a silent margin leak, not an unbalanced or unreconcilable ledger -- so 'the double-entry ledger is only as correct as project-service's arithmetic' overstates it. Both proposed fixes are sound; the cheaper one (make the anomaly loud rather than silently zeroing the fee) captures most of the value without introducing a generated-constant drift check.

### [MEDIUM] Route handlers query the database directly alongside an unused repository layer; layering is inconsistent rather than absent
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/routes/projects.ts contains 35 direct `getDb()` / `db.select|insert|update|delete|transaction(` call sites while simultaneously importing ProjectRepository (:47), WorkPackageRepository (:48), ProjectService (:50) and PaymentSettlementService (:49). routes/matching.ts has 10, routes/milestones.ts 8, routes/contracts.ts 7. The pattern is visible inline: routes/milestones.ts:212-218 inserts a `milestoneComments` row straight from the handler, and :246-260 runs a raw `count(*)` aggregate before constructing `new ProjectService(new ProjectRepository(db))` on the very next line to perform the transition. The repositories/ directory holds 10 real implementations, so the layer exists and is bypassed. project.service.ts is 4.8K against a 58.2K projects.ts — the business logic did not move down.
- **Root cause:** The repository and service layers were introduced after the routes were already written, and adoption stopped at the cases that needed unit tests. Nothing enforces the boundary — no lint rule forbids importing `@kerjacus/db` from routes/.
- **Impact:** Maintenance drag concentrated in the single largest file in the service. Cross-cutting changes have to be applied in two places with different shapes: the same milestone-status logic is reachable through routes/milestones.ts and through activities/milestone.activities.ts (which calls `settleMilestoneEscrow` directly at :53), so a rule added to one path does not reach the other. It also makes the domain logic effectively untestable without a database, which is why project.service.test.ts is 48.9K of tests against a 4.8K service while the 58.2K route file has thinner coverage.
- **Fix:** Add a Biome lint rule (or a `no-restricted-imports` equivalent) banning `@kerjacus/db` imports from `src/routes/**`, then migrate incrementally rather than in one pass — start with the paths that already have a service (project status transitions, work-package pricing, milestone status) since those are pure moves. Do not attempt to decompose projects.ts wholesale; the value is in getting the money- and status-mutating paths behind services, not in the file size.
- **Verifier correction:** No substantive correction. The proposed fix -- a no-restricted-imports rule banning @kerjacus/db from src/routes/**, then incremental migration starting with paths that already have a service -- is the right sequencing and explicitly avoids decomposing projects.ts wholesale. Worth noting the rule must land as a warning or with per-file overrides first, since 58+ existing call sites would fail it on day one.

### [LOW] project-service is the domain; the other five services are peripherals, and the split is not where the coupling is
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/index.ts:127-144 mounts 18 route groups covering projects, milestones, matching, work-packages, time-logs, talents, reviews, disputes, contracts, chat, applications, talent-profiles, talent-placement, upload, activities, realtime and invoices. Alongside them it owns: platform fee arithmetic (lib/settle-milestone.ts:17-62 `computeMilestoneFee`), escrow orchestration (lib/payment-client.ts), invoice PDF rendering (services/invoice.service.ts:126-136 + src/templates/InvoiceTemplate.ts), BRD/PRD PDF rendering (lib/brd-pdf.ts, lib/prd-pdf.ts), AI proxying (routes/projects.ts:876, :1019, :1166), CV-parse orchestration (routes/upload.ts:132), and Centrifugo token signing (lib/subscription-token.ts). By contrast the four peripheral services are thin: admin-service performs exactly three writes across its entire store layer (`UPDATE dead_letter_events`, `INSERT INTO platform_settings`, `INSERT INTO admin_audit_logs`) and is otherwise a read-only BI layer over project-service's tables. The boundary is also decorative in one place: apps/ai-service/app/routes/ai.py:1596-1612 exposes `/match-talents`, which does nothing but POST back to project-service `/api/v1/matching/recommend` and remap the field names — a full network round trip out and back, and a grep shows nothing outside ai-service's own tests (tests/test_ai_routes.py:1025-1050) ever calls it.
- **Root cause:** The services were split along technology and infrastructure lines (Go for money, Python for LLMs, Hono for HTTP) rather than along bounded contexts. Everything that is genuinely business logic stayed in one place because that is where the domain actually is; the peripherals are integrations, not contexts.
- **Impact:** This is honest for the current stage and is not urgent to undo — but it invalidates the reason CLAUDE.md gives for microservices ('penambahan domain baru hanya perlu service baru tanpa mengubah service existing'). Adding the planned civil/geodesy domains would require changing project-service, because project lifecycle, matching, escrow and documents all live there. The concrete cost today is that project-service is a single point of failure with a 160M memory cap and no replicas, and that the replica-hostile singletons above cannot be fixed by scaling out.
- **Fix:** Do not re-split; the current shape is the right one for the stage. Two cheap corrections instead: (1) delete the dead `/match-talents` endpoint in ai-service (ai.py:1596) so the service graph has no phantom cycle; (2) amend CLAUDE.md to describe project-service as the domain core with four supporting integration services, so future extension work is planned against the real topology rather than the aspirational one. If load ever justifies a split, invoicing and PDF rendering are the cleanest first extraction — they are already event-driven via `milestone.invoice_requested` (routes/milestones.ts:224-230 + services/invoice-consumer.ts:18).
- **Verifier correction:** Two factual corrections. admin-service performs five writes, not three: dlq.go:142 (UPDATE dead_letter_events), users.go:226 and :247 (UPDATE "user" for suspend/unsuspend -- both missed), users.go:306 (INSERT admin_audit_logs), users.go:475 (INSERT platform_settings). The suspend/unsuspend writes matter because they are the one place admin-service mutates auth-domain state, which is exactly the cross-domain coupling the finding is about. Severity corrected from medium to low: the finding itself concludes 'do not re-split' and its only actionable items are deleting a dead endpoint and amending a doc.

### [LOW] CLAUDE.md names Traefik v3 as the API gateway; production runs a hand-written nginx config, and the Traefik labels left in prod compose are inert
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/gateway/Dockerfile.api-gateway is two lines: `FROM nginx:alpine` + `COPY nginx-api-gateway.conf /etc/nginx/conf.d/default.conf`. docker-compose.prod.yml's `api-gateway` service builds that Dockerfile as `kerjacus/api-gateway:latest`, and there is no `traefik` service anywhere in docker-compose.prod.yml — the service list is postgres, pgbouncer, valkey, nats, nats-init, minio, minio-init, centrifugo, temporal-db, temporal, temporal-ui, openobserve, uptime-kuma, db-migrate, the six app services, web, admin, api-gateway. Yet docker-compose.prod.yml:240-244 and :257-260 still carry `traefik.enable=true` / `traefik.http.routers...` labels on openobserve and uptime-kuma, which nothing reads. Traefik exists only in the dev compose (docker-compose.yml, traefik service), which contains no application services at all. The routing is entirely manual: nginx-api-gateway.conf:44 (/api/), :53 (project-service:3002), :63-94 (auth-service:3001), :107 (ai-service:3003), :121 (payment-service:3004), :136 (notification-service:3005), :151 (admin-service:3006), :161 (centrifugo), :179 (minio). CLAUDE.md's claimed 'Auto-discovery via Docker labels' and 'SSL termination, rate limiting global' are not what ships — nginx does none of the rate limiting, which lives in each service's in-memory limiter.
- **Root cause:** Traefik was the original choice and survives in the dev compose and in documentation; production needed behaviors that were quicker to express in nginx (the OPTIONS-via-418 CORS trick at :31-46, the MinIO presigned-URL Host override at :176-183, the Centrifugo prefix rewrite at :158-168), so an nginx gateway was written and the docs were never updated.
- **Impact:** Low operational risk right now — the nginx config is correct and reasonably careful — but it misleads anyone reasoning about the system. Two concrete consequences: routing a new service requires editing a checked-in nginx file and redeploying the gateway rather than adding a label, and per-service `proxy_read_timeout` is set on exactly one location (:112, ai-service 120s) while payment, notification and admin locations inherit nginx's 60s default, which nobody has reconciled against the 60s BRD/PRD generation budget in CLAUDE.md. The stale Traefik labels are also a trap: someone reading them will assume observe.kerjacus.id and status.kerjacus.id are routed and TLS-terminated when nothing serves them.
- **Fix:** Pick one and make the docs match. Given the nginx config already encodes three behaviors that are awkward in Traefik, keeping nginx is the lower-risk choice: update CLAUDE.md's 'API Gateway (Traefik v3)' section to describe apps/gateway/nginx-api-gateway.conf, delete the dead traefik labels at docker-compose.prod.yml:240-244 and :257-260, and either remove apps/gateway/traefik.yml + dynamic.yml or scope them explicitly to local development. Separately, set explicit proxy_read_timeout on the payment, notification and admin locations rather than inheriting the 60s default.
- **Verifier correction:** The central claim -- that the Traefik labels are inert leftovers -- is REFUTED, and the proposed fix would break production. docker-compose.prod.yml:609-612 declares `networks: default: external: true, name: dokploy-network`, and CI deploys via Dokploy (ci.yml:294, POST /api/compose.deploy). Dokploy ships Traefik on that network and consumes these labels. The finding also cherry-picked the two observability services: labels are equally present on web (:545-549), admin (:564-568) and api-gateway itself (:582-586). The real topology is Dokploy's Traefik doing TLS termination and host routing (kerjacus.id, admin.kerjacus.id, api.kerjacus.id, observe.kerjacus.id, status.kerjacus.id), with nginx as an internal path router behind it for the api host only. Deleting the labels at :240-244 and :257-260 as proposed would drop TLS and routing for observe.kerjacus.id and status.kerjacus.id, for which nginx has no `location` block and therefore no fallback. The timeout sub-claim is also self-defeating: BRD/PRD generation goes through /api/v1/ai, which is the ONE location with an explicit `proxy_read_timeout 120s` (:112), so it is not unreconciled against the 60s budget; payment/notification/admin inheriting nginx's 60s default has no demonstrated problem. Salvageable content: amend CLAUDE.md to describe the two-tier Traefik-plus-nginx topology. Severity drops from medium to low.

## Database architecture and query performance

_The schema is well-normalized with good FK discipline (only one genuinely missing FK), and the money code in payment-service shows real care — row locking, idempotency keys, serializable ledger transactions, and an escrow-sufficiency guard. But the database itself enforces almost nothing: zero CHECK constraints across all 22 migrations, no unique constraint on `accounts(owner_type, owner_id)` despite a read-then-insert get-or-create running under Read Committed, and `accounts.balance` — the sole authority for the escrow sufficiency guard — maintained purely by application arithmetic with no reconciliation against `ledger_entries` anywhere in the repo. Index coverage was clearly retrofitted in two late passes (0017, 0021) that caught the paths someone profiled and missed ~14 others, including `tasks.milestone_id` (Gantt), `chat_conversations.project_id` (every AI-scoping message), and every `created_at` column the admin dashboard aggregates on — where the query shape (`created_at::date = d.day`) is non-sargable anyway and does one full table scan per day in the requested range. Growth controls are documented in CLAUDE.md and implemented nowhere: no partitioning, no retention, no cleanup of published outbox rows._

### [CRITICAL] accounts has no unique constraint on (owner_type, owner_id); GetOrCreateAccountTx is a read-then-insert that can duplicate escrow accounts and strand funds
`UNVERIFIED` · behavior-change: `True`

- **Evidence:** packages/db/src/schema/payment.ts:104-114 declares `accounts` with no index/unique array; migration packages/db/migrations/0000_dark_microchip.sql:286-296 creates it with only a PK on id, and grepping all 22 migrations for CREATE INDEX finds nothing on `accounts`. apps/payment-service/internal/store/ledger.go:270-294 GetOrCreateAccountTx does FindAccountByOwnerTx (SELECT ... LIMIT 1) then INSERT with no ON CONFLICT and no lock. It is called from apps/payment-service/internal/handler/webhook.go:246 and :259 (fundEscrowLedgerTx) inside a transaction opened with `pgx.TxOptions{}` (webhook.go:121) — Read Committed, not Serializable, so the phantom is not detected. FindAccountByOwner (ledger.go:102-121) then reads back with `LIMIT 1` and no ORDER BY.
- **Root cause:** The uniqueness of an account per (owner_type, owner_id) is a modelling invariant that only ever existed in the shape of the Go helper, never in the schema. Because owner_id is polymorphic (it holds a user.id, a talent_profiles.id, or a projects.id depending on owner_type, which is why no FK is possible), a unique index is the only enforcement mechanism available — and it was never added.
- **Impact:** Two Midtrans webhook deliveries settling two escrow_in transactions for the same project concurrently each create their own escrow account. The project's funded balance then splits across two rows; FindAccountByOwner picks one arbitrarily, so GetEscrowBalance under-reports and ReleaseEscrow (payment.go:211) rejects every milestone payout with `insufficient escrow balance` for money that is actually in the ledger. The talent is never paid and the owner's escrow is unrecoverable without manual DB surgery. The same race applies to the owner account (webhook.go:246) and the talent payout account (payment.go:215). Secondary cost: with no index at all on these columns, every escrow balance lookup is a sequential scan of `accounts`, which grows at roughly one row per project plus one per user, inside a Serializable transaction — and an unindexed predicate in SSI escalates the predicate lock toward relation granularity, making spurious 40001 serialization failures more likely as the table grows.
- **Fix:** Add `CREATE UNIQUE INDEX CONCURRENTLY uq_accounts_owner ON accounts (owner_type, owner_id) NULLS NOT DISTINCT` (Postgres 15+ handles the platform account's NULL owner_id correctly with NULLS NOT DISTINCT), then rewrite GetOrCreateAccountTx to `INSERT ... ON CONFLICT (owner_type, owner_id) DO UPDATE SET updated_at = EXCLUDED.updated_at RETURNING *` so it is a single atomic statement. This must be preceded by a cleanup migration that merges any existing duplicate rows and re-points ledger_entries.account_id, otherwise the index creation fails on deploy.
- **Edge cases:** A second escrow top-up on an already-funded project is the most likely trigger, because both webhooks target the same project_id. Retried webhook deliveries are covered by LockStatusTx on the transaction row (webhook.go:132) but that lock does not serialize account creation for two *different* transaction rows.

### [CRITICAL] accounts.balance is application-maintained, is the sole authority for the escrow sufficiency guard, and is never reconciled against ledger_entries
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/payment-service/internal/store/ledger.go:203-208 and :359-361 maintain balance with `UPDATE accounts SET balance = balance + $1`, issued as a separate statement per ledger entry. apps/payment-service/internal/service/payment.go:211 (`escrowAccount.Balance < in.Amount`) and :434 (same guard in ProcessRefund) read that column as the gate on releasing and refunding money. A repo-wide grep for `reconcil` returns only comments in midtrans_status.go and config_test.go plus an unrelated pricing test — no query, job, or test anywhere compares accounts.balance to `SUM(amount) FILTER (WHERE entry_type='debit') - SUM(...credit)` from ledger_entries. CLAUDE.md states the invariant ("balance ... selalu = sum(debit) - sum(credit) dari ledger_entries") as if it were enforced; packages/db/src/schema/payment.ts:110 declares it as a plain `integer('balance').default(0)`.
- **Root cause:** A denormalized running total was introduced for read performance without either a database-level derivation (trigger or generated view) or a periodic verification job. The double-entry sum-to-zero check that does exist (ledger.go:141-158, :303-320) validates the *entries* balance each other, which is a different invariant — it says nothing about whether accounts.balance still reflects them.
- **Impact:** Any divergence is silent and self-perpetuating. If balance drifts low, legitimate payouts are blocked with a misleading `insufficient escrow balance` error and the talent goes unpaid; if it drifts high, ReleaseEscrow and ProcessRefund will pay out more than was ever deposited, because the guard is the only thing standing between them and the money. Detection today requires someone to notice a payout failing and hand-query the ledger. Because ledger_entries is append-only, the reconstructed truth is always available — nothing is looking at it.
- **Fix:** Two layers. (a) A reconciliation query run on a schedule and on demand from the admin panel: `SELECT a.id, a.balance, COALESCE(SUM(CASE WHEN l.entry_type='debit' THEN l.amount ELSE -l.amount END),0) AS derived FROM accounts a LEFT JOIN ledger_entries l ON l.account_id=a.id GROUP BY a.id, a.balance HAVING a.balance <> derived` — cheap because idx_ledger_account_created already exists, and it should alert, not auto-correct. (b) Make the balance update unforgeable by moving it into an AFTER INSERT trigger on ledger_entries so the two writes cannot be separated, and drop the manual UPDATE from ledger.go:203 and :359.
- **Edge cases:** Divergence does not require a bug in the current code: any future code path that inserts into ledger_entries directly (an admin tool, a data fix, a NATS consumer) without the paired balance UPDATE creates it. So does a partial failure in the per-entry loop if it ever runs outside a transaction.

### [HIGH] Zero CHECK constraints exist despite CLAUDE.md documenting eight; the load-bearing ones guard cross-column invariants Zod structurally cannot express
`UNVERIFIED` · behavior-change: `True`

- **Evidence:** `grep -rni 'check' packages/db/migrations/*.sql` returns nothing across all 22 migration files, confirming CLAUDE.md's own admission. Edge validation partially compensates for the single-column cases: packages/shared/src/schemas.ts:187 has `rating: z.number().int().min(1).max(5)` and :162 has `durationMinutes: z.number().int().positive()`. It does not compensate for cross-column ones. apps/project-service/src/services/time-log.service.ts:20-22 uses a caller-supplied durationMinutes verbatim (`input.durationMinutes ?? null`) and only computes it when absent, while the only guard is `endedAt <= startedAt` (:24-27) — so a caller may post a 5-minute interval with durationMinutes: 480 and both pass. packages/db/src/schema/project.ts:157-159 declares finalPrice/platformFee/talentPayout as three independent nullable integers with nothing tying them together; the invariant `final_price = talent_payout + platform_fee` lives only in packages/shared/src/pricing.ts and a unit test. project.ts:409-413 lets milestone_type='individual' coexist with a NULL assigned_talent_id. Missing FK: packages/db/src/schema/auth.ts:158 `relatedProjectId: text('related_project_id')` has no .references() — the one genuine case; accounts.owner_id, admin_audit_logs.target_id and outbox_events.aggregate_id are polymorphic by design and correctly have none.
- **Root cause:** Validation was placed exclusively at the Hono/Zod HTTP boundary of one service. Three Go services (payment, admin, notification), the NATS consumers, and packages/db/src/seed.ts all write to the same tables without passing through any Zod schema, so the boundary is not the boundary.
- **Impact:** time_logs is the sharpest case: inflated durations propagate into per-milestone and per-talent time aggregates that CLAUDE.md says feed future team-size estimation, and there is no way to detect it after the fact because the interval and the duration are both stored. The pricing invariant is the most expensive: apps/project-service/src/services/work-package.service.ts:82-84 explicitly notes in its own comment that if the repricing transaction breaks the sum, "tidak ada CHECK constraint yang menangkapnya, dan computeMilestoneFee memakai rasio yang salah untuk setiap pencairan sesudahnya" — the fee ratio on every subsequent settlement is silently wrong.
- **Fix:** Add the cross-column constraints, which is where the value is: `ALTER TABLE time_logs ADD CONSTRAINT time_logs_interval CHECK (ended_at IS NULL OR ended_at > started_at) NOT VALID`, `... CHECK (duration_minutes IS NULL OR ended_at IS NULL OR duration_minutes BETWEEN 0 AND EXTRACT(EPOCH FROM (ended_at - started_at))/60 + 1) NOT VALID`, `ALTER TABLE projects ADD CONSTRAINT projects_price_split CHECK (final_price IS NULL OR final_price = talent_payout + platform_fee) NOT VALID`, plus the single-column amount/rating ones for the non-Zod writers. Every one must be added NOT VALID first and VALIDATE CONSTRAINT in a follow-up migration, or the deploy fails on any pre-existing violating row and takes an ACCESS EXCLUSIVE lock while it scans. Add the missing FK on talent_penalties.related_project_id in the same pass.
- **Edge cases:** An individual milestone with a NULL assigned_talent_id silently drops out of getTalentHistoricalStats (matching.repository.ts:127-134 groups by assignedTalentId), so a talent's on-time rate is computed from a subset of their milestones without anyone noticing.

### [HIGH] Roughly fourteen hot-path query columns have no supporting index, including tasks.milestone_id (Gantt) and project_applications.talent_id (wrong prefix order)
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** Cross-referencing every CREATE INDEX in packages/db/migrations against actual query predicates. Missing and demonstrably queried: tasks.milestone_id — apps/project-service/src/repositories/project.repository.ts:321 joins tasks to milestones filtered by milestones.projectId for the whole Gantt view. chat_conversations.project_id — apps/project-service/src/routes/projects.ts:840, 968, 1187, 1294, 1656, hit on every AI-scoping message. project_activities.project_id — routes/activities.ts:102 and :109 (list and count, so twice per page). milestone_files.milestone_id (routes/milestones.ts:301), milestone_comments.milestone_id (:331), revision_requests.milestone_id (repositories/milestone.repository.ts:139), contracts.project_id (routes/contracts.ts:147), disputes.project_id (repositories/dispute.repository.ts:68), project_status_logs.project_id (project.repository.ts:297), reviews.reviewee_id (routes/talents.ts:104, routes/reviews.ts:205, and the matching join at matching.repository.ts:155), reviews.project_id (routes/reviews.ts:182), transaction_events.transaction_id, and transactions.created_at / projects.created_at / ai_interactions.created_at / user.created_at for the admin dashboard and lists. The subtle one: project_applications has `uniqueIndex('project_applications_unique').on(projectId, talentId)` (packages/db/src/schema/project.ts:304) but routes/applications.ts:234 and :241 query `WHERE talent_id = $1` — the non-leading column, which a btree on (project_id, talent_id) cannot serve efficiently.
- **Root cause:** Indexes were added reactively in two late passes — migration 0001 (three), 0017 (six, payment-focused), 0021 (seven, with schema comments naming the specific slow query each one fixed). Each pass covered what someone had just profiled. There was never a systematic sweep of foreign keys, which Postgres does not index automatically, against actual predicates.
- **Impact:** Every one of these is a sequential scan whose cost grows linearly with the table. project_activities and chat_conversations grow per project and per message respectively, so the activity feed and the scoping chat degrade fastest — and the scoping chat sits directly on the AI streaming path with a documented sub-1s first-token target. The Gantt endpoint scans the entire tasks table for one project. The talent's 'my applications' dashboard scans all applications platform-wide, twice.
- **Fix:** One migration adding the missing indexes, all with CREATE INDEX CONCURRENTLY so they do not hold a write lock: single-column on each FK listed above; `(milestone_id)` on the three milestone children; `(project_id, created_at DESC)` on project_activities and project_status_logs since both are read newest-first; `(talent_id, status)` on project_applications; `(reviewee_id, type)` on reviews to serve both the profile read and the matching join; and `(created_at)` on transactions, projects, ai_interactions and "user". Note that the created_at indexes are wasted unless the dashboard query is also made sargable — see the separate finding.
- **Edge cases:** The project_applications case is the one that will not show up in review: the index exists, is named for the constraint it enforces, and looks like coverage. Only reading the column order against the predicate reveals it.

### [HIGH] Admin dashboard runs one full sequential scan per day in the requested range against transactions, projects and ai_interactions, unbounded by any date cap
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/admin-service/internal/store/dashboard.go:253-275 (GetDailyRevenue) and :310-319 (GetAiUsage) both join `generate_series($1::date, $2::date, interval '1 day')` to a LATERAL subquery whose predicate is `WHERE created_at::date = d.day::date`. Casting the column defeats any btree index on created_at (none exists anyway), so each of the N generated days drives a full scan. GetDailyRevenue does this twice per day — once on transactions, once on projects. The byModel query at :349 uses `created_at::date BETWEEN $1 AND $2`, also non-sargable. apps/admin-service/internal/handler/dashboard.go:78-107 calls GetProjectStats, GetRevenueStats, GetTalentStats, GetDailyRevenue and GetAiUsage sequentially per request with no caching, and the from/to params (:34-66) are validated only for format — no maximum span is enforced.
- **Root cause:** These functions were rewritten to read base tables after migration 0014 dropped the mv_* tables (the comments at dashboard.go:222-243 and :293-300 document that the materialized views were never materialized views at all — Drizzle created them as empty plain tables, so every revenue figure read zero). The rewrite fixed correctness and did not consider access paths.
- **Impact:** At the 30-day default that is 60 seq scans of transactions plus 60 of projects plus 30 of ai_interactions per dashboard load, with no caching, on tables that grow with every payment and every LLM call. ai_interactions is the fastest-growing of the three — CLAUDE.md earmarks it for monthly partitioning. Worse, the range is caller-controlled: an admin selecting a one-year window issues 365 scans per table, roughly 1,100 full scans in a single HTTP request, on the shared PgBouncer-fronted database that every other service depends on. That is an availability risk reachable from an authenticated admin session, not just a slow page.
- **Fix:** Rewrite as a single sargable pass per table and left-join it to the series: `SELECT date_trunc('day', created_at) AS day, SUM(...) FILTER (...) FROM transactions WHERE created_at >= $1 AND created_at < $2 + interval '1 day' AND status='completed' AND deleted_at IS NULL GROUP BY 1`, then `generate_series ... LEFT JOIN agg ON agg.day = d.day` to keep zero-days. That turns N scans into one range scan per table and makes the created_at indexes from the previous finding actually usable. Separately, cap the accepted span (90 days is generous) and cache the response in Valkey for 60s — the dashboard has no need to be second-fresh.
- **Edge cases:** `created_at::date` also silently applies the server's timezone to a timestamptz, so day boundaries shift relative to the ::date::text label returned to the chart.

### [HIGH] Project status transitions validate against a stale read and update without SELECT FOR UPDATE, so two concurrent transitions can both pass the state machine
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/services/project.service.ts:58-77: transitionStatus calls projectRepo.findById (a plain pool read, project.repository.ts:85-93, no transaction, no lock), validates via validateTransitionViaXState against that snapshot, then calls updateStatus. apps/project-service/src/repositories/project.repository.ts:146-204: updateStatus opens a transaction, re-SELECTs the row *without* FOR UPDATE (:147-151), takes fromStatus from it, UPDATEs unconditionally (`.where(eq(projects.id, id))` — no status predicate), writes the status log and the outbox event. The transition is never re-validated inside the transaction.
- **Root cause:** The read that decides and the write that acts are in different services and different transaction scopes. The transactional wrapper in updateStatus was added for atomicity of the three writes (row, log, outbox event), which it achieves, but atomicity is not isolation — nothing prevents the row from having moved between the validating read and the locking write.
- **Impact:** Two valid-from-the-same-state transitions racing produce an arbitrary winner and a falsified audit trail. The concrete money case: from brd_approved, both `brd_purchased` (the owner buys the BRD and exits) and `prd_generated` (the owner continues to PRD) are valid targets. If both fire, the project ends in one state while project_status_logs records a from_status that was already superseded — and project_status_logs is the audit trail the platform relies on for dispute resolution. The same shape applies to prd_approved -> matching vs prd_approved -> cancelled, where cancellation drives refunds.
- **Fix:** Move the validation inside the transaction and lock the row first: in updateStatus, change the initial select to `.for('update')`, then run validateTransitionViaXState(current.status, newStatus) there and throw if it now fails. Have transitionStatus pass only the target status and let the repository own both the read and the check — the pre-read in project.service.ts becomes a fast-fail optimization rather than the decision. Equivalently, add `eq(projects.status, expectedFromStatus)` to the UPDATE's where clause and treat a zero-row result as a conflict.
- **Edge cases:** A double-clicked button or a client retry on a slow response is enough; this does not need two distinct users. Under Read Committed the second UPDATE blocks on the first's row lock and then applies cleanly, so there is no error and nothing in the logs indicates anything happened.

### [HIGH] Talent matching loads every eligible talent and every skill embedding into memory on each request, then scores in JavaScript
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/repositories/matching.repository.ts:36-66 findEligibleTalents selects all talent_profiles where verification_status='verified' and availability_status='available' with no LIMIT and no pagination — the filter is served by idx_talent_profiles_eligible (migration 0021) and the two correlated assignment-count subqueries are served by idx_project_assignments_talent_status, so the access paths are fine; the row count is not. matching.repository.ts:84-107 getAllSkillEmbeddings selects name, aliases and the full vector(768) for every skill with a non-null embedding and materializes them into a JS Map, once per matching request (matching.service.ts:274). getTalentSkills (:70-81) is then called with an inArray of every talent id. Scoring runs in JS: matching.service.ts:156-159 loops required skills, :128-131 loops each talent's skills computing jaroWinkler (:75-111, an O(len^2) string algorithm), for every talent.
- **Root cause:** The service layer was correctly refactored to batch-load once per project instead of once per work package (the comment at matching.service.ts:356-360 documents that fix), but the underlying reads were never bounded. Candidate filtering and ranking are being done in the application because the fuzzy cascade — exact, Jaro-Winkler, then embedding cosine — was written in TypeScript, even though pgvector with an HNSW index is already installed and indexed on skills.embedding (migration 0008).
- **Impact:** Cost is O(talents x requiredSkills x skillsPerTalent) CPU plus O(skills x 768 x 8 bytes) allocation on every call, on Bun's single-threaded event loop, against a documented <500ms P95 for matching. At 5,000 verified talents averaging 8 skills against 5 required skills, that is 200,000 Jaro-Winkler evaluations per request, blocking every other request in the process. The embedding map alone is ~6MB per request at 1,000 skills, re-allocated each time and never cached.
- **Fix:** Two independent changes. (a) Hoist the embedding map out of the request path — it changes only when the skills taxonomy changes, so build it once at startup and invalidate on skill write, or cache it in Valkey. (b) Push candidate narrowing into SQL: pre-filter talents to those with at least one exact or alias skill overlap using talent_skills joined to skills, and only run the Jaro-Winkler/embedding cascade over that reduced set. Add a hard LIMIT (a few hundred) on findEligibleTalents ordered by pemerataan_skor so the exploration guarantee is preserved while the pool is bounded.
- **Edge cases:** Because there is no LIMIT, the failure mode is not gradual degradation but a cliff: the request stays fast until the talent pool crosses the point where the event loop stalls, and then every endpoint in project-service goes slow at once.

### [MEDIUM] Migrations 0006/0007 are a pair of full-table rewrites that cancel each other out; 0019 deletes production data; no index is created CONCURRENTLY
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** packages/db/migrations/0006_needy_doomsday.sql renames the project_category enum value other_digital -> other via ALTER TABLE projects ALTER COLUMN category SET DATA TYPE text, DROP TYPE, CREATE TYPE, ALTER COLUMN back. 0007_chemical_wildside.sql is byte-for-byte the same sequence renaming other -> other_digital, restoring the original state. Each ALTER COLUMN SET DATA TYPE rewrites the entire projects table under an ACCESS EXCLUSIVE lock, so the pair costs two full rewrites and two exclusive locks to achieve nothing. 0019_wooden_harry_osborn.sql:5 issues `DELETE FROM "project_invoices"` — an unconditional data deletion — before adding `audience invoice_audience NOT NULL` with no default (:8), which succeeds only because the table was just emptied. 0008_gemini_embeddings.sql:6, :9, :12 do `ALTER TABLE ... DROP COLUMN IF EXISTS embedding` before re-adding. Every CREATE INDEX across 0001, 0008, 0017, 0019, 0021 is written without CONCURRENTLY.
- **Root cause:** Migrations are generated by drizzle-kit from schema diffs and hand-edited for the enum cases, with no review step asking whether the resulting DDL is safe to run against a live table. CLAUDE.md's own rule — "backward-compatible only, additive — add columns, jangan rename/drop" — is violated by four of the twenty-two.
- **Impact:** Against the documented deploy model (migrations run before deploy, rolling per-service updates, blue-green via Traefik), an ACCESS EXCLUSIVE lock on `projects` blocks every read and write platform-wide for the duration of a full table rewrite — which grows with the table, so the outage lengthens as the product succeeds. CREATE INDEX without CONCURRENTLY blocks writes to the target table for the duration of the build; on time_logs or chat_messages that is a user-visible stall. The 0019 DELETE means the migration is not replayable against any environment where those rows mattered.
- **Fix:** Going forward: add CONCURRENTLY to every CREATE INDEX (and drop them from the drizzle-generated file into a hand-written migration, since drizzle-kit will not emit it); never emit ALTER COLUMN TYPE on a hot table — for enum value renames use `ALTER TYPE ... RENAME VALUE` (Postgres 10+), which is a catalog-only change with no rewrite; and gate migrations on a review checklist that rejects unconditional DELETE and DROP COLUMN. 0006/0007 can be collapsed into a no-op for fresh environments, but only after confirming no deployed database is between them.
- **Edge cases:** 0006 and 0007 both run on any fresh environment, so a new staging or PR-branch database pays both rewrites even though the net effect is zero. Squashing them is safe only if no environment sits between the two.

### [MEDIUM] Every table CLAUDE.md names for partitioning or retention grows without bound, and published outbox rows are never deleted
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** A repo-wide grep for PARTITION, pg_cron, cron.schedule and retention across all .sql, .ts and .go files returns zero non-test hits. packages/db/migrations contains no PARTITION BY. apps/project-service/src/services/scheduled-jobs.ts is the only scheduler in the repo and runs exactly two jobs — inactive-talent scan and abandon penalties — with no archival or cleanup. apps/project-service/src/services/outbox-worker.ts:93-96 marks rows `published: true` and never deletes them; the only index, idx_outbox_unpublished (migration 0017), is partial on `WHERE published = false`, so the scan stays fast while the heap grows forever. The schema comment at packages/db/src/schema/project.ts:545-547 acknowledges time_logs "grows faster than anything else here — CLAUDE.md already earmarks it for monthly partitioning", which was not done.
- **Root cause:** The retention and partitioning design was written into CLAUDE.md as architecture and never scheduled as work. The mechanism it depends on — pg_cron — is not installed (CLAUDE.md's own note confirms this), and pg-boss, the documented alternative for background jobs, is absent from package.json, so there is no execution substrate for a cleanup job even if one were written.
- **Impact:** chat_messages (every AI scoping turn plus every owner-talent message), time_logs (one row per timer stop), ai_interactions (one row per LLM call), outbox_events and project_activities all accumulate indefinitely on a single VPS-hosted Postgres. The immediate cost is storage and backup time; the second-order cost is that the sequential scans identified in the index and dashboard findings get slower in direct proportion. outbox_events is the most avoidable: it is pure transient plumbing where every row older than a day is dead weight.
- **Fix:** Start with the cheap, high-value half: a delete job for outbox_events where published = true and published_at < now() - interval '24 hours', batched, run from the existing scheduled-jobs.ts interval. Then convert chat_messages, time_logs and ai_interactions to declaratively range-partitioned tables by created_at (monthly) — doing this while the tables are small is enormously cheaper than after, and it makes retention a DETACH PARTITION rather than a mass DELETE. The schema is already partition-friendly since created_at is NOT NULL on all three; the blocker is that the primary key must include the partition key, which is a breaking schema change and needs owner sign-off on timing.
- **Edge cases:** outbox-worker.ts:38 filters `retry_count < 3`, so a permanently failing event stays published=false forever and remains in the partial index indefinitely — a slow poison specifically in the index that was created to keep the poll fast.

### [MEDIUM] packages/db/src/seed.ts is a 6,223-line inline fixture that is type-checked in the package build, runs against DATABASE_DIRECT_URL with no environment guard, and is not transactional
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** packages/db/src/seed.ts is one `async function seed()` (line 69) containing thousands of hand-written literal rows; wc gives 6,223 lines / 204KB. packages/db/package.json declares `"build": "tsc --noEmit"` for the whole package, so the file is fully type-checked on every build even though packages/db/src/index.ts exports only ./client and ./schema — it never ships to any service. seed.ts:70 does `getDb(process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL)` with no NODE_ENV check anywhere in the file. Writes are individual `await db.insert(...).onConflictDoNothing()` calls (lines 520, 773, 1364, 2930, and many more) with no db.transaction wrapper; the file ends in process.exit(0)/process.exit(1) (:6217, :6222).
- **Root cause:** Demo data grew organically as inline literals rather than as data files, and the package's typecheck script has no exclusion for it. The safety question — what happens if this runs against production — was never asked, because in development DATABASE_DIRECT_URL always points at localhost.
- **Impact:** Build cost: 6,223 lines of deeply nested object literals is the single largest input to tsc in packages/db, paid on every CI run and every Turborepo cache miss, for output that is never used. Operational risk: `bun run db:seed` is one command away from the production connection string, with no guard to stop it — and because DATABASE_DIRECT_URL deliberately bypasses PgBouncer, it is precisely the variable set to the real primary. Because there is no transaction, a mid-run failure leaves the database in a partially seeded state that no rollback undoes; onConflictDoNothing makes a re-run merge rather than reset, which quietly hides the gap.
- **Fix:** Three independent, low-risk changes. Add `"exclude": ["src/seed.ts"]` to the package tsconfig used by the build script (keep it type-checked in a separate dev-only script). Add a hard guard at the top of seed(): refuse to run unless NODE_ENV is development or test, or an explicit --force flag is passed. Wrap the whole body in a single db.transaction so a failure rolls back. Extracting the literals into JSON fixtures is a larger refactor and can follow.
- **Edge cases:** onConflictDoNothing silently skips rows whose unique keys already exist, so a seed run after a schema change can produce a database that looks seeded but is missing exactly the rows that changed shape — and it exits 0.

### [MEDIUM] No single-leader coordination for database-mutating background work: setInterval jobs and the outbox poller both duplicate across replicas
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/services/scheduled-jobs.ts:64 starts penalty jobs with a plain `setInterval(runPenaltyJobs, SIX_HOURS)` in every process, with no advisory lock, no leader election, and no claim on the rows it processes. Those jobs call PenaltyService, which calls matching.repository.ts:190-197 incrementPemerataanPenalty — `LEAST(pemerataan_penalty + delta, 5.0)`, atomic per statement but fully repeatable. apps/project-service/src/services/outbox-worker.ts:35-41 selects the oldest 100 unpublished rows with no FOR UPDATE SKIP LOCKED and no claiming update, so two replicas read the same batch. CLAUDE.md's deployment section describes horizontal scaling per service and blue-green deployment with both stacks running simultaneously.
- **Root cause:** Background work was implemented as in-process timers on the assumption of exactly one replica. That assumption holds in docker-compose today and is contradicted by the documented scaling and blue-green strategies, where two instances run concurrently by design during every switchover.
- **Impact:** The outbox half is largely covered downstream: publishes carry msgID: event.id (outbox-worker.ts:80) and JetStream deduplicates within a 2-minute window, so duplicate delivery is suppressed — the residual cost is wasted publishes and a lost-update race on the published flag. The penalty half has no such protection. Running twice applies the pemerataan penalty twice, which directly suppresses that talent in the matching score (matching.service.ts:168 divides by 1 + ... + penalty) and pushes them toward the 5.0 cap that effectively removes them from recommendations. A blue-green switchover with a 30-second initial-run delay (scheduled-jobs.ts:57) makes the double-run near-certain at exactly the moment two stacks overlap.
- **Fix:** Wrap each scheduled job body in a Postgres advisory lock — `SELECT pg_try_advisory_lock($jobKey)` at the start, unlock at the end — so only one replica executes and the others no-op. For the outbox poller, change the select to a claiming statement: `UPDATE outbox_events SET ... WHERE id IN (SELECT id FROM outbox_events WHERE published = false AND retry_count < 3 ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING *`, which makes replicas partition the work instead of duplicating it. Both are additive and change no observable product behavior.
- **Edge cases:** The penalty is capped at 5.0 but never decays, so a duplicated penalty is permanent — there is no code path anywhere that reduces pemerataan_penalty.

### [MEDIUM] Work package creation commits its transaction, then writes outbox events outside it — defeating the outbox pattern for that path
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/services/work-package.service.ts:85-104 wraps the three related writes in `this.db.transaction(async (tx) => ...)` — createMany, the repricing updatePayout loop, and the project price update — and returns after commit. apps/project-service/src/routes/work-packages.ts:113-127 then loops `for (const wp of result)` calling `appendOutboxEvent(db, ...)` with `db` (the pool, obtained at :107) rather than a transaction handle, after the service call has already returned. Contrast with apps/project-service/src/repositories/project.repository.ts:177 and :192, where appendOutboxEvent is correctly passed `tx` inside the transaction.
- **Root cause:** The outbox helper accepts either a Database or a transaction handle, so passing the pool compiles and works in the happy path. The route was written to emit one event per created package and had no transaction handle in scope, because the transaction is opened inside the service and closed before the route regains control.
- **Impact:** This is the exact dual-write problem the outbox pattern exists to eliminate. If the process dies, the database connection drops, or any single appendOutboxEvent throws after the first, the work packages and the repriced project are committed while some or all of the `work_package.created` events are lost — permanently, with no retry anywhere, because the outbox row that would have driven the retry was never written. Downstream consumers of that subject see a project whose packages simply never existed.
- **Fix:** Move the event emission inside the existing transaction. Have createWorkPackages accept the event payload construction (or return from inside tx) and call appendOutboxEvent(tx, ...) for each created package within the same db.transaction block at work-package.service.ts:85, then delete the loop at routes/work-packages.ts:113. Audit the other routes for the same shape — grep for appendOutboxEvent called with `db` rather than `tx`.
- **Edge cases:** Partial failure inside the loop is the likelier case than a crash: N packages created, the first k events written, the rest lost, and the route returns a 500 that suggests nothing was created at all.

## Backend API surface, contracts and correctness

_Authorization is unusually well covered for a codebase this size — `assertProjectOwner`/`assertProjectAccess` are applied consistently across ~15 route files, the payment service does object-level checks on every user-facing read, the Midtrans webhook signature check is correct (SHA512 over order_id+status_code+gross_amount+server_key, constant-time compare, row-locked replay guard), and all 8 ai-service endpoints are service-auth gated. But there is one genuine IDOR on `PATCH /disputes/:id/status` that lets the accused party permanently freeze disputed escrow with no code path to release it, and `isAssignedTalent` is status-blind so terminated talents keep full project read access forever. The bigger structural gap is that the documented per-work-package escrow does not exist in code (one escrow account per project), which makes owner-set milestone amounts a cross-talent hazard rather than self-harm. Contract-side, the shared error catalog's i18n mapping is entirely dead — the frontend renders server-authored English/Indonesian strings verbatim, including upstream AI service error bodies — and rate limiting is in-memory, per-instance and IP-only despite CLAUDE.md claiming Redis-backed per-user._

### [HIGH] IDOR on PATCH /disputes/:id/status permanently freezes disputed escrow
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/routes/disputes.ts:194-217 — the handler reads `getAuthUser(c)` and passes only `user.role` to `service.changeStatus(id, user.role, status, validTransitions)`. There is no `assertProjectAccess`, no check that the caller is `initiatedBy` or `againstUserId`, and no check the dispute belongs to a project the caller touches. Compare the sibling handlers, which do check: `/:id` at 157-168, `/project/:projectId` at 180-182, `/:id/resolve` at 231-233. In apps/project-service/src/services/dispute.service.ts:71-73, `ADMIN_ONLY_STATUSES = ['under_review','mediation','escalated']` — `'resolved'` is deliberately not in that list, and disputes.ts:25-30 allows `open -> resolved` directly. Dispute ids are not secret: `disputeRoute.get('/project/:projectId')` (disputes.ts:178-190) returns every dispute row on a project to anyone passing `assertProjectAccess`, which includes the talent the dispute was filed against.
- **Root cause:** Authorization for this handler was pushed into DisputeService, but only the role dimension moved. `changeStatus` was written to answer "is this an admin-only step?" and was never given the caller's user id, so the object-level question "is this caller party to this dispute?" has no place to live and was silently dropped. The route comment at line 195-197 ("Only admin or dispute parties can update status") documents an invariant the code does not implement.
- **Impact:** The talent a dispute is filed against reads their own dispute id from GET /disputes/project/:projectId, then PATCH /disputes/:id/status {"status":"resolved"} closes it. dispute.repository.ts:171-196 writes status='resolved' with resolution, resolutionType, resolvedBy and resolvedAt all left NULL. Both service entry points then hard-stop on that state: `changeStatus` throws DISPUTE_ALREADY_RESOLVED at dispute.service.ts:60-62 and `resolve` throws it at 85-87. Because `refundEscrow` is only reachable from inside `resolve` (dispute.service.ts:102-124), the admin can never move the money. The project also stays in status 'disputed' (nothing consumes the `dispute.resolved` outbox event to unfreeze it — grep across all services returns only the emitter). Net result: escrow held against a live dispute, no API path to release it to the talent or refund it to the owner, recoverable only by direct SQL. Any authenticated user on the platform can also do this to any dispute id they can obtain.
- **Fix:** Load the dispute in the handler before delegating and require the caller be `initiatedBy`, `againstUserId`, or role admin (mirroring the read path at disputes.ts:157-168), then pass `user.id` into `changeStatus` so the service can assert it too. Separately, remove `'resolved'` from the non-admin reachable set in `validTransitions` / add it to `ADMIN_ONLY_STATUSES` — resolution moves money and belongs only to `/:id/resolve`, which already enforces admin. Add a regression test asserting a non-party 403s; the existing suite has no coverage for this handler.
- **Edge cases:** A dispute already stuck in this state needs a data repair, not just a code fix — status must be reverted to its pre-'resolved' value before the admin resolve path becomes reachable again. Also note `resolve` never transitions the project out of 'disputed'; the owner must manually POST /projects/:id/transition, which is legal per state-machine.ts but undiscoverable in the UI.
- **Verifier correction:** Real, unauthenticated-by-object-identity state mutation: any signed-in user with a dispute id can force it to 'resolved' with a NULL resolution, permanently disabling the admin /:id/resolve path and its refund for that dispute. But 'escrow held with no API path to release, recoverable only by direct SQL' is refuted — the owner retains disputed -> cancelled (triggers refundRemainingEscrow) and disputed -> in_progress. Impact is denial of the dispute-resolution path plus a falsified audit record, not frozen funds. The proposed fix is correct as written (load the dispute, require party-or-admin, pass user.id into changeStatus, and move 'resolved' out of the non-admin reachable set).

### [HIGH] isAssignedTalent ignores assignment status, so terminated and replaced talents keep full project read access
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/lib/project-access.ts:85-96 — `isAssignedTalent` joins projectAssignments to talentProfiles filtering only on `projectId` and `talentProfiles.userId`. No filter on `projectAssignments.status`. The enum at packages/db/src/schema/project.ts:69-74 is ['active','completed','terminated','replaced'], so a row survives termination. Contrast apps/project-service/src/routes/projects.ts:375, which does filter `eq(projectAssignments.status,'active')` for team-roster visibility, and apps/project-service/src/routes/invoices.ts:47, which defines `WORKED_STATUSES = ['active','completed']` for exactly this reason and documents why ("A declined or replaced assignment reopens the work package for somebody else").
- **Root cause:** The helper was extracted to fix a different bug — sibling routes missing any authorization at all (see the comment at project-access.ts:5-23) — and the extraction preserved the loosest of the inline checks it replaced. Two other call sites independently discovered the status dimension and hardened locally instead of fixing the shared helper, so the codebase now holds three different definitions of "is on this project".
- **Impact:** `isAssignedTalent` backs `assertProjectAccess`, which gates: milestones list including per-milestone amounts (milestones.ts:73-85), milestone files and comments (286-335), time logs and the per-talent time summary (time-logs.ts:30-33, 202-206), work packages and dependency graph (work-packages.ts:60-65, 78-85, 240-244), status logs (projects.ts:1538-1542), the project activity feed (activities.ts:83-86), Centrifugo subscription tokens for live project channels (realtime.ts:51), and the full PRD (projects.ts:472-477). A talent terminated for abandonment — the exact case CLAUDE.md penalises — retains indefinite live read access to their replacement's payment schedule, work hours and real-time channel. It also widens the dispute IDOR above, since GET /disputes/project/:projectId uses the same helper.
- **Fix:** Add `inArray(projectAssignments.status, ['active','completed'])` to the where clause in project-access.ts:92, and import the existing `WORKED_STATUSES` constant rather than defining a fourth copy. 'completed' must stay in the set or talents lose access to finished projects they need for invoices and reviews.
- **Edge cases:** An assignment in `acceptance_status='pending'` with `status='active'` (created that way at matching.ts:264-272) already grants access before the talent has accepted the offer — arguably correct since they must read the brief to decide, but it means the status filter alone does not fully close pre-acceptance exposure.
- **Verifier correction:** Severity stands; impact is slightly wider than claimed — it is a write path too (milestones.ts:170-190 integration-milestone submit). The proposed fix (inArray(projectAssignments.status, WORKED_STATUSES) imported from the invoices constant, keeping 'completed') is correct and behavior-preserving for legitimate participants.

### [HIGH] Gateway-initiated refund updates transaction status but never reverses the escrow ledger, and permanently blocks the internal refund path
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/payment-service/internal/handler/webhook.go:369-382 — `mapMidtransStatus` maps 'refund' and 'partial_refund' to `store.TxStatusRefunded`. webhook.go:358-367 — `supersedes` explicitly permits `completed -> refunded`. The handler then calls `UpdateWebhookTx` (line 150) and `CreateEventTx` (line 199) and commits. The only ledger write in the whole handler is `fundEscrowLedgerTx`, guarded at webhook.go:160 by `newStatus == store.TxStatusCompleted` — nothing runs on the refunded branch. `notifyProjectService` is likewise gated on completed at line 226. A grep for TxStatusRefunded across the service (internal/**/*.go, excluding tests) returns only webhook.go and the guards in payment.go — no ledger reversal anywhere.
- **Root cause:** The webhook was written as a status-mirroring endpoint with one special case bolted on (escrow funding on settlement). Refund was treated as a status transition rather than as a money movement, because in the intended flow refunds originate internally via ProcessRefund, which does write the ledger pair (payment.go:449-469). The gateway-initiated path — Midtrans dashboard refund, chargeback, or reversal — was never wired to the same accounting.
- **Impact:** After a dashboard refund, `transactions.status='refunded'` while the escrow account balance still reflects the deposit. Two concrete consequences. First, `GetEscrowBalance` (payment.go:132-141) over-reports, so `ReleaseEscrow`'s balance guard at payment.go:211 passes on money the platform no longer holds — the next milestone approval pays a talent out of refunded funds. Second, `ProcessRefund` short-circuits at payment.go:330-332 with `alreadyProcessedErr` for that transaction id forever, so the internal refund path can never correct the books; `refundRemainingEscrow` on project cancellation and `DisputeService.resolve` both go through it. The double-entry invariant CLAUDE.md relies on for auditability is silently broken with no reconciliation job to detect it.
- **Fix:** On the refunded branch, mirror `fundEscrowLedgerTx` in reverse inside the same dbTx: CREDIT the project escrow account and DEBIT the owner account for the refunded gross, then emit a `payment.refunded` outbox event so project-service learns about it. Guard on `txn.Type == TxTypeEscrowIn` as the funding branch does. For BRD/PRD payment types, decide explicitly whether a ledger reversal or just the status flip is correct rather than falling through by omission.
- **Edge cases:** Midtrans sends `partial_refund` with the same terminal mapping, so a partial gateway refund currently marks the whole transaction refunded — the reversal amount must come from the notification's refund amount, not from `txn.Amount`. `supersedes` also treats refunded as absolutely terminal (webhook.go:360-361), so a second partial_refund notification is dropped entirely.
- **Verifier correction:** Confirmed for the full-refund case. The partial_refund sub-case is UNVERIFIED: webhook.go:99-105 rejects the notification outright unless paidAmount == txn.Amount, and what Midtrans places in gross_amount on a partial-refund notification cannot be determined from this repo — it may be filtered before reaching the branch. The proposed fix (reverse ledger pair inside the same dbTx, guarded on txn.Type == TxTypeEscrowIn, plus a payment.refunded outbox event) is correct.

### [MEDIUM] Per-work-package escrow does not exist; a single project-level escrow pool plus owner-set milestone amounts lets one talent's payouts starve another's
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** CLAUDE.md states "Dana owner masuk escrow per work package (setiap talent punya alokasi escrow sendiri berdasarkan PRD pricing)". In code there is exactly one escrow account per project: apps/payment-service/internal/handler/webhook.go:259-263 creates it with `OwnerID: &txn.ProjectID`, and apps/payment-service/internal/service/payment.go:204 resolves it the same way on release — `FindAccountByOwnerTx(ctx, dbTx, store.OwnerEscrow, &in.ProjectID)`. No code path keys an escrow account on workPackageId. Meanwhile apps/project-service/src/routes/milestones.ts:52 accepts `amount: z.number().int().nonnegative()` straight from the owner's request body, and MilestoneService.createMilestone (services/milestone.service.ts:51-69) validates only that the project exists — no comparison against `workPackages.amount`, `projects.finalPrice`, or the escrow balance. The release guard at payment.go:211 is the first and only place the amount meets reality.
- **Root cause:** Escrow accounts were modelled on the owner_type/owner_id pair (`OwnerEscrow` + project id) chosen before the multi-talent work-package design landed, and the work-package split was implemented only in the pricing layer (packages/shared/src/pricing.ts computes per-package payouts) without a matching change to the ledger's account granularity.
- **Impact:** Milestone amounts are unbounded relative to the pool that funds them. On a team project, approving talent A's milestones in sequence can drain the shared escrow account; talent B's subsequent release then fails with PAYMENT_ESCROW_INSUFFICIENT_FUNDS at payment.go:211-213, and because settleMilestoneEscrow swallows the error (milestones.ts:234-239, logged and dropped) the milestone shows approved with no payout. The 14-day auto-release retries against the same empty pool. This is not owner self-harm: talent B has an executed contract and delivered work. It also defeats the documented per-talent freeze on termination and per-work-package dispute freeze, both of which assume separable balances.
- **Fix:** Two independent pieces. (a) Cheap and behavior-preserving: validate milestone amount at creation against the parent work package's `amount` minus already-created sibling milestones, rejecting over-allocation with VALIDATION_ERROR — this alone removes the starvation path. (b) Structural, needs sign-off: key escrow accounts on work package id (`OwnerID: &workPackageID`) with a project-level account only for single-package projects, and pass workPackageId through ReleaseEscrow/ProcessRefund. Note the DB CHECK constraints CLAUDE.md documents for `work_packages.amount > 0` and `milestones.amount >= 0` are not actually installed — grep over packages/db/migrations returns zero CHECK constraints — so there is no database-level backstop either.
- **Edge cases:** `computeMilestoneFee` (lib/settle-milestone.ts:52-61) derives the platform fee from `workPackages.talentPayout / workPackages.amount`; if a milestone amount exceeds its work package amount the ratio still applies and the fee scales past what the bracket table intends. Integration milestones carry `workPackageId = null` and fall back to project totals, so they are unattributable to any package under either scheme.
- **Verifier correction:** Downgrade to medium and split it as the finding itself suggests. The reachable bug is (a) unvalidated milestone amount at creation plus (b) the swallowed settlement error at milestones.ts:236-239 that leaves a milestone marked approved with an unpaid talent and only a log line — fix (a) as proposed and surface (b) rather than dropping it. Part (b) of the finding, re-keying escrow accounts on work package id, is a documented-intent divergence from CLAUDE.md and a product/accounting change needing owner sign-off, not debt cleanup.

### [MEDIUM] Rate limiting is an in-process Map keyed on IP only — not Redis, not per-user, and resets on every deploy
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/middleware/rate-limit.ts:14-16 — `createRateLimiter` allocates `const store = new Map<string, RateLimitEntry>()`, per process, with a 60s sweep timer. The key is derived at lines 43-45 from `x-real-ip` with `x-forwarded-for` as fallback; the authenticated user id is never consulted, and the middleware runs before `sessionMiddleware` in the chain anyway (index.ts:59-67 mount the limiters, index.ts:70 mounts session). CLAUDE.md states "Rate limiting per IP dan per user (pakai Hono rate-limit middleware + Redis)" and lists Valkey as "used for consumer idempotency, session store, rate limiting". There is no Redis/Valkey client imported anywhere in the middleware directory.
- **Root cause:** The limiter was written as a placeholder — its own doc comment at line 13 says "Single-instance only; use Redis in production" — and the Redis swap was never done. The subsequent hardening work went into key selection and route coverage, which made the middleware look finished.
- **Impact:** Three separate holes. Horizontal scaling multiplies every limit by the replica count, so the 10/min AI tier that protects the most expensive call on the platform (PRD generation) becomes 10xN. Counters reset on every container restart, so a rolling deploy clears all buckets. And because the key is IP, a single office or mobile-carrier NAT shares one 100/min bucket while an attacker on a residential IPv6 /64 gets effectively unlimited fresh buckets — the opposite of the intended allocation. Cost exposure is direct: each generate-prd call is a full Gemini generation billed per token.
- **Fix:** Replace the Map with a Valkey INCR + EXPIRE (or a sliding window via sorted set) so buckets are shared across replicas and survive restarts. Move the limiter to run after session resolution and key on `user.id` when present, falling back to IP for anonymous routes — the current ordering in index.ts:59-70 must be swapped for that. Keep the existing x-real-ip logic as the anonymous fallback; that part is correct.
- **Edge cases:** apps/project-service/src/middleware/rate-limit-key.test.ts asserts correctness by reading rate-limit.ts and index.ts as text and matching substrings (lines 22-23, 31-38, 54). It proves a line exists; it cannot execute a request, so it is structurally incapable of catching a Hono path-matching failure or the absence of a shared store. That is worth knowing about this suite generally, not just here.
- **Verifier correction:** The PROPOSED FIX IS WRONG in one respect and would weaken the service. 'Move the limiter to run after session resolution' means every unauthenticated flood request performs a Better Auth session lookup (a DB/cache round trip) before being throttled — precisely what the front-line limiter exists to prevent. Correct shape: keep the IP-keyed limiter in front of sessionMiddleware, and ADD a second user-keyed limiter after it for authenticated routes. The Valkey INCR+EXPIRE part of the fix is right. Also note the multi-replica multiplication is a future concern, not current reality: CLAUDE.md's deployment is single-host Docker Compose via Dokploy, so today the live defects are the restart reset and NAT-shared/IPv6-cheap bucketing.

### [MEDIUM] The shared error catalog's i18n mapping is dead code; raw server messages including upstream AI service bodies render in the UI
`CONFIRMED` · behavior-change: `True`

- **Evidence:** packages/shared/src/errors.ts:144-207 defines ERROR_I18N_KEYS for all 50 codes, and apps/web/src/locales/{id,en}/errors.json exist and are registered as a namespace in apps/web/src/lib/i18n.ts:8,17,41. But grep across apps/web/src for `ERROR_I18N_KEYS`, `t('errors`, or `useTranslation('errors` returns zero hits. apps/web/src/lib/api.ts:35-39 does `const message = errorBody?.error?.message` and throws `new ApiError(message, ...)` — the server's message string is what components display. Two further consequences are visible in the payload: apps/project-service/src/routes/projects.ts:884-887 embeds `detail.slice(0, 200)` of the AI service's raw response body into the AppError message, and projects.ts:1271, 1279, 1399, 1408, 1645, 1648 hardcode Indonesian strings in the service layer. The locale file itself only covers 5 of the 10 catalog namespaces — payment, milestone, talent, ai, dispute and file keys are absent entirely.
- **Root cause:** The catalog was designed for code->i18n-key translation at the client, but the client's fetch wrapper was written independently and took the shortest path (display server message). Nothing enforces the contract in either direction, so the server drifted into writing user-facing prose and the locale file drifted into partial coverage without either being noticed.
- **Impact:** Three things at once. Localization is broken by construction — an English-locale user sees "Batas generasi BRD gratis (3x) sudah tercapai" because that string is baked into projects.ts:1271. Error copy cannot be changed without a backend deploy. And CLAUDE.md's explicit rule "Jangan expose error detail dari external service ke user" is violated on the AI paths, where 200 characters of the Gemini/FastAPI error body — potentially including prompt fragments, model names or internal hostnames — reach the browser. Go services widen the drift further with codes absent from the catalog: `FORBIDDEN` (payment.go:94), `AUTH_REQUIRED` (payments.go:251), `AUTH_SERVICE_REQUIRED` (middleware/auth.go:41), `PAYMENT_AMOUNT_MISMATCH` (webhook.go:104), `EXTERNAL_SERVICE_ERROR` (payment.go:49).
- **Fix:** In api.ts, map `errorBody.error.code` through ERROR_I18N_KEYS to `t(key)` and fall back to the server message only for unmapped codes. Backfill the missing namespaces in both locale files. Strip the upstream detail from the client-facing message at projects.ts:886 and log it server-side instead (the correlation id already ties them together). Replace the ad-hoc Go codes with catalog members — AUTH_FORBIDDEN, AUTH_UNAUTHORIZED, PAYMENT_GATEWAY_ERROR — or add them to the catalog if they are genuinely distinct.
- **Edge cases:** The catalog is otherwise sound: AppError.statusCode derives from ERROR_HTTP_STATUS, the single onError handler at index.ts:104 catches everything, and non-AppError throws correctly collapse to a generic INTERNAL_ERROR without leaking stacks (middleware/error-handler.ts:22-31). The problem is purely the unconsumed mapping layer, not the error plumbing.
- **Verifier correction:** Add one defect the finding missed, which also breaks its own proposed fix: the catalog values are prefixed strings like 'errors.auth.invalid_credentials' while 'errors' is already the i18next NAMESPACE. A naive t(ERROR_I18N_KEYS[code], {ns:'errors'}) resolves to errors:errors.auth.* and misses every key. The fix must strip the 'errors.' prefix (or use a non-namespaced t() with the flat key) — proof in itself that the mapping was never exercised.

### [LOW] Payment idempotency relies on a DB unique constraint rather than the application path, so a concurrent retry returns 500 instead of replaying
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/payment-service/internal/store/transaction.go:130-137 — `Create` does `FindByIdempotencyKey` (a plain SELECT on the pool) and, when nil, an unguarded INSERT at line 142. There is no ON CONFLICT clause. The uniqueness that actually protects the system lives in packages/db/src/schema/payment.ts:74 (`.notNull().unique()`) and packages/db/migrations/0000_dark_microchip.sql:351 (`CONSTRAINT transactions_idempotency_key_unique`). Callers wrap the error opaquely: payment.go:159-161 returns `fmt.Errorf("create release transaction: %w", err)`, which `handleServiceError` (payments.go:304-318) cannot match to an AppError and logs as "unhandled error" before returning INTERNAL_ERROR 500.
- **Root cause:** The check-then-act pattern reads correctly in the single-caller case and the post-hoc status branches (payment.go:168-179, 361-372) plus the row-level `LockStatusTx` re-check (payment.go:193-202) were added later to close the settlement race. The narrower window between SELECT and INSERT was never revisited because the database was already closing it — just with the wrong error shape.
- **Impact:** Double-charge is genuinely prevented — that is the important answer, and the row lock plus status re-check make the settlement path correct under concurrency. But the failure mode is wrong: two simultaneous deliveries of the same milestone approval (owner clicks approve while the 14-day Temporal auto-release fires, both using idempotencyKey `release:{milestoneId}`) produce one success and one 23505 surfaced as a 500. project-service's `settleMilestoneEscrow` caller swallows that (milestones.ts:236-239) so nothing breaks visibly, but the 500 is indistinguishable in logs and alerting from a real ledger failure, and a client that retries on 5xx will keep getting 500 rather than converging on the idempotent success.
- **Fix:** Change the INSERT at transaction.go:142 to `... ON CONFLICT (idempotency_key) DO NOTHING RETURNING ...`; when zero rows come back, re-run FindByIdempotencyKey and return `IsNew: false`. That makes the application path idempotent by itself and collapses the race to the existing, already-correct replay branches. Purely internal — no response shape changes on the success path.
- **Edge cases:** `CreateSnapToken` takes the idempotency key from the client-supplied `orderId` (payment.go:584; generated in apps/web/src/routes/_authenticated/projects/$projectId/checkout.tsx:114-117). The amount-drift guard at payment.go:595 is good, but it never checks `result.Transaction.ProjectID == in.ProjectID`, so a reused id across projects would build a Snap request against the wrong project's row. Not practically exploitable — order ids carry Date.now() plus 6 random chars, so they are unguessable — but the project-id comparison is a one-line hardening worth adding next to the amount check.
- **Verifier correction:** Downgrade to low: the finding itself concedes correctness is preserved, and the retry does converge — the loser's next attempt finds the committed row via FindByIdempotencyKey and takes the replay branch. The residual cost is a misleading 500 in logs/alerting. The PROPOSED FIX HAS A HOLE: FindByIdempotencyKey filters deleted_at IS NULL while the unique index does not, so 'ON CONFLICT DO NOTHING RETURNING, then re-SELECT' returns nil when the collision is a soft-deleted row, converting a 500 into a nil-pointer path. Re-query without the deleted_at filter on the conflict branch, or make the index partial on deleted_at IS NULL.

### [LOW] projects.ts hand-rolls assertProjectOwner in ten handlers, two of which return the wrong error code for a missing project
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/routes/projects.ts uses the shared helper at lines 390, 630, 1259 and 1385, and re-implements the identical query inline at 413-420 (/brd/pdf), 494-501 (/prd/pdf), 545-553 (/tasks), 658-669 (/transition), 787-789 (/scoping-status), 825-827 (/chat), 954-956 (/chat/stream), 1153-1155 (/upload-spec), 1626-1628 (/brd/revision) and 1752-1754 (/prd/revision). The helper at lib/project-access.ts:48-53 returns NOT_FOUND for a missing project and AUTH_FORBIDDEN for a real one the caller does not own. The copies at 418 and 499 collapse both into `if (!project || project.ownerId !== user.id) throw AUTH_FORBIDDEN` — while the copy at 468 in the same file gets it right with a separate NOT_FOUND. Beyond the auth check: LIVE_STATUSES is declared inline at 330-337 and duplicated as a literal at 161-168; the BRD and PRD revision handlers (1599-1717 and 1725-1818) are near-identical 110-line blocks differing only in table, price function and constant; and generate-brd/generate-prd (1253-1376, 1379-1533) repeat the same limit-check -> generate -> upsert-with-version-bump -> transition sequence.
- **Root cause:** The helper was introduced after most handlers already existed (its doc comment describes retrofitting sibling routes) and adoption stopped at four call sites. Handlers that also needed other project columns — title for the PDF, status for upload-spec, teamSize for transition — had a reason to keep their own SELECT and kept the auth branch with it, so the copy was never a deliberate choice.
- **Impact:** Two costs. A correctness one: a client probing GET /projects/{unknown-uuid}/brd/pdf gets 403 while GET /projects/{unknown-uuid}/prd gets 404, so the same logical condition produces different status codes depending on which handler is hit — clients cannot branch on it and the inconsistency is invisible until someone tests both. A maintenance one: any change to what "owns this project" means (soft-delete awareness, admin override, org accounts) must land in eleven places, and the two divergent copies prove the class of drift is already happening. The two 110-line revision handlers mean every revision-policy change is written twice.
- **Fix:** Replace the ten inline blocks with `await assertProjectOwner(id, user.id, '<existing message>')` followed by a plain SELECT for whatever extra columns the handler needs — the helper already takes a custom forbidden message precisely so adoption is not a UX regression (see its comment at project-access.ts:34-38). Extract the two revision handlers into one parameterised function over {table, priceFn, freeLimit, languageFn, generateFn}. Hoist LIVE_STATUSES to a module constant. All mechanical; the only observable change is the 403->404 correction on two paths.
- **Edge cases:** The 403->404 change on /brd/pdf and /prd/pdf for a non-existent project is technically observable to clients, though it moves toward the codebase's own majority convention. Everything else in this finding is invisible externally.
- **Verifier correction:** The finding UNDERCOUNTS. Five handlers collapse missing-project into AUTH_FORBIDDEN, not two: 421, 502, 1156, 1629, 1755 all use the `if (!project || project.ownerId !== user.id) throw AUTH_FORBIDDEN` shape. And there is a third variant the finding missed — 786, 824, 953 throw PROJECT_NOT_FOUND where the helper throws NOT_FOUND, so the same condition yields three different codes across one file. Severity downgraded to low: this is consistency debt with no security or data consequence (every path still refuses non-owners correctly). The proposed fix is mechanical and sound.

### [LOW] Matching loads every eligible talent with two correlated subqueries per row, plus all skill embeddings, on every request
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/repositories/matching.repository.ts:37-68 — `findEligibleTalents` selects from talentProfiles filtered only on verificationStatus='verified' and availabilityStatus='available', with no LIMIT and no pagination, and computes `totalProjectsCompleted` and `totalProjectsActive` as two correlated `SELECT COUNT(*)` subqueries evaluated per returned row (lines 43-52). Exclusions are applied in JS afterwards at line 67, not in SQL. apps/project-service/src/services/matching.service.ts:251-280 (`loadCandidatePool`) then calls `getTalentSkills` and `getTalentHistoricalStats` over the full id list and, at line 274, `getAllSkillEmbeddings()` — which reads every row of the skills table including its vector(768) column into a Map on each request. `scorePool` (matching.service.ts:293-317) scores the entire pool in memory.
- **Root cause:** The pool-loading design is deliberate and well-reasoned for the team case — the comment at matching.service.ts:245-250 explains it loads once per project rather than once per work package. The unexamined assumption is that the candidate set is small enough that "all talents" is a reasonable unit of work, which holds at seed scale and stops holding as soon as the talent side of the marketplace grows.
- **Impact:** Cost is O(talents) per matching request with a per-row subquery pair, plus O(skills x 768 floats) of embedding transfer and deserialization. At 10k verified-available talents that is 20k correlated count subqueries per call, against a shared PgBouncer pool in transaction mode. CLAUDE.md targets <500ms P95 for talent matching; this will not hold. The endpoint is reachable from the owner-facing staffing page and from ai-service via POST /recommend, so it is on an interactive path, and there is no cache despite Valkey being available and CLAUDE.md listing AI response caching among its uses.
- **Fix:** Three independent changes, none altering ranking output. (a) Move the exclusion list into SQL (`notInArray`) instead of filtering in JS at line 67. (b) Replace the two correlated subqueries with a single grouped LEFT JOIN over projectAssignments aggregating both counts — one scan instead of 2N. (c) Cache `getAllSkillEmbeddings()` in-process or in Valkey with a short TTL; the skills taxonomy is admin-managed master data that changes rarely. If the pool still needs bounding, pre-filter candidates by skill overlap in SQL before scoring rather than capping the fetch, since a blind LIMIT would bias against the fairness weighting.
- **Edge cases:** A naive LIMIT here would silently break the documented pemerataan guarantee — the 30% exploration slots are drawn from the same pool, so truncating it truncates exactly the low-project-count talents exploration exists to surface. Any bounding must be skill-based, not arbitrary.
- **Verifier correction:** Downgrade to low: correct as an analysis but it does not bite at this codebase's actual scale (pre-launch, seed data), and there is no correctness or fairness defect — only latency that grows with the talent table. The proposed fixes are all sound and non-behavior-changing; (c), caching getAllSkillEmbeddings for admin-managed master data, is the highest value per line and worth doing now precisely because it is free.

### [LOW] Multiple list endpoints return unbounded arrays with no pagination and no cap
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/routes/invoices.ts:199-246 returns `repo.findByProject(projectId, audience)` with no limit and filters in JS at line 230. apps/project-service/src/routes/milestones.ts:73-85 returns `service.listByProject(projectId)` unbounded. apps/project-service/src/routes/talents.ts:136-167 (`/:id/skills`) selects all rows for a talent with no limit. work-packages.ts:60-65 and time-logs.ts:30-33, 148-163 are the same shape. Contrast the endpoints that do it properly: activities.ts:15-19 defines a schema with `pageSize.max(100)` and applies limit/offset at 66-67; chat.repository.ts:91-101, dispute.repository.ts:77-86, project.repository.ts:99-110 and talent-placement.repository.ts:61-96 all paginate. So the pattern exists and is simply not applied uniformly.
- **Root cause:** Pagination was applied where a list was obviously unbounded (activities, chat, projects, disputes) and skipped where the list felt naturally small (milestones per project, skills per talent). That judgement is defensible per-endpoint but leaves no ceiling anywhere, and the two collections most likely to grow — time logs and invoices — are on the unbounded side.
- **Impact:** Response size and query cost scale linearly with data the caller does not control. `GET /time-logs/task/:taskId` returns every log entry ever recorded against a task; CLAUDE.md's own retention policy assumes time_logs is high-volume enough to warrant monthly partitioning and a 3-year retention. The invoices list additionally over-fetches then discards: for a talent it loads every invoice on the project and filters in JS at invoices.ts:230, so a talent on one work package of an eight-package project reads all eight talents' invoice rows into the process before dropping seven-eighths of them. The rows themselves carry no amounts so this is not a data leak, but it is a straightforward query-scope bug.
- **Fix:** For the invoice list, push the milestone-id filter into the repository query rather than filtering post-fetch, and add page/pageSize using the exact schema shape already in activities.ts:15-19. For time-logs, milestones, work-packages and talent skills, add the same schema with a sane default. Ship pagination additively — accept the params, default to a generous pageSize, and return the `{items,total,page,pageSize}` envelope the rest of the API already uses — so existing clients that read `data` as an array need a coordinated frontend change.
- **Edge cases:** Changing these from bare arrays to a paginated envelope is a breaking response-shape change for every current caller in apps/web. Either version the shape or land both sides together; adding the limit without the envelope silently truncates instead.
- **Verifier correction:** Downgrade to low: every cited collection is bounded by a single project's or task's own data (milestones per project, invoices per project, logs per task), so at any realistic scale these are tens of rows, not a DoS or cost surface. The genuinely defective one is the invoice over-fetch-then-JS-filter at invoices.ts:228-230 — that is a query-scope bug worth fixing on its own regardless of pagination, and the finding correctly notes the rows carry no amounts so it is not a data leak. Ship that; treat blanket pagination as opportunistic, and note the finding is right that changing the envelope from array to {items,total,page,pageSize} is a coordinated frontend change, i.e. not purely internal debt.

### [LOW] project-service publishes an OpenAPI document with zero paths while advertising Scalar docs
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/index.ts:107-121 mounts Scalar at /api/v1/projects/docs pointing at /api/v1/projects/openapi.json, and that endpoint returns a hand-written literal: `{ openapi: '3.1.0', info: {...}, paths: {} }`. Empty. `@hono/zod-openapi` is not imported anywhere in the service despite CLAUDE.md stating "@hono/zod-openapi menghasilkan OpenAPI 3.1 spec dari route definitions" and "Dokumentasi selalu up-to-date karena derived dari code". auth-service is closer but still manual — apps/auth-service/src/index.ts:57 serves a JSON literal containing 13 hand-written path specs.
- **Root cause:** Scalar was wired up first as the UI shell, with the spec left as a stub to be generated later. The generation step needs every route rewritten from `new Hono()` handlers to `createRoute()` definitions, which is a large mechanical change across 20 route files, so it stalled — but the docs URL shipped anyway.
- **Impact:** Contract documentation is absent for the largest service in the system, roughly 80 endpoints across 20 route files. The Zod schemas that would produce it already exist inline in each handler (listQuerySchema, createMilestoneSchema, transitionBodySchema and so on), so the work is transcription rather than design. Downstream: no contract tests can be generated, no client SDK, and the apps/web api.ts client is a plain string-URL fetch wrapper with `hc()` imported but never given an AppType generic — so there is no type-safe RPC either, despite CLAUDE.md claiming it for both frontend and inter-service calls. The stub is worse than no endpoint, since /docs renders an empty but authoritative-looking reference.
- **Fix:** Either migrate incrementally to `@hono/zod-openapi` — the existing Zod schemas drop straight into `createRoute()` request definitions, and the routes can be converted a file at a time since OpenAPIHono composes with plain Hono — or, if that is not near-term work, remove the /docs and /openapi.json endpoints so nothing advertises a contract that does not exist. Migrating projects.ts's routes first would cover the largest surface for the least files touched.
- **Edge cases:** Converting a route to createRoute() changes validation-error shape unless the custom `defaultHook` is set to throw the same AppError('VALIDATION_ERROR', ...) the handlers currently produce; without that, error responses drift from the catalog mid-migration.
- **Verifier correction:** One sub-claim is fabricated, inherited from CLAUDE.md rather than read from code: 'the apps/web api.ts client is a plain string-URL fetch wrapper with hc() imported but never given an AppType generic'. Grep for hono/client and hc( across apps/web/src returns zero hits — hc() is not imported anywhere in the frontend. The rest of the finding stands, and its second option (delete the /docs and /openapi.json stubs until a real spec exists) is the right near-term call, since the stub advertises a contract that does not exist.

## Frontend / UI architecture, rendering performance, bundle

_apps/web is architecturally sound: route-level code splitting is on (`autoCodeSplitting: true` in both vite configs), the heavy deps (SVAR Gantt, Recharts) are reachable only from lazily-split routes, and the repeated `components/project/*/shared.ts` files are healthy per-feature colocation, not copy-paste — one of them documents a deliberate 1635-line decomposition. apps/admin is the opposite: 4,658 LOC across 8 route files with no component layer, no API layer, and no dialog semantics at all, which has already produced two user-visible defects (silently truncated lists, dead Escape handlers). The two highest-impact runtime problems are a 1-second interval that re-runs an unmemoized sort/group/filter block plus a Recharts tree on the time-tracking route, and a soft logout that leaves the React Query cache and the Centrifugo WebSocket alive across user sessions in the same tab. Bundle is in decent shape; the only real weight is ~105KB raw of locale JSON always in the entry chunk._

### [HIGH] apps/admin has no component or API layer: 6 hand-rolled tables, 3 slide-overs, 24 raw fetch call sites duplicated across 4,658 LOC
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** 8 route files under apps/admin/src/routes/_authenticated/ total 4,658 LOC (users 778, projects 740, dashboard 682, disputes 632, settings 522, finance 503, dlq 475, audit-log 326) with no src/components directory anywhere in the app (verified by full file listing: only lib/, locales/, routes/, stores/, main.tsx, styles.css). Measured duplication: (a) 6 table scaffolds with the byte-identical wrapper `overflow-hidden rounded-xl border border-neutral-600/30 bg-neutral-600` + `<table className="w-full text-left text-sm">` at users.tsx:306-308, projects.tsx:313-315, dlq.tsx:195-197, audit-log.tsx:182-184, finance.tsx:349-388, disputes.tsx:324; (b) 26 `<th>` cells sharing the identical class string `whitespace-nowrap px-4 py-3.5 font-medium text-warning-500`; (c) the error/loading/empty tbody triad repeated verbatim — users.tsx:332-353, projects.tsx:344-359, dlq.tsx:246-252, finance.tsx:405-419, audit-log.tsx:227-233 — differing only in `colSpan`; (d) 3 slide-over panels with identical overlay + panel markup at users.tsx:416/425, projects.tsx:442/448, dlq.tsx:314/320; (e) 8 inline badge-pill class strings and 11 `Record<...>` colour maps; (f) 15 hand-written fetch wrapper functions across 24 call sites, each re-implementing `credentials: 'include'` and `if (!res.ok) throw new Error(...)` (users.tsx:114-168, projects.tsx:204-224, disputes.tsx:103-150, finance.tsx:99-127, dlq.tsx:53-72, settings.tsx:33-46, audit-log.tsx:41-50, dashboard.tsx:125). apps/admin/src/lib/ contains no api.ts. Zero occurrences of VITE_API_URL in apps/admin/src — every fetch is a relative `/api/v1/...`, whereas apps/web routes everything through `apiUrl()`/`apiFetch()` in lib/api.ts:5-63 which honours VITE_API_URL. CLAUDE.md's monorepo layout lists `packages/ui` as a shared UI package; `ls packages/` returns config, db, logger, nats-events, shared, testing — it does not exist. apps/admin/PRODUCT.md:46 names the gap honestly: "there is no shared component layer in this app — no src/components directory at all... Consistency across surfaces is therefore unenforced today."
- **Root cause:** The admin app was built route-first with no extraction pass, and the shared `packages/ui` that CLAUDE.md's architecture assumes was never created. With no primitive to reach for, each new surface copied the previous route's markup. The same applies to networking: with no admin-side api.ts, each route inlined fetch.
- **Impact:** Every cross-cutting change (a column style, a loading state, an auth header, an error shape) is a 6-to-8-file edit with no compiler help, and the copies have already diverged — finance.tsx uses `px-6 py-8` in its empty cell where the other five use `px-4 py-8`. The missing API layer means admin cannot be pointed at a different API host at build time the way web can; whether that breaks the documented admin.bytz.id deployment depends on Traefik routing /api/v1 on that host, which I did not verify — treat the production consequence as UNVERIFIED, the divergence from web as confirmed.
- **Fix:** Create apps/admin/src/components/ui with five primitives and apps/admin/src/lib/api.ts: (1) `DataTable<T>` taking `columns: {key,header,render}[]`, `rows`, `isLoading`, `isError`, `emptyLabel` — absorbs the wrapper, thead, and the error/loading/empty triad, ~30-45 lines of scaffold per route × 6; (2) `StatusBadge` taking a variant token — absorbs the 8 pill strings and 11 colour maps; (3) `SlideOver` with the overlay + panel chrome, ~25 lines × 3; (4) `FilterBar`/`SearchInput` for the shared search input and pill-tab classes; (5) `lib/api.ts` mirroring web's `apiFetch`/`apiUrl` including VITE_API_URL support — replaces 15 wrappers, ~10 lines each. Estimated removal is 600-900 lines with no behavior change. Do the SlideOver extraction together with the a11y finding below so the accessible dialog is written once.
- **Edge cases:** finance.tsx and disputes.tsx use slightly different padding and a card-list rather than a table for disputes; DataTable needs a `dense`/`padding` prop rather than forcing one spacing. dashboard.tsx:612 and settings.tsx:245 are static display tables, not list surfaces — leave them out of the first pass.

### [HIGH] Four admin list surfaces hardcode page 1 and silently truncate; users.tsx then reports wrong counts
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/admin/src/routes/_authenticated/users.tsx:187-188 calls `fetchUsers({role, search, page: 1, pageSize: 100})` with no `page` state and no pagination control anywhere in the file. Same pattern at projects.tsx:246-247 (`page: 1, pageSize: 100`), dlq.tsx:103-104 (`page: 1, pageSize: 100`), disputes.tsx:171 (`page: 1, pageSize`). users.tsx:218-222 then derives the tab counts client-side from that truncated array: `const users = usersQuery.data?.data.items ?? []; const tabCounts = { all: users.length, owner: users.filter(u => u.role === 'owner').length, talent: ... }`, and those counts are rendered into the tab labels at users.tsx:257, 269, 281. audit-log.tsx:106/303-311 is the only admin list with real pagination (`const [page, setPage] = useState(1)` plus prev/next controls), and finance.tsx:137 at least sets `pageSize = 50` — which is the evidence that the hardcoded ones are oversight, not a decision.
- **Root cause:** Each list route was written independently against the same paginated admin-service endpoint; with no shared list hook, the pagination wiring was done once (audit-log) and skipped in the four routes written around it.
- **Impact:** At 101 users the admin panel shows 100 and labels the tab 'All Users (100)' with no indicator that anything is missing — an operator searching for a suspended account can conclude it does not exist. The same silent ceiling applies to project management, dispute triage, and DLQ reprocessing, i.e. exactly the surfaces PRODUCT.md:76 says exist to 'notice before being told'. Not yet biting because PRODUCT.md:70-72 confirms no production data, so this is a latent defect with a known trigger date.
- **Fix:** Extract `useAdminList({queryKey, fetcher, pageSize})` returning `{rows, total, page, setPage, isLoading, isError}` and wire it into DataTable's footer so pagination ships with the table primitive. Move `tabCounts` to a server-provided aggregate (admin-service already returns `total`), or label the tabs from `total` rather than `items.length`.
- **Edge cases:** Adding pagination changes what an admin sees on load and moves the tab counts from a client-side number to a server one — needs owner sign-off. If admin-service does not return per-role totals, the role tabs need either three counts in the list response or a separate counts endpoint; do not fake it from the page.
- **Verifier correction:** Correct the trigger — it is not "at 101 users", it fires today at 3 users. `fetchUsers` (users.tsx:114-131) sends `role` to the server, so when roleFilter='owner' the response contains ONLY owners, and `tabCounts.all = users.length` then renders "All Users (N)" as the owner count with "Talents (0)" beside it. The counts are wrong on every non-default tab regardless of dataset size. Two other corrections: finance.tsx is a fifth affected surface; and disputes.tsx has a separate server-side `countsQuery` (:174-177) so its status counts are correct even though its list truncates — do not lump it in with users.tsx on the counts half. Fix is otherwise right; label tabs from a server aggregate, not from `items.length`.

### [HIGH] Soft logout leaves the whole React Query cache and the Centrifugo WebSocket alive as the previous user
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** The QueryClient is a module singleton created at apps/web/src/routes/__root.tsx:7-14 and lives for the tab's lifetime. apps/web/src/routes/_authenticated.tsx:280-285 logs out with `useAuthStore.getState().logout(); navigate({ to: '/login' })` — a client-side navigation, no reload. `logout()` at stores/auth.ts:34-44 only POSTs sign-out and clears the auth store; it never calls `queryClient.clear()` or `removeQueries` (grep for `queryClient.clear|qc.clear|removeQueries` across apps/web/src returns nothing) and never calls `disconnectCentrifugo()` (the only references to that export are its own definition at lib/centrifugo.ts:54 and lib/centrifugo.test.ts:23). The keys that survive and are NOT user-scoped: `['projects', filters]` (use-projects.ts:20), `['project', id]` (:52), `['activities', limit]` (:484), `['available-projects', filters]` (use-talent.ts:21), `['notifications', page, filter]` and `['notifications','unread-count']` (use-notifications.ts:42, 65). By contrast `['conversations', user?.id]` (use-chat-messages.ts:49) and `['talent-profile', userId]` (use-talent.ts:52) ARE user-scoped — that inconsistency is what makes this a bug rather than a design choice. Note the 401 path in lib/api.ts:29-32 does a hard `window.location.href` reload and is therefore safe; only the explicit logout button is affected.
- **Root cause:** The QueryClient's lifetime was scoped to the module, not to the session, and the teardown helpers (`queryClient.clear`, `disconnectCentrifugo`) were written but never wired into the one place that ends a session.
- **Impact:** On a shared machine or a role switch, user B logging in on the same tab renders user A's project list, project details, activity feed and notification badge from cache until each query's 60s staleTime expires and a refetch lands — a window of stale, cross-account data on the dashboard and notification bell. The Centrifugo client also stays connected on user A's connection token, so user A's realtime pushes keep invalidating queries in user B's session. Not an authorization bypass (the server still enforces), but a confidentiality and correctness failure that is trivially reproducible.
- **Fix:** Three lines in `logout()` in stores/auth.ts: import the module singleton (or accept it as an argument from the logout button), call `queryClient.clear()` and `disconnectCentrifugo()` alongside the existing `set({user: null, ...})`. Mirror the same in apps/admin/src/stores/auth.ts:31. Optionally follow up by scoping the six offending query keys to the user id so the class of bug cannot recur.
- **Edge cases:** `queryClient.clear()` during an in-flight mutation will drop its cached result; clear after the sign-out POST resolves, as the existing code already orders it. `disconnectCentrifugo()` nulls the singleton (lib/centrifugo.ts:54-59) so the next login reconnects with a fresh token — that is the intended path and is already covered by centrifugo.test.ts.
- **Verifier correction:** The Centrifugo mechanism described is wrong. `useNotificationRealtime` (use-notifications.ts:105-117) keys its effect on `[userId, qc]` and returns `unsubscribe()`, so on logout userId goes undefined, the effect re-runs and the cleanup DOES tear down user A's `notifications#A` subscription. "User A's realtime pushes keep invalidating queries in user B's session" does not happen. What actually happens: the Centrifuge singleton (centrifugo.ts:28-46) stays connected on A's connection token, and per the comment at centrifugo.ts:63-68 channels containing '#' are enforced by Centrifugo against the connection token — so user B's `notifications#B` subscribe is rejected and B receives NO realtime notifications until a full page reload. Different failure, same three-line fix. Severity stays high on the strength of the query-cache half alone: it is a reproducible cross-account data exposure window on a shared machine, not merely a correctness nit.

### [HIGH] Time-tracking route re-renders 634 lines plus a Recharts tree once per second, re-running an unmemoized sort and two group/reduce passes
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/web/src/routes/_authenticated/projects/$projectId/time-tracking.tsx:95-109 runs `setInterval(() => setTimerSeconds(prev => prev + 1), 1000)` while `isTimerRunning`. `timerSeconds` lives in the same component as everything else (12 useState hooks at :80-91), so each tick re-runs the whole function body, including the unmemoized block at :203-222: two `.filter()` + `.reduce()` passes over all time logs (:208-212), a `.reduce()` into `logsByDate` (:215-219), and `Object.keys(logsByDate).sort()` with a `new Date()` construction per comparison (:220-222). It also reconciles the `<ResponsiveContainer><BarChart>` at :375-379 and the full per-date log list below it. `talentTotals` at :59-78 IS wrapped in `useMemo` — the author knew the pattern; the sort/group block simply predates it. The route imports Recharts eagerly at :17.
- **Root cause:** A per-second ticking value was placed in the same component as the page's derived data and its chart, so a display-only counter drives full-page reconciliation.
- **Impact:** For a talent with an active timer — the primary use of this page — the browser does a full component re-render plus an O(n log n) date sort plus a Recharts reconcile every second, indefinitely. At 200 log entries that is a measurable main-thread cost every tick on a mid-range Android, and it violates CLAUDE.md's own 400ms Doherty-threshold guidance for interaction responsiveness on the page most likely to be left open for hours.
- **Fix:** Extract the timer readout into its own component (`<TimerDisplay running={isTimerRunning} onTick={...} />`) that owns `timerSeconds` and its interval, so the tick re-renders ~10 lines instead of 634. Independently, wrap :203-222 in a `useMemo` keyed on `timeLogs` — one `Date.parse` per key rather than one `new Date()` per comparison. Both are local, no behavior change.
- **Edge cases:** The interval effect at :95-109 has a real bug adjacent to this: the `else if` branch clears the interval but the cleanup only runs on `isTimerRunning` change, so a start→stop→start sequence is fine, but the timer drifts because it counts ticks rather than reading wall-clock delta from `timerStartedAt` (:114). Moving to `Date.now() - startedAt` while extracting fixes the drift at the same time.

### [MEDIUM] Five Escape-key handlers can never fire (attached to tabIndex={-1} elements), and apps/admin has zero dialog semantics across three slide-overs
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** `onKeyDown={(e) => e.key === 'Escape' && ...}` is attached to an element carrying `tabIndex={-1}` — therefore never focusable, therefore never the keydown target — at apps/web/src/routes/_authenticated.tsx:119-120 (sidebar backdrop), apps/admin/src/routes/_authenticated.tsx:49, apps/admin/src/routes/_authenticated/users.tsx:421-422, projects.tsx:445, dlq.tsx:317. Searching apps/admin/src for `role="dialog"`, `aria-modal`, or `.focus()` returns zero hits, while three slide-over panels exist (users.tsx:425, projects.tsx:448, dlq.tsx:320) plus a suspend-confirmation dialog (users.tsx:179 `showSuspendDialog`). apps/admin/PRODUCT.md:86 states "staff spend long sessions in dense tables, so text sizing, row scanning, and keyboard navigation matter more than in the main app." apps/web's own primitive is better but still short of the documented bar: components/ui/modal.tsx:25-36 registers Escape on `document` (works) and restores focus to the trigger on close (:33), but never moves focus into the dialog on open and has no focus trap — CLAUDE.md's a11y section requires "Saat modal dibuka: focus pindah ke elemen pertama di dalam modal" and WCAG 2.1 AA no-keyboard-trap/focus-order.
- **Root cause:** The overlay is rendered as a `<button>` to satisfy a lint rule about click handlers on non-interactive elements, and `tabIndex={-1}` was added to keep it out of the tab order — which silently killed the keydown handler that was placed on the same element. Nobody caught it because there is no shared dialog primitive in admin to encode the correct pattern once.
- **Impact:** Keyboard-only and screen-reader operators cannot dismiss any admin slide-over or the mobile sidebar with Escape, and once focus enters a slide-over there is nothing keeping it there or announcing it as a dialog — the reader continues through the table underneath. This directly contradicts PRODUCT.md:86 and the WCAG 2.1 AA commitment stated in both PRODUCT.md files and CLAUDE.md.
- **Fix:** Build the `SlideOver` primitive proposed above with the pattern web's modal.tsx already half-implements: `role="dialog" aria-modal="true" aria-labelledby`, a `document`-level keydown listener for Escape (not an element handler), focus moved to the panel's first focusable node on open, focus restored to the trigger on close, and a Tab cycle trap. Replace all three admin slide-overs and the confirmation dialog with it. Separately, in web's modal.tsx add the initial focus move and trap, and in _authenticated.tsx:119 move the sidebar Escape handler to a document listener.
- **Edge cases:** Escape currently does nothing, so making it work is strictly additive — but if a slide-over contains an unsaved edit (users.tsx suspend reason at :178), Escape closing it now discards input; guard with a confirm when a form is dirty.

### [MEDIUM] Five separate project-status→colour maps in apps/web have drifted: the same status renders three different colours
`UNVERIFIED` · behavior-change: `True`

- **Evidence:** Independent maps of the same domain enum: components/project/detail/shared.tsx:19-35 (`STATUS_COLORS`), components/project/list/shared.ts:25-116 (`STATUS_CONFIG`), routes/_authenticated/dashboard.tsx:103-114 (`STATUS_STYLES`), routes/_authenticated/browse.tsx:26-33 (`STATUS_COLORS`), routes/_public/browse-projects.tsx:25-32 (`STATUS_COLORS`). They disagree: `brd_approved` is `text-success-600` on a `bg-primary-600/10` in detail/shared.tsx:23 but `bg-warning-500/20 text-primary-600` in list/shared.ts:41-45. `matching` is `bg-accent-cream-500/10 text-primary-600` in detail/shared.tsx:27, `bg-accent-coral-500/10 text-accent-coral-500` in list/shared.ts:66-70, `bg-accent-coral-500/10 text-accent-coral-600` in dashboard.tsx:105, and `bg-warning-500/20` in browse.tsx:27. Coverage also diverges — browse.tsx omits draft/scoping/brd_* entirely, so those statuses render unstyled. Four more single-purpose `STATUS_BADGE` maps exist for document and payment status (brd.tsx:37, prd.tsx:48, payments/index.tsx:40, payments/$transactionId.tsx:12), and `formatCurrency`/`formatDate` are re-declared locally at talent/index.tsx:87-107 and `formatRupiah` at dashboard.tsx:116 despite lib/utils.ts:8-47 exporting equivalents. To be clear about what is NOT the problem: the repeated `components/project/*/shared.ts` files are healthy per-feature colocation — new/shared.ts:6-12 documents a deliberate decomposition of a 1635-line wizard — not copy-paste siblings.
- **Root cause:** No single source of truth for domain-enum presentation. Each route needed a badge, found no shared `StatusBadge`, and wrote the map it needed for the statuses it happened to show.
- **Impact:** The same project shows a different-coloured status chip on the dashboard, the project list, the browse page and the detail header — the exact 'similarity' consistency that CLAUDE.md's Gestalt section commits to, broken across the four surfaces an owner moves between most. Statuses missing from browse.tsx's map render with no background at all. Every new status added to the DB enum requires touching five maps or silently rendering unstyled.
- **Fix:** One `projectStatusStyle(status)` in packages/shared (or apps/web/src/lib) keyed exhaustively off the existing `ProjectStatus` union so TypeScript fails the build on an unhandled member, plus a `<StatusBadge status>` component consuming it. Delete the five maps. Do the same for document and payment status. Replace the three local formatter copies with the lib/utils.ts exports.
- **Edge cases:** Unifying the maps necessarily picks one colour per status, so at least three surfaces will change appearance — that is a visual decision needing owner sign-off, and the palette constraints in CLAUDE.md apply (cream and green are background/badge only, never body text; coral #e59a91 is 2.4:1 on white and fails AA as text).

### [MEDIUM] Talent dashboard fires 8 queries with a 4-wide waterfall behind the profile fetch, and pulls 20 notifications to render 3
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/web/src/routes/_authenticated/talent/index.tsx:113-146 mounts eight hooks. Four of them are gated on `profile?.id` and therefore cannot start until `useTalentProfile` resolves: `useTalentActiveProjects(profile?.id ?? '')` (:137), `useTalentApplications(profile?.id ?? '')` (:145), `useTalentHoursLogged(profile?.id ?? '')` (:146) — each `enabled: !!userId` in use-talent.ts (e.g. :77). `useNotifications(1)` at :143 fetches `pageSize=20` (use-notifications.ts:46) with `refetchInterval: 30_000` (:57) purely to render `.slice(0, 3)` at :144. `applicationsList` at :147-153 re-derives an array and `appliedProjectIds` at :154 builds a new `Set` on every render, both unmemoized, and both are read inside the `availableProjects.map` at :317-326.
- **Root cause:** The API keys the talent-scoped resources by talent_profile.id rather than user.id, forcing a client-side lookup hop; and the notification widget reuses the full notifications list hook instead of a small dedicated query.
- **Impact:** Two sequential round trips before the talent's own dashboard has data — the profile request, then four parallel requests — so time-to-content on the talent home screen is roughly double the single-hop case on a slow connection. The notification widget over-fetches 20 records every 30 seconds per open tab to display 3. The unmemoized Set rebuild is cheap in absolute terms but sits in the render path of the available-projects list.
- **Fix:** Server-side: accept user_id on the talent-scoped endpoints (or return the talent profile id in the session/me payload) so the four gated queries can start immediately — this is the real fix and is a project-service change. Client-side interim: `useMemo` the `applicationsList`/`appliedProjectIds` derivation on `applicationsRaw`, and add a `useRecentNotifications(3)` hook hitting `pageSize=3` instead of reusing `useNotifications(1)`.
- **Edge cases:** The pageSize=3 change is invisible unless the notifications endpoint's `type` filter behaves differently at small page sizes. The waterfall fix touches the API contract and should be sequenced with project-service work, not done unilaterally.
- **Verifier correction:** Correct the count from four gated queries to three, and from "8 queries" to 7 queries + 2 mutations. Also note the server-side fix is smaller than described: `useTalentProfile` already hits `/talent-profiles/user/${userId}` (use-talent.ts:77), so the API keys the profile by user id and only the three downstream endpoints need the same treatment — or the talent profile id can be returned in the /me payload, which is the cheaper change. The client-side interim fixes (useMemo, a dedicated pageSize=3 hook) are correct and behavior-neutral.

### [MEDIUM] Scoping chat SSE stream has no AbortController and no unmount teardown
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/web/src/hooks/use-chat.ts:155-160 opens `fetch('/api/v1/projects/${projectId}/chat/stream')` with no `signal`, then reads it in a `while (true)` loop at :173-217 with no unmount teardown — `sendMessage` is a `useCallback` (:127-238) with no cleanup path, and the hook has no effect tied to the stream. This is specifically the send path; the initial-load path at :37-120 IS correctly cancelled (AbortController at :38, signal on all three requests, an explicit `controller.signal.aborted` guard before the write at :108) and is covered by hooks/scoping-chat-cancel.test.ts:19-49, which asserts exactly those three properties.
- **Root cause:** Cancellation was added to the load effect in response to a stale-write bug (documented in the test file's header comment) but the streaming send path was not covered by the same fix, because it is invoked from a callback rather than an effect.
- **Impact:** Navigating away mid-generation leaves the HTTP connection open and lets server-side LLM generation run to completion — wasted Gemini tokens per abandoned message and a held connection, on the flow CLAUDE.md identifies as the most token-expensive. The `setState` calls after unmount are no-ops in React 19, so this is a cost/resource leak rather than a correctness bug; the closure also keeps the message array alive until the stream ends.
- **Fix:** Hold a `useRef<AbortController|null>`, create one per `sendMessage` call and pass `signal` to the fetch at :155, abort any prior in-flight controller at the top of `sendMessage`, and add a `useEffect(() => () => ref.current?.abort(), [])` for unmount. Swallow the resulting AbortError in the catch at :228 so it does not surface as a chat error toast. Extend scoping-chat-cancel.test.ts with a case for the stream path so the guard cannot regress.
- **Edge cases:** Aborting mid-stream leaves a partial assistant message persisted server-side; the reload path at :63-103 will replay whatever the server committed, so the UI stays consistent — but confirm project-service does not require the client to close the stream cleanly to persist the turn.
- **Verifier correction:** None. Evidence, severity and fix are all correct, including the honest framing that React 19 makes post-unmount setState a no-op so this is a token/connection cost leak rather than a correctness bug. Adding the AbortError swallow in the catch at :228-235 is necessary — without it the abort surfaces as a chat error state, which would be a behavior regression.

### [MEDIUM] ~105KB of locale JSON for both languages is statically imported into the entry chunk, and centrifuge is pulled into the layout every authenticated page loads
`UNVERIFIED` · behavior-change: `False`

- **Evidence:** apps/web/src/lib/i18n.ts:4-21 statically imports all 18 locale files (9 namespaces × id/en) and inlines them into `resources` at :48-71; main.tsx:6 imports it unconditionally, so they land in the entry chunk regardless of the detected language. Raw sizes measured: 105,071 bytes total for apps/web, of which project.json alone is 22,019 (id) + 21,752 (en) and common.json 10,406 + 10,133 — roughly 52KB per language, of which one language is always dead weight. apps/admin adds 22,792 bytes (11,474 + 11,318). i18next-http-backend is not a dependency, matching CLAUDE.md's note that resources are bundled rather than fetched. Separately, apps/web/src/routes/_authenticated.tsx:27 imports `useNotificationRealtime` from hooks/use-notifications.ts, which imports `connectCentrifugo`/`subscribeTo` from lib/centrifugo.ts:1 (`import { Centrifuge } from 'centrifuge'`) — the layout route wrapping every authenticated page therefore pulls the WebSocket client into its chunk. What is NOT a problem, verified: `autoCodeSplitting: true` is set in both vite.config.ts files; @svar-ui/react-gantt is imported only by components/project/gantt-view.tsx:1, whose only consumer is the split route projects/$projectId/milestones.tsx:6; recharts is imported only by projects/$projectId/time-tracking.tsx:17 and apps/admin dashboard.tsx:30, both split routes. Neither is in the initial bundle.
- **Root cause:** i18n was wired for simplicity (static import, zero network) at a point where the locale files were small; project.json has since grown to 22KB per language. The Centrifugo import sits in the layout because the notification badge lives in the top bar.
- **Impact:** Roughly 52KB raw (gzip meaningfully smaller — I did not measure the compressed figure and will not guess) of never-used translations in the entry chunk on every first load, against CLAUDE.md's stated <2s P95 page-load target. The centrifuge client is a fixed cost on the authenticated layout even for users who never open a realtime surface. Modest, not urgent — I flag it precisely so the Gantt/Recharts non-finding does not get conflated with it.
- **Fix:** Switch i18n.ts to `import()` the resource bundles for the resolved language only (i18next `resourcesToBackend` over dynamic import keeps it bundled-not-fetched while splitting per language), loading the second language on switch. Optionally split `project.json` so document-heavy namespaces load with their routes. For centrifuge, lazy-import lib/centrifugo.ts inside `useNotificationRealtime`'s effect rather than at module scope.
- **Edge cases:** Lazy locale loading introduces a frame where `t()` returns keys; i18next's `initImmediate: false` plus a Suspense boundary handles it, but the language switcher at _authenticated.tsx:167-174 must await the load before flipping. Lazy centrifuge means the realtime subscription starts one microtask later — harmless, since use-notifications.ts:57 already polls at 30s as the fallback path.

### [LOW] TopBar in the layout route subscribes to two whole Zustand stores with no selector
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/web/src/routes/_authenticated.tsx:141-142: `const { user } = useAuthStore()` and `const { theme, toggleTheme } = useThemeStore()`, both without a selector, inside `TopBar` — a component rendered by the layout that wraps every authenticated page. Sidebar at :210 does the same. The repo already litigated this pattern for the toast store: stores/toast-subscription.test.ts:30-39 fails the build if any file other than components/layout/toast-container.tsx calls `useToastStore()` unselected, with a header comment explaining the double re-render cost. That rule does not cover the auth or theme stores. Correcting my own prior framing: zero `useShallow` usage is NOT a CLAUDE.md violation — that warning is about selectors returning a fresh array/object per render, and none of the 40 store call sites do that (`s => s.user`, `s => s.addToast`, `s => s.user?.role === 'talent'` are all stable). The issue is over-subscription, not selector identity.
- **Root cause:** The enforcement test was written for the store whose writes were most frequent (toasts) and never generalised to auth/theme.
- **Impact:** Any auth-store write — `setLoading`, `hydrate` completing, a profile update via settings.tsx:77 `setUser` — re-renders TopBar and Sidebar on every authenticated page, and theme writes re-render TopBar. Small in absolute cost (these are ~60-line components), but it is the layout, so it is the one place a stray write is guaranteed to be paid on every route.
- **Fix:** `useAuthStore(s => s.user)` and `useThemeStore(s => s.theme)` / `useThemeStore(s => s.toggleTheme)` as two calls, matching the pattern already used correctly at :99 and in 20 other call sites. Extend stores/toast-subscription.test.ts to cover `useAuthStore()` and `useThemeStore()` with the same whitelist mechanism so the rule generalises.
- **Edge cases:** settings.tsx:77 and login.tsx:15 destructure `setUser` from an unselected call — those are actions, stable references, so selecting them individually is safe and equivalent.
- **Verifier correction:** None. Severity is correctly filed at low — these are ~60-line components and the writes are infrequent. The proposed fix is trivial and behavior-neutral; extending toast-subscription.test.ts to cover useAuthStore()/useThemeStore() with the same whitelist mechanism is the higher-value half, since it stops the pattern recurring in the next 700-line route.

### [LOW] No list virtualization anywhere, against pageSize=100 fetches and a 5-second chat refetch
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** Searching apps/web/src, apps/admin/src and the package.json files for `virtual`, `react-window`, or `@tanstack/react-virtual` returns nothing. Against that: admin users.tsx:188, projects.tsx:247 and dlq.tsx:104 each render up to 100 rows into a plain `<tbody>`; apps/web/src/hooks/use-chat-messages.ts:73 fetches `?pageSize=100` and re-maps every message through `deriveSenderName` (:78-89) on each of the `refetchInterval: 5_000` polls (:92), on top of the Centrifugo subscription at :96-102 that invalidates the same key; talent/index.tsx:317 and the milestone board render unbounded lists.
- **Root cause:** Nothing has hit the threshold yet, so no one has needed it.
- **Impact:** Not a present defect — apps/admin/PRODUCT.md:70-72 confirms there is no production data and that empty/sparse is the normal state. Naming it as the threshold to watch: 100 table rows is fine, 100 chat messages re-mapped every 5 seconds is already wasteful, and the doubled refresh path (5s poll + WebSocket invalidation on the same key) means the map runs more often than the poll interval suggests.
- **Fix:** Do not virtualize now. Two cheap wins that are worth doing: drop `refetchInterval: 5_000` on use-chat-messages.ts:92 to a much longer safety-net interval (30-60s) now that Centrifugo delivers the messages, and move the `deriveSenderName` mapping into a `select` so React Query memoizes it against unchanged data. Revisit virtualization when admin pagination lands and page sizes are chosen deliberately.
- **Edge cases:** Lengthening the chat poll makes the app depend more on Centrifugo; verify the subscription-token path at lib/centrifugo.ts:70-97 is reliable for `chat:` channels before reducing the fallback, since that path requires a per-channel signed token where notifications do not.
- **Verifier correction:** One half of the proposed fix is wrong. `deriveSenderName` is called inside `queryFn` (use-chat-messages.ts:74-90), so it already runs exactly once per network response — which is the minimum. "Move the mapping into a select so React Query memoizes it" would not reduce work, and with an inline (non-stabilized) select fn it would run on every render, i.e. strictly worse. Drop that half. The evidence wording also mis-frames the mapping as render-path waste; it is per-fetch. Only the refetchInterval change is worth doing — and even that needs a moment's care: Centrifugo delivery is the only thing that would then keep messages fresh, so lengthening the poll to 30-60s makes the chat correctness-dependent on the WebSocket, which per finding 3 breaks silently after a soft logout. Land finding 3's fix first.

## Cross-cutting infrastructure — events, caching, jobs, resilience, observability, config

_The event plumbing is more real than most codebases at this stage: JetStream streams are provisioned with correct retention/dedup/MaxDeliver, the notification consumer has genuinely correct durable-consumer, ack/nak, final-delivery-detection and DLQ-parking semantics, Valkey-backed consumer idempotency exists and is checked before processing, and Temporal is not vaporware — three workflows are defined, started from routes, and a `project-worker` container runs them in prod. Where it breaks down is at the seams. The outbox pattern is applied non-atomically at 15 of its 36 call sites, so the exact dual-write inconsistency it exists to prevent is still live on the milestone and payment paths. Two independent outbox pollers (TS and Go) race on one unpartitioned table with no row locking, corrupting retry counts and double-inserting DLQ rows. Five outbound AI-service calls have no timeout, the Cockatiel policy that exists is wired to exactly one of ~eight outbound call sites, Valkey caches nothing (every TS service requires REDIS_URL and none opens a connection), and the penalty scheduled job re-penalizes talents on every process restart. Config fail-fast is real in TypeScript and absent in Go/Python._

### [HIGH] Outbox event written outside the business transaction at 15 of 36 call sites, defeating the pattern entirely
`CONFIRMED` · behavior-change: `False`

- **Evidence:** `appendOutboxEvent(db, …)` takes any `DbLike` (apps/project-service/src/lib/outbox.ts:22-33), so a transaction handle and a pool handle are indistinguishable at the call site. Counting call sites in apps/project-service/src: 21 pass `tx` (correct), 12 pass `db`, 3 pass `getDb()` directly (scheduled-jobs.ts:16, activities/team-formation.activities.ts:69, routes/talent-placement.ts:216). I checked the `db` binding in all 9 files containing `appendOutboxEvent(db, {` — milestones.ts, projects.ts, applications.ts, contracts.ts, work-packages.ts, time-logs.ts, talent-profiles.ts, talent-placement.ts, activities/milestone.activities.ts — and in every one `db` is bound as `const db = getDb()`, never a transaction parameter. Confirmed no shadowing: `grep -rn "transaction(async (db\|transaction((db" apps/project-service/src` returns zero hits, so no `db` identifier anywhere is a tx handle. Two sites read end-to-end: milestones.ts:102 binds `const db = getDb()`, then :119 emits `milestone.created` after `service.createMilestone()` returned; milestones.ts:224 emits `milestone.invoice_requested` after `service.updateMilestoneStatus()` already committed. The in-code comment at milestones.ts:220-222 asserts "Outbox commit gives us durability so a crash here cannot drop the invoice work for an approved milestone" — that guarantee does not hold, because there is no shared commit.
- **Root cause:** `DbLike` is structurally typed on `.insert().values()`, which both the Drizzle pool client and a tx satisfy. Nothing at the type level or in review forces the caller to be inside `db.transaction()`. The 21 correct sites are correct by author discipline, not by construction, and the discipline drifted as routes were added.
- **Impact:** Every one of the 15 sites is a live dual-write window. Crash or connection loss between the business write and the outbox insert leaves the state change committed with no event ever published. Concretely on milestones.ts:224: a milestone flips to `approved`, escrow settles inline at :232, and the `milestone.invoice_requested` event is lost — the owner and talent are charged and paid with no invoice row and no PDF, and nothing retries because the outbox row does not exist. The failure is silent: there is no reconciliation query anywhere that detects committed state with a missing event.
- **Fix:** Two-part. (1) Make the invariant structural rather than cultural: narrow the `DbLike` type in lib/outbox.ts to a branded transaction type (e.g. accept only `PgTransaction`, or add a `__tx: true` phantom field that only a tx-wrapping helper can produce) so `appendOutboxEvent(getDb(), …)` stops compiling. That converts all 15 sites into compile errors that must be individually resolved. (2) Wrap each of the 15 into the surrounding `db.transaction(async (tx) => …)` alongside the business write it belongs to. The service-layer calls (`service.createMilestone`, `service.updateMilestoneStatus`) need to accept an optional tx parameter to participate. Fix the 3 `getDb()` sites first — talent-placement.ts:216 and team-formation.activities.ts:69 sit on the money and matching paths.
- **Edge cases:** activities/milestone.activities.ts is a Temporal activity, which Temporal already retries on failure — so a lost event there self-heals on retry and is lower priority. scheduled-jobs.ts:16 is inside a periodic job that re-scans, so it also partially self-heals. The route-layer sites (milestones, applications, contracts, work-packages, talent-placement) have no retry above them and are the ones that permanently lose events.
- **Verifier correction:** Severity critical -> high. The worst-case is narrower than stated. On the milestones.ts:224 path the repository already emitted milestone.approved inside its own transaction (milestone.repository.ts:110), and escrow settlement is a separate inline call (milestones.ts:232) with an idempotent auto-release backstop (activities/milestone.activities.ts:52). So a crash in the window loses the invoice row and PDF, not the payout and not the approval notification. That is a real, silent, unreconciled loss but it is not money loss. The proposed fix is sound; note that branding DbLike to a PgTransaction shape is a genuinely mechanical change, but wrapping the 15 sites requires threading a tx through the service layer (MilestoneService, WorkPackageService), which is a larger refactor than the finding implies.

### [HIGH] Two independent outbox publishers poll the same unpartitioned table with no row locking
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/services/outbox-worker.ts:35-41 selects `FROM outboxEvents WHERE published = false AND retryCount < 3 ORDER BY createdAt LIMIT 100` on a 1s loop (started unconditionally at src/index.ts:150). apps/payment-service/internal/publisher/outbox.go:91-97 issues a byte-identical query — `SELECT … FROM outbox_events WHERE published = false AND retry_count < 3 ORDER BY created_at ASC LIMIT 100` — on its own 1s ticker (outbox.go:72, started at payment-service/main.go:80-83). Neither filters by `aggregate_type` or service ownership, and neither uses `FOR UPDATE SKIP LOCKED` or an advisory lock. Both stamp a different `source` on the envelope (outbox-worker.ts:70 `'project-service'` vs outbox.go:21 `serviceSource = "payment-service"`). Duplicate *delivery* is contained: both publish with `msgID = event.id` (outbox-worker.ts:80, outbox.go:200) and every stream is created with `--dupe-window 2m` (apps/gateway/nats-init-streams.sh:51-84). What is not contained is the DB-side state.
- **Root cause:** The outbox table was designed as a single shared infrastructure table (packages/db/src/schema/infrastructure.ts) but each service grew its own publisher independently, and neither added an ownership predicate or a lock because in single-replica dev both appear to work.
- **Impact:** Three concrete consequences that NATS msgID dedup does not cover. (1) retry_count races: both pollers do an unconditional `UPDATE … SET retry_count = $1` (outbox-worker.ts:118-121, outbox.go:207-214) computed from a stale read, so during a NATS outage a row burns its 3-retry budget in fewer than 3 real failure rounds and is abandoned early. (2) Duplicate DLQ rows: outbox-worker.ts:103-116 and outbox.go:139-141 both insert into `dead_letter_events` at the threshold with no uniqueness constraint, so one failed event yields two DLQ entries under two different `consumer_service` values — which corrupts the admin DLQ viewer's counts and makes any re-process flow double-fire. (3) Neither service can be scaled past one replica without multiplying both effects, and the 2-minute dedup window is the only thing standing between a slow publish cycle and genuine duplicate delivery of payment events.
- **Fix:** Add an ownership predicate plus a lock, in that order. Give `outbox_events` a `publisher` column (or reuse `aggregate_type`) and have each poller filter to its own domain — project-service takes project/milestone/talent/work_package aggregates, payment-service takes payment. Then change both SELECTs to `… FOR UPDATE SKIP LOCKED` inside a transaction that also performs the `published = true` update, which makes the poller safe to run at N replicas. Add a unique index on `dead_letter_events(original_event_id)` as a backstop against the double-insert. All three changes are invisible to product behavior.
- **Edge cases:** Because `retry_count < 3` is in the WHERE clause, a row that races its way past 3 increments disappears from both pollers' view permanently while `published` stays false — it is neither published nor guaranteed to be in the DLQ (the DLQ insert only happens on the poller that observed the third failure). There is no query anywhere that surfaces stuck `published = false AND retry_count >= 3` rows.
- **Verifier correction:** The finding understates one consequence it did not name: because neither poller filters by domain, payment-service publishes project-service's rows stamped source="payment-service" (outbox.go:21) and vice versa (outbox-worker.ts:70). I checked whether this is load-bearing — apps/notification-service/internal/consumer/nats.go:34 decodes Source into the envelope struct but no consumer in Go, Python or TS branches on it, so today it is cosmetic and does not raise severity. It does mean the event source field in stored/traced envelopes is unreliable for debugging. The proposed fix is correct; the ownership predicate is the load-bearing half and SKIP LOCKED alone would not fix the cross-publishing.

### [HIGH] Penalty scheduled job re-penalizes the same talents on every process restart, and has no leader election
`CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/services/scheduled-jobs.ts:59-61 schedules `runPenaltyJobs` 30 seconds after every boot, unconditionally, in addition to the 6-hour interval at :56. `processAbandons(6)` (:47) reaches apps/project-service/src/services/penalty.service.ts:47-63, which for every returned row calls `incrementPemerataanPenalty(item.talentId, ABANDON_PENALTY_DELTA)` — a cumulative `+0.5` — and emits an outbox event. The query behind it, apps/project-service/src/repositories/matching.repository.ts:257-276, is a pure time-window scan: `WHERE status = 'terminated' AND completedAt >= cutoff` where cutoff is `now - 6h`. There is no `already_penalized` column, no penalty-record lookup, and no dedup of any kind. `processInactiveTalents` (penalty.service.ts:28-44) has the same shape for warning events.
- **Root cause:** The job was written as idempotent-by-time-window — the assumption being that a 6-hour interval over a 6-hour window visits each row once. That assumption holds only for a single process that never restarts. The 30s boot run was added for dev convenience ("Initial run after 30s so service boot has time to settle") and silently broke it.
- **Impact:** Product-behavior bug on the fairness system, which CLAUDE.md names as a core platform value. `pemerataan_penalty` feeds `1 / (1 + active*2 + completed*0.1 + pemerataan_penalty)`, so each spurious `+0.5` measurably suppresses a talent's recommendation score. Three redeploys in an afternoon apply `+1.5` instead of `+0.5` to every talent whose assignment terminated in the preceding 6 hours; a crash-loop applies it once per restart with no ceiling. Each also emits a duplicate `talent.abandon_penalized` outbox event, so the talent receives duplicate notifications. Separately, there is no advisory lock or leader election anywhere in scheduled-jobs.ts, so running two project-service replicas doubles every penalty even with no restarts — this is a hard blocker on horizontal scaling of the service.
- **Fix:** Make the job idempotent at the data layer rather than by timing: record penalties in the existing `talent_penalties` table (schema already has `type: 'rating_penalty'` and `related_project_id`) and have `processAbandons` skip any assignment that already has a penalty row, applying the increment and the insert in one transaction. That is correct under restarts, replicas, and window drift simultaneously. Separately wrap the whole `runPenaltyJobs` body in a `pg_try_advisory_lock` so only one replica runs it — cheap and needed for the inactivity scan too. Removing the 30s boot run is a band-aid that does not fix the multi-replica case; do the data-layer fix.
- **Edge cases:** Window drift is a second, independent bug in the same code: `setInterval` at exactly 6h against a `now - 6h` window means any clock skew or event-loop delay lets a termination fall between two runs and never be penalized at all, or land in both. The data-layer fix should widen the scan window (e.g. 24h) and rely on the penalty record for dedup, which fixes over- and under-counting together. Backing out already-applied duplicate penalties needs owner sign-off — it changes live matching scores.
- **Verifier correction:** The proposed data-layer fix does not fit the existing schema as described. talent_penalties has type/reason/related_project_id/issued_by but no assignment_id column, and findRecentAbandons (matching.repository.ts:257-274) returns only talentId and assignmentId — no projectId — so it cannot populate related_project_id and cannot key dedup on the assignment without a migration. The correct minimal fix is a new nullable assignment_id column (or a boolean penalty_applied flag on project_assignments) plus a unique index, applied in the same transaction as the increment. The advisory-lock half of the fix is correct as written and is independently needed for the inactivity scan.

### [HIGH] Milestone auto-release deadline is never reset after a revision cycle, shortening the owner's review window
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/routes/milestones.ts:382 gates the Temporal trigger to `submitted | approved | rejected` — `revision_requested` is deliberately excluded, so no signal is sent when the owner requests changes and the running workflow keeps sleeping. The workflow itself (apps/project-service/src/workflows/milestoneAutoRelease.ts:30) is a single `await sleep(delayMs)` with `delayMs` defaulting to 14 days, measured from workflow start. On resubmission, milestones.ts:388-394 calls `client.workflow.start` with the same deterministic `workflowId = milestoneAutoReleaseWorkflowId(milestoneId)` and `workflowIdReusePolicy: 'ALLOW_DUPLICATE'`. That policy permits reuse only after the prior run closes; against a still-running workflow the start rejects, and the rejection is swallowed by the `.catch()` at milestones.ts:268-270 which logs a warn and returns success to the caller.
- **Root cause:** The workflow models the 14-day clock as a one-shot timer started at first submission, but the milestone lifecycle (`submitted -> revision_requested -> in_progress -> submitted`) is a loop. Nothing resets or restarts the timer at the loop boundary, and the deliberate `.catch()` that makes Temporal optional also hides the resulting collision.
- **Impact:** Directly mis-times a payout. CLAUDE.md's rule is "setelah talent submit, owner punya 14 hari untuk review" per submission. If the talent submits at T0, the owner requests revision at T0+3d, and the talent resubmits at T0+10d, auto-release still fires at T0+14d — the owner gets 4 days on the revised deliverable, not 14, and escrow releases to the talent on work the owner has not had the contractual window to review. The longer the revision cycle, the shorter the window; a resubmission after day 14 gets no timer at all because the workflow already fired and closed. This is silent — the only trace is a `temporal workflow trigger failed` warn line, which reads like an infrastructure blip rather than a payment-timing defect.
- **Fix:** On `revision_requested`, signal the running workflow to cancel (add a `revisionRequestedSignal` alongside `milestoneApprovedSignal` at milestoneAutoRelease.ts:11 and return early from the workflow), so the next `submitted` gets a clean start against a closed workflow and `ALLOW_DUPLICATE` does what it was chosen for. Alternatively make the workflow loop: replace the single `sleep` with `condition`-based waiting that restarts the 14-day timer on each resubmission signal. Either way, narrow the `.catch()` at milestones.ts:268 so `WorkflowExecutionAlreadyStartedError` is logged at error level — an already-running auto-release timer is a correctness signal, not the same class of event as "Temporal is down".
- **Edge cases:** The inline settlement at milestones.ts:232 is described as idempotent, so the failure mode is early release rather than double payment — but it is still a release the owner did not authorize and had no window to contest. Also worth noting the reverse case: `rejected` does send the signal (milestones.ts:382), but the signal handler at milestoneAutoRelease.ts:26-28 sets `approved = true`, so a rejection is recorded as `reason: 'already_approved'` in the workflow result — harmless today since nothing reads it, but actively misleading in a Temporal UI investigation.
- **Verifier correction:** One sub-claim is backwards and should be dropped: 'a resubmission after day 14 gets no timer at all because the workflow already fired and closed'. A closed workflow is precisely the case ALLOW_DUPLICATE permits, so a post-day-14 resubmission does get a fresh 14-day timer. (In that path the original workflow woke while status was revision_requested, checkMilestoneReleased returned alreadyReleased=true, and it closed without releasing.) The proposed fixes are both correct; the cancel-on-revision_requested variant is the smaller change and I would prefer it over converting the workflow to a condition loop.

### [MEDIUM] No timeout on five outbound AI-service calls, including the two document generators
`CONFIRMED` · behavior-change: `True`

- **Evidence:** These five `fetch` calls configure no `signal`: apps/project-service/src/lib/document-generation.ts:56 (`/generate-brd`) and :88 (`/generate-prd`), apps/project-service/src/routes/projects.ts:876 (`/ai/chat`) and :1006 (`/ai/chat/stream`), apps/project-service/src/routes/upload.ts:132 (`/parse-cv`). The codebase demonstrably knows the idiom — `grep -rn "AbortSignal" apps/*/src` returns exactly four uses, all elsewhere: middleware/session.ts:54 and :91 (5s), projects.ts:1174 (60s), auth-service/src/lib/sms.ts:33 (15s). So the omission is inconsistency, not an unknown pattern. CLAUDE.md specifies "Timeout: 30 detik untuk chatbot response, 60 detik untuk BRD/PRD generation" — projects.ts:1174 is the only call that honours it. I did not verify Bun's default fetch timeout, so the correct claim is that no timeout is explicitly configured, not that the request hangs forever.
- **Root cause:** Timeouts were added reactively at the call sites where a hang was actually observed (session validation, SMS) rather than adopted as a rule for all outbound calls. There is no shared HTTP client wrapper — `withServiceAuth` (lib/service-auth.ts:16) composes headers only, so each call site re-specifies transport options from scratch and each one can forget.
- **Impact:** When ai-service degrades rather than fails — the common LLM failure mode, since it fronts Vertex AI — a BRD/PRD generation request occupies a project-service request handler with no bound. Under the documented 500-concurrent-user target this is how the service is saturated by a slow upstream instead of shedding load. The user sees a spinner with no error and no retry affordance, and the carefully-built `unavailable()` path at document-generation.ts:44-49 that protects the owner's daily document quota never executes, because it only triggers on a thrown fetch or a non-ok status. Notably this is not a connection-pool problem: I checked all four `generateBrdContent`/`generatePrdContent` call sites (projects.ts:1317, 1421, 1680, 1783) and none is inside a `db.transaction()`, so a hung call does not pin a Postgres connection through PgBouncer.
- **Fix:** Add `signal: AbortSignal.timeout(ms)` to all five, using the values CLAUDE.md already specifies — 60s for document-generation.ts:56 and :88, 30s for projects.ts:876 and :1006, 30s for upload.ts:132. Better: introduce a single `serviceFetch(url, init)` helper next to `withServiceAuth` in lib/service-auth.ts that applies the service-auth header, a default timeout, and the Cockatiel policy in one place, then migrate all internal calls to it — that closes this finding and the circuit-breaker-coverage finding together and stops the next call site from regressing.
- **Edge cases:** projects.ts:1006 is an SSE stream — a whole-request `AbortSignal.timeout` would kill long legitimate streams. That one needs a connect/first-byte timeout or an inactivity-based abort rather than a total-duration one. Because a hang currently surfaces as an indefinite spinner and would become a visible error, this needs owner sign-off on the messaging: for document generation the error path also refunds the daily quota, which is the better outcome but is a user-visible change.
- **Verifier correction:** Severity high -> medium, on mechanism not scale. The blast radius is bounded by things the finding itself verified: none of the four generateBrdContent/generatePrdContent callers sits inside db.transaction(), so no Postgres connection is pinned through PgBouncer, and the unavailable() quota-protection path at document-generation.ts:44-49 still fires on any thrown fetch or non-ok status — it is only bypassed while the socket stays open. What is actually lost is bounded latency and a fast-fail signal, not correctness and not connection-pool exhaustion. The proposed fix (serviceFetch wrapper) is right and is the correct place to land findings 3, 7 and 10 together.

### [MEDIUM] Valkey caches nothing; every TypeScript service requires REDIS_URL and none opens a connection
`CONFIRMED` · behavior-change: `False`

- **Evidence:** packages/config/src/index.ts:8 puts `REDIS_URL: z.url()` in `baseEnvSchema`, so auth-service and project-service both hard-fail at boot without it. Neither ever connects: `grep -rn "redis\|Redis\|REDIS_URL" apps/project-service/src apps/auth-service/src` returns exactly two hits, both the same comment string in apps/project-service/src/middleware/rate-limit.ts:13 and apps/auth-service/src/middleware/rate-limit.ts:14 — "In-memory rate limiter keyed by client IP. Single-instance only; use Redis in production." ai-service has zero redis references in app/. The only real consumer in the monorepo is apps/notification-service/internal/idempotency/idempotency.go:29-58, which uses it correctly for consumer dedup with the documented 7-day TTL. CLAUDE.md claims Valkey is "Used for consumer idempotency, session store, rate limiting, AI response cache" — only the first is true.
- **Root cause:** Valkey was provisioned as infrastructure ahead of the read paths that would justify it, and the env schema was written against the intended architecture rather than the implemented one. No caching was ever needed because load has not forced the issue.
- **Impact:** Two distinct costs. (1) The rate limiter is per-process, so the documented 100 req/min ceiling becomes 100×N with N replicas — it is not a real limit in any scaled deployment, and it is the primary control on the AI-intensive endpoints where each request costs money at Vertex AI. (2) Config is misleading: a valid deployment is rejected for a missing dependency the service does not use, and an operator reading CLAUDE.md will assume there is a cache layer to tune when there is none. The highest-value cacheable paths that currently hit Postgres every time are the public browse endpoints (`/projects` listing and `/projects/stats` on the unauthenticated landing page, both backed by `idx_projects_browse`) and the AI response cache CLAUDE.md specifies for price estimation, where the cache would avoid a paid LLM call rather than just a query.
- **Fix:** Decide and align, do not leave it ambiguous. Minimum honest fix: move `REDIS_URL` out of `baseEnvSchema` into only the schemas of services that use it, and correct the CLAUDE.md sentence to say idempotency only. If the cache is wanted, the ordering by value is (a) move rate limiting to Valkey — this is a correctness fix, not an optimization, because the current limiter does not limit; (b) cache the two public browse endpoints with short TTLs, where staleness is harmless; (c) the AI estimate cache last, since it needs a prompt-hash key and has real invalidation questions.
- **Edge cases:** Moving rate limiting to Valkey is the one part with a behavior change — real enforcement will start rejecting traffic that currently passes, so the limit values need review before it ships. Removing REDIS_URL from the base schema is purely a config relaxation and cannot break a running deployment.
- **Verifier correction:** The rate-limiter half of the impact is currently latent, not live: deployment is single-replica per service (docker-compose.prod.yml has no replicas/deploy scaling), so 100 req/min is today the real ceiling. It becomes a correctness gap the moment anything scales out. The config half is real now. The proposed fix ordering is right, and moving REDIS_URL out of baseEnvSchema is the honest minimum.

### [MEDIUM] Trace context is propagated over NATS but not over outbound HTTP; X-Request-ID is generated and never sent anywhere
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** The NATS path is genuinely complete in all three languages: packages/logger/src/nats-tracing.ts:37 and :68 inject W3C context, apps/notification-service/internal/consumer/nats.go:204 extracts it, apps/payment-service/internal/observability/nats.go:34-43 does both, and apps/ai-service/app/services/nats_consumer.py:70 extracts it. The outbox even round-trips trace context through the DB (lib/outbox.ts:24 captures, outbox-worker.ts:48 restores), which is unusually thorough. The HTTP path is the opposite: `grep -rn "traceparent\|propagation.inject"` across apps and packages returns no manual injection on any outbound `fetch`. apps/project-service/src/lib/service-auth.ts:11-17 is the shared outbound header builder and adds only `X-Service-Auth`. apps/project-service/src/middleware/correlation-id.ts:4-9 generates a UUID v7, echoes it on the response and stores it in Hono context — but `grep -rn "X-Request-ID"` across all six services returns hits in that one file only, so it is never read by a logger, never attached to an outbound call, and no Go or Python service looks for it. The OTel SDK (packages/logger/src/tracing.ts:29) registers `HttpInstrumentation`, which instruments node:http; whether that patches Bun's native global `fetch` I did not verify, so I am claiming only the absence of manual propagation, not that traces are definitively broken.
- **Root cause:** Two correlation mechanisms were adopted in parallel — W3C trace context for messaging and a bespoke X-Request-ID for HTTP — and only the first was carried through to completion. The X-Request-ID middleware was added to satisfy the documented requirement and stopped at the point where it produces a value, without the log-binding and outbound-propagation halves that give it any use.
- **Impact:** The async half of the system is traceable end to end; the synchronous half is not. A slow BRD generation cannot be followed from the project-service span into ai-service's span, which is exactly the investigation the observability stack was stood up for — and CLAUDE.md's target of "AI BRD/PRD generation < 60 detik" is unmeasurable across the boundary as a result. Because Pino never binds `requestId` either, log lines cannot be grouped by request even within one service, so the fallback of grepping logs by correlation id does not work.
- **Fix:** Pick one mechanism, which should be W3C trace context since it already works over NATS and across all three languages. Add `propagation.inject()` into the shared outbound helper (the same `serviceFetch` wrapper proposed for the timeout finding) so every internal call carries `traceparent` — one change point covers all of them. Then either bind `requestId` into the Pino child logger so it earns its keep, or delete correlation-id.ts and derive the correlation id from the active span's traceId, which is what the outbox publisher already does (outbox-worker.ts:67).
- **Edge cases:** The Go services all extract from NATS headers but I did not check whether their Fiber HTTP handlers extract W3C context from inbound requests — if they do not, injecting on the TS side is necessary but not sufficient for a joined trace, and the Go middleware needs the matching extract.
- **Verifier correction:** The evidence sentence 'grep -rn "X-Request-ID" across all six services returns hits in that one file only' is false. apps/auth-service/src/middleware/error-handler.ts:8 reads the header and returns it in the error body, and apps/notification-service/main.go:104 allows it in the CORS AllowHeaders list. Neither changes the conclusion — it is still never attached to an outbound call and never bound to a logger — but the cited grep result is wrong as written. Proposed fix is correct.

### [MEDIUM] Env validation fails fast only in the two TypeScript services; Go and Python services boot with silent localhost defaults
`CONFIRMED` · behavior-change: `False`

- **Evidence:** packages/config/src/index.ts:57-66 implements `validateEnv` correctly — it throws on a parse failure, and both TS services call it at module load: apps/project-service/src/lib/env.ts:3 and apps/auth-service/src/index.ts:16 (plus lib/auth.ts:7). That is genuine fail-fast. The comment at packages/config/src/index.ts:47-49 is candid that the Go and Python schemas were removed as dead exports because those services parse env natively — but native parsing there means defaults, not validation. apps/payment-service/internal/config/config.go:60-62 falls back to `nats://localhost:4222` when NATS_URL is unset; apps/notification-service/internal/config/config.go:43-45 does the same for REDIS_URL. The team clearly knows the risk: apps/payment-service/internal/config/compose_test.go:151-159 is a test asserting the compose file sets NATS_URL, with the comment "the outbox publisher defaults to localhost and drops every payment.* event" — a compose-file assertion standing in for the startup check that does not exist.
- **Root cause:** The shared config package targets the TypeScript workspace, and `os.Getenv` with a default is the path of least resistance in Go. The default values were chosen for local development convenience and then inherited by the production code path.
- **Impact:** A misconfigured Go service starts, passes `/health`, and fails invisibly. The payment-service case is the sharp one and its own test names it: with NATS_URL unset the outbox publisher dials localhost, every `payment.*` event fails to publish, and the finance notification path goes dark while the service reports healthy — which is worse than a crash loop, because a crash loop is noticed. The compose_test guard only covers the checked-in compose file; it does not cover Dokploy env overrides, a `.env` typo, or any deployment path that is not that file.
- **Fix:** Add a required-vars check to each Go service's `config.Load()` — collect the vars with no safe default (NATS_URL, DATABASE_URL, REDIS_URL where used, SERVICE_AUTH_SECRET) and return an error listing all missing ones so `main.go` exits non-zero. Keep the localhost defaults behind an explicit `APP_ENV=development` branch so local dev is unaffected. The same applies to ai-service's settings. This is roughly 15 lines per service and converts the silent-degradation class of failure into a startup failure.
- **Edge cases:** The compose_test approach should be kept alongside the runtime check, not replaced by it — it catches the error at CI time rather than deploy time. But it must not be mistaken for the runtime guarantee, which is how it currently functions.
- **Verifier correction:** No correction to the claim; sharpen the evidence. The finding attributes the silence to the localhost default alone, but the default only degrades silently because RetryOnFailedConnect(true) at outbox.go:50 converts a would-be startup error into a background retry. A required-vars check in config.Load() is the right fix and is sufficient, but a reviewer should know that removing the default without that flag change would still not crash the process.

### [MEDIUM] The Cockatiel resilience policy is wired to one of roughly eight outbound call sites
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/project-service/src/lib/resilience.ts:10-20 defines `makeResilientPolicy` correctly — retry (3 attempts, `ExponentialBackoff` 1s→8s) wrapped over a `ConsecutiveBreaker(5)` with `halfOpenAfter: 30_000`, matching CLAUDE.md's stated config. `grep -rn "makeResilientPolicy" apps packages` returns exactly one consumer: apps/project-service/src/middleware/session.ts:7, guarding the auth-service session check. Every AI-service call (document-generation.ts:56, :88; projects.ts:876, :1006; upload.ts:132), the payment-service client (lib/payment-client.ts), and the S3 calls in upload.ts run as bare `fetch` with no breaker. CLAUDE.md places the circuit breaker specifically on the AI path ("Circuit breaker (Cockatiel) … return fallback error ke user" under AI Integration) — the one place it is not applied. The `_serviceName` parameter is unused (prefixed underscore), so all callers would share breaker semantics but not state, which is the right shape for per-service breakers once there is more than one caller.
- **Root cause:** Same root cause as the missing timeouts: there is no shared outbound HTTP client, so resilience is opt-in per call site and was applied at the one place a failure was actually felt. CLAUDE.md's jitter requirement ("exponential backoff + jitter … jitter ±500ms random") is also unimplemented — `ExponentialBackoff` is constructed without a jitter generator.
- **Impact:** ai-service is the least reliable dependency in the system (it fronts a paid external API with rate limits) and has the least protection. When it degrades, every project-service request that touches it retries zero times and trips no breaker, so project-service keeps hammering a struggling upstream instead of failing fast — the thundering-herd pattern the jitter requirement exists to prevent. Combined with the missing timeouts on the same five calls, an ai-service brownout propagates into project-service resource exhaustion with no circuit anywhere in the path to stop it.
- **Fix:** Fold the policy into the shared `serviceFetch` wrapper proposed in the timeout finding, with a per-service breaker keyed on the now-unused `serviceName` parameter so ai-service tripping does not open the circuit for payment-service. Add jitter to the backoff to match the documented config. This is the single highest-leverage refactor in this dimension: one wrapper resolves the timeout gap, the breaker gap, and the trace-propagation gap across all internal HTTP calls at once.
- **Edge cases:** Blanket retry on the AI calls is not safe as-is — `/generate-brd` and `/generate-prd` are expensive and each attempt bills Vertex AI, and CV parsing at upload.ts:132 is non-idempotent from the caller's perspective. The retry half of the policy should be applied selectively (or restricted to connection-level failures) even where the breaker and timeout are applied universally. Retries changing cost and latency profile needs owner sign-off.
- **Verifier correction:** Severity high -> medium, and one sub-claim is REFUTED: 'CLAUDE.md's jitter requirement is also unimplemented — ExponentialBackoff is constructed without a jitter generator'. I read node_modules/.bun/cockatiel@3.2.1/.../backoff/ExponentialBackoff.d.ts:5-14 and .js:6 — the generator option defaults to decorrelatedJitterGenerator, explicitly documented as 'a good default for most scenarios'. Jitter is already applied; the proposed 'add jitter to the backoff' step is a no-op and should be dropped from the fix. The severity downgrade is because the gap is uniform absence of protection on calls that already fail closed (unavailable() at document-generation.ts:44, thrown Error at payment-client.ts:52), not a partially-applied policy that masks failures. The serviceFetch consolidation remains the right fix and is correctly identified as the highest-leverage single refactor in this dimension.

### [LOW] JetStream streams are provisioned only in prod compose; a missing stream degrades to a logged warning and silent event loss
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/gateway/nats-init-streams.sh is thorough and correct — it creates all 8 streams with per-stream retention, `--dupe-window 2m`, and an `ensure_stream` function (lines 27-46) that syncs subjects on an existing stream, with a comment documenting that a prior `|| true` had silently stranded 12 event types. But it is wired into docker-compose.prod.yml:88-94 (`nats-init` service) and the Makefile only. docker-compose.yml — the dev stack — defines `nats` at :55-57 with no init service and no equivalent step. On the consumer side, apps/notification-service/internal/consumer/nats.go:176-179 calls `c.js.Stream(ctx, def.Stream)` which only looks up an existing stream, and the caller at :163-170 catches the error, logs `slog.Warn("failed to subscribe to stream")`, and `continue`s to the next stream.
- **Root cause:** Stream provisioning was correctly extracted into a script but treated as a deployment concern rather than an environment invariant, so it was attached to the prod compose file and the Makefile and never to the dev one. The consumer's tolerant startup was written to make boot ordering non-fatal and has the side effect of making a permanently missing stream non-fatal too.
- **Impact:** In dev, notification-service starts, reports healthy, and consumes nothing — six warning lines during startup are the only signal, and every event published by the outbox errors on publish (no matching stream), burns its 3 retries and lands in the DLQ. That is a slow, confusing local failure that costs developer time and, worse, trains people to ignore the warning. The same tolerance means a prod `nats-init` failure produces a service that passes its health check while silently dropping the notification pipeline; nothing distinguishes "stream not ready yet" from "stream will never exist".
- **Fix:** Add the same `nats-init` service to docker-compose.yml that prod has — it is a copy of the prod block and makes dev match prod, which is the 12-factor parity the architecture doc calls for. Separately, make the consumer's tolerance bounded: retry the stream lookup with backoff for a startup grace period (say 60s), then fail the readiness probe if any required stream is still absent, so `/ready` reflects the truth instead of returning 200 for a consumer wired to nothing.
- **Edge cases:** The `ensure_stream` update path (nats-init-streams.sh:33-38) logs a WARNING rather than failing when subject sync fails on an existing stream — the same silent-degradation shape one level up. A stream whose subject list is stale after a deploy will not be caught by CI or by the init script's exit code.
- **Verifier correction:** The dev-parity half is largely mitigated and the finding missed it. Makefile:77-83 defines a `nats-setup` target that runs the same script against the dev broker, and Makefile:85 puts it in the documented bootstrap: `setup: install docker-up db-setup storage-setup nats-setup`. A developer following the documented path gets the streams; only someone running bare `docker compose up -d` hits the described confusion. What survives at full strength is the prod half, which I verified independently: a nats-init failure yields a notification-service that passes its health check while consuming nothing, with six warn lines as the only signal. Fix accordingly — the bounded-retry-then-fail-readiness change is the valuable half; adding nats-init to the dev compose is cosmetic parity, not a bug fix.

### [LOW] packages/testing is a dead workspace member documented as shared test utilities
`CONFIRMED` · behavior-change: `False`

- **Evidence:** `ls -a packages/testing/` shows only `.turbo/`, `coverage/`, and `node_modules/` — no `src/`, no `package.json`, no source file of any kind. It is nonetheless matched by the `packages/*` workspace glob in the root package.json:5-8, and `grep -rn "@kerjacus/testing" apps packages` returns zero dependents. CLAUDE.md lists it twice as a real package: under Monorepo Structure ("packages/testing/ # Shared test utilities, fixtures, database helpers") and again under Shared Packages. It also carries a stale `coverage/` directory and a `.turbo/turbo-build.log`, so it has been part of a build graph at some point.
- **Root cause:** Scaffolded during Fase 1 alongside the other packages and never filled in, then never removed because an empty workspace member costs nothing at runtime and turbo tolerates it.
- **Impact:** Low and mostly documentary. It makes CLAUDE.md wrong about the shape of the monorepo, which matters because CLAUDE.md is the onboarding document — a new contributor looking for the fixtures it promises will find nothing and either duplicate or improvise. I checked for the duplication it would nominally cause and the evidence is weak: 9 of 74 project-service test files mock `@kerjacus/db`, which is not enough repetition to call a maintenance burden. I am not claiming meaningful duplication across the 175 test files, only that the package is dead and the docs are wrong.
- **Fix:** Delete the directory and remove both CLAUDE.md references, or add a package.json and one real helper if the DB test fixtures are genuinely wanted. Deleting is the honest default under YAGNI — the 9 files that mock the db module can share a helper when there is a tenth.
- **Edge cases:** The leftover `coverage/` directory may be picked up by aggregate coverage reporting and skew monorepo-wide numbers with a stale empty report; worth checking the coverage config before or after deleting.
- **Verifier correction:** One precision point: without a package.json the directory is matched by the glob but is not actually resolved as a Bun workspace member, so it has zero build-graph cost today — the stale .turbo/ and coverage/ are residue from when it did have one. That makes this purely a documentation defect. Deleting it and the two CLAUDE.md references is correct.

## Code Quality — duplication, coupling, dead code, testability, maintainability

_The headline hypothesis is wrong in a good way: the fee bracket table exists in exactly one place (packages/shared/src/pricing.ts) and is not reimplemented in Go or Python — I grepped all three languages for the bracket constants and only that file matched. The real defect at that seam is the opposite: because no other language knows the rates, nothing downstream can re-check them, and payment-service accepts whatever fee its caller sends. Where duplication does exist it is intra-language and structural: the project transition graph is encoded four times in one file with XState as decoration, packages/shared/src/constants.ts is a documentation module whose values are re-hardcoded at every real use site, and status literal arrays are retyped per route file with two services disagreeing on what "active" means. Testability is the weakest dimension: 32 of 123 TypeScript test files assert on source code read as a string rather than executing it, and every money test takes the platform fee as a test input rather than deriving it, so the suite cannot catch a fee regression._

### [HIGH] Platform fee crosses into Go as an unvalidated caller-supplied number; no service can re-derive it
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** packages/shared/src/pricing.ts:21-34 is the only definition of the bracket table anywhere — a grep for 0.815/0.765/0.715/0.665/0.615/0.565/0.515/0.465 across *.go, *.py and *.ts matched that file alone. computeProjectPricing has exactly one production caller: apps/project-service/src/services/work-package.service.ts:63. From there the split is persisted and every downstream consumer reads columns, never the table: apps/project-service/src/lib/settle-milestone.ts:17-60 computes the fee as Math.round(milestone.amount * workPackages.talentPayout / workPackages.amount), i.e. from stored data, falling back to projects.finalPrice/talentPayout. That number is POSTed to Go, where apps/payment-service/internal/service/payment.go:147 validates only `if in.FeeAmount < 0 || in.FeeAmount >= in.Amount` and payment.go:227 computes `talentAmount := in.Amount - in.FeeAmount`. The handler at apps/payment-service/internal/handler/payments.go:128 checks MilestoneID/ProjectID/TalentID/PerformedBy/IdempotencyKey non-empty and Amount > 0 — FeeAmount is absent from that check entirely. The route is service-auth gated (payments.go:64 `internal.Post("/release", ...)`, guard at apps/payment-service/internal/middleware/auth.go:32-36) and payments.go:131-133 explicitly delegates authorisation upstream.
- **Root cause:** The fee was correctly centralised as a TypeScript pure function, but the architecture then persists its output into projects.platform_fee / work_packages.talent_payout and treats those columns as the new source of truth. Because Go and Python have no copy of the rate table (by design), no service at any later point can ask "is this fee still what the bracket says?" The invariant that survives is only the arithmetic one (debit == credit, which payment_mock_test.go:1172 checks); the rate invariant has no enforcement point in any language. CLAUDE.md compounds this by documenting that no CHECK constraints exist — confirmed, the schema and all 22 migrations contain none.
- **Impact:** Any bug that writes a wrong talent_payout — a partially-applied transaction, an admin edit, a future backfill, a migration — silently changes the platform's take on every subsequent milestone settlement for that project, and every generated invoice, with no error and no alert. The only guard is settle-milestone.ts:52-58, which fires solely when the ratio is negative or >= 100%; a project whose payout column drifted from 66.5% to 51.5% settles quietly at the wrong rate forever. work-package.service.ts:78-86 documents this exact failure mode in its own comment and mitigates only the single-transaction case.
- **Fix:** Add a derivation check rather than a second copy of the table. (a) In computeMilestoneFee, after loading gross/payout, assert Math.abs(payout/gross - talentShareRate(gross)) is within rounding tolerance and log/alert otherwise — pricing.ts already exports talentShareRate for exactly this. (b) Give payment-service a bound it can check without knowing the table: reject FeeAmount > Amount*0.60, which no published bracket reaches (top is 53.5%) — a guard rail, not a duplicate rule. (c) Add a reconciliation query asserting sum(work_packages.talent_payout) == projects.talent_payout and projects.final_price == talent_payout + platform_fee, the invariant CLAUDE.md states but nothing enforces.
- **Edge cases:** Top bracket is 53.5% platform / 46.5% talent, so a naive "fee must be under half" guard would reject legitimate >Rp 50 juta releases. computeProjectPricing clamps the last package's payout to its own amount (pricing.ts:90-93), so a project whose final package is tiny relative to the rounding remainder can legitimately have a per-package ratio slightly off the project ratio — tolerance must account for that, not just ±1 rupiah.

### [HIGH] 32 of 123 TypeScript test files assert on source code read as a string, not on behavior
`CONFIRMED` · behavior-change: `False`

- **Evidence:** 31 test files under apps/project-service/src call readFileSync on a sibling source file and assert against its text; 25 contain a literal `expect(source)` assertion. apps/project-service/src/routes/invoice-audience-rule.test.ts:24 reads ./invoices.ts and line 45 asserts `expect(source).toContain("const WORKED_STATUSES = ['active', 'completed'] as const")` — matching the declaration character-for-character including `as const`. Lines 25-31 slice the file between function-name markers, and lines 63-76 assert on the ordinal position of the strings "return 'owner'" and "return 'admin'" within that slice. apps/project-service/src/routes/invoice-audience-access.test.ts:31 duplicates the same string assertion. The pattern also appears in rate-limit-key.test.ts, chat-write-access.test.ts, read-authorization.test.ts, talent-anonymity-allowlist.test.ts, document-paywall.test.ts and 26 others.
- **Root cause:** These guard genuinely important cross-function invariants — invoice-audience-rule.test.ts's header comment explains it precisely: two resolvers must apply the same rule, and merging them would create an N+1. Rather than extract the shared rule into a testable unit, the author pinned the textual similarity of the two implementations. The rationale for not merging is sound; the conclusion (test the text instead) is not.
- **Impact:** These tests are anti-correlated with the risk they target. Rename WORKED_STATUSES or reformat the line and the test fails though behavior is identical — noise that trains people to update the assertion string reflexively. Invert the access check inside the function, or add an `if (true) return 'owner'` short-circuit, and every one still passes because the strings remain present in the right order. For invoice audience the test's own comment names the stake — an owner's gross on a talent's copy — and the test cannot detect it. This is ~26% of the TS suite providing coverage-shaped reassurance.
- **Fix:** Extract the shared rule into a pure function both resolvers call for the decision while keeping their separate queries for the data — e.g. `isLiveAssignment(status)` and `canSeeInvoice({role, ownerId, assignedTalentId, workPackageAssignments})`, tested with a table of cases. The N+1 concern the comment raises is about the query, not the predicate, so the predicate can be shared without reintroducing it. Then delete the source-text assertions. Pure tech debt, no behavior change, but real work across 32 files — prioritise those guarding money and authorization (invoice-audience-*, read-authorization, chat-write-access, talent-anonymity-allowlist) and leave the rest.
- **Edge cases:** Some of these files test things with no runtime surface — temporal-deployment.test.ts and talents-route-order.test.ts appear to pin registration order and config, where a source assertion is defensible. Triage per file rather than blanket-deleting.

### [MEDIUM] Project transition graph is written four times in one file, and the XState machine it claims to validate against is decorative
`PARTLY_CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/project-service/src/lib/state-machine.ts encodes the same graph four times: EVENT_TO_STATUS (line 29), STATUS_TO_EVENTS (line 55), VALID_TRANSITIONS (line 77), and the XState `projectMachine` states block (lines 100-210). validateTransitionViaXState (line 265) is what project.service.ts:67 calls, but it first calls findTransitionEvent (line 222), which returns null unless VALID_TRANSITIONS[current] already includes the target (lines 228-231). XState is therefore consulted only for transitions the map has already approved — it can never reject one the map allows, nor allow one the map forbids. Lines 283-286 construct a snapshot by spreading getInitialSnapshot and overwriting `.value` with the current status, then cast the event `as unknown as ProjectEvent` (line 285) to feed it in. EVENT_TO_STATUS is exported at line 296 with zero consumers outside this file (grepped across apps/ and packages/).
- **Root cause:** XState was adopted per CLAUDE.md but status is stored as a plain enum column rather than a persisted snapshot, so there is no real machine instance to advance. Rehydrating one required hand-mutating a snapshot object, which the library does not support, so a lookup table was added to answer the question first — leaving the machine as an expensive assertion that the table agrees with itself.
- **Impact:** Four copies of one graph that must be edited in lockstep. Adding a state means touching EVENT_TO_STATUS, STATUS_TO_EVENTS, VALID_TRANSITIONS, the machine states block, and the ProjectEvent union — miss one and the failure is silent in three of five (a missing STATUS_TO_EVENTS entry makes findTransitionEvent return null, so a legal transition is rejected as illegal, surfacing as a confusing 400). The `as unknown as ProjectEvent` cast means TypeScript cannot report event-name drift. Carrying XState's runtime for a path that cannot change any outcome is pure cost.
- **Fix:** Pure tech debt, no behavior change. Derive the redundant maps from one authority: keep the XState config as the source and generate VALID_TRANSITIONS and STATUS_TO_EVENTS from `projectMachine.config.states` at module load (the code already reads that config at line 240). Delete EVENT_TO_STATUS (no consumers) and collapse validateTransitionViaXState into isValidTransition. Alternatively drop XState entirely and keep VALID_TRANSITIONS, which is what actually gates every call today. Either direction removes three of four copies; state-machine.test.ts (18-key assertion at line 211) and acceptance.test.ts:233-277 pin behavior during the change.
- **Edge cases:** in_progress is reachable via four distinct events (START_PROGRESS, RESTORE_FULL_TEAM, RESUME, RESOLVE_DISPUTE_CONTINUE); findTransitionEvent disambiguates by scanning the current state's `on` keys (lines 240-248), so any generated replacement must preserve that ordering-dependent resolution or a resume from on_hold could be logged under the wrong event.

### [MEDIUM] packages/shared/src/constants.ts is documentation, not a dependency: 8 of 18 constants have zero consumers and their values are re-hardcoded at the real call sites
`CONFIRMED` · behavior-change: `False`

- **Evidence:** Counting references across apps/ and packages/ excluding constants.ts itself: REVISION_FEES 0, AUTO_RELEASE_DAYS 0, MILESTONE_REVIEW_DAYS 0, HEALTH_WEIGHTS 0, HEALTH_THRESHOLDS 0, TALENT_QUALITY 0, RAG_CONFIG 0, RATE_LIMITS 0, FILE_LIMITS 0. The values live on regardless: apps/project-service/src/workflows/milestoneAutoRelease.ts:13 declares `const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000` instead of importing AUTO_RELEASE_DAYS (constants.ts:41); apps/project-service/src/workflows/teamFormation.ts:15 declares TEAM_FORMATION_DEADLINE_MS with the same literal instead of MATCHING_SLA.TEAM_PROJECT_DAYS (constants.ts:50); apps/project-service/src/middleware/rate-limit.ts:85-91 hardcodes `maxRequests: 100, windowMs: 60_000` and `10 / 60_000`, exactly RATE_LIMITS.STANDARD and RATE_LIMITS.AI_INTENSIVE (constants.ts:65-68). constants.ts also carries two names for the same 14 days (AUTO_RELEASE_DAYS line 41, MILESTONE_REVIEW_DAYS line 118), both unused. constants.test.ts (159 lines) asserts tautologies — line 100 is `expect(AUTO_RELEASE_DAYS).toBe(14)`.
- **Root cause:** The constants file was transcribed from CLAUDE.md up front, before the features that would consume it. Implementations landed later and reached for local literals. Nothing detects the divergence: the tautology tests pass whether or not any consumer exists, and no lint rule flags unused workspace exports.
- **Impact:** The file reads as a control surface and is not one. Changing AUTO_RELEASE_DAYS to 7 changes nothing — the real timer is milestoneAutoRelease.ts:13 — so someone tuning it would ship a no-op and believe it took effect. HEALTH_WEIGHTS, HEALTH_THRESHOLDS and REVISION_FEES have zero consumers and no implementation anywhere (grep found no health-score or revision-fee computation), so CLAUDE.md's documented Project Health Scoring and tiered revision pricing are constants without code — the file makes them look implemented.
- **Fix:** Two separable moves, both behavior-preserving. (1) Wire the constants with a real call site: import AUTO_RELEASE_DAYS in milestoneAutoRelease.ts, MATCHING_SLA.TEAM_PROJECT_DAYS in teamFormation.ts, RATE_LIMITS in rate-limit.ts; delete MILESTONE_REVIEW_DAYS as a duplicate. (2) Delete the constants whose feature does not exist (HEALTH_WEIGHTS, HEALTH_THRESHOLDS, TALENT_QUALITY, REVISION_FEES, RAG_CONFIG) or move them into the module that will own the feature, so their absence is visible. Replace the tautology assertions with tests on the consumers.
- **Edge cases:** rate-limit.ts:13 comments that the limiter is in-memory and single-instance, contradicting CLAUDE.md's "rate limiting per IP dan per user (pakai Hono rate-limit middleware + Redis)" — wiring the constant does not fix that the limiter is not production-shaped behind multiple replicas.

### [MEDIUM] Every money test takes the platform fee as an input; none derives it, and the fixtures are internally inconsistent
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/payment-service/internal/service/payment_mock_test.go:1153 calls ReleaseEscrow with `Amount: 50000, FeeAmount: 24250` and lines 1176-1183 assert the three ledger legs are 25750 / 50000 / 24250. 24250/50000 is 48.5%, the >Rp 30 juta bracket rate, applied to a Rp 50.000 amount whose bracket is 18.5%. Line 1172 asserts debit == credit — arithmetic that cannot fail for any fee the caller supplies. apps/project-service/src/services/invoice.service.test.ts:6 does `vi.mock('../lib/settle-milestone', () => ({ computeMilestoneFee: vi.fn().mockResolvedValue(0) }))`, then line 104 injects 2_425_000 against a 5_000_000 gross (48.5% again) while the same fixture's project at line 22 declares finalPrice 12_000_000 / platformFee 2_000_000 — a 16.7% rate, and a 12M project brackets at 33.5%. The test asserts subtotal + fee == total (lines 108-113), which holds for any injected pair.
- **Root cause:** The seam was drawn so the fee is an input to both the Go service and the invoice service — architecturally correct per finding 1 — and the tests were written to the seam. Because computeMilestoneFee is the only place the ratio is applied and it is mocked out in the invoice test, and because pricing.ts has no Go consumer, no test at any level composes "project priced at X" → "milestone settles at Y" and checks Y against the bracket.
- **Impact:** pricing.test.ts (118 lines) covers computeProjectPricing in isolation and settle-milestone.test.ts covers computeMilestoneFee against stubbed rows, but nothing covers the composition. A regression applying the wrong bracket at PRD time, or writing talent_payout without repricing siblings, passes the entire suite: unit tests still see correct inputs, Go tests still balance, the invoice test still sums. Fixtures encoding rates their own project data contradicts are direct evidence nobody reads these numbers as business values.
- **Fix:** Add one composition test in project-service that runs computeProjectPricing over realistic packages, writes the result through work-package.service, then calls computeMilestoneFee unmocked against those rows and asserts the fee equals amount − round(amount * talentShareRate(finalPrice)). Add a Go test asserting ReleaseEscrow rejects a FeeAmount outside a plausible band once that guard exists (finding 1). Correct the fixture rates in payment_mock_test.go:1153 and invoice.service.test.ts:22/104 so a reader can check them against the bracket table.
- **Edge cases:** invoice.service.test.ts:130 covers the fee==0 branch, which is also the branch settle-milestone.ts:52-58 falls into on implausible data — so a corrupted-ratio project produces a full-gross talent invoice and the existing test says that is correct. Any composition test needs a case distinguishing legitimate zero-fee from the error fallback.

### [MEDIUM] The web-to-service boundary is fully untyped: apiFetch<T = unknown> at 46 call sites, and hono/client is not a dependency at all
`CONFIRMED` · behavior-change: `False`

- **Evidence:** apps/web/src/lib/api.ts:16 declares `export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T>` and line 42 returns `res.json() as Promise<T>` — an unchecked cast of whatever the network returned. There are 46 apiFetch/apiUrl call sites across apps/web/src. apps/web/package.json lists no `hono` dependency and no dependency on any service package; only `@kerjacus/shared` (types/schemas/enums) is shared. `hc(` appears nowhere in apps/web/src or apps/admin/src — verified by direct grep of both package.json files and api.ts. CLAUDE.md states "hc() dari hono/client ada tapi tanpa AppType generic" and its Service Map claims "Frontend -> Service: semua user-facing API calls via hono/client (type-safe RPC, zero codegen)" — both describe a client that is not present.
- **Root cause:** The type-safe RPC plan was documented but never adopted; a plain fetch wrapper was written instead and the docs were not corrected. Because apiFetch's type parameter defaults to unknown and is supplied by the caller, each call site independently declares what it believes the endpoint returns, with nothing checking that belief against the Hono route serving it.
- **Impact:** Any response-shape change in project-service — renaming a field, moving it under `data`, making it nullable — compiles clean on both sides and fails at runtime in the browser, typically as an undefined render rather than a caught error. Blast radius is the 46 call sites plus every component consuming their return types. This is also where CLAUDE.md is most misleading to a new contributor: it promises IDE autocomplete across the wire that does not exist.
- **Fix:** Two options with very different cost. Cheap and immediately valuable: validate at the boundary with the Zod schemas already in packages/shared — have apiFetch accept an optional schema and parse rather than cast, starting with money and project-status endpoints. Expensive but complete: export AppType from project-service and adopt hc<AppType>() as documented, which requires web to depend on the service package. Either way, correct CLAUDE.md — the current text asserts a guarantee the code does not provide.
- **Edge cases:** apiFetch already special-cases 401 by importing the auth store and hard-navigating (lines 27-35), and apiFetchSafe swallows 401 into null (line 51). Adding schema validation must not turn a 401 body into a parse error before that handling runs.

### [MEDIUM] Status literal arrays are retyped per route file, and two services disagree on what an "active" project is
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** packages/shared/src/enums.ts is the declared single source of truth (line 32 ProjectStatus, line 63 AvailabilityStatus) and lines 22-24 even carry a comment about a past bug caused by a hardcoded option list. Route files bypass it: apps/project-service/src/routes/talents.ts:9 and routes/talent-profiles.ts:56 each declare `const availabilityValues = ['available', 'busy', 'unavailable'] as const`, duplicating AvailabilityStatus twice; routes/disputes.ts:20 declares disputeStatusValues duplicating packages/db/src/schema/project.ts:92 disputeStatusEnum; routes/applications.ts:19, routes/contracts.ts:17, routes/reviews.ts:11, routes/work-packages.ts:24 and routes/chat.ts:20 follow the same pattern. More consequential: routes/talent-profiles.ts:279 defines an active project as `['in_progress', 'review', 'partially_active']` while apps/admin-service/internal/store/finance.go:69-77 defines activeEscrowStatuses as matched, in_progress, partially_active, review, disputed, on_hold — six statuses. Separately, routes/disputes.ts:25 holds a second, independent transition map injected as a parameter into services/dispute.service.ts:56.
- **Root cause:** Zod's z.enum wants a readonly string tuple while the shared enums are `as const` objects keyed by SCREAMING_CASE, so deriving the tuple takes an extra line. Each route author took the shorter path. The active-project divergence is different in kind: nobody wrote down what "active" means, so each service invented a list fitting its own question — talent workload versus escrow exposure.
- **Impact:** The literal duplication is maintenance drag with a real failure mode: adding a project or dispute status updates the DB enum and packages/shared but silently leaves seven route validators rejecting it as invalid input. The Go/TS active-status divergence is worse because both lists are plausible and the difference is invisible — a talent shown as having 0 active projects (talent-profiles.ts:279 excludes matched and on_hold) can hold escrow the admin finance page counts as live, so pemerataan_skor and the finance dashboard tell different stories about the same talent.
- **Fix:** For the literals: add a helper in packages/shared turning each const object into the readonly tuple z.enum needs, and replace the seven local arrays — pure tech debt, no behavior change. For the divergence: this needs an owner decision, not a refactor. Name the two concepts separately (e.g. TALENT_WORKLOAD_STATUSES and ESCROW_EXPOSURE_STATUSES), decide each membership deliberately, and have Go read the same list rather than maintaining its own — since Go cannot import the TS package, that means a generated constant or an accepted, commented duplication with a test pinning both.
- **Edge cases:** Whether 'matched' counts as active changes the pemerataan_skor denominator (CLAUDE.md's formula uses proyek_aktif * 2), so unifying the lists shifts matching recommendations — precisely why it needs sign-off rather than a silent fix.

### [LOW] Team-size business rule is duplicated inside ai.py and contradicts the algorithm CLAUDE.md documents
`PARTLY_CONFIRMED` · behavior-change: `True`

- **Evidence:** apps/ai-service/app/routes/ai.py:54 declares `MAX_TEAM_SIZE = 8`, duplicating packages/shared/src/constants.ts:52 `export const MAX_TEAM_SIZE = 8` with no sync mechanism between the two languages. The sizing formula `team_size = max(1, min(MAX_TEAM_SIZE, timeline // 30))` appears twice verbatim — ai.py:553 in the BRD fallback and ai.py:862 in the PRD fallback. CLAUDE.md specifies a different rule: "team_size = ceil(total_estimated_hours / (timeline_days * working_hours_per_day)). Minimum 1, maximum 8". The implemented formula never reads estimated hours at all; it is one talent per 30 days of timeline. CLAUDE.md's own worked example (800 man-hours, 2 months → ~3 talents) yields 2 under the implemented formula.
- **Root cause:** The fallback paths were written to be cheap and total (never fail when the LLM does), and a timeline-only heuristic is the simplest thing returning an integer. The documented hours-based formula presumably lives in the LLM prompt rather than in code, so the fallback silently substitutes a different business rule. Nothing tests the fallback against the spec, and MAX_TEAM_SIZE has no cross-language contract.
- **Impact:** Team size drives work-package decomposition, which drives per-package pricing, which drives the fee bracket — so a fallback that under-sizes the team propagates into money. Because it fires only when the LLM call fails, it is the path least likely to be noticed in normal operation and most likely to be hit during an outage. The duplicated MAX_TEAM_SIZE means raising the cap in TypeScript leaves Python clamping at 8, with no test or type error.
- **Fix:** (a) Deduplicate the formula into one module-level helper in ai-service called from both 553 and 862. (b) Decide which rule is true and make code and CLAUDE.md agree — if the hours-based formula is intended, the fallback needs an hours estimate to work from, which is an owner decision, not a refactor. (c) Export MAX_TEAM_SIZE from a single place both runtimes read — realistically a small generated constants file or an env var, since Python cannot import the TS package.
- **Edge cases:** ai.py:862 reads `brd.get("estimated_team_size", <formula>)` — when the BRD already carries a team size the formula is bypassed, so the two call sites are not equivalent and cannot be blindly collapsed without preserving that default-argument semantics.

### [LOW] packages/testing is an empty phantom workspace; seed.ts is 6223 lines of demo data, not duplicated fixtures
`CONFIRMED` · behavior-change: `False`

- **Evidence:** packages/testing contains only .turbo/, coverage/ and node_modules/ — no package.json, no src, zero source files — yet it is matched by the `packages/*` workspace glob in the root package.json and CLAUDE.md lists it as "shared test utilities, fixtures, database helpers". It has produced coverage output (packages/testing/coverage/lcov.info), so it has been built at least once. On seed.ts: it is not logic duplication. It imports computeProjectPricing and the bracket exports from @kerjacus/shared at lines 1-5 and routes all pricing through helpers `priced()` (line 56) and `pkg()` (line 64), with a final repricing pass at line 2529 — so it cannot drift from pricing.ts. Sampling lines 1700-1790 shows the bulk is literal Indonesian demo content (makeBrd calls with executive summaries, objectives, feature lists per project). Nothing imports it: grep for `from './seed'` and for its fixed UUID prefix `00000000-0000-7000-8000-` across all test files returns zero hits outside seed.ts; it is invoked only via the `seed` script in packages/db/package.json. Only 8 of 123 TS test files touch a real database at all.
- **Root cause:** packages/testing was scaffolded per the documented monorepo layout and never filled; the 175 test files each build their own inline fixtures instead (24 vi.mock calls in project-service alone). seed.ts grew large because it seeds a demo environment for 12+ projects with realistic Indonesian copy — its size is data volume, not repetition of behavior.
- **Impact:** Low but non-zero: the empty package is a turbo task target resolving to nothing, and its presence in CLAUDE.md tells contributors shared test helpers exist when they do not, so the next test file will also inline its fixtures. seed.ts's size makes it slow to navigate but it is doing its job correctly and is the one place outside pricing.ts that correctly consumes the pricing function. Moving it into packages/testing would be wrong — it seeds a demo environment and no test depends on it.
- **Fix:** Delete packages/testing and its CLAUDE.md entry, or actually populate it — a declared-but-empty workspace is the worst of the three. Leave seed.ts where it is; if its size becomes a real problem, split the demo content by domain (users, projects, documents, payments) into sibling modules a single seed() orchestrator calls, keeping the priced()/pkg() helpers shared. Both are pure tech debt.
- **Edge cases:** seed.ts:76-89 TRUNCATEs 40 tables CASCADE on every run, so if it were ever wired into a test harness against a shared database it would destroy concurrent test state — another reason to keep it out of packages/testing.
