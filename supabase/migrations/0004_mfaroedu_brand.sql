-- Set the default for newly created schools; preserve existing school customisations.
begin;
alter table public.schools alter column brand_color set default '#0047d6';
commit;
