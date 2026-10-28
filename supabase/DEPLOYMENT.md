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
