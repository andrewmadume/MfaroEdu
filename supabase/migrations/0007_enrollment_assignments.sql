begin;
create table public.class_subjects (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 class_id uuid not null, subject_id uuid not null, compulsory boolean not null default true, weight numeric(7,2) not null default 1 check(weight>0 and weight<=1000),
 foreign key(school_id,class_id) references public.classes(school_id,id), foreign key(school_id,subject_id) references public.subjects(school_id,id), unique(school_id,class_id,subject_id),
 search_text text generated always as (id::text) stored
);
create index class_subjects_school_list on public.class_subjects(school_id,archived,id);
create table public.teacher_assignments (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 staff_id uuid not null, class_subject_id uuid not null,
 foreign key(school_id,staff_id) references public.staff(school_id,id), foreign key(school_id,class_subject_id) references public.class_subjects(school_id,id), unique(school_id,staff_id,class_subject_id),
 search_text text generated always as (id::text) stored
);
create index teacher_assignments_school_list on public.teacher_assignments(school_id,archived,id);
create table public.enrollments (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 archived boolean not null default false, version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
 student_id uuid not null, academic_year_id uuid not null, class_id uuid not null, starts_on date not null, ends_on date,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','COMPLETED','TRANSFERRED','WITHDRAWN')),
 check(ends_on is null or ends_on>=starts_on), check((status='ACTIVE' and ends_on is null) or (status<>'ACTIVE' and ends_on is not null)), check(not archived),
 foreign key(school_id,student_id) references public.students(school_id,id), foreign key(school_id,academic_year_id) references public.academic_years(school_id,id),
 foreign key(school_id,class_id,academic_year_id) references public.classes(school_id,id,academic_year_id),
 search_text text generated always as (id::text) stored
);
create index enrollments_school_list on public.enrollments(school_id,archived,id);
create unique index one_active_enrollment_per_year on public.enrollments(school_id,student_id,academic_year_id) where status='ACTIVE';
create index enrollment_student_history on public.enrollments(school_id,student_id,starts_on desc);
create index enrollment_class on public.enrollments(school_id,class_id,student_id);
commit;
