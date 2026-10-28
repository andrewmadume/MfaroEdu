# Historical Phase 4 design reference

The interrupted draft below is superseded by `../PHASE4.md` and accepted migration `20261028030133_finish_phase4_operations.sql`. Do not deploy the historical schema independently. The completed implementation uses checked workflows and school-level serialization instead of the draft's `btree_gist` occupancy table.

# Phase 4 draft — do not deploy

Phase 4 was interrupted before its database workflows and acceptance tests were completed. Its React pages, service contracts, resource definitions and CSS remain in source for future work. `src/lib/features.ts` disables all Phase 4 routes, navigation and room/time-slot directory URLs.

`phase4-schema.sql` is an unfinished design reference, **not a migration**. It depends on `btree_gist`; it has not been applied or accepted. Do not copy it into migrations or enable the feature flag without finishing the workflow functions, authorization/integrity review and actual database/browser tests. In particular, review attendance date/enrollment history, optimistic conflicts, finalization, session uniqueness, booking overlap exclusion and error handling in report selectors.

Phase 5 finance is independent of this draft and does not claim Phase 4 completion.
