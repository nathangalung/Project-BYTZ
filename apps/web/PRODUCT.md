# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences of equal priority, served by one application with a split entry point. Neither is the default reader; the landing surface forks into two paths rather than optimizing for one.

**Project owners (Pemilik Proyek).** Indonesian UMKM operators, startup founders, and organizations that need a digital product built — web app, mobile app, UI/UX design, or data/AI work. They arrive with a business need and usually without the vocabulary to specify it technically. They are deciding whether to trust a platform with money and a project outcome, not comparing feature lists.

**Talents (Talenta).** Indonesian software, design, and data practitioners across all experience levels — including people with no completed platform projects yet. They arrive to find work and to be judged on competence rather than reputation. Junior and unproven talents are a first-class audience, not an edge case: the distribution system exists specifically to give them projects.

Both roles operate in Indonesian by default. Owners and talents never communicate outside the platform before a deal, and talent identity stays anonymous to owners until a deal closes.

## Product Purpose

KerjaCUS! is a managed marketplace for digital projects in Indonesia — a curated "virtual software house" rather than an open freelancer board.

An owner submits a project need. The platform runs an AI scoping conversation, produces a BRD, and then optionally a PRD with team composition, work-package decomposition, and pricing. The owner can stop and buy just the BRD, stop and buy just the PRD, or continue into full delivery, where the platform matches talents per work package, holds funds in escrow, and manages milestones to completion.

Success means an owner who could not write a technical spec ends up with either a usable document or delivered software, and a talent who has no track record still receives real, paid work.

## Positioning

The platform curates and prices the work instead of hosting a bidding war, and it deliberately redistributes projects instead of concentrating them on top-rated talents.

Three mechanisms a neighboring product could not truthfully copy without changing what it is:

- **Documents are a sellable product, not a funnel step.** An owner can buy the BRD or PRD and leave. The exit is designed, not tolerated.
- **Distribution is engineered against reputation lock-in.** Ratings and tiers are internal-only and invisible to both sides. The recommendation score weights fairness (0.35) above skill match (0.30) and rating (0.15), with 30% of recommendation slots reserved for exploration. Talents with zero projects score highest by construction.
- **No vetting gate.** Verification is CV parsing only — no skill test, no probation period — because both create barriers that filter out competent people who test poorly or are simply new.

Against the field: Gigster is closed and priced beyond this market; Upwork has no curation and no price discipline; Toptal admits only a top slice; Projects.co.id has no AI scoping, no standard documents, and no ML matching.

## Operating Context

Owner path: multi-step project wizard → AI scoping chat (streaming, completeness score 0-100) → scope summary confirmation → BRD review and revision via chat → decision point → PRD review → decision point → anonymous talent review → escrow funding → milestone monitoring via Gantt, time logs, and the milestone board → approval and release → internal rating.

Talent path: registration with CV upload (PDF/DOCX/PPTX) → automated parsing and cross-validation against manual input → verified status → skill-matched project feed → one-click apply or receive a work-package offer → accept or decline → milestone execution with time tracking → submission and revision cycles → payout per milestone.

Money moves through escrow only, per work package, released per milestone with a 14-day auto-release if the owner goes silent. Every release generates three invoice copies with one invoice number: owner sees gross, talent sees payout, only admin sees the fee.

Team projects change the shape of every screen: multiple talents per project, per-package escrow, swimlane Gantt, group and per-talent chat, integration milestones requiring several submissions, and partial cancellation that keeps the rest of the project running.

## Capabilities and Constraints

Confirmed and built:

- Project lifecycle as an 18-state machine (XState v5), every transition logged for audit
- AI scoping chat, BRD generation, PRD generation with team composition and dependency DAG, CV parsing — all on glm-5.3
- Rule-based talent matching with epsilon-greedy exploration; ML matching is planned, not built
- Escrow with double-entry ledger, milestone release, refunds, revision fees, dispute freeze
- Gantt chart, time tracking, milestone board, invoice PDF generation
- 35 routes, i18n across 9 namespaces in Indonesian and English

Constraints that design must respect:

- **Rupiah only.** No multi-currency.
- **Pricing is derived, never entered.** Project price is the sum of work-package amounts; the fee bracket is chosen once at project level from that total; talent payout and platform fee are splits of it. The invariant `final_price = talent_payout + platform_fee` holds everywhere. Owners see one final price.
- **Fee brackets are locked in code** (`packages/shared/src/pricing.ts`) and shown read-only in admin (`apps/admin/src/routes/_authenticated/settings.tsx` imports `PLATFORM_FEE_BRACKETS` directly). There is no margin-editing UI.
- **The authoritative fee schedule is fee-primitive and RISES with project size**: 18.5% ≤3jt, 23.5% ≤5jt, 28.5% ≤10jt, 33.5% ≤15jt, 38.5% ≤20jt, 43.5% ≤30jt, 48.5% ≤50jt, 53.5% >50jt — blended ≈37.7% on the projected mix. The project price is the primitive (sum of work-package amounts); the bracket is chosen once from the project total and splits it into talent payout and platform fee. Locked by the platform owner 2026-07-25 (`5f4b0cd`), which superseded the payout-primitive declining-markup model (`796cc6e`). Design must not describe the fee as declining with project size, and must not present the declining schedule as current. `KerjaCUS!_Financial_Projection_2026-2030.xlsx` models this locked schedule as its base case (verified 2026-07-26); the declining 21.3% schedule survives there only as a labeled downside scenario, and the earlier `FINANCIAL-AUDIT.md` that treated the rising bracket as a defect has been removed.
- **The fee is a deduction from the project price, not a markup on top of it.** Talent still receives 100% of the payout they are quoted, so the fee-transparency commitment below is unaffected — but copy must not describe the owner price as "payout plus fee."
- **Ratings, reviews, and tiers are internal.** They must never appear on a public profile, a matching card, or anywhere an owner or another talent can read them. A talent sees only their own rating.
- **Anonymity before deal.** Owners see competence — CV summary, portfolio cards, verified badges, endorsed skills — and never a name, a rating, a tier, or a portfolio link, because links carry real names and off-platform contact.
- **Team size caps at 8.** The platform is not ready to coordinate more.
- **Web only.** Responsive web; no native app in scope.
- **Dark mode is implemented in this app** (verified 2026-07-26): `src/stores/theme.ts` resolves `light`/`dark` from localStorage then `prefers-color-scheme`, toggling a `.dark` class on `<html>`; `src/styles.css:185+` carries the `.dark` token block and `html.dark` component overrides. Both themes are therefore live surfaces and new UI must be checked in each. `apps/admin` has no dark mode — see that app's record.

## Brand Commitments

- **The product is named KerjaCUS!** in every user-facing surface, exclamation mark included. `BYTZ` is the repository and package namespace only and must never appear in the UI.
- **Indonesian first.** `id` is the default locale and the source of voice; English is a translation of it, never the origin of tone. Every user-facing string goes through `t()`.
- **Fee transparency is a commitment, not copy.** "Talents keep 100% of their quoted amount; the platform service fee is included in the project price." This framing is binding and must not be reworded into something that implies a deduction from the talent.
- **Terminology is fixed** in Indonesian: Talenta (service provider), Pemilik Proyek (project owner). Code and database keep `talent` / `owner`.
- Logo is **not** finalized. `public/svg.png` and `public/favicon.svg` exist but are open to replacement, repositioning, and extension — a stronger mark, better placement in the web shell, and small/square variants are explicitly wanted.

## Evidence on Hand

The application is built end to end and runs, but **no part of it is in production and there are no real users**. Every external dependency is on a sandbox or trial footing: Midtrans is in sandbox, the LLM runs on trial credentials, and storage/infra are self-hosted development instances.

Consequences that bind all future design work:

- **There are no real testimonials, case studies, customer logos, press mentions, or completed projects.** The landing page reads reviews from `/api/v1/reviews/public` and metrics from `/api/v1/projects/stats`; against a fresh database these are empty or seeded. Nothing may be invented to fill them — empty states are the honest answer until real data exists.
- **No verifiable performance, volume, payout, or satisfaction claims.** No "1,000+ projects delivered," no "trusted by," no fabricated ratings.
- What genuinely exists as evidence: the working product itself, the documented fee table, the transparent pricing mechanism, the fairness algorithm, and the document deliverables. Design should demonstrate the mechanism rather than assert traction.
- Assets present: `public/preview.png` (OG image), `public/favicon.svg`, `public/svg.png`, plus `public/robots.txt` and `public/sitemap.xml`. Incumbent token system in `src/styles.css` (292 lines, light + dark blocks); **12** hand-rolled UI primitives in `src/components/ui` (badge, button, card, document-watermark, empty-state, error-boundary, input, language-choice, modal, skeleton, tabs, toast) inside ~48 component files total, the rest being feature composition under `components/project`, `components/talent`, and `components/layout`. Verified 2026-07-26; an earlier draft of this record said 15 primitives, which was wrong.

## Product Principles

1. **The platform carries the complexity, the user carries none of it.** AI computes team size, decomposes work packages, and derives pricing; the user confirms rather than configures.
2. **Fairness is the product, so it must be visible as procedure.** Talents should be able to understand how distribution works. Procedural fairness retains people who did not win a given project.
3. **Competence over reputation.** Anonymity, internal-only ratings, and no vetting gate all serve one rule: judge the work, not the name or the score.
4. **Every exit is a legitimate product.** An owner who buys only a BRD is a satisfied customer, not a lost conversion. Never design the document paths as dead ends or dark-pattern them toward full delivery.
5. **Claim nothing that is not true yet.** With no users and no track record, credibility comes from showing the mechanism, the documents, and the escrow guarantees — never from manufactured social proof.

## Accessibility & Inclusion

WCAG 2.1 AA is the required standard, already reflected in the token palette: brand coral (#e59a91), cream (#f6f3ab), and green (#9fc26e) fail text contrast and are restricted to backgrounds, badges, fills, and icons — never body text. Body text is #3b526a (5.8:1), headings #1f2e3d (12.1:1).

Additional product-specific requirements: 44×44px minimum touch targets; visible focus rings on every interactive element; `prefers-reduced-motion` and `prefers-contrast` honored; complex components (Gantt chart, kanban board) need text or table alternatives for screen readers, since the visual form alone is unreadable to them.

Audience reality: many owners are non-technical and many users are on mid-range Android devices over mobile networks in Indonesia. Weight, clarity, and readable defaults matter more than density.
