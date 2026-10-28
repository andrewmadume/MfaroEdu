# Current verification — 28 October 2026 · v0.7.1

- Completed the previously disabled Phase 4 module: dated historical attendance, atomic versioned capture, finalize/reopen/void, scoped reports/history, rooms/periods, weekly timetables, actual-date class/teacher/room overlap checks, assignment/capacity validation, resource/history guards and audit records. Phase 8 has not started.
- 57 unit tests pass. All seven embedded PostgreSQL suites passed (275 assertions at the initial run); the expanded Phase 4 suite then passed 33 assertions, bringing current covered assertions to 280. New cases include same-class re-enrollment, cross-year booking overlaps, nonoverlapping terms, report-card attendance snapshots and new aggregate analytics.
- All 94 desktop/mobile browser cases have passed: the final run passed 91, then all three Windows network/suspend interruptions passed on a focused rerun. This includes fourteen email-callback checks as well as the original school modules and new school-day workflows. The first Phase 4 run found an exact-label test locator issue; using the accessible combobox role corrected it. A separate full run initially could not locate Chromium because the workspace browser path was unset; it was rerun with the correct path. Windows preview teardown was corrected with directly owned processes; the accepted full run exits successfully (80 passed).
- Patched the production Zod dependency to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); all 57 validation/unit tests pass after the patch and the production-only dependency audit reports zero vulnerabilities.
- Updated Vitest to 5.0.5 to remove the critical development-tool advisories, and patched fast-uri/serialize-javascript within compatible ranges. The remaining development-only audit findings are low-severity deepmerge/Workbox dependency advisories; the suggested automatic PWA downgrade is not applied.
- Fixed the live account setup failure: externally issued signup/invitation/recovery fragments are now consumed through Auth setSession verification before the page becomes editable; ordinary browser-initiated recovery retains PKCE. Fragment tokens are removed from the address bar immediately and are not logged. Missing, expired or rejected sessions show recovery guidance, and a failed callback cannot reuse an older local session for password setup. Added three unit cases and fourteen desktop/mobile callback checks, including unchanged PKCE exchange. The real confirmation email was delivered and verified; the user's initial password submission failed under the old callback handling, so password setup requires the patched deployment and a new email link.
- Strict TypeScript and the production/PWA build pass. Attendance/timetable desktop/mobile screenshots inspected; table scrolling is contained inside panels. Cornflower blue header/logo backing and the supplied installed-app icon are preserved.
- Migration `20261028030133_finish_phase4_operations.sql` was scaffolded with official Supabase CLI 2.122.0 and applied to embedded PostgreSQL. It also preserves public signatures while moving the 12 older public privileged implementations into `private`, addressing the previously observed advisor warnings. Hosted migration/advisor results are recorded after deployment, not inferred from embedded tests.
- Added production CSP restricted to this app and its exact Supabase HTTPS/WSS origin, anti-framing, content-type and referrer headers, plus manifest cache revalidation. Verify these response headers after Vercel deployment. A different Supabase deployment must update the CSP's connect-src origins.
- Hosted read-only checks confirm the Auth settings endpoint responds and email authentication is enabled. Anonymous Data API reads of learner records are rejected with HTTP 401 / SQLSTATE 42501. The initial inspection found zero Auth accounts and zero school workspaces. At the user's request, the first account was subsequently created through the public Auth signup API with a fresh high-entropy temporary secret that was not retained. Supabase accepted the confirmation-email request with no session issued. The confirmation redirect opens the production password setup page; the user must verify the email and choose their own password. No school records were inserted.
- Live-user sign-in, verification/invitation and reset email, token refresh/logout, actual authenticated PostgREST/Storage HTTP workflows, SMTP configuration, backups/restore drills and physical-device PWA installation remain acceptance tasks. The administrator email was supplied privately in chat; it is not included in repository content. Computer Use stopped before any dashboard account action because it could not establish the browser URL. The account was instead prepared through the authorized public Auth API; email delivery and confirmation are verified through the user and hosted Auth records; password setup awaits the corrected release.

The older dated records below are historical. Current implementation/deployment status supersedes their statements that Phase 4 is disabled, Phase 7 is planned, or Supabase is inactive.

# Verification record

## Phase 7 advanced capabilities — 25 October 2026

- Version 0.7.0: server analytics, private import/export jobs, atomic learner CSV imports, consistent paginated exports, iCalendar and JSON integrations, AI-ready count contracts, account/school-scoped offline catalogue drafts, explicit conflict resolution and provisioned platform oversight.
- 49 unit tests pass, including bounded RFC 4180 parsing, formula escaping, calendar injection/folding, and versioned draft validation.
- 247 embedded PostgreSQL assertions pass across the six phase suites (25 Phase 7 assertions). New checks cover no-write validation previews, duplicate/date/column rejection, atomicity, idempotent retries, consistent 250-row snapshots, job expiry/quotas, actor ownership, revocation, tenant isolation, populated academic/finance aggregates, calendar ranges, privacy suppression, offline conflicts and platform-operator isolation.
- 70 desktop/mobile browser checks pass, including fully offline draft reload after PWA caching, lost-response request-key preservation, separate conflict review/synchronization, import review/confirmation, real file downloads and role controls. The Phase 7 browser cases are rerun after final visual and draft-label refinements.
- TypeScript and production/PWA build pass. Report and conflict screenshots inspected; corrected mobile grid overflow and catalogue-draft checkbox layout.
- Tests use synthetic browser fixtures and embedded PostgreSQL with the explicitly test-only Storage shim. They do not create hosted users, deliver email, send data to providers or establish actual-user Auth/Storage acceptance.
- Hosting status supersedes older entries below: Supabase is healthy, the first 20 migrations were deployed, Vercel is live at `https://mfaro-edu.vercel.app`, and production authentication URLs are configured. Phase 7 adds migration `20261025125043_phase7_advanced.sql`. Deployment is verified separately after publishing the release.
- No attendance/offline-attendance implementation, automated provider delivery, AI decisions or billing enforcement is claimed. Private data-job expiry blocks reads after 15 minutes; physical cleanup is opportunistic at the next job for the school. Dormant-school cleanup remains an operational task.

Date: 6 October 2026

## Phase 6 communication/library — 24 October 2026

- Release 0.6.0 adds three CLI-scaffolded migrations; all 20 migrations apply successfully in embedded PostgreSQL. Existing foundation, people, academics and finance behavior remains covered. Phase 4 is still an unfinished, disabled draft.
- 39 unit tests pass. New validation checks cover allowed upload types, size/name/path limits, trimmed message boundaries and calendar arithmetic across month/year/leap boundaries.
- 222 PostgreSQL assertions pass: foundation 25, people 48, academics 44, finance 41 and Phase 6 64. New cases exercise role/class audiences, teacher restrictions, publication/withdrawal, immutable posts/files, pending upload recovery, deleted-object detection, private Storage policies, recipient relationships, family messaging settings, personal read state, private conversation access (including administrator denial), idempotency, pagination, catalogue snapshots, unique copies, borrower limits, renewals, returns, damage/loss, date/history checks, minimal librarian lookups, tenant isolation, audit and revoked access.
- The Phase 6 Storage test shim models the bucket/object catalogue and runs real SQL grants/RLS. It does not emulate Supabase Storage HTTP, content validation, file bytes or actual concurrent clients. The checked-in SQL does not replace or recreate the real Storage schema.
- The complete browser regression suite passes 50 cases (38 existing + 12 Phase 6), using synthetic protocol fixtures on desktop/mobile. New workflows cover draft/attach/publish/withdraw, notifications/read state, parent messaging, assigned-teacher audiences, book/copy registration, issue/renew/damaged return, parent read-only history and retained stale-return input.
- Patched the production Zod dependency to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); all 57 validation/unit tests pass after the patch and the production-only dependency audit reports zero vulnerabilities.
- Updated Vitest to 5.0.5 to remove the critical development-tool advisories, and patched fast-uri/serialize-javascript within compatible ranges. The remaining development-only audit findings are low-severity deepmerge/Workbox dependency advisories; the suggested automatic PWA downgrade is not applied.
- Fixed the live account setup failure: externally issued signup/invitation/recovery fragments are now consumed through Auth setSession verification before the page becomes editable; ordinary browser-initiated recovery retains PKCE. Fragment tokens are removed from the address bar immediately and are not logged. Missing, expired or rejected sessions show recovery guidance, and a failed callback cannot reuse an older local session for password setup. Added three unit cases and fourteen desktop/mobile callback checks, including unchanged PKCE exchange. The real confirmation email was delivered and verified; the user's initial password submission failed under the old callback handling, so password setup requires the patched deployment and a new email link.
- Strict TypeScript and production/PWA build pass. The existing logo and white backing are retained. Desktop/mobile views were inspected; Phase 6 tabs explicitly use a horizontal layout on desktop and wrap on mobile.
- The connected MfaroEdu project remains inactive. Its advisor API returned no existing security lints; new migrations were not applied, so this is not a validation of the Phase 6 schema. Hosted Auth/PostgREST/Storage, live concurrency, real object upload/download enforcement and deployed-schema advisors remain pending. No external messages or live uploads were made. The changelog markdown endpoint could not be retrieved; official Storage access-control/download documentation was consulted.

## Phase 5 finance — 22 October 2026

- Release version 0.5.0. All 17 migrations apply in embedded PostgreSQL; the new migration was scaffolded with the official Supabase CLI (2.121.0), using a workspace-local CLI configuration directory after Windows denied its default location. The downloaded binary archive's SHA-512 matched the official npm integrity value.
- 34 unit tests pass, including exact amount parsing, signed formatting, 0/2/3 decimal precision, unsupported notation, fractional overflow and maximum amount boundaries.
- 158 PostgreSQL assertions pass across the foundation (25), people (48), academics (44) and finance (41) suites. Finance coverage includes minimal accountant lookups, hidden private learner profiles, tenant/role/link access, eligibility, fee versions, dates, integer totals, immutable documents, currency locking, idempotency, overpayments, optimistic conflicts, concessions, reversals, voids, read-only ledger, period reports, statement pagination/snapshot consistency, backdating, audit, anonymous denial and immediate membership revocation, and document numbering beyond six digits.
- The complete browser suite passes 38 checks on desktop/mobile: 30 existing cases plus 8 finance cases. Finance checks cover exact fee setup, invoice issue, partial bank payment, bursary, receipt/statement printing, report totals, parent read-only controls, retained conflict input and overflow. Browser tests use synthetic Supabase protocol fixtures; they do not verify a hosted service.
- Patched the production Zod dependency to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); all 57 validation/unit tests pass after the patch and the production-only dependency audit reports zero vulnerabilities.
- Updated Vitest to 5.0.5 to remove the critical development-tool advisories, and patched fast-uri/serialize-javascript within compatible ranges. The remaining development-only audit findings are low-severity deepmerge/Workbox dependency advisories; the suggested automatic PWA downgrade is not applied.
- Fixed the live account setup failure: externally issued signup/invitation/recovery fragments are now consumed through Auth setSession verification before the page becomes editable; ordinary browser-initiated recovery retains PKCE. Fragment tokens are removed from the address bar immediately and are not logged. Missing, expired or rejected sessions show recovery guidance, and a failed callback cannot reuse an older local session for password setup. Added three unit cases and fourteen desktop/mobile callback checks, including unchanged PKCE exchange. The real confirmation email was delivered and verified; the user's initial password submission failed under the old callback handling, so password setup requires the patched deployment and a new email link.
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
- Patched the production Zod dependency to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); all 57 validation/unit tests pass after the patch and the production-only dependency audit reports zero vulnerabilities.
- Updated Vitest to 5.0.5 to remove the critical development-tool advisories, and patched fast-uri/serialize-javascript within compatible ranges. The remaining development-only audit findings are low-severity deepmerge/Workbox dependency advisories; the suggested automatic PWA downgrade is not applied.
- Fixed the live account setup failure: externally issued signup/invitation/recovery fragments are now consumed through Auth setSession verification before the page becomes editable; ordinary browser-initiated recovery retains PKCE. Fragment tokens are removed from the address bar immediately and are not logged. Missing, expired or rejected sessions show recovery guidance, and a failed callback cannot reuse an older local session for password setup. Added three unit cases and fourteen desktop/mobile callback checks, including unchanged PKCE exchange. The real confirmation email was delivered and verified; the user's initial password submission failed under the old callback handling, so password setup requires the patched deployment and a new email link.
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
- Patched the production Zod dependency to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); all 57 validation/unit tests pass after the patch and the production-only dependency audit reports zero vulnerabilities.
- Updated Vitest to 5.0.5 to remove the critical development-tool advisories, and patched fast-uri/serialize-javascript within compatible ranges. The remaining development-only audit findings are low-severity deepmerge/Workbox dependency advisories; the suggested automatic PWA downgrade is not applied.
- Fixed the live account setup failure: externally issued signup/invitation/recovery fragments are now consumed through Auth setSession verification before the page becomes editable; ordinary browser-initiated recovery retains PKCE. Fragment tokens are removed from the address bar immediately and are not logged. Missing, expired or rejected sessions show recovery guidance, and a failed callback cannot reuse an older local session for password setup. Added three unit cases and fourteen desktop/mobile callback checks, including unchanged PKCE exchange. The real confirmation email was delivered and verified; the user's initial password submission failed under the old callback handling, so password setup requires the patched deployment and a new email link.
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

These checks must be completed before the application is accepted for production use. Phases 2, 3, 5 and 6 were implemented locally at the user’s request while this gate remains open. No live school data was created or uploaded. Phase 4 is an unreleased draft; Phase 7 is planned.

