# Phase 6 — Communication and library · v0.6.0

Implemented locally on 24 October 2026. Phase 4 remains a disabled draft. No real school data, live messages, hosted uploads or migrations were sent during development.

## Communication workflow

1. Open **Communication hub**. The published feed includes announcements available under your current school/class/role relationships. Search and pagination apply on the server.
2. School administrators and principals can create school-wide, teacher, parent, learner or class announcements. Teachers can post only to classes they currently teach. Use **New announcement**, save a draft, add attachments if needed, then publish. Published title/body/audience cannot be edited; withdraw and publish a corrected draft instead. Drafts and withdrawn posts remain in the authorized management history.
3. Published announcements create personal in-app notifications for current eligible school members. The notification center supports unread/all views, opening the source and marking each notice as read. A newly eligible member can read the feed but does not receive historical notification backfill. Withdrawal or loss of audience eligibility blocks subsequent source/file requests and hides the corresponding notifications.
4. **Settings → Enable family messaging** is off by default. When enabled, parents/learners can contact assigned teachers and school administrators/principals. Teacher/family eligibility follows current enrollment, teacher assignment, guardian links and active membership. Staff can contact staff independently of this setting. The recipient search returns names/roles only, never emails or private learner profiles.
5. **Messages → New message** creates or reuses a private two-person conversation. Replies go to the same participant. Messages are append-only; only participants with active school access may read them. Administrators cannot browse other people's conversations. Disabling family messaging or removing the relevant teaching relationship blocks new replies while participants retain their own history. Removing the current user's school access blocks history as well.
6. The latest 20 messages are shown chronologically within page 1; later pages show older history. Inbox/feed queries refresh every 30 seconds and through **Refresh inbox**. No browser push, external delivery or offline sending is claimed.

## Private attachments

- Announcements support up to five PDF, PNG, JPEG or plain text files, each between 1 byte and 5 MB. Only authorized draft editors may reserve/finalize/remove files. Published attachments are immutable.
- Files live in the private `mfaroedu-communications` bucket. Paths use the school and a reserved UUID; the original name is metadata, never a trusted path. Bucket MIME/size limits and Storage RLS supplement metadata validation.
- Upload is a recoverable sequence: reserve metadata, upload with overwrite disabled, then verify Storage metadata and finalize. Pending files block publication. After a failed upload, use **Retry**, **Finish uploaded file**, or remove the pending entry and start again. Finalization checks stored size/MIME; publication also verifies that the object still exists.
- Removal uses the Storage API first and then soft-removes metadata. Storage upload/delete checks serialize with announcement publication, preventing a draft mutation from deleting a newly published object. Download performs a fresh authenticated request and saves a blob locally; no public or long-lived signed URL is created.
- Withdrawing a post stops subsequent family downloads. It cannot retract bytes a reader already downloaded. Uploaders are trusted school staff; antivirus/content scanning is not implemented. General learner/staff document management is outside this phase.

## Library workflow

1. School administrators and librarians open **School library**, register titles (author, ISBN, category, publisher), then register each physical copy with a school-unique accession number, shelf/location, condition and availability status. ISBN is descriptive; different editions may have separate title records.
2. Configure **Borrowing rules**: default loan days (1–365), maximum open books per learner (1–50), maximum renewals per loan (0–20). Defaults are 14 days, 3 books and 2 renewals. New limits apply to subsequent operations; existing due dates/history are not rewritten.
3. **View copies → Issue copy**, choose an active registered learner and dates, then confirm. Librarians receive a minimal learner lookup, not private profiles. The server checks title/copy availability, copy version, borrowing limit, dates, historical overlap and the unique open-loan constraint.
4. Open **Borrowing history → Open loan** to renew, return or report lost. Renewals must extend the due date, meet the configured renewal limit and stay within one year of today. Returns/losses cannot precede the latest recorded activity. Activity notes are visible to the borrower and linked parents.
5. A damaged return closes the loan and marks the copy unavailable. A lost report closes the loan and records the copy as lost. Repair/recovery is recorded by updating the copy to a lendable condition/status; previous lost/damaged loan events remain unchanged. Retire obsolete copies rather than deleting history.
6. Books with open loans cannot be archived. Copies on loan cannot be edited or retired. Closed loans cannot be renewed or closed again with a new request. Loan/title/borrower snapshots preserve the original borrowing record after later catalogue/profile edits.
7. Families can browse the catalogue and read only their own/linked learners' history; school administrators, librarians and principals can view authorized school circulation. Teachers have catalogue access without access to other learners' loan records unless another role grants it.
8. **Library reports** shows active titles, registered non-retired copies, lendable copies, open/overdue loans and lost/damaged inventory. Overdue means an open loan whose due date is before today's school-local date. These are current reports; historical report exports, staff borrowing, reservations, barcode scanning and fines are future extensions.

## Authorization and consistency

- Three CLI-generated migrations add explicit grants, RLS, tenant composite foreign keys and indexes. Client writes use checked private functions behind public invoker wrappers. Authorization reads current membership/profile/relationship tables; editable JWT user metadata never grants access.
- Financial and academic modules are unchanged. Phase 4 navigation/resources remain disabled. School switches and sign-out clear private application query data; the PWA caches public static assets only.
- Writes use version checks and per-request idempotency. A repeated key with the same actor/module/payload returns the original result; changed details are rejected. Local forms retain failed input and reuse their key for an identical retry. Editor snapshots do not refresh silently in the background; reload after a conflict before making a revised attempt.
- Library and communication mutations acquire the school lock before resource locks. Copy availability and per-learner limits are checked atomically; unique open-copy loans provide an additional database constraint. Storage mutations lock their announcement before rechecking draft permissions.
- Messages, circulation events, catalogue changes and publication actions create audit entries that identify actor/action/entity without copying complete message bodies or borrowing notes into the general audit log. Notifications retain their personal read state. Infrastructure database owners remain trusted operators.

## Transport extension

`src/services/community.ts` defines `CommunicationTransport` and the active `IN_APP` adapter. Only in-app delivery is registered. Future email/SMS/WhatsApp adapters must run on a trusted server, recheck recipient authorization, manage secrets outside browser variables, and add an auditable outbox/retry/delivery lifecycle. There are no provider credentials, fake delivery statuses or external network sends in this release.

## Verification and hosted acceptance

Run `npm test`, `npm run test:db`, `npm run test:e2e` and `npm run build`. The database tests execute actual migration SQL and RLS in embedded PostgreSQL. A test-only Storage catalogue shim exercises policies and metadata transitions, not Storage's HTTP service or file-byte handling. Browser tests use synthetic protocol fixtures and cover desktop/mobile workflows, attachments, publication, notifications, private replies, circulation and conflicts.

The connected MfaroEdu project was inactive on 24 October. Its advisor API returned no existing security lints, but the Phase 6 migrations have not been applied there; that response does not validate this new schema. Official Storage access-control/download documentation was checked. The changelog markdown endpoint could not be retrieved by the browser tool.

Before school rollout, restore/configure a suitable test project, review/apply all pending migrations, and verify real Auth/PostgREST/Storage with every role. Specifically test concurrent issue attempts, borrower limits, upload/delete versus publication, interrupted uploads, content type/size enforcement, direct object-path guesses, membership/link revocation, private downloads, unread-state persistence and actual multi-client polling. Run security/performance advisors on the deployed schema. No hosted deployment or service validation was performed in this phase.
