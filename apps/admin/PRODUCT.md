# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Internal KerjaCUS! staff only. Not owners, not talents, not the public. Access is a separate application on its own port (5174, `admin.bytz.id` in production) with its own login that validates `role=admin`; every admin-service request re-checks the session and role.

The staffing model is **explicitly undecided**. It is not yet settled whether one person handles disputes, finance, user moderation, and infrastructure together, or whether those become separate roles. Design work must not assume a role split that does not exist, and must not hard-code a single-operator assumption either. Until this is decided, prefer surfaces that work for one person switching contexts and would not need rebuilding if roles are later separated.

## Product Purpose

The operational control surface for the marketplace: see what is happening, and intervene when it goes wrong.

Two distinct jobs live here. **Monitoring** — project volume and status, revenue by stream, talent utilization and distribution fairness, matching performance, AI cost, dispute rate, platform health. **Intervention** — mediate and decide disputes, suspend or verify users, reassign talents, adjust project status, process refunds, and re-process failed events from the dead-letter queue.

Success is that a problem is noticed before the affected owner or talent has to report it, and that resolving it takes one screen rather than a database console.

## Positioning

This is not a product sold to anyone. Its job is to make the platform's promises enforceable: escrow that actually releases, disputes that actually get decided inside the stated 3-step / 10-working-day process, and a distribution algorithm whose fairness can be observed rather than asserted.

The admin panel is also the only place the platform's economics are fully visible. Owner invoices show gross, talent invoices show payout, and only the admin copy shows the fee. That asymmetry is deliberate and this surface is the single point where the whole picture exists.

## Operating Context

Eight authenticated surfaces: dashboard, users, projects, finance, disputes, DLQ, audit log, settings. Plus an unauthenticated login route (`routes/index.tsx`) and two layout routes (`__root.tsx`, `_authenticated.tsx`) — 11 route files in total. Verified 2026-07-26; an earlier draft of this record said "eleven surfaces, all authenticated," conflating the file count with the surface count and overlooking that the login route cannot be authenticated.

- **Dashboard** — BI aggregates queried live against base tables, not materialized views (those were designed but removed in migration 0014). Line, bar, funnel, heatmap, and pie charts via Recharts.
- **Disputes** — the highest-stakes surface. Evidence from both sides, mediation chat, and a binding decision that moves real money one of three ways: to talent, to owner, or split.
- **Finance** — transaction log, escrow balances, payout history, refunds, revenue by stream. Backed by a double-entry ledger where every movement must sum to zero.
- **DLQ** — failed NATS events after max retries, with re-processing. Infrastructure work, not business work.
- **Audit log** — every admin action recorded with before/after values. Admins are accountable to this record.
- **Settings** — matching weights, exploration rate, auto-release timer, AI model configuration. Fee brackets appear here **read-only**, because they are locked in `packages/shared/src/pricing.ts` and the engine reads the constant, not the setting.

Work here is reactive and alert-driven: overdue projects, health-score drops, new disputes, inactive talents, DLQ failures.

## Capabilities and Constraints

Built: React 19, TanStack Router, TanStack Query, Zustand v5, Tailwind v4, Recharts v3, i18n (id/en). Backed by admin-service (Go 1.25 + Fiber v2 + pgx v5). Eight authenticated surfaces plus a login route; 11 route files.

Current state worth naming honestly: there is **no shared component layer** in this app — no `src/components` directory at all. Routes inline their own markup, and `styles.css` is 73 lines against the main app's 292. Consistency across surfaces is therefore unenforced today.

Constraints:

- **Admin actions are consequential and mostly irreversible.** Suspending a user, resolving a dispute, releasing or refunding escrow, and reassigning a talent all affect real balances and real accounts. Destructive actions need confirmation and must be distinguishable at a glance from routine ones.
- **Every action is audited.** Nothing here is a private action.
- **Fee brackets are read-only.** There is no margin editing, by design.
- **Internal ratings and tiers are visible here and only here.** They must never leak into anything an owner or talent can see.
- **Dashboard queries hit base tables directly.** Slow queries are a real risk as data grows; density decisions should not assume unlimited query budget. (Confirmed: migration `0014_early_violations.sql` drops `mv_ai_cost`, `mv_matching_metrics`, `mv_project_overview`, `mv_revenue_daily`, and `mv_talent_stats`.)
- **The authoritative fee schedule is fee-primitive and RISES with project size**: 18.5% ≤3jt through 53.5% >50jt, blended ≈37.7%. Locked 2026-07-25 (`5f4b0cd`), superseding the payout-primitive declining model (`796cc6e`). The settings surface renders this table read-only straight from the `PLATFORM_FEE_BRACKETS` constant, so the eight bracket rows shown to admins are the code's rows — a schedule change is a deploy, not a settings edit. The financial workbook now models this locked schedule as its base case (verified 2026-07-26).
- **No dark mode in this app.** `apps/web` implements it (theme store plus a `.dark` token block); this app's `styles.css` has no dark treatment. New admin UI is therefore light-only today, and any move to match the main app is net-new work, not a token swap.
- **Single i18n namespace.** All copy lives in one `admin.json` per locale, against the main app's nine namespaces. Fine at current size; worth splitting if this app's surface count grows.
- Undecided: staffing model and role separation.

## Brand Commitments

- **KerjaCUS!** is the product name here too. `BYTZ` must never appear in the UI.
- **KNOWN VIOLATION of the line above, open as of 2026-07-26.** `BYTZ` is currently rendered to admin users in four translation keys, in both locales (`src/locales/en/admin.json` and `src/locales/id/admin.json`): `overview` ("BYTZ platform overview" / "Overview platform BYTZ"), `admin_panel` ("BYTZ Admin Panel"), `login_subtitle` ("For BYTZ administrators only" / "Hanya untuk administrator BYTZ"), and `user_management_desc` ("Manage all BYTZ platform users" / "Kelola semua user platform BYTZ"). `apps/web` is clean — the leak is confined to this app. Any work touching these surfaces should replace `BYTZ` with `KerjaCUS!`; do not propagate the repository name into new copy.
- **Dual language, same as the main app.** Every static UI string — labels, navigation, table headers, statuses, buttons, empty states, errors, confirmations — goes through `t()` and is available in both Indonesian and English, with a language switcher matching the main app's.
- **Dynamic and user-generated content is never translated.** Chat messages, dispute evidence, BRD/PRD document bodies, user-submitted names and descriptions, and similar variable content render exactly as authored, in whatever language they were written. Do not build translation affordances around them.
- Visual identity follows the main app's token system; this is the same product wearing a working uniform, not a separate brand.

## Evidence on Hand

No production deployment and no real users. Sandbox Midtrans, trial LLM credentials, development infrastructure. Consequently there is no real dispute history, no real transaction volume, no real utilization data, and no real audit trail.

Every dashboard, chart, and table in this app will render against empty or seeded data for the foreseeable future. **Empty and sparse states are the primary state here, not the exception**, and they must be designed as the normal case rather than treated as a temporary condition to be filled with placeholder numbers. Do not fabricate metrics to make screenshots look alive.

## Product Principles

1. **Notice before being told.** The panel earns its existence by surfacing problems ahead of complaints — overdue milestones, health-score drops, stalled matching, failed events.
2. **Consequence must be legible.** Money-moving and account-affecting actions look and behave differently from navigation and filtering. No irreversible action shares a visual weight with a benign one.
3. **Show the number and the evidence together.** An admin deciding a dispute or a refund needs the underlying records in the same view, not a number that must be trusted.
4. **Empty is the honest default.** With no traffic, most views are empty most of the time. Design for that state first.
5. **Do not encode a staffing model that has not been decided.** Build surfaces that serve one operator now without foreclosing a role split later.

## Accessibility & Inclusion

WCAG 2.1 AA, same standard and same palette constraints as the main app: brand coral, cream, and green are background/badge/icon colors only and never body text; body #3b526a, headings #1f2e3d.

Specific to this surface: staff spend long sessions in dense tables, so text sizing, row scanning, and keyboard navigation matter more than in the main app. Status must never be conveyed by color alone — dispute state, project health, and transaction state each need a label or icon alongside the color, both for color-vision deficiency and because these distinctions carry financial consequence. Charts need accessible text or table alternatives; a Recharts canvas is unreadable to a screen reader on its own.
