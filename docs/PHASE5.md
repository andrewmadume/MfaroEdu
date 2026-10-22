# Phase 5 — Finance · v0.5.0

Implemented locally on 22 October 2026. Phase 4 remains an unpublished draft; finance does not depend on it. No real school records, online charges, emails or live migrations were used.

## Workflow

1. Sign in as a school administrator or accountant. Open **Fees & accounts → Fees & currency**. Save the school currency's decimal precision (0–3), add your own categories, then add annual fee structures. A grade restriction is optional. The school currency must be configured in School settings first.
2. Open **Learner accounts**, search for a registered learner by name/admission number, and select the account. Accountants receive a minimal billing lookup, not access to learner birth dates, emergency details or full profiles.
3. Choose **Issue an invoice**, select the learner's enrolled academic year, dates, applicable fees and quantities. The server validates year/grade eligibility and fee versions. Add a fee structure first for any additional charge. Issued descriptions, prices, school/learner identity and currency are captured as a snapshot.
4. Open the invoice and **Record payment received** for money the school has already received. Choose cash, bank transfer, card or other and enter an optional reference. A receipt number is generated. Payment records do not contact a provider or perform a charge.
5. Use **Discount** or **Bursary** with a reason to reduce the amount owed. References and reasons are visible on the learner account; do not enter confidential internal notes.
6. Correct a payment/concession with **Reverse a payment or concession**, selecting the original transaction and giving a reason. Reversal is full only and retains the original record/receipt. Arrange any actual refund separately. To cancel an invoice, reverse all payments and concessions first, then void it. Reissue a corrected invoice if required.
7. Use the account statement date range for opening balance, chronological entries, running balance and closing balance. On-screen history and invoices use 20-record pages. **Print full statement / Save PDF** collects every page under a fixed server timestamp, so concurrent transactions cannot change the document halfway through.
8. Use **Financial reports** for a selected period of up to one year. Print invoices, receipts, statements or reports through the browser dialog and choose Save as PDF when needed.

## Calculations and integrity

- All amounts are bounded integer minor units (maximum 9,000,000,000,000 per invoice/entry); UI parsing and formatting use BigInt. Aggregates and monetary API values use decimal strings, avoiding floating point arithmetic and JSON integer rounding.
- A single currency and precision apply to each school. Currency and precision lock permanently after the first invoice, including voided history. Changing currency requires a separately designed conversion/migration; existing balances must never mix currencies.
- An invoice is a positive debit. Payments, discounts and bursaries are negative credits; a full reversal has the opposite sign; a void offsets the original invoice debit. Balance is the exact sum of entries, never an editable field.
- Credits cannot exceed the current invoice balance. The server also rejects backdating that would make a historical running balance negative. Reversal dates cannot precede the original transaction.
- New invoices require a registered, unarchived learner with enrollment in the chosen year. Invoices can be paid after learner archival; history remains accessible to authorized users. Fee price/name edits and archiving never rewrite issued invoices.
- Transactions lock the school and invoice, check optimistic invoice versions, and commit atomically. A repeated request key with identical details returns the existing result; changed details with the same key are rejected. The form retains a stable key after an unsuccessful network attempt. Reload after a conflict before attempting a revised transaction.
- Ledger entries cannot be edited/deleted through the API. All financial writes use checked private functions behind public invoker wrappers; every call checks active account and school permission. New tables use RLS and explicit grants. Audit events record actor/entity/action without copying full financial documents into the audit log.

## Report definitions

| Figure | Definition |
|---|---|
| Net invoiced | Invoice debits plus void offsets posted within the period |
| Net payments received | Payments minus their reversals posted within the period |
| Net discounts & bursaries | Concessions minus their reversals posted within the period |
| Outstanding at end date | All ledger entries dated on/before the end date, independent of the period start |
| Statement opening | All learner entries dated before the start date |
| Statement closing | All learner entries dated on/before the end date |

Voiding/reversing is recognized on its posting date. Prior periods retain their historical figures. These are fee-ledger reports; expenses, bank reconciliation, tax accounting and a general ledger are outside this phase. Receipts are payment acknowledgements; no jurisdiction-specific tax invoice certification is claimed.

## Permissions

| Role | Access |
|---|---|
| School admin / authorized platform admin | Fee setup, billing, posting, reports |
| Accountant | Fee setup, minimal learner billing search, billing, posting, reports; no general learner profile access |
| Principal | School finance accounts and reports, read only |
| Parent / learner | Linked child / own account, invoices, receipts and statements; no posting or school-wide report access |
| Teacher / librarian | No finance access unless another active role grants it |

Membership/link revocation and inactive profiles are checked in the database. Tenant IDs alone never grant access. Keep `private` out of PostgREST's exposed schemas.

## Verification and remaining service acceptance

Run `npm test`, `npm run test:db`, `npm run test:e2e` and `npm run build`. Phase 5 adds exact-money unit tests, an actual PostgreSQL finance security/workflow suite and desktop/mobile browser workflows using test-only synthetic fixtures. No production fallback data is supplied. See `VERIFICATION.md` for executed results.

The connected MfaroEdu Supabase project was inactive when inspected. Hosted Auth/PostgREST behavior, advisor results, actual multi-client database contention, browser printing on user devices and live acceptance remain unverified. No migration was pushed. Restore/configure a suitable test project, review all pending migrations, apply them through the normal project workflow, then exercise every role before entering real records. The Supabase changelog endpoint could not be retrieved in this environment; current RLS/grant guidance was checked through official documentation search.

## Extension boundaries

Payment methods are provider neutral. Online payment collection, webhook verification, refunds, automatic recurring billing, class-wide batch invoices, partial reversals, unapplied credit, overpayments, expenses, tax rules, reconciliation, currency conversion and external accounting exports are not implemented. Invoice creation is per learner and uses reusable fee structures. Finance requires a network connection; private responses are not cached for offline use.
