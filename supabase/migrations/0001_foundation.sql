begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.schools (
 id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 2 and 120),
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 63),
 contact_email text, phone text check(length(phone)<=30), address text check(length(address)<=500),
 timezone text not null default 'Africa/Johannesburg', currency text not null default 'ZAR' check(currency ~ '^[A-Z]{3}$'),
 brand_color text not null default '#173f35' check(brand_color ~ '^#[0-9a-fA-F]{6}$'),
 version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=120), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.roles (id text primary key, label text not null);
create table public.permissions (id text primary key, description text not null);
create table public.role_permissions (
 role_id text not null references public.roles(id), permission_id text not null references public.permissions(id), primary key(role_id,permission_id)
);
create table public.user_roles (
 school_id uuid not null references public.schools(id), user_id uuid not null references public.profiles(id),
 role_id text not null references public.roles(id), active boolean not null default true,
 created_at timestamptz not null default now(), primary key(school_id,user_id,role_id),
 constraint platform_role_not_school_role check(role_id <> 'SUPER_ADMIN')
);
create index user_roles_user_idx on public.user_roles(user_id,school_id) where active;
-- Platform operators are provisioned out-of-band; school administrators cannot grant this role.
create table private.platform_admins (user_id uuid primary key references public.profiles(id));
create table private.school_subscriptions (
 school_id uuid primary key references public.schools(id), plan_code text not null default 'trial',
 status text not null default 'trial' check(status in ('trial','active','suspended','cancelled')), provider_reference text, created_at timestamptz not null default now()
);
create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
create trigger schools_updated before update on public.schools for each row execute function private.touch_updated_at();
create trigger profiles_updated before update on public.profiles for each row execute function private.touch_updated_at();
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id,display_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',''),120)); return new; end $$;
create trigger auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
insert into public.profiles(id) select id from auth.users on conflict do nothing;
commit;
