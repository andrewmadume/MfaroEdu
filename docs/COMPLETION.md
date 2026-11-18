# Completion release — v0.7.2

This release closes the code gaps found in the 18 November 2026 inspection. It does not start Phase 8. The original brief has seven phases; physical-device and hosted-service acceptance remain distinct from implemented functionality.

## Account isolation and security

The authentication provider now owns a globally mounted account boundary. Each identity gets a separate React Query client and a fresh component tree, including on public, authentication, offline and platform routes. Account changes discard old queries and editors synchronously; retiring clients cancel and clear their requests. Cross-tab sign-out/sign-in and direct identity changes have browser regression coverage.

The production npm audit is clear. Glob and minimatch are overridden to patched versions (14.0.6 and 11.0.9). Picomatch 4.0.7 has no upstream patched version for [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). The committed install/build guard rejects extended glob syntax, including caller overrides, in every installed picomatch parser. A security check verifies the attack patterns cannot compile while ordinary asset patterns work. Changed parser source fails closed for review. Do not remove the guard or use `--ignore-scripts` without running `npm run security:check` before development/testing/building.

`npm audit` still reports 11 high development-package entries propagated from that one advisory. They are documented as mitigated, not hidden or declared patched. There are no remaining moderate findings in this release's audit. Replace the mitigation with an official fixed version once available, rerunning PWA generation and all tests.

## Account invitations

In **People & access**, administrators create a private invitation link for an email and school role. Share it with that recipient through an approved channel. The screen clearly states that it does not send an invitation email. It also lists the latest 50 invitation statuses and supports revocation. Accepted invitations include the account UUID so administrators can link the correct teacher, guardian or learner profile without external identity-directory access.

Links expire after seven days, are single-use, and bind acceptance to the confirmed email in Supabase Auth. A SHA-256 digest of the high-entropy token is stored server-side; the original link is only returned once. Tokens are stripped from the address bar and retained in sessionStorage while joining. They are never included in audit metadata. A new link for the same email/role revokes the previous pending one. Up to 100 invitation creations per school per day are allowed. A revoked/inactive inviter cannot authorize new acceptance.

Recipients open **Join your school**, sign in or create their own account, verify their email, then explicitly accept the invitation. If verification opens in another browser, reopen the original invitation there. Acceptance creates only the invited school role; it does not automatically link a learner, guardian or teacher profile. Administrators then assign that account to the appropriate profile using existing directory controls. Platform roles cannot be invited. Passwords are chosen privately by recipients.

## School calendar

**School calendar** supports school events, exams, meetings, parent meetings, holidays, sports and academic dates. Administrators/principals create and edit events, choose role audiences and optionally restrict an event to a class. The database enforces school/class identity, audience access, date bounds and optimistic versions. Teachers and families cannot mutate events. Archive/restore is performed by editing the event.

Timed events are entered using the device timezone and displayed using the school's timezone. All-day events use inclusive dates in the editor and an exclusive end in storage/iCalendar. Events span at most 366 days. Search and pagination limit results to 20 per page. **Export visible events** downloads exactly that authorized page as iCalendar, preserving times and escaping calendar content. Events do not automatically cancel timetable lessons; timetable changes remain explicit.

## Private documents

**Private documents** supports school policies, learner registration/certificates, reports and staff records. Administrators/principals upload a PDF, PNG, JPEG or text file up to 5 MB with one of these audiences:

- SCHOOL: active members of this school.
- STAFF: authorized school staff roles.
- LEARNER: the learner's own student account, linked guardians and school managers.
- STAFF_MEMBER: the selected staff member and school managers.
- ADMIN: document managers only.

General teachers cannot read learner documents merely because they teach the learner. Every metadata query and private Storage download rechecks access. Relationship and membership revocation remove access immediately. Managers retain object metadata visibility to clean up archived files. No public or long-lived signed download URL is generated.

Upload is reserve → upload without overwrite → verify stored size/type → finalize. A stable client UUID makes retries safe. Pending uploads are visible only to managers; there may be at most 20 per school. Use **Retry original file**, **Finish uploaded file**, or archive a failed reservation. Changed filenames, size/type or audiences cannot reuse an existing reservation. Published file bytes cannot be overwritten. Archive revokes ordinary readers before byte cleanup; retry cleanup from Archived if deletion was interrupted. Previously downloaded copies cannot be retracted. Upload only approved files; automated antivirus scanning is not provided.

## Additional imports and exports

**Reports & data → Import** now includes teacher and subject templates alongside the learner import. Teacher imports create staff profiles with `is_teacher=true`; they do not create Auth accounts or teaching assignments. Required template fields are checked in both the parser and database. Extra columns, length/type failures and case-insensitive duplicate codes/numbers are reported by CSV row. A 500-record / 300-KB limit, review preview and explicit atomic confirmation apply. Commit rechecks conflicts and access, rolls back the whole batch on failure and is idempotent during job validity.

**Export** now supports staff, subjects, finalized attendance, active published results, fee-ledger entries and library transactions, in addition to learners and existing reports. Data jobs are actor-owned, school-scoped, permission-checked snapshots lasting 15 minutes. Downloads paginate the fixed snapshot in 250-row pages and release it afterward. Exports are bounded to 10,000 records / 20 MB; larger exports are rejected. Nested result/loan documents are JSON within quoted CSV cells. Formula prefixes are escaped and financial integer amounts remain strings. Exporting does not authorize sharing private school information with another service.

## School and report branding

**School settings** supports a PNG/JPEG logo up to 200 KB, HTTPS website, school colour, report title/footer and Standard/Compact report format. The portal displays the school logo/accent; MfaroEdu's installed icon, authentication branding and requested #6495ED header background remain intact. Standard reports include assessment detail; Compact reports show subject summaries and comments. New previews/publications snapshot the school branding and format. Old publications preserve their original documents.

## Release and acceptance

Migration `20261118140849_complete_school_workflows.sql` follows the existing 22 migrations; `20261118150417_invitation_account_receipts.sql` adds the manager-only accepted-account receipt. It adds school events, private document metadata/Storage policies, private invitations, bounded data tools and branding columns. New public tables have RLS and no direct client writes. Public RPCs are SECURITY INVOKER; private implementations use a fixed search path and fresh authorization. Production seeds are never deployed.

CI runs TypeScript, unit tests, all database suites, desktop/mobile browser workflows, production dependency/security-mitigation checks and the production/PWA build. `/release.json` exposes only version, commit and build time for release identification; it is not a database-health claim.

Before declaring school rollout acceptance complete, verify real account sign-in/out/refresh, multiple roles and schools over PostgREST, real Storage bytes/revocation/concurrency, production email delivery, backup/restore and physical Android/iOS install/update. See `OPERATIONS.md`. Synthetic browser fixtures and embedded PostgreSQL cannot establish these external checks. Phase 8 remains on hold until those gates are accepted.
