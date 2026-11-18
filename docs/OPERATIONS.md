# Production acceptance and operations

Use the production repository `andrewmadume/MfaroEdu`, Vercel project `mfaro-edu`, and Supabase project `nafnbwyfdmjlznixqybj`. Never place service-role keys, database passwords, email credentials, invitation links or authenticated browser traces in GitHub, build logs or chat.

## Deployment and monitoring

1. Before release, run `npm ci`, `npm run security:check`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run test:e2e` and `npm run build`.
2. Publish reviewed source to main. The existing GitHub integrations apply migrations and build Vercel production. Check both systems; a successful frontend build does not prove database deployment.
3. Match the production `/release.json` commit to the intended GitHub commit. Confirm all 23 migrations in Supabase's Migration History. Check GitHub CI and Vercel build status.
4. Review Supabase Security/Performance Advisors after each schema change. Keep `private` outside exposed schemas and both Storage buckets private. Review Auth, PostgREST and Storage error rates without collecting passwords/tokens or unnecessary personal data.
5. Assign a named operator to review failed deployments, service errors, quota/capacity and backup status. Alerts must go to a user-approved destination; no external monitoring account or notification subscription is created by this release.

## Authentication and email

- Configure a school-approved custom SMTP service in Supabase Authentication settings, with its sender domain and DNS records verified. Enter SMTP credentials directly in that dashboard, never frontend environment variables. The default Supabase mail service has recipient/rate restrictions and is insufficient evidence of general invitation delivery.
- Production Site URL: `https://mfaro-edu.vercel.app`; permit password redirects to `/auth/reset`. Test confirmation/recovery and password saving in the same browser. Cross-browser externally generated links are separately handled by the verified fragment callback.
- Sign out and sign back in with the privately chosen password. Confirm token refresh, expired/revoked sessions and the fresh account cache boundary.
- Test administrator, principal, teacher, learner, parent, accountant and librarian accounts with least privilege. Use an approved test school; do not introduce fabricated learner information into the real school. Confirm unrelated-school and unrelated-family denials over real HTTP, including retained old URLs after revocation.
- Recheck leaked-password protection in Supabase. The previous organization plan did not include this paid feature. No paid plan upgrade is authorized by the implementation. Keep the 12-character password policy and monitor the outstanding advisor status until the feature can be enabled on an eligible plan.

## Storage acceptance

Using approved disposable files, verify both private buckets: allowed size/type, unexpected object paths, anonymous denial, family visibility, staff-only isolation, failed/retried uploads, duplicate retry, no overwrite, archive/withdrawal and immediate membership/relationship revocation. Compare downloaded bytes with the original. Test concurrent publish/delete and finish/archive attempts from separate clients. SQL metadata tests do not emulate this HTTP/file-byte behavior.

## Backup and restore

Record an owner, retention period, acceptable data-loss interval and restore-time target before rollout. Confirm which backups/PITR are actually available on the project's current plan; do not assume Free projects have downloadable managed backups.

Use an approved encrypted destination for logical backups or managed backup/PITR facilities. PostgreSQL backups do not by themselves contain all Storage file bytes; preserve private objects plus their metadata/paths through an approved Storage backup process. Protect Auth/account data and operator access separately. Record the migration version and application commit accompanying each backup.

Restore into a separate, explicitly approved test project, never over production for a drill. Keep outgoing email/providers disabled or routed to approved test destinations during the drill. Validate schema/migration history, row counts, constraints, RLS, representative academic/fee snapshots, Auth identity mapping and Storage byte integrity. Verify that unauthorized accounts remain denied after restore. Record start/end time, outcomes and deletion/retention approval for the temporary environment. Creating an additional paid project or performing a destructive restore requires separate authorization.

This runbook is a procedure, not a claim that a production restore drill has been performed.

## Physical PWA acceptance

On a real Android device, install from Chrome; on a real iPhone/iPad, use Safari's Add to Home Screen. Verify the supplied MfaroEdu icon, app launch, safe areas, keyboard/forms, private sign-out, and a release update after saving work. Confirm that only non-personal catalogue drafts reopen offline, and that synchronization requires current server permission and explicit conflict review. Device emulation and service-worker tests do not replace this physical check.

Keep Phase 8 on hold until external acceptance outcomes and remaining operational decisions are recorded in `VERIFICATION.md`.
