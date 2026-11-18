# Hosted database deployment

The Supabase GitHub integration connects `andrewmadume/MfaroEdu` to the MfaroEdu project `nafnbwyfdmjlznixqybj`.

- Production GitHub branch: `main`.
- Working directory: repository root (`.`).
- Deploy to production: enabled.
- Automatic preview branching: disabled.
- Migration source: `supabase/migrations/`, in version order.
- Production seed data: not deployed. `seed.sql` is for local development only.

Pushing or merging to `main` allows Supabase to apply pending migrations. Review migration SQL and run `npm run test:db` before merging database changes. Read deployment status in the Supabase dashboard and confirm that migration history matches the repository after each release.

The `private` schema must not be exposed through the Data API. Application tables require row-level security. The `mfaroedu-communications` Storage bucket must remain private. Never commit service-role keys, database passwords, or Supabase access tokens.

This deployment connection does not publish the frontend or configure its environment. Frontend deployments need `VITE_SUPABASE_URL` and a public `VITE_SUPABASE_PUBLISHABLE_KEY`. Hosted Auth, redirects, SMTP and end-to-end account flows need separate acceptance checks.

## v0.7.1 completion release

Migration `20261028030133_finish_phase4_operations.sql` finishes attendance/timetable workflows and preserves existing API signatures while moving privileged public function bodies into `private`. Existing published academic documents remain immutable. No seeds or Auth accounts are deployed.

Vercel's CSP connect-src is pinned to the production project's HTTPS/WSS origins. Update it along with public client configuration when deploying against a different project. Before introducing school data, complete real-account Auth/Storage acceptance and backup/restore procedures. Invite the first administrator from the Supabase Authentication Users dashboard, let that person set their own password, then sign in and create the first school through the application. Do not put passwords, invitation links or Auth tokens in Git.

## v0.7.2 completion release

Apply `20261118140849_complete_school_workflows.sql` after the existing 22 migrations. It adds the private `mfaroedu-documents` bucket, school event/document tables with RLS, private email-bound invitations, additional import/export jobs and branding columns. Keep both Storage buckets private and `private` unexposed. The frontend and database must be verified together before accepting the release. See `docs/OPERATIONS.md` for SMTP, real-role/Storage, physical PWA and backup/restore acceptance. `/release.json` identifies the frontend version/commit and is not a live database health endpoint.

The follow-up `20261118150417_invitation_account_receipts.sql` returns the accepted account UUID only in the already-authorized manager invitation list, for linking directory profiles. The final `20261118175559_tune_access_policy_queries.sql` preserves four access-policy predicates while avoiding per-row identity evaluation, and adds 33 covering foreign-key indexes. There are 25 migrations in total. Short lock/statement timeouts bound the index rollout; verify migration history and fresh advisors independently of frontend deployment.
