# Phase 7 — Advanced capabilities · v0.7.0

Implemented 25 October 2026. Version 0.7.1 completes Phase 4 and adds finalized attendance statistics to Reports & data. Offline synchronization remains restricted to non-personal catalogue metadata. Existing hosted Auth, email-delivery and real-user acceptance checks remain separate from these implementation tests.

## Reports and analytics

Open **Reports & data** as a school administrator or principal. Apply a date range of at most ten years. Queries run on the server with current tenant permissions; there is no browser aggregation of full learner records.

- Learner, teacher and class counts describe the current active directory, across all academic years.
- Academic groups aggregate immutable reports from currently active publications **created in the selected date range**, grouped by academic year, grade, term and class. This is not a learner ranking. Term and annual publications can both occur in a range; report counts are not counts of distinct learners. Withdrawn publications are excluded.
- Finance appears only with `finance.reports`: exact signed integer minor-unit ledger balance through the end date, plus net monthly movements in the selected period. A credit balance is negative; net movement is not revenue or cash collection. Existing finance reports provide those separate measures.
- Library appears only with `library.reports`: current open/overdue loans and issues within the selected period. It does not reconstruct historical overdue balances.
- Report groups are capped at 500; narrow the date range when necessary. Print the report or download a versioned JSON snapshot for a downstream reporting tool.

## Import and export

**Import** is granted to school administrators only. Download the CSV template, fill its five columns, select the file, review the first ten rows, and choose **Validate import**. Validation checks all rows on the server and reports logical CSV row numbers. Names/admission numbers have database length limits; dates use real `YYYY-MM-DD` values and birth precedes admission. Unknown columns, duplicate admission numbers and existing admission numbers are rejected. Validation does not insert records.

**Confirm import** commits exactly the validated snapshot in one transaction after rechecking authorization and duplicates. Any failure rolls back the entire batch. Retrying a completed job within its validity returns the original count without inserting again. Imports create learner profiles only, preserving all existing records. They do not create Auth users, guardian links, enrollment or class assignments. Up to 500 rows, 300 KB of source CSV and five concurrent pending jobs per actor/school are supported. Previews expire after 15 minutes; after expiration upload/validate again.

**Export** is granted to school administrators and principals. One database statement captures up to 10,000 learner profiles, including archived records; the client reads that private snapshot in pages of 250 and releases it after download. Permission and actor ownership are checked on every page. Formula-like CSV cell prefixes are escaped before download; CSV is UTF-8 with a BOM. Exports include personal information and are not an authorization to send it to another service. Use approved storage and retention procedures.

Jobs live in the non-exposed `private.data_jobs` table with RLS and no client table privileges. Jobs become inaccessible after 15 minutes; expired physical rows are cleaned when the next data job starts for that school. An operator may periodically purge expired rows for dormant schools. Completed import payloads are erased immediately while their retry receipt remains until expiry/cleanup. Import/export audit records contain counts, not names or CSV content. Data jobs are not backups or long-term integration queues.

## Offline synchronization

Open **Offline catalogue drafts** from the school navigation. This phase deliberately stores **non-personal book catalogue metadata only**, not learner profiles, marks, attendance, messages or fees. Confirm that the device is trusted, create a new title or load an existing catalogue title while online, and save a local draft. Drafts are stored in IndexedDB by account and school, schema version 1, with a maximum of 100 per account. Another account's drafts are not displayed. Sign-out clears this app's drafts from the browser.

The standalone `/offline` route can reopen saved drafts without loading the school access query. After installation/caching, a retained session and app shell allow offline reopening. Browser storage eviction or clearing site data can remove drafts; it is not durable server storage. The browser's connection indicator is advisory. No background synchronization or automatic writes occur when connectivity returns.

Choose **Reviewed — synchronize** when online. A stable request key is persisted before transmission. If a response is lost, retry the same request; the UI locks its fields until the result is reconciled. This prevents edits from accidentally re-keying an uncertain create request. The database rechecks current library permissions, school scope, optimistic version and idempotency. Revoked users cannot synchronize.

On a conflict the server record is displayed, and nothing is overwritten. **Keep server record** discards the local draft. **Keep my changes for review** rebases the draft onto the displayed version with a new request key, requiring a separate synchronization click. A further concurrent change triggers another conflict. Archived server records cannot be restored through conflict resolution. Catalogue synchronization uses the existing checked library workflow, including audit history. It never creates or changes physical copies or loans.

## Integrations and AI-ready services

- **Download calendar** exports selected school terms to RFC 5545 iCalendar, with stable event UIDs, versions, exclusive all-day end dates, Unicode-safe line folding and escaped text. Import the file into Google Calendar, Outlook/Microsoft 365 or another compatible client. This is a portable file integration, not an OAuth connection or live subscription. Some clients duplicate repeated file imports.
- **Download report JSON** provides a versioned school report for manual downstream processing.
- **Download analysis context** supplies a versioned whole-school operations contract for a future analysis adapter. Only whole-school learner/teacher counts of ten or more are included; smaller counts are null. Names, IDs, classes, assessment marks, financial records and messages are absent. Counts and combinations with other datasets can still identify people. Review before sharing.
- No AI model, webhook, email/SMS/payment provider or cloud calendar receives data automatically. Provider credentials, contracts and deployment-specific consent are required before adding a server-side delivery adapter. There are no fake connected-provider switches or automated learner eligibility decisions.

## Multi-school operations

`/platform` is available only to active operators provisioned in `private.platform_admins` by a trusted infrastructure administrator. A school's `SUPER_ADMIN` label cannot be assigned through school membership APIs, and a school administrator cannot grant themselves platform access. The operator's access is checked on every list request.

The operator sees a paginated school directory (20 per page), active learner and administrator counts, and existing subscription metadata. Selecting a school opens its authorized workspace using the existing platform permission model. No membership is inserted to impersonate a school user. Operators retain their identity for auditing. Ordinary school switching remains restricted to assigned memberships. Plan collection, automatic suspension and cross-school bulk writes remain outside this release; subscription metadata does not enforce billing.

## Deployment

Apply `20261025125043_phase7_advanced.sql` after the Phase 6 migrations. Public RPC wrappers are invokers; privileged implementations are in `private` and check `auth.uid()` plus fresh permissions. Never expose `private` through the Data API. The existing Supabase GitHub integration and Vercel deployment from `main` apply source/migration changes after release. No test users or synthetic records are deployed by the test suite.
