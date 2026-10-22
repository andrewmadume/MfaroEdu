# Phase 3 — Academics

Implemented locally on 10 October 2026, refined on 12 October 2026 in version 0.3.1. Apply migrations 0011–0016 after the Phase 2 migrations. Existing installations need the new 0016 migration; earlier migration files are unchanged. Production screens call Supabase; no demo records are embedded in the application.

## Workflow

1. Configure **Grading rules** under **Assessments & results**. Define band minimum percentages from highest to lowest ending at zero, labels, pass percentage and assessment types. No default national grading system is imposed. Configure every term weight for annual summaries.
2. Select **Assessments & gradebook**, a class subject and term. Term options are filtered to the selected class's year; changing the class subject resets the term selection. Create an assessment with date, maximum mark and positive weight. The date must fall inside the term; the term must belong to the class year.
3. Open its gradebook. The roster uses historical enrollment on the assessment date. Capture marks with Tab, select absent/exempt where applicable and add comments. Save changed rows together. Weighted draft subject totals update from the database after saving. Version conflicts reject the entire batch and preserve the unsaved input; reload to resolve them.
4. A school administrator or principal selects a class/term under **Results & reports** and previews the complete results. Every enrolled learner and active class subject needs applicable assessments; missing marks block publication. Add principal notes and the school's promotion decision, then preview again.
5. Review learner reports and publish. Publication compares the reviewed documents to current server calculations; changed results require another preview. Families see the release only after this operation commits.
6. View/print a learner report or print the whole selected class. **Print / save PDF** opens the browser dialog: choose a printer or **Save as PDF**. Printing uses A4 pages and the MfaroEdu logo on white. This is browser PDF output, not a server-generated downloadable file.
7. Use **Academic report** for complete published class/term subject averages and pass rates. **Annual summary** combines a learner's published term reports using the configured annual weights.

To correct a mistakenly captured draft score, select **Incomplete · pending** and save. This clears the score through an audited versioned update; it does not delete the mark record. The draft subject total becomes incomplete and publication is blocked until the score is recaptured or an explicit absence/exemption is recorded. Existing published family reports remain unchanged. Grading-rule save confirmation now survives the query refresh and clears when editing begins again.

## Calculations

- Raw mark percentage: `100 × mark / maximum`.
- Subject percentage: sum of each applicable percentage times its assessment weight divided by included weights. Absent is an explicit zero. Exempt is excluded. Missing is incomplete, never silently zero.
- Each subject percentage is rounded to two decimals before band classification and the overall calculation. PostgreSQL decimal arithmetic is authoritative; the client percentage is a capture preview.
- Term average: sum of graded subject percentages times class-subject weights divided by included subject weights. Entirely exempt subjects do not affect the denominator. At least one graded subject is required.
- Bands classify percentages using descending inclusive minimums. The zero band covers the bottom of the range; each higher band starts at its configured threshold. Pass status uses the independent configured pass threshold.
- Annual subject percentages use published term percentages and the school's current positive term weights. Every nonarchived term in the selected year must have a weight and a visible published report. Missing terms block the summary. Entirely exempt term-subject entries are excluded; subjects absent from a term are omitted from that subject's denominator.
- Annual overall average uses the latest included term's class-subject weight for each subject, with current grading labels and threshold. It is a generated summary, not a separately released immutable annual document. Resolve multiple active class reports for one learner in a term by withdrawing superseded releases before generating it; ambiguous transfer results are not silently combined.
- Promotion status is entered by the school, not inferred from a hard-coded pass policy. Attendance is explicitly unavailable until Phase 4; no attendance totals are invented.

## Access

| Role | Academic scope |
| --- | --- |
| School admin / principal | School grading, all assessments/marks, report notes, preview, publication, withdrawal, history and academic reports |
| Teacher | Draft assessments and marks for exact assigned class subjects; published reports for assigned classes |
| Parent | Published reports and annual summaries for linked children only |
| Learner | Own published reports and annual summaries only |
| Other roles | No new academic access |

Tenant relationships use composite foreign keys. RLS and checked RPCs enforce access independently of navigation. Direct mark/note/publication/snapshot writes and deletes are not granted to authenticated users. All academic mutations are audited without copying private marks/comments into audit metadata. Revoked role/subject/guardian assignments revoke relevant access at the database.

## Concurrency and history

Assessment/rule updates use optimistic versions. Mark batches verify both assessment and individual mark versions, enrollment eligibility and score limits atomically. School row locks serialize grade capture, grading configuration and publication. Term/enrollment date changes cannot remove authorization for captured historical assessments. Existing snapshots retain marks, comments, grading and school metadata even after draft values change. Republishing creates new immutable reports, withdraws the previous release and keeps earlier snapshots available to school publishers. Teachers/families cannot see withdrawn releases.

## Limits and integration gate

There is no Supabase project configured. Embedded PostgreSQL checks exercise actual SQL, while browser fixtures exercise UI behavior; neither validates hosted JWT verification, real PostgREST embedding, Auth/email delivery, PDF dialogs on all browsers or multi-client production concurrency. Complete these checks before introducing real school records. Whole-class report documents can be large; load-test actual school sizes and hosted API payload limits before rollout. Audit retention, backups and deployment security remain operational tasks. Offline academic writes, national policy presets, automatic promotion, per-learner elective enrollment, storage-backed school-logo uploads, spreadsheet imports and server PDF generation are outside this release.
