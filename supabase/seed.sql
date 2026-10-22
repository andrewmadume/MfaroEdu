-- Development metadata only. Auth users are created with scripts/seed-demo.mjs.
-- No passwords, real learners, or production data belong in seed files.
insert into public.schools(id,name,slug) values ('10000000-0000-4000-8000-000000000001','Demonstration School (development only)','development-school') on conflict do nothing;
