create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
insert into public.permissions values ('attendance.view','Read authorized finalized attendance'),('attendance.capture','Capture assigned-class attendance'),('attendance.manage','Manage all school registers'),('timetable.view','Read authorized timetables'),('timetable.manage','Manage school resources and schedules');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL') and p.id like any(array['attendance.%','timetable.%']);
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p where r.id in ('TEACHER','STUDENT','PARENT') and p.id in ('attendance.view','timetable.view');
insert into public.role_permissions values ('TEACHER','attendance.capture');

create table public.rooms (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),unique(school_id,id),
 name text not null check(length(trim(name)) between 1 and 120),code text not null check(length(trim(code)) between 1 and 24),capacity integer check(capacity between 1 and 1000),
 archived boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),search_text text generated always as(name||' '||code) stored
);
create unique index rooms_code on public.rooms(school_id,lower(code));
create table public.time_slots (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),unique(school_id,id),
 name text not null check(length(trim(name)) between 1 and 120),starts_at time not null,ends_at time not null,
 check(ends_at>starts_at and starts_at<'24:00' and ends_at<'24:00' and extract(second from starts_at)=0 and extract(second from ends_at)=0),
 archived boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),search_text text generated always as(name) stored
);
create unique index time_slots_name on public.time_slots(school_id,lower(name));
create table public.timetable_slots (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),unique(school_id,id),
 class_subject_id uuid not null,class_id uuid not null,staff_id uuid not null,term_id uuid not null,room_id uuid,time_slot_id uuid not null,weekday integer not null check(weekday between 1 and 7),active boolean not null default true,
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(school_id,class_subject_id) references public.class_subjects(school_id,id),foreign key(school_id,class_id) references public.classes(school_id,id),foreign key(school_id,staff_id) references public.staff(school_id,id),foreign key(school_id,term_id) references public.terms(school_id,id),foreign key(school_id,room_id) references public.rooms(school_id,id),foreign key(school_id,time_slot_id) references public.time_slots(school_id,id)
);
create index timetable_term on public.timetable_slots(school_id,term_id,active,weekday,id);
create index timetable_class on public.timetable_slots(school_id,class_id,active);
create index timetable_staff on public.timetable_slots(school_id,staff_id,active);
create index timetable_room on public.timetable_slots(school_id,room_id,active);
create table private.lesson_occupancy (
 school_id uuid not null,slot_id uuid not null,lesson_on date not null,class_id uuid not null,staff_id uuid not null,room_id uuid,minutes int4range not null,
 primary key(school_id,slot_id,lesson_on),foreign key(school_id,slot_id) references public.timetable_slots(school_id,id),
 constraint class_busy exclude using gist(school_id extensions.gist_uuid_ops with =,lesson_on extensions.gist_date_ops with =,class_id extensions.gist_uuid_ops with =,minutes with &&),
 constraint teacher_busy exclude using gist(school_id extensions.gist_uuid_ops with =,lesson_on extensions.gist_date_ops with =,staff_id extensions.gist_uuid_ops with =,minutes with &&),
 constraint room_busy exclude using gist(school_id extensions.gist_uuid_ops with =,lesson_on extensions.gist_date_ops with =,room_id extensions.gist_uuid_ops with =,minutes with &&)
);
alter table private.lesson_occupancy enable row level security;
revoke all on private.lesson_occupancy from public,anon,authenticated;

create table public.attendance_sessions (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),unique(school_id,id),class_id uuid not null,attended_on date not null,
 name text not null check(length(trim(name)) between 1 and 80),status text not null default 'OPEN' check(status in ('OPEN','FINAL','VOID')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(school_id,class_id) references public.classes(school_id,id)
);
create unique index attendance_session_identity on public.attendance_sessions(school_id,class_id,attended_on,lower(name));
create index attendance_sessions_class_date on public.attendance_sessions(school_id,class_id,attended_on,status);
create table public.attendance_entries (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),session_id uuid not null,student_id uuid not null,
 status text not null check(status in ('PRESENT','ABSENT','LATE','EXCUSED','UNMARKED')),reason text not null default '' check(length(reason)<=1000),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(school_id,session_id,student_id),foreign key(school_id,session_id) references public.attendance_sessions(school_id,id),foreign key(school_id,student_id) references public.students(school_id,id)
);
create index attendance_entries_learner on public.attendance_entries(school_id,student_id,session_id);

create function private.can_capture_attendance(tenant uuid,class_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (private.has_permission(tenant,'attendance.manage') or (private.has_permission(tenant,'attendance.capture') and private.teaches_class(tenant,class_key)))
$$;
create function private.can_read_attendance(tenant uuid,session_key uuid,learner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.attendance_sessions s where s.school_id=tenant and s.id=session_key and (
 private.can_capture_attendance(tenant,s.class_id) or (s.status='FINAL' and private.has_permission(tenant,'attendance.view') and private.owns_learner(tenant,learner))))
$$;
do $$ declare tab text;begin
 foreach tab in array array['rooms','time_slots','timetable_slots','attendance_sessions','attendance_entries'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('create trigger guard_record before update on public.%I for each row execute function private.guard_school_record()',tab);
  execute format('create trigger audit_record after insert or update on public.%I for each row execute function private.audit_change()',tab);
 end loop;
 foreach tab in array array['rooms','time_slots'] loop
  execute format('grant insert,update on public.%I to authenticated',tab);
  execute format('create policy resources_read on public.%I for select to authenticated using(private.has_permission(school_id,''timetable.view''))',tab);
  execute format('create policy resources_insert on public.%I for insert to authenticated with check(private.has_permission(school_id,''timetable.manage''))',tab);
  execute format('create policy resources_update on public.%I for update to authenticated using(private.has_permission(school_id,''timetable.manage'')) with check(private.has_permission(school_id,''timetable.manage''))',tab);
 end loop;
end $$;
create policy schedule_read on public.timetable_slots for select to authenticated using(private.has_permission(school_id,'timetable.view') and private.can_read_class(school_id,class_id) and (active or private.has_permission(school_id,'timetable.manage')));
create policy sessions_read on public.attendance_sessions for select to authenticated using(private.can_capture_attendance(school_id,class_id) or (status='FINAL' and private.has_permission(school_id,'attendance.view') and exists(select 1 from public.enrollments e where e.school_id=attendance_sessions.school_id and e.class_id=attendance_sessions.class_id and e.starts_on<=attended_on and (e.ends_on is null or e.ends_on>=attended_on) and private.owns_learner(e.school_id,e.student_id))));
create policy entries_read on public.attendance_entries for select to authenticated using(private.can_read_attendance(school_id,session_id,student_id));
revoke all on function private.can_capture_attendance(uuid,uuid),private.can_read_attendance(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_capture_attendance(uuid,uuid),private.can_read_attendance(uuid,uuid,uuid) to authenticated;
