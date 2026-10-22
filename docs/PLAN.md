# Implementation plan

## Inspection

The provided project directory contained only empty `outputs/` and `work/` directories. There was no existing React/Vite project or application code to preserve. Node 24 and npm were available. No local PostgreSQL, Docker or Supabase CLI was found. The application is delivered in `outputs/school-management/`.

## Phase 1 — Foundation (implemented; live integration pending)

1. Establish React/TypeScript/Vite/Tailwind, modular folders, routing and environment configuration.
2. Implement real Supabase authentication and profile handling; show a clear setup state when unconfigured.
3. Create versioned tenant, role and permission migrations with explicit grants, RLS and immutable school audit records.
4. Implement school creation, school selection, profile and school settings, membership administration and paginated audit history.
5. Build accessible responsive navigation and explicitly labeled role dashboard placeholders.
6. Add PWA manifest, icons, update prompt and public static shell caching.
7. Verify TypeScript, production build, validation/permission tests, PostgreSQL RLS and responsive browser paths.
8. Complete actual Supabase service integration testing when an instance is configured. This remains the phase acceptance gate.

## Phase 2 — People and academic structure (implemented)

Implemented on 7 October 2026 at the user’s request. Includes the academic structure, people directories, guardian links, class subjects, teacher assignments, historical enrollment, archive/restore, database RLS and tests. See `PHASE2.md`. The missing Supabase connection still prevents real-service verification; it does not prevent the requested local implementation.

## Phase 3 — Academics (implemented)

Implemented on 10 October 2026 after local Windows execution recovered. Assessment types, school-defined grading bands and term weights, assigned-subject assessment capture, atomic gradebook writes, results preview/publication/withdrawal, immutable report snapshots, comments, promotion decisions, report printing/PDF, annual summaries and academic reports. See `PHASE3.md`. Real Supabase Auth/PostgREST acceptance still requires a project.

Version 0.3.1 on 12 October adds audited incomplete-score resets, year-scoped term selectors and persistent save feedback. Migration 0016 extends the existing workflows while preserving report snapshots and access controls.

## Phase 4 — Attendance/timetables (unreleased draft)

The interrupted Phase 4 session created UI/service drafts and a schema draft, but no accepted migration or working database workflows. The `phase4Enabled` flag is false: attendance, timetable, room and time-slot routes are unavailable. This phase is not complete. See `drafts/README.md` before resuming it.

## Phase 5 — Finance (current)

Version 0.5.0 implements fee categories/structures, learner billing accounts, invoice snapshots, append-only exact-amount ledger entries, payments received, receipts, concessions, audited reversals, voids, statements and fee reports. See `PHASE5.md`. Hosted service verification remains pending; the connected MfaroEdu project was inactive. The local implementation does not deploy migrations or use real school records.

## Later phases

6. Communication/library: provider-neutral message transport interfaces, recipient authorization, private attachments, book copies and transactional circulation checks.
7. Analytics/imports/integrations: server-side reporting, validation previews, atomic imports, safe exports, versioned offline drafts and explicit conflict resolution. Add platform billing and cross-school operator UI after independent security review.

## Deferred by design

Attendance, timetable, communications, library, storage, document upload and data import/export remain deferred. Directory counts, academic results and finance data come from authorized database queries. Login/email recovery and real PostgREST behavior cannot be accepted solely from embedded database or mocked browser tests.
