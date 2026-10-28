# MfaroEdu

A modular school management application using React, TypeScript, Vite, Tailwind CSS and Supabase. Version **0.7.1** implements Phases 1-7, including the completed attendance/timetable workflows. Supabase migrations and Vercel hosting are connected to GitHub. Live account, email, Storage service and physical-device acceptance checks remain open; implementation tests do not replace those checks. See `docs/PHASE4.md` for the completed school-day module. Phase 8 has not started.

## MfaroEdu branding

The supplied MfaroEdu logo is preserved unchanged in `public/mfaroedu-logo.png` and appears on the authentication screen, sidebar and dashboard. The installed app icon uses the separately supplied `MfaroEdu_icon.svg` artwork. Production assets include 192/512 px PNG icons, a safe-zone maskable icon for rounded launchers, a 180 px Apple touch icon, and browser favicon variants. Icon URLs are versioned so updates can be detected; an existing installation may need reinstalling if its operating system retains the old icon. The wordmark used inside the application is unchanged. The palette uses royal blue `#0047D6`, cyan `#00C4EF`, green `#08AD38` and gold `#FFD21A`, with dark blue text for contrast. Header and in-app logo panels use the requested cornflower blue `#6495ED`. Application titles and PWA metadata use MfaroEdu. Migration `0004_mfaroedu_brand.sql` sets the default colour for new schools without overwriting existing school customisations.

## Implemented

- Responsive application shell, lazy-loaded routes, role-aware navigation and role-specific dashboards with permission-scoped live directory counts.
- Supabase password sign-in, persistent sessions, sign-out, reset email and password changes.
- Self-service school creation for verified active accounts; multiple school memberships and school switching.
- School settings with optimistic concurrency protection, editable profile, paginated membership administration and audit history.
- Versioned PostgreSQL migrations for schools, profiles, roles, permissions, memberships and private subscription foundations.
- Database-enforced tenant/permission isolation, inactive-account checks, protected role assignment and append-only audit records for school, membership and Phase 2 record changes.
- Installable PWA manifest, icons, update prompt and static offline shell. No private API responses are cached and there is no offline write queue.

## Phase 2 modules

- Learners, parents/guardians and staff: create, view, edit, search, sort, paginate, archive and restore.
- Academic years, terms, grades, classes and subjects: school-configurable records with year-scoped classes and validated term dates.
- Guardian/child links, compulsory/elective class subjects, subject weights and teacher assignments.
- Learner enrollment, class movement, promotion and closure with historical records retained.
- Server-side class filtering, paginated lookup controls, concurrency checks and school audit events.
- Teachers, learners and parents receive read-only directories scoped by database relationships.

See `docs/PHASE2.md` for the workflow, permissions and limits.

## Phase 3 modules

- School-defined assessment types, grading bands, pass threshold and annual term weights.
- Assigned-subject assessments, tab-through mark capture, explicit absence/exemption, teacher comments and atomic optimistic mark saving.
- Database-calculated weighted subject/term results, principal comments and school-entered promotion decisions.
- Review-before-publication, immutable report snapshots, withdrawal, retained history and corrected republication.
- Family access to published reports for linked/own learners; teachers restricted to assigned subjects for draft work.
- Branded individual and class report cards through **Print / save PDF** using the browser print dialog; annual summaries and subject averages/pass rates.

See `docs/PHASE3.md` for calculation semantics, permissions and remaining service checks.

## Phase 4 attendance and timetables

Historical class registers, atomic mark/save/finalize/reopen/void workflows, family-scoped attendance reports, daily dashboard totals and immutable academic-report attendance snapshots. School-local rooms/periods, class/teacher/room weekly schedules, actual-date overlap protection, assignment/capacity checks and versioned archive/restore. See `docs/PHASE4.md`.

## Phase 5 finance

- School-defined fee categories and versioned annual / grade fee structures.
- Learner accounts, immutable invoice line snapshots, exact minor-unit amounts and currency locking.
- Payments received, receipts, discounts, bursaries, full transaction reversals and retained void invoices.
- Paginated statements with opening/running/closing balances; complete statement printing uses a fixed snapshot.
- Financial reports: net invoiced, net collections, net concessions and outstanding as at the end date.
- Branded invoice, receipt, statement and report printing through the browser's **Print / Save PDF** dialog.
- School administrator/accountant posting, principal read-only reporting, linked parent/own learner access, fresh database authorization and audited append-only transactions.

See `docs/PHASE5.md` for usage, permissions, calculations and limits. Finance records money already received; it does not charge cards or initiate refunds.

## Phase 6 communication and library

- School-wide, class, teacher, parent and learner announcements, with draft/publish/withdraw workflows and immutable published content.
- Personal notification center with unread state and current audience checks; private in-app conversations restricted to eligible recipients.
- A school setting enables family messaging with assigned teachers and administrators. Only conversation participants can read messages, including when the administrator is not a participant.
- Private announcement attachments through Supabase Storage, authenticated downloads, draft-only upload/removal and recoverable pending uploads. Five files per announcement, 5 MB per file; PDF, PNG, JPEG and text are supported.
- Book catalogue, unique accession numbers for individual copies, shelf/condition/status tracking, atomic issues, renewals, returns, lost/damaged records and retained borrowing history.
- Configurable borrowing limits, family-scoped history and current inventory/overdue reports. Librarians use minimal learner lookups without access to private learner profiles.
- Provider-neutral transport interface for future email/SMS/WhatsApp adapters. This release delivers in-app messages only and sends no external communications.

See `docs/PHASE6.md` for permissions, workflows, Storage acceptance and limits.

## Phase 7 advanced capabilities

School-scoped server reports, validated atomic learner CSV imports, private export snapshots, formula-safe CSV downloads, versioned offline catalogue drafts with explicit conflict resolution, iCalendar/JSON integrations and provisioned platform-operator oversight. No third-party provider or AI service receives data automatically. See `docs/PHASE7.md`.

## Requirements and installation

Use Node.js **24 LTS** and npm. The Vite config uses native TypeScript loading to avoid config bundler traversal issues in restricted Windows environments.

```sh
npm ci
cp .env.example .env
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` and `npm.cmd` if execution policy prevents `npm.ps1`. The development server binds only to the local machine. Open the URL printed by Vite.

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using your project's public URL and publishable key (legacy public anon keys also work). These variables are public browser configuration. Never put service-role keys, database credentials or other secrets in `VITE_*` variables. Without configuration, the application displays an explicit connection setup screen.

## Supabase setup

For a local instance install the official Supabase CLI and Docker, then:

```sh
supabase start
supabase db reset
```

The checked-in `supabase/config.toml` enables email verification and includes local reset redirects. Match its site URL and redirect allowlist to the exact development origin you use. Set the environment variables to the values from your local instance.

For a hosted project, link the project with `supabase link --project-ref YOUR_PROJECT_REF`, inspect pending migrations, then run `supabase db push`. Do not run `db reset` on a production database. In Auth settings, configure the production Site URL, the exact `/auth/reset` redirect URL, SMTP, password policy, verification and rate limits. Create/invite the first account through a trusted administrator workflow, verify its email, sign in and create the school. This initial release does not offer public signup or an invitation UI.

Migrations execute in filename order:

1. `0001_foundation.sql`: tenant and identity tables, auth profile trigger.
2. `0002_permissions.sql`: role grants and provisioning functions.
3. `0003_rls_and_audit.sql`: table privileges, RLS, audit triggers, checked membership mutation and school version checks.
4. `0004_mfaroedu_brand.sql`: MfaroEdu default school colour.
5. `0005_academic_structure.sql`: academic years, terms, grades, classes and subjects.
6. `0006_people.sql`: learners, guardians, staff and child links.
7. `0007_enrollment_assignments.sql`: class subjects, teaching assignments and enrollment history.
8. `0008_phase2_security.sql`: new permissions, tenant/relationship RLS, version and audit triggers.
9. `0009_phase2_integrity.sql`: validation and transactional enrollment/movement RPCs.
10. `0010_phase2_lookups.sql`: RLS-preserving class-subject search.
11. `0011_phase3_academics.sql`: grading, assessment, mark, report and publication tables with RLS.
12. `0012_phase3_workflows.sql`: gradebook, transactional capture, notes, preview, publication and withdrawal RPCs.
13. `0013_phase3_annual_integrity.sql`: annual results and historical enrollment/assessment protection.
14. `0014_phase3_subject_lookup.sql`: search restricted to markable subjects.
15. `0015_phase3_subject_summary.sql`: authorized weighted draft subject totals.
16. `0016_phase3_incomplete_marks.sql`: audited score resets and incomplete-result publication protection.
17. `20261022110410_phase5_finance.sql`: finance settings, fees, immutable invoices/ledger, RLS and checked finance workflows. Scaffolded with the official Supabase CLI.
18. `20261024173735_phase6_communications.sql`: announcements, private threads/messages, notifications, attachment metadata and checked communication APIs.
19. `20261024173736_phase6_library.sql`: catalogue, copies, configurable circulation, loan events, family history and reporting APIs.
20. `20261024173751_phase6_attachments.sql`: private attachment bucket and Storage RLS. These three migrations were scaffolded with the official CLI and require the standard Supabase Storage schema.

21. `20261025125043_phase7_advanced.sql`: checked analytics, private expiring import/export snapshots and provisioned platform oversight. Offline catalogue synchronization uses the existing transactional library workflow.

22. `20261028030133_finish_phase4_operations.sql`: attendance, timetable resources/bookings, history guards, report snapshots, analytics and compatible private implementations for older privileged RPCs.

The `private` schema must **never** be added to Supabase's exposed API schemas. Migrations assume the standard Supabase `auth.users`, `auth.uid()`, `anon`, `authenticated` and `service_role` setup. Keep infrastructure service-role privileges private. Regenerate database TypeScript types with the Supabase CLI when expanding the schema; current service boundaries use explicit domain types.

## Development data

`supabase db reset` creates a clearly marked development school. To provision local demo accounts, supply the local `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as process environment variables and run:

```sh
node scripts/seed-demo.mjs
```

This script refuses hosted URLs, generates random passwords, confirms local demo emails and creates administrator, teacher, parent, learner, accountant and librarian accounts. Temporary passwords print once to your terminal; do not capture/share these logs. Run against a fresh local database. The script also creates a demonstration academic year, term, grade, class, subject, teacher assignment, guardian link, enrolled learner, explicitly labeled grading examples and a draft assessment with marks. It does not automatically publish results. No real passwords are committed.

## Commands and tests

```sh
npm run typecheck
npm test
npm run test:db
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

The database suite applies the actual migrations to embedded PostgreSQL via PGlite and tests grants, RLS and SQL business rules using authenticated/anonymous roles and simulated `auth.uid()` claims. This verifies actual database behavior, but **does not replace testing the real Supabase Auth service, JWT verification, PostgREST, email delivery or hosted configuration**. Browser tests automatically build separate unconfigured and fixture-configured production bundles in ignored `.e2e/` directories. They cover setup, routing, responsive layout, mocked authenticated workflows and the offline public shell. Mocking is confined to test fixtures.

For workspace-restricted Windows installations set `PLAYWRIGHT_BROWSERS_PATH` to a writable development directory before both installing browsers and running E2E tests.

See `docs/VERIFICATION.md` for executed checks and remaining integration checks.

## Architecture

UI lives in `src/pages`, shared layout in `src/layouts`, validation in `src/schemas`, data operations in `src/services`, and identity/school context in `src/contexts`. TanStack Query caches in memory only; tenant identifiers are part of query keys. Authenticated query results stay in memory. Opt-in non-personal catalogue drafts use account/school-scoped IndexedDB; learner, academic, message and finance records are not cached for offline access. Supabase manages authentication token persistence; logout clears the application's query cache. The database is authoritative for permission decisions even if browser permissions are stale. Client access refreshes every minute and on window focus.

Permissions are data-driven through `roles`, `permissions` and `role_permissions`. School users cannot modify these definitions or grant platform access. Platform operators are provisioned through the private `platform_admins` table by trusted infrastructure administrators. A cross-school super-administration UI is not included. A user may hold multiple roles; route access is their union.

Phase 2 schema rule: use `(school_id, entity_id)` composite keys and foreign keys for school-scoped relationships, not only independent UUID foreign keys. Phase 2 enforces relationship-scoped RLS for teachers' assigned classes, parents' linked children and learners' own records. Membership alone must not authorize access to every learner record.

## Security and operations

- Active status is protected at database column level. A trusted identity administrator deactivates global profiles; school administrators can deactivate individual role memberships through the checked RPC.
- An administrator cannot change their own role membership through the UI/RPC, and the last administrator cannot be removed. Account invitation/activation UI is deferred.
- School and membership changes are audited without copying personal records into audit JSON. Supabase Auth's own audit logs cover identity events; this release does not duplicate login/logout events into school audit history.
- The Phase 6 private announcement-attachment bucket is provisioned. General learner/staff document management remains outside this release.
- Require MFA for privileged accounts, configure session policies, monitor Auth audit logs, configure backups/restore drills and complete deployment security review before introducing learner data. These are deployment tasks, not claims of completed controls.
- School creation is available to verified active accounts. Disable public signup in a closed rollout and introduce tenant quotas/abuse controls before opening commercial self-service registration.

## Deployment and PWA

Run `npm run build` and publish `dist/` to your chosen HTTPS static host. Configure SPA rewrites to `/index.html`; do not rewrite asset requests. Use no-cache for `index.html`, `sw.js` and the manifest, and long immutable caching for hashed assets. Configure your host's CSP to allow only your app and exact Supabase HTTPS/WSS origins; set anti-framing and content-type protections. Test password reset using the production origin.

The service worker precaches public application assets only; it never caches Supabase API traffic. On a new version, the user is asked to save their work before reloading. Installation availability varies by browser; the install button appears only when the browser supplies its install event. On iOS, use the browser's Add to Home Screen action. The initial request requires a connection. Reopened authenticated offline screens may show an error because live permissions cannot be checked. Phase 7 supports opt-in offline catalogue drafts with reviewed synchronization. Attendance requires connectivity and does not store learner drafts offline.

## Development plan

See `docs/PLAN.md` and the per-phase guides, including `docs/PHASE4.md`. Phases 2 and 3 were implemented at the user’s request while the Supabase integration gate remains open. Do not introduce real school data until hosted authentication, PostgREST and security acceptance checks are complete. This is **not yet a commercially launch-ready complete school management system**.

## References

- [Supabase RLS and security-definer guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase user profiles](https://supabase.com/docs/guides/auth/managing-user-data)
- [Vite requirements](https://vite.dev/guide/)
- [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite)
