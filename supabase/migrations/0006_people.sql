begin;
create table public.students (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 first_name text not null check(length(trim(first_name)) between 1 and 80), surname text not null check(length(trim(surname)) between 1 and 80),
 email text check(email is null or (length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')), phone text check(length(phone)<=30),
 user_id uuid references public.profiles(id), unique(school_id,user_id), admission_number text not null check(length(trim(admission_number)) between 1 and 40), middle_name text check(length(middle_name)<=80),
 date_of_birth date not null, gender text not null default 'NOT_SPECIFIED' check(gender in ('FEMALE','MALE','OTHER','NOT_SPECIFIED')),
 admission_date date not null, address text check(length(address)<=500), emergency_name text check(length(emergency_name)<=160), emergency_phone text check(length(emergency_phone)<=30),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','TRANSFERRED','GRADUATED','WITHDRAWN')), check(date_of_birth<admission_date), unique(school_id,admission_number),
 search_text text generated always as (admission_number || ' ' || first_name || ' ' || coalesce(middle_name,'') || ' ' || surname) stored
);
create index students_school_list on public.students(school_id,archived,id);
create table public.parents (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 first_name text not null check(length(trim(first_name)) between 1 and 80), surname text not null check(length(trim(surname)) between 1 and 80),
 email text check(email is null or (length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')), phone text check(length(phone)<=30),
 user_id uuid references public.profiles(id), unique(school_id,user_id), address text check(length(address)<=500),
 search_text text generated always as (first_name || ' ' || surname || ' ' || coalesce(email,'')) stored
);
create index parents_school_list on public.parents(school_id,archived,id);
create table public.staff (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 first_name text not null check(length(trim(first_name)) between 1 and 80), surname text not null check(length(trim(surname)) between 1 and 80),
 email text check(email is null or (length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')), phone text check(length(phone)<=30),
 user_id uuid references public.profiles(id), unique(school_id,user_id), employee_number text not null check(length(trim(employee_number)) between 1 and 40), department text check(length(department)<=120), position text not null check(length(trim(position)) between 1 and 120),
 is_teacher boolean not null default false, employment_status text not null default 'ACTIVE' check(employment_status in ('ACTIVE','ON_LEAVE','LEFT')), unique(school_id,employee_number),
 search_text text generated always as (employee_number || ' ' || first_name || ' ' || surname) stored
);
create index staff_school_list on public.staff(school_id,archived,id);
create table public.student_parents (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 student_id uuid not null, parent_id uuid not null, relationship text not null check(length(trim(relationship)) between 1 and 60), is_primary boolean not null default false,
 foreign key(school_id,student_id) references public.students(school_id,id), foreign key(school_id,parent_id) references public.parents(school_id,id), unique(school_id,student_id,parent_id),
 search_text text generated always as (relationship) stored
);
create index student_parents_school_list on public.student_parents(school_id,archived,id);
create unique index student_primary_guardian on public.student_parents(school_id,student_id) where is_primary and not archived;
create index parent_children on public.student_parents(school_id,parent_id,student_id) where not archived;
commit;
