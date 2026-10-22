begin;
insert into public.roles values ('SUPER_ADMIN','Platform administrator'),('SCHOOL_ADMIN','School administrator'),('PRINCIPAL','Principal'),('TEACHER','Teacher'),('STUDENT','Learner'),('PARENT','Parent / guardian'),('ACCOUNTANT','Accountant'),('LIBRARIAN','Librarian');
insert into public.permissions values
 ('dashboard.view','View own role dashboard'),('school.view','View school details'),('school.update','Update school details'),
 ('members.view','View school memberships'),('members.manage','Manage school memberships'),('audit.view','View school audit trail');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p where r.id not in ('SUPER_ADMIN','SCHOOL_ADMIN') and p.id in ('dashboard.view','school.view');
insert into public.role_permissions values ('PRINCIPAL','members.view'),('PRINCIPAL','audit.view');
create function private.is_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and active)
$$;
create function private.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active() and exists(select 1 from private.platform_admins where user_id=(select auth.uid()))
$$;
create function private.is_member(target_school uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active() and (private.is_platform_admin() or exists(select 1 from public.user_roles where school_id=target_school and user_id=(select auth.uid()) and active))
$$;
create function private.has_permission(target_school uuid, required_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active() and (private.is_platform_admin() or exists(
 select 1 from public.user_roles ur join public.role_permissions rp on ur.role_id=rp.role_id
 where ur.school_id=target_school and ur.user_id=(select auth.uid()) and ur.active and rp.permission_id=required_permission))
$$;
create function public.my_permissions(target_school uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(p.id order by p.id),'{}'::text[]) from public.permissions p where private.has_permission(target_school,p.id)
$$;
-- Enrollment into a new tenant is atomic. No user can choose another school's ID or role.
create function public.create_school(school_name text, school_slug text, school_timezone text default 'Africa/Johannesburg', school_currency text default 'ZAR') returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not private.is_active() then raise exception 'Active account required'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Verified email required'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=school_timezone) then raise exception 'Invalid time zone'; end if;
 insert into public.schools(name,slug,timezone,currency) values(trim(school_name),school_slug,school_timezone,school_currency) returning id into new_id;
 insert into public.user_roles(school_id,user_id,role_id) values(new_id,auth.uid(),'SCHOOL_ADMIN');
 insert into private.school_subscriptions(school_id) values(new_id);
 return new_id;
end $$;
revoke all on all functions in schema private from public,anon;
revoke all on function public.my_permissions(uuid), public.create_school(text,text,text,text) from public,anon;
grant execute on function private.is_active(),private.is_platform_admin(),private.is_member(uuid),private.has_permission(uuid,text) to authenticated;
grant execute on function public.my_permissions(uuid), public.create_school(text,text,text,text) to authenticated;
commit;
