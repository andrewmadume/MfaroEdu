begin;
create table public.academic_years (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 name text not null check(length(trim(name)) between 1 and 120), starts_on date not null, ends_on date not null, check(ends_on>=starts_on), unique(school_id,name),
 search_text text generated always as (name) stored
);
create index academic_years_school_list on public.academic_years(school_id,archived,id);
create table public.terms (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 name text not null check(length(trim(name)) between 1 and 120), academic_year_id uuid not null, starts_on date not null, ends_on date not null, check(ends_on>=starts_on),
 foreign key(school_id,academic_year_id) references public.academic_years(school_id,id), unique(school_id,academic_year_id,name),
 search_text text generated always as (name) stored
);
create index terms_school_list on public.terms(school_id,archived,id);
create table public.grades (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 name text not null check(length(trim(name)) between 1 and 120), sort_order integer not null default 0 check(sort_order between 0 and 100), unique(school_id,name),
 search_text text generated always as (name) stored
);
create index grades_school_list on public.grades(school_id,archived,id);
create table public.classes (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 name text not null check(length(trim(name)) between 1 and 120), academic_year_id uuid not null, grade_id uuid not null, capacity integer check(capacity between 1 and 1000),
 foreign key(school_id,academic_year_id) references public.academic_years(school_id,id), foreign key(school_id,grade_id) references public.grades(school_id,id),
 unique(school_id,academic_year_id,grade_id,name), unique(school_id,id,academic_year_id),
 search_text text generated always as (name) stored
);
create index classes_school_list on public.classes(school_id,archived,id);
create table public.subjects (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 name text not null check(length(trim(name)) between 1 and 120), code text not null check(length(trim(code)) between 1 and 24), description text check(length(description)<=1000), unique(school_id,code),
 search_text text generated always as (code || ' ' || name) stored
);
create index subjects_school_list on public.subjects(school_id,archived,id);
commit;
