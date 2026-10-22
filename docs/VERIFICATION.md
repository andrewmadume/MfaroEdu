# Verification record

Date: 6 October 2026

## Phase 5 finance — 22 October 2026

- Release version 0.5.0. All 17 migrations apply in embedded PostgreSQL; the new migration was scaffolded with the official Supabase CLI (2.121.0), using a workspace-local CLI configuration directory after Windows denied its default location. The downloaded binary archive's SHA-512 matched the official npm integrity value.
- 34 unit tests pass, including exact amount parsing, signed formatting, 0/2/3 decimal precision, unsupported notation, fractional overflow and maximum amount boundaries.
- 158 PostgreSQL assertions pass across the foundation (25), people (48), academics (44) and finance (41) suites. Finance coverage includes minimal accountant lookups, hidden private learner profiles, tenant/role/link access, eligibility, fee versions, dates, integer totals, immutable documents, currency locking, idempotency, overpayments, optimistic conflicts, concessions, reversals, voids, read-only ledger, period reports, statement pagination/snapshot consistency, backdating, audit, anonymous denial and immediate membership revocation, and document numbering beyond six digits.
- The complete browser suite passes 38 checks on desktop/mobile: 30 existing cases plus 8 finance cases. Finance checks cover exact fee setup, invoice issue, partial bank payment, bursary, receipt/statement printing, report totals, parent read-only controls, retained conflict input and overflow. Browser tests use synthetic Supabase protocol fixtures; they do not verify a hosted service.
- Strict TypeScript and the production/PWA build pass. Desktop/mobile finance layouts and receipt print-media rendering were inspected; the logo retains its white backing and the existing brand palette.
- Phase 4 remains an unfinished draft with no deployed migration or acceptance. Its navigation/routes/resources are disabled and its schema is stored only under `docs/drafts`, outside the migration directory.
- The connected MfaroEdu project was inspected and was inactive. No hosted migration was applied, project resumed, external payment attempted or real record created. Hosted Auth/JWT/PostgREST, security/performance advisors, real concurrent clients and device printing remain acceptance tasks. Official Supabase RLS/grant documentation was consulted; the changelog markdown endpoint could not be retrieved in this environment.

## Phase 3 refinement — 12 October 2026

- Version 0.3.1 adds migration 0016; all 16 migrations execute successfully in embedded PostgreSQL.
- Draft scores can be reset to an explicit incomplete status through the existing authorized, optimistic, atomic mark RPC. The record and audit history remain; incomplete draft totals block publication and existing published reports are unchanged.
- Assessment and result term pickers are scoped to the selected class year. Changing class/subject clears the old term. Grading confirmation survives the refreshed editor and clears when the form changes.
- 30 unit tests and 117 PostgreSQL assertions pass (25 foundation, 48 Phase 2, 44 Phase 3). New database tests cover incomplete resets, publication blocking, unchanged family reports, stale reset rejection and recapture.
- 30 desktop/mobile browser checks pass, including term-option filtering, persistent save feedback and clearing/recapturing a score. Strict TypeScript and the production/PWA build pass.
- Supabase integration remains pending; no real school records or external services were used.

## Phase 3 verification — 10 October 2026

- All 15 versioned migrations execute in embedded PostgreSQL.
- Strict TypeScript and production/PWA builds pass. Release version: 0.3.0.
- 29 unit tests pass, including school grading configuration, boundaries, mark validation and academic summaries.
- 113 PostgreSQL assertions pass: 25 foundation, 48 Phase 2 and 40 Phase 3. New coverage includes exact assigned-subject access, protected unpublished marks/totals, weighted results, absence/exemption, atomic conflict rejection, historical enrollment protection, stale publication previews, snapshot immutability, parent/self access, withdrawal, republication and annual weighting.
- The complete desktop/mobile browser suite passes 28 cases. Phase 3 covers assessment creation, grading configuration, teacher capture, unsaved/conflicting marks and reload, principal comments/promotion, preview/publication/withdrawal, family reports, annual summaries, individual printing and class printing.
- Chromium PDF output inspected using Poppler. Individual report: one A4 page; two-learner class batch: two A4 pages. Logo, subject marks, comments and learner information render without clipping. Browser print output remains subject to the user's printer/dialog settings.
- Desktop and mobile renders inspected. The logo header retains the requested white backing after removal of `#b1f2ff`.
- No external dependencies were added for Phase 3. Demo seed includes configurable example grading and a draft assessment; it is guarded to local Supabase and was not executed here.

The local Windows sandbox initially prevented execution; it recovered before this implementation. No Supabase URL/public key was provided, so hosted Auth/JWT, PostgREST, email and live multi-client acceptance remain unverified. All browser records are test fixtures, not production mock data.

## Phase 2 verification — 7 October 2026

- All ten versioned migrations execute in embedded PostgreSQL.
- Strict TypeScript typecheck and final production/PWA build pass.
- 19 unit tests pass (11 foundation and 8 directory/schema tests).
- 73 PostgreSQL assertions pass: 25 foundation checks and 48 Phase 2 checks. Coverage includes tenant foreign keys, assigned-teacher/linked-parent/self-learner RLS, prohibited writes, revoked links, duplicate identifiers, term boundaries, capacity, enrollment overlap, retained history, promotion, stale writes and audit protection.
- The full browser suite passed 20 desktop/mobile cases. After improving fixture response headers and dialog focus restoration, all 6 Phase 2 browser cases were rerun successfully. The expanded administrator workflow also creates a teacher and teaching assignment, and asserts the saved enrollment is displayed.
- Desktop/mobile Phase 2 screenshots inspected. At this stage the requested `#b1f2ff` logo backing was used; it was subsequently removed at the user's request. Current headers use white.
- Updated local-only demo seed, workflow guide, roadmap and README. The demo seed still requires a real local Supabase instance to execute.

These tests use embedded PostgreSQL and synthetic browser fixtures. They do not establish that hosted Auth or PostgREST has been verified. No real learner records were used.

## MfaroEdu branding update

Applied the supplied logo without altering its source bytes (SHA-256 equality verified). Updated the application name, navigation, authentication screen, dashboard, favicon, PWA identity and blue/cyan/green/gold palette. Added migration `0004_mfaroedu_brand.sql` for new-school defaults. Production build/typecheck, all 25 database assertions and all 14 desktop/mobile browser checks passed after the branding change. Inspected desktop/mobile dashboard and sign-in renders; placed the original logo on white where needed to retain wordmark contrast.

## Executed successfully

- TypeScript strict typecheck.
- Vite production build with route splitting and generated PWA service worker/manifest/icons.
- 11 unit tests: exact permission checks, invalid school identifiers, currency codes, time zones, branding, email and password validation.
- All three migrations applied in order to embedded PostgreSQL (PGlite).
- 25 database assertions: cross-school reads and writes, prohibited role escalation, direct table/role mutations, school updates, stale versions, time zones, audit creation and protection, teacher restrictions, profile column protection, revoked membership, inactive accounts, unverified school creation and anonymous access.
- 12 browser workflow checks across desktop (1440 px) and mobile (390 px): connection setup state, roadmap, unknown routes, overflow checks, school settings writes, teacher navigation/direct-route protection, mobile menu and logout token removal.
- 2 additional production PWA checks passed after the service-worker correction: offline public shell reload on desktop and mobile (14 passing browser checks in total).
- Desktop/mobile authenticated dashboard screenshots inspected; no clipped content or horizontal overflow observed. Authenticated browser tests use synthetic network fixtures and do not claim live Supabase integration.
- Production npm dependency audit: zero reported vulnerabilities at verification time.
- Application started locally using the production preview server.

## Corrections made during verification

- Corrected audit trigger use of a table-specific field by extracting the entity ID from the JSON record.
- Used Vite's native config loader to avoid restricted Windows parent-directory traversal.
- Browser tests run against production preview builds because development dependency scanning is restricted in this execution sandbox. Normal development remains available outside that restriction; use `npm run build` and `npm run preview` as the tested local fallback.
- Kept each school form's original version until a successful save, so background data refresh cannot silently authorize a stale edit.
- Enabled service-worker client claiming for the initial installation. Updates still require the user to choose reload.

## Outstanding integration acceptance gate

At the initial release no Supabase project or local service stack was available. As of 22 October, a connected MfaroEdu project exists but is inactive; a workspace CLI is available, while no real local Supabase stack has been verified. Consequently, the following remain **unverified**:

1. Supabase CLI migration/reset against a real Supabase stack and the local demo-user script.
2. Real account provisioning, confirmation emails, sign-in, token refresh, logout and password reset/change.
3. PostgREST relationship selection and RPC responses against deployed migrations.
4. Cross-tenant API requests using real user JWTs, and revocation during an active real session.
5. Hosted redirect URLs, SMTP, rate limits, production CSP, operational monitoring and restore procedures.
6. PWA installation and update UX on physical iOS/Android devices.

These checks must be completed before the application is accepted for production use. Phases 2, 3 and 5 were implemented locally at the user’s request while this gate remains open. No live school data was created or uploaded. Phase 4 is an unreleased draft; Phases 6–7 are planned.

