# Phase 4 — Attendance and timetables

Completed implementation in version 0.7.1 on 28 October 2026. This finishes the disabled Phase 4 draft; it does not introduce Phase 8.

## Attendance

Open **Attendance & timetable → Take attendance** as an administrator, principal or assigned teacher. Select a class and a date within its academic year, no later than today in the school's timezone. Open a named session such as Daily or Morning. The class/date/session identity is unique, ignoring session-name case. Reopen the existing register instead of creating a duplicate.

The roster follows historical enrollment on the selected date, including learners whose enrollment has since closed. Mark Present, Absent, Late or Excused, optionally recording a reason. Not marked is an explicit draft status. **Mark unmarked present** leaves other statuses untouched. Saving a batch is atomic and checks both the register version and each changed learner's entry version. A conflict retains input until the user explicitly reloads. Unsaved changes prompt before leaving the module or changing the register.

Finalize only after every enrolled learner is marked. Families see finalized attendance for linked children or their own learner profile. Teachers see assigned-class registers; a timetable teacher assignment alone does not grant access to other classes. Only administrators/principals can reopen or void a register. Reopening and voiding hide attendance from family reports until the register is finalized again. Records and audit history remain.

Captured attendance prevents enrollment dates from being shortened past a captured session. Backdated enrollment affecting a finalized register requires reopening that register first. Open it again to load the updated roster, mark newly eligible learners, save and finalize. Void records do not constrain later enrollment changes.

## Reports

Attendance reports support a date range up to 366 days, class/learner filters, term dates and paginated history. Percentage = (Present + Late) / all finalized learner sessions × 100. Excused is included in the denominator. Missing, draft and void records are excluded; no sessions gives no percentage. Multiple named sessions count independently. The dashboard shows today's authorized finalized attendance; Reports & data includes attendance for its selected reporting period.

New academic report previews/publications contain a term attendance snapshot. A later correction does not rewrite a published report; withdraw and republish through the existing academic workflow when a corrected report is needed. Older reports retain their historical content. Annual academic summaries identify attendance as the last published term's snapshot rather than presenting it as a year total.

## Timetables

Administrators/principals configure **Rooms** and **Time slots**. Periods use school-local, whole-minute times and cannot cross midnight. Room capacity must accommodate the class capacity when both are configured.

Select a term and **New scheduled lesson**. Choose a class subject, its assigned active teacher, a period, optional room and weekday. Lessons repeat on actual matching dates within the term. Class and term must share an academic year. Terms exceeding ten years are rejected. There are no holiday/exception calendars in this Phase 4 scope.

Class, teacher and room overlap checks apply to actual dates and time ranges across terms, including overlapping academic-year definitions. Adjacent periods are allowed. School-level database locking serializes booking creation/changes and linked-resource changes, so simultaneous writes cannot silently reserve the same resource. Archive schedules before changing linked period times, term boundaries, capacities or active relationships. Restoring a schedule revalidates current assignments and conflicts. Archived schedule records remain available.

Class, teacher and administrator room views show one selected week. Families see only schedules for authorized classes. The family teacher selector returns only an ID and name for visible scheduled teachers; it does not expose staff profiles/contact information. Teachers can see timetable lessons in classes they are authorized to access. Room views are offered to timetable managers.

## Security and migration

Migration `20261028030133_finish_phase4_operations.sql` adds school-scoped tables, composite foreign keys, explicit grants, RLS, audits and checked private workflow implementations behind public invoker wrappers. Direct attendance/schedule mutations and anonymous RPC execution are denied. It also relocates the 12 older privileged public RPC implementations to `private`, preserving public signatures/defaults and existing authorization. `private` must remain outside the exposed Data API schemas.

The old `docs/drafts/phase4-schema.sql` remains a historical design reference. It is not deployed; the accepted migration deliberately uses serialized booking checks without requiring `btree_gist` or a materialized per-date occupancy table.

## Acceptance boundaries

Embedded PostgreSQL tests exercise actual schema, grants/RLS, permissions, history guards, publication snapshots and transaction rollback. Browser tests use synthetic protocol fixtures on desktop/mobile. Hosted migration status, anonymous Data API rejection and security advisors are checked separately after deployment. Real-user sign-in, confirmation/reset email, token refresh, actual Storage HTTP uploads/downloads and physical-device PWA installation still need real accounts/devices. Attendance entry requires connectivity; no learner attendance is persisted offline. Existing Phase 7 offline catalogue drafts remain available.

## Foundation callback completion in this release

The first live account check exposed an incompatible external email callback. Browser-originated recovery remains PKCE. Signup/invitation/recovery fragment links issued outside the browser are now explicitly verified through Auth setSession before password controls become available, with URL token removal, loading/error states and a fresh-link fallback. Passwords and email tokens are never put in repository files or diagnostics. An expired callback cannot unlock password controls through an older locally stored account session.
