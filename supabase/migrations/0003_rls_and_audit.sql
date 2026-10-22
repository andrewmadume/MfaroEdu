begin;
alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table private.platform_admins enable row level security;
alter table private.school_subscriptions enable row level security;
revoke all on public.schools,public.profiles,public.roles,public.permissions,public.role_permissions,public.user_roles from anon,authenticated;
grant select on public.schools,public.profiles,public.roles,public.permissions,public.role_permissions,public.user_roles to authenticated;
grant update(name,slug,contact_email,phone,address,timezone,currency,brand_color,version) on public.schools to authenticated;
grant update(display_name) on public.profiles to authenticated;
create policy schools_read on public.schools for select to authenticated using(private.is_member(id));
create policy schools_update on public.schools for update to authenticated using(private.has_permission(id,'school.update')) with check(private.has_permission(id,'school.update'));
create policy profiles_self on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid()) and private.is_active()) with check(id=(select auth.uid()) and private.is_active());
create policy roles_read on public.roles for select to authenticated using(private.is_active());
create policy permissions_read on public.permissions for select to authenticated using(private.is_active());
create policy role_permissions_read on public.role_permissions for select to authenticated using(private.is_active());
create policy memberships_read on public.user_roles for select to authenticated using(private.is_active() and ((user_id=(select auth.uid()) and active) or private.has_permission(school_id,'members.view')));

create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 actor_id uuid, action text not null, entity text not null, entity_id text not null,
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index audit_school_time_idx on public.audit_logs(school_id,created_at desc);
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon,authenticated;
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated using(private.has_permission(school_id,'audit.view'));
create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare record_json jsonb; tenant uuid;
begin
 record_json=to_jsonb(new);
 tenant=case when tg_table_name='schools' then (record_json->>'id')::uuid else (record_json->>'school_id')::uuid end;
 insert into public.audit_logs(school_id,actor_id,action,entity,entity_id,metadata)
 values(tenant,auth.uid(),tg_op,tg_table_name,coalesce(record_json->>'id',record_json->>'user_id'),jsonb_build_object('role',record_json->>'role_id','active',record_json->>'active'));
 return new;
end $$;
create trigger audit_school after insert or update on public.schools for each row execute function private.audit_change();
create trigger audit_membership after insert or update on public.user_roles for each row execute function private.audit_change();

-- Membership mutation is intentionally only possible through this checked RPC.
create function public.set_membership(target_school uuid, target_user uuid, target_role text, enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_permission(target_school,'members.manage') then raise exception 'Not authorized'; end if;
 if target_role='SUPER_ADMIN' then raise exception 'Platform roles cannot be assigned here'; end if;
 perform 1 from public.schools where id=target_school for update;
 if target_user=auth.uid() then raise exception 'Cannot modify your own membership'; end if;
 if not enabled and target_role='SCHOOL_ADMIN' and not exists(select 1 from public.user_roles where school_id=target_school and role_id='SCHOOL_ADMIN' and active and user_id<>target_user) then raise exception 'School requires an administrator'; end if;
 insert into public.user_roles(school_id,user_id,role_id,active) values(target_school,target_user,target_role,enabled)
 on conflict(school_id,user_id,role_id) do update set active=excluded.active;
end $$;
create function private.validate_school_update() returns trigger language plpgsql set search_path='' as $$
begin
 if new.version<>old.version+1 then raise exception 'Invalid school version'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Invalid time zone'; end if;
 return new;
end $$;
create trigger validate_school before update on public.schools for each row execute function private.validate_school_update();
revoke all on function private.audit_change(),private.validate_school_update() from public,anon,authenticated;
revoke all on function public.set_membership(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.set_membership(uuid,uuid,text,boolean) to authenticated;
commit;
