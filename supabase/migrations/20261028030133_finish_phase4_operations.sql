begin;
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
create index timetable_subject on public.timetable_slots(school_id,class_subject_id);
create index timetable_period on public.timetable_slots(school_id,time_slot_id);
create index timetable_term on public.timetable_slots(school_id,term_id,active,weekday,id);
create index timetable_class on public.timetable_slots(school_id,class_id,active);
create index timetable_staff on public.timetable_slots(school_id,staff_id,active);
create index timetable_room on public.timetable_slots(school_id,room_id,active);
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
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
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

-- School-day workflows. All writes serialize on the school row, including linked-resource edits.
create function private.operations_write(tenant uuid, request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op text=request->>'op'; c public.classes; y public.academic_years; t public.terms;
 s public.attendance_sessions; b public.timetable_slots; previous public.attendance_entries;
 cs public.class_subjects; st public.staff; room public.rooms; period public.time_slots;
 item jsonb; vals jsonb=request->'values'; learner uuid; expected integer; result uuid;
 day integer; first_day date; last_day date; status_value text; note text;
begin
 if auth.uid() is null or not private.is_member(tenant) then raise exception 'Not authorized'; end if;
 perform 1 from public.schools where id=tenant for update;
 if op='open' then
  select * into c from public.classes where school_id=tenant and id=(request->>'class_key')::uuid and not archived;
  if c.id is null then raise exception 'Select an active class'; end if;
  if not private.can_capture_attendance(tenant,c.id) then raise exception 'Not authorized'; end if;
  select * into y from public.academic_years where school_id=tenant and id=c.academic_year_id and not archived;
  first_day=(request->>'attendance_date')::date;
  if y.id is null or first_day is null or first_day not between y.starts_on and y.ends_on or first_day>(now() at time zone (select timezone from public.schools where id=tenant))::date then
   raise exception 'Attendance date must be within the class year and not in the future'; end if;
  if request->>'session_name' is null or length(trim(request->>'session_name')) not between 1 and 80 then raise exception 'Invalid attendance entries'; end if;
  insert into public.attendance_sessions(school_id,class_id,attended_on,name) values(tenant,c.id,first_day,trim(request->>'session_name')) returning id into result;
  return to_jsonb(result);
 elsif op in ('save','state') then
  select * into s from public.attendance_sessions where school_id=tenant and id=(request->>'session_key')::uuid;
  if s.id is null or not private.can_capture_attendance(tenant,s.class_id) then raise exception 'Not authorized'; end if;
  if (request->>'expected_version')::integer is distinct from s.version then raise exception 'Register changed; reload before saving'; end if;
  if op='state' then
   status_value=request->>'next_state';
   if status_value is null or status_value not in ('OPEN','FINAL','VOID') then raise exception 'Invalid attendance entries'; end if;
   if status_value in ('OPEN','VOID') and not private.has_permission(tenant,'attendance.manage') then raise exception 'Only administrators can reopen or void registers'; end if;
   if status_value='FINAL' then
    if s.status<>'OPEN' then raise exception 'Only open registers can be edited'; end if;
    if not exists(select 1 from public.enrollments e where e.school_id=tenant and e.class_id=s.class_id and s.attended_on between e.starts_on and coalesce(e.ends_on,s.attended_on))
    or exists(select 1 from public.enrollments e where e.school_id=tenant and e.class_id=s.class_id and s.attended_on between e.starts_on and coalesce(e.ends_on,s.attended_on)
     and not exists(select 1 from public.attendance_entries a where a.school_id=tenant and a.session_id=s.id and a.student_id=e.student_id and a.status<>'UNMARKED')) then raise exception 'Complete every learner before finalizing'; end if;
   end if;
   update public.attendance_sessions set status=status_value,version=version+1 where id=s.id;
  else
   if s.status<>'OPEN' then raise exception 'Only open registers can be edited'; end if;
   if jsonb_typeof(request->'entries') is distinct from 'array' then raise exception 'Invalid attendance entries'; end if;
   if jsonb_array_length(request->'entries') not between 1 and 1000 or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(request->'entries')) then raise exception 'Invalid attendance entries'; end if;
   for item in select value from jsonb_array_elements(request->'entries') loop
    learner=(item->>'id')::uuid; expected=(item->>'version')::integer; status_value=item->>'status'; note=coalesce(item->>'reason','');
    if status_value is null or status_value not in ('PRESENT','ABSENT','LATE','EXCUSED','UNMARKED') or length(note)>1000 or expected is null then raise exception 'Invalid attendance entries'; end if;
    if not exists(select 1 from public.enrollments e where e.school_id=tenant and e.class_id=s.class_id and e.student_id=learner and s.attended_on between e.starts_on and coalesce(e.ends_on,s.attended_on)) then raise exception 'Learner is not enrolled on this date'; end if;
    select * into previous from public.attendance_entries where school_id=tenant and session_id=s.id and student_id=learner;
    if coalesce(previous.version,0)<>expected then raise exception 'Register changed; reload before saving'; end if;
    if previous.id is null then insert into public.attendance_entries(school_id,session_id,student_id,status,reason) values(tenant,s.id,learner,status_value,note);
    else update public.attendance_entries set status=status_value,reason=note,version=version+1 where id=previous.id; end if;
   end loop;
   update public.attendance_sessions set version=version+1 where id=s.id;
  end if;
  return 'null'::jsonb;
 elsif op='schedule' then
  if not private.has_permission(tenant,'timetable.manage') then raise exception 'Not authorized'; end if;
  if request->>'booking_key' is not null then
   select * into b from public.timetable_slots where school_id=tenant and id=(request->>'booking_key')::uuid;
   if b.id is null or b.version is distinct from (request->>'expected_version')::integer then raise exception 'Schedule changed; reload before saving'; end if;
  end if;
  -- Archiving releases reservations even if a linked resource has since been archived.
  if b.id is not null and (vals->>'active')::boolean=false then
   update public.timetable_slots set active=false,version=version+1 where id=b.id;return to_jsonb(b.id);
  end if;
  select * into cs from public.class_subjects where school_id=tenant and id=(vals->>'class_subject_id')::uuid and not archived;
  select * into c from public.classes where school_id=tenant and id=cs.class_id and not archived;
  select * into t from public.terms where school_id=tenant and id=(vals->>'term_id')::uuid and not archived;
  if cs.id is null or c.id is null or t.id is null or c.academic_year_id<>t.academic_year_id or not exists(select 1 from public.subjects where school_id=tenant and id=cs.subject_id and not archived) then raise exception 'Select an active class subject and term in the same year'; end if;
  select * into st from public.staff where school_id=tenant and id=(vals->>'staff_id')::uuid and not archived and is_teacher and employment_status='ACTIVE';
  if st.id is null or not exists(select 1 from public.teacher_assignments where school_id=tenant and staff_id=st.id and class_subject_id=cs.id and not archived) then raise exception 'Assign this teacher to the selected subject first'; end if;
  select * into period from public.time_slots where school_id=tenant and id=(vals->>'time_slot_id')::uuid and not archived;
  select * into room from public.rooms where school_id=tenant and id=(vals->>'room_id')::uuid and not archived;
  if period.id is null or (vals->>'room_id' is not null and room.id is null) then raise exception 'Select an active room and time slot'; end if;
  if room.capacity<c.capacity then raise exception 'Room capacity is below class capacity'; end if;
  if t.ends_on-t.starts_on>3660 then raise exception 'Use a term of ten years or less'; end if;
  day=(vals->>'weekday')::integer;
  if day is null or day not between 1 and 7 or (vals->>'active')::boolean is distinct from true then raise exception 'Invalid schedule'; end if;
  first_day=t.starts_on+((day-extract(isodow from t.starts_on)::integer+7)%7);
  if first_day>t.ends_on then raise exception 'No lesson dates match this weekday'; end if;
  -- The school lock serializes all booking mutations. Check actual shared dates, not just term IDs.
  for item in select to_jsonb(other)||jsonb_build_object('other_start',ot.starts_on,'other_end',ot.ends_on,'time_start',p.starts_at,'time_end',p.ends_at)
   from public.timetable_slots other join public.terms ot on ot.school_id=other.school_id and ot.id=other.term_id
   join public.time_slots p on p.school_id=other.school_id and p.id=other.time_slot_id
   where other.school_id=tenant and other.active and other.id is distinct from b.id and other.weekday=day
   and ot.starts_on<=t.ends_on and ot.ends_on>=t.starts_on and p.starts_at<period.ends_at and p.ends_at>period.starts_at loop
   last_day=least(t.ends_on,(item->>'other_end')::date);first_day=greatest(t.starts_on,(item->>'other_start')::date);
   first_day=first_day+((day-extract(isodow from first_day)::integer+7)%7);
   if first_day<=last_day then
    if (item->>'class_id')::uuid=c.id then raise exception 'Class already has an overlapping lesson'; end if;
    if (item->>'staff_id')::uuid=st.id then raise exception 'Teacher already has an overlapping lesson'; end if;
    if room.id is not null and (item->>'room_id')::uuid=room.id then raise exception 'Room already has an overlapping lesson'; end if;
   end if;
  end loop;
  if b.id is null then
   insert into public.timetable_slots(school_id,class_subject_id,class_id,staff_id,term_id,room_id,time_slot_id,weekday) values(tenant,cs.id,c.id,st.id,t.id,room.id,period.id,day) returning id into result;
  else
   update public.timetable_slots set class_subject_id=cs.id,class_id=c.id,staff_id=st.id,term_id=t.id,room_id=room.id,time_slot_id=period.id,weekday=day,active=true,version=version+1 where id=b.id returning id into result;
  end if;
  return to_jsonb(result);
 end if;
 raise exception 'Invalid operation';
end $$;

-- RLS-preserving reporting: definer is used only for minimal timetable name joins;
-- every result is filtered through fresh permissions and relationship helpers.
create function private.operations_read(tenant uuid, request jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare op text=request->>'op'; first_day date; last_day date; page integer=coalesce((request->>'page_number')::integer,0);
 result jsonb; total bigint; s public.attendance_sessions; class_key uuid=(request->>'class_key')::uuid;
 learner uuid=(request->>'learner')::uuid; term_key uuid=(request->>'term_key')::uuid; resource uuid=(request->>'resource_key')::uuid;
begin
 if auth.uid() is null or not private.is_member(tenant) then raise exception 'Not authorized'; end if;
 if page<0 or page>50000 then raise exception 'Invalid page'; end if;
 if op in ('sessions','report','history','dashboard') then
  if not private.has_permission(tenant,'attendance.view') then raise exception 'Not authorized'; end if;
  first_day=(request->>'from_date')::date;last_day=(request->>'to_date')::date;
  if first_day is null or last_day is null or last_day<first_day or last_day-first_day>366 then raise exception 'Select a valid date range of one year or less'; end if;
 end if;
 if op='sessions' then
  if not private.can_capture_attendance(tenant,class_key) then raise exception 'Not authorized'; end if;
  select count(*) into total from public.attendance_sessions where school_id=tenant and class_id=class_key and attended_on between first_day and last_day;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select * from public.attendance_sessions where school_id=tenant and class_id=class_key and attended_on between first_day and last_day order by attended_on desc,id limit 20 offset page*20) x;
 elsif op='register' then
  select * into s from public.attendance_sessions where school_id=tenant and id=(request->>'session_key')::uuid;
  if s.id is null or not private.can_capture_attendance(tenant,s.class_id) then raise exception 'Not authorized'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into result from (
   select st.id,st.first_name||' '||st.surname name,st.admission_number,coalesce(a.status,'UNMARKED') status,coalesce(a.reason,'') reason,coalesce(a.version,0) version
   from public.students st left join public.attendance_entries a on a.school_id=st.school_id and a.student_id=st.id and a.session_id=s.id
   where st.school_id=tenant and exists(select 1 from public.enrollments e where e.school_id=tenant and e.student_id=st.id and e.class_id=s.class_id and s.attended_on between e.starts_on and coalesce(e.ends_on,s.attended_on))
  ) x;
  return jsonb_build_object('session',to_jsonb(s),'learners',result);
 elsif op in ('report','history','dashboard') then
  if op='history' and learner is null then raise exception 'Not authorized'; end if;
  if op='history' then
   select count(*) into total from public.attendance_entries a join public.attendance_sessions ss on ss.school_id=a.school_id and ss.id=a.session_id where a.school_id=tenant and a.student_id=learner and ss.status='FINAL' and ss.attended_on between first_day and last_day and private.can_read_attendance(tenant,ss.id,a.student_id);
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select ss.attended_on,c.name class_name,ss.name session_name,a.status,a.reason from public.attendance_entries a join public.attendance_sessions ss on ss.school_id=a.school_id and ss.id=a.session_id join public.classes c on c.school_id=ss.school_id and c.id=ss.class_id
    where a.school_id=tenant and a.student_id=learner and ss.status='FINAL' and ss.attended_on between first_day and last_day and private.can_read_attendance(tenant,ss.id,a.student_id) order by ss.attended_on desc,ss.id limit 20 offset page*20) x;
  else
   with grouped as (select a.student_id,st.first_name||' '||st.surname name,st.admission_number,
    count(*) filter(where a.status='PRESENT') present,count(*) filter(where a.status='ABSENT') absent,count(*) filter(where a.status='LATE') late,count(*) filter(where a.status='EXCUSED') excused,count(*) total,
    round(100.0*count(*) filter(where a.status in ('PRESENT','LATE'))/nullif(count(*),0),2) percentage
    from public.attendance_entries a join public.attendance_sessions ss on ss.school_id=a.school_id and ss.id=a.session_id join public.students st on st.school_id=a.school_id and st.id=a.student_id
    where a.school_id=tenant and ss.status='FINAL' and ss.attended_on between first_day and last_day and (class_key is null or ss.class_id=class_key) and (learner is null or a.student_id=learner) and private.can_read_attendance(tenant,ss.id,a.student_id) group by a.student_id,st.first_name,st.surname,st.admission_number)
   select (select count(*) from grouped),coalesce((select jsonb_agg(to_jsonb(x)) from (select * from grouped order by name,student_id limit 20 offset page*20) x),'[]') into total,result;
   if op='dashboard' then
    select jsonb_build_object('present',count(*) filter(where a.status='PRESENT'),'absent',count(*) filter(where a.status='ABSENT'),'late',count(*) filter(where a.status='LATE'),'excused',count(*) filter(where a.status='EXCUSED'),'total',count(*),'percentage',round(100.0*count(*) filter(where a.status in ('PRESENT','LATE'))/nullif(count(*),0),2)) into result
    from public.attendance_entries a join public.attendance_sessions ss on ss.school_id=a.school_id and ss.id=a.session_id where a.school_id=tenant and ss.status='FINAL' and ss.attended_on between first_day and last_day and private.can_read_attendance(tenant,ss.id,a.student_id);
    return result;
   end if;
  end if;
 elsif op='teachers' then
  if not private.has_permission(tenant,'timetable.view') then raise exception 'Not authorized'; end if;
  with visible as (select distinct st.id,st.first_name,st.surname from public.staff st join public.timetable_slots b on b.school_id=st.school_id and b.staff_id=st.id and b.active where st.school_id=tenant and private.can_read_class(tenant,b.class_id) and (resource is null or st.id=resource) and (st.first_name||' '||st.surname) ilike '%'||left(coalesce(request->>'search',''),100)||'%')
  select (select count(*) from visible),coalesce((select jsonb_agg(to_jsonb(x)) from (select * from visible order by surname,first_name,id limit 20 offset page*20) x),'[]') into total,result;
 elsif op in ('schedules','week') then
  if not private.has_permission(tenant,'timetable.view') then raise exception 'Not authorized'; end if;
  if op='schedules' and not private.has_permission(tenant,'timetable.manage') then raise exception 'Not authorized'; end if;
  if op='week' then
   if request->>'view_kind' is null or request->>'view_kind' not in ('CLASS','TEACHER','ROOM') or resource is null then raise exception 'Not authorized'; end if;
   first_day=(request->>'on_date')::date;
   if first_day is null then raise exception 'Select a valid date'; end if;
   first_day=first_day-(extract(isodow from first_day)::integer-1);last_day=first_day+6;
  end if;
  with visible as (
   select b.*,c.name class_name,su.name subject_name,st.first_name||' '||st.surname teacher_name,r.name room_name,p.name period_name,to_char(p.starts_at,'HH24:MI') starts_at,to_char(p.ends_at,'HH24:MI') ends_at,t.starts_on,t.ends_on
   from public.timetable_slots b join public.classes c on c.school_id=b.school_id and c.id=b.class_id join public.class_subjects cs on cs.school_id=b.school_id and cs.id=b.class_subject_id
   join public.subjects su on su.school_id=cs.school_id and su.id=cs.subject_id join public.staff st on st.school_id=b.school_id and st.id=b.staff_id
   join public.time_slots p on p.school_id=b.school_id and p.id=b.time_slot_id join public.terms t on t.school_id=b.school_id and t.id=b.term_id left join public.rooms r on r.school_id=b.school_id and r.id=b.room_id
   where b.school_id=tenant and b.term_id=term_key and private.can_read_class(tenant,b.class_id)
   and (case when op='schedules' then b.active=coalesce((request->>'only_active')::boolean,true) and (class_key is null or b.class_id=class_key)
    else b.active and case request->>'view_kind' when 'CLASS' then b.class_id=resource when 'TEACHER' then b.staff_id=resource else b.room_id=resource end end))
  select (select count(*) from visible),case when op='schedules' then coalesce((select jsonb_agg(to_jsonb(x)) from (select * from visible order by weekday,starts_at,id limit 20 offset page*20) x),'[]')
   else coalesce((select jsonb_agg(to_jsonb(x) order by x.lesson_on,x.starts_at,x.id) from (select v.*,d::date lesson_on from visible v cross join lateral generate_series(greatest(first_day,v.starts_on)::timestamp,least(last_day,v.ends_on)::timestamp,interval '1 day') d where extract(isodow from d)=v.weekday) x),'[]') end into total,result;
  if op='week' then return result; end if;
 else raise exception 'Invalid operation'; end if;
 return jsonb_build_object('rows',result,'count',total);
end $$;

create function public.operations_read(tenant uuid,request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select private.operations_read(tenant,request)$$;
create function public.operations_write(tenant uuid,request jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select private.operations_write(tenant,request)$$;
revoke all on function private.operations_read(uuid,jsonb),private.operations_write(uuid,jsonb),public.operations_read(uuid,jsonb),public.operations_write(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.operations_read(uuid,jsonb),private.operations_write(uuid,jsonb),public.operations_read(uuid,jsonb),public.operations_write(uuid,jsonb) to authenticated;

create function private.protect_operations_history() returns trigger language plpgsql security definer set search_path='' as $$
declare changed boolean=false;
begin
 perform 1 from public.schools where id=new.school_id for update;
 if tg_table_name='enrollments' then
  if tg_op='UPDATE' and exists(select 1 from public.attendance_entries a join public.attendance_sessions s on s.school_id=a.school_id and s.id=a.session_id
   where s.attended_on>=old.starts_on and (old.ends_on is null or s.attended_on<=old.ends_on) and a.school_id=new.school_id and a.student_id=new.student_id and s.class_id=new.class_id and s.status<>'VOID'
   and (s.attended_on<new.starts_on or (new.ends_on is not null and s.attended_on>new.ends_on))) then raise exception 'Enrollment dates must preserve captured attendance'; end if;
  if exists(select 1 from public.attendance_sessions s where s.school_id=new.school_id and s.class_id=new.class_id and s.status='FINAL'
   and s.attended_on between new.starts_on and coalesce(new.ends_on,s.attended_on)
   and not exists(select 1 from public.attendance_entries a where a.school_id=s.school_id and a.session_id=s.id and a.student_id=new.student_id)) then raise exception 'Reopen affected registers before changing enrollment'; end if;
  return new;
 end if;
 if tg_table_name='academic_years' then
  if exists(select 1 from public.attendance_sessions s join public.classes c on c.school_id=s.school_id and c.id=s.class_id where s.school_id=new.school_id and c.academic_year_id=new.id and s.status<>'VOID' and s.attended_on not between new.starts_on and new.ends_on) then raise exception 'Year dates must preserve captured attendance'; end if;
 end if;
 if tg_op<>'UPDATE' then return new; end if;
 changed=case tg_table_name
  when 'rooms' then (new.archived is distinct from old.archived or to_jsonb(new)->'capacity' is distinct from to_jsonb(old)->'capacity')
  when 'time_slots' then (new.archived is distinct from old.archived or to_jsonb(new)->'starts_at' is distinct from to_jsonb(old)->'starts_at' or to_jsonb(new)->'ends_at' is distinct from to_jsonb(old)->'ends_at')
  when 'terms' then (new.archived is distinct from old.archived or to_jsonb(new)->'starts_on' is distinct from to_jsonb(old)->'starts_on' or to_jsonb(new)->'ends_on' is distinct from to_jsonb(old)->'ends_on')
  when 'staff' then (new.archived is distinct from old.archived or to_jsonb(new)->'is_teacher' is distinct from to_jsonb(old)->'is_teacher' or to_jsonb(new)->'employment_status' is distinct from to_jsonb(old)->'employment_status')
  when 'classes' then (new.archived is distinct from old.archived or to_jsonb(new)->'capacity' is distinct from to_jsonb(old)->'capacity')
  else new.archived is distinct from old.archived end;
 if changed and exists(select 1 from public.timetable_slots b join public.class_subjects cs on cs.school_id=b.school_id and cs.id=b.class_subject_id join public.classes c on c.school_id=b.school_id and c.id=b.class_id
   where b.school_id=new.school_id and b.active and case tg_table_name
    when 'rooms' then b.room_id=new.id when 'time_slots' then b.time_slot_id=new.id when 'terms' then b.term_id=new.id
    when 'classes' then b.class_id=new.id when 'staff' then b.staff_id=new.id when 'class_subjects' then b.class_subject_id=new.id
    when 'subjects' then cs.subject_id=new.id when 'academic_years' then c.academic_year_id=new.id
    when 'teacher_assignments' then b.staff_id=(to_jsonb(new)->>'staff_id')::uuid and b.class_subject_id=(to_jsonb(new)->>'class_subject_id')::uuid else false end)
 then raise exception 'Archive linked schedules before changing this resource'; end if;
 return new;
end $$;
do $$declare tab text;begin
 foreach tab in array array['rooms','time_slots','terms','classes','staff','class_subjects','subjects','academic_years','teacher_assignments'] loop
  execute format('create trigger operations_history before update on public.%I for each row execute function private.protect_operations_history()',tab);
 end loop;
end $$;
create trigger operations_history before insert or update on public.enrollments for each row execute function private.protect_operations_history();
revoke all on function private.protect_operations_history() from public,anon,authenticated;

-- Minimal teacher labels for family timetable selectors, without exposing staff profiles.
create function public.timetable_teachers(tenant uuid,search_term text default '',page_number integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.operations_read(tenant,jsonb_build_object('op','teachers','search',search_term,'page_number',page_number))
$$;
revoke all on function public.timetable_teachers(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.timetable_teachers(uuid,text,integer) to authenticated;


create function private.report_attendance(tenant uuid,class_key uuid,learner uuid,from_date date,to_date date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('total',count(*),'present',count(*) filter(where a.status='PRESENT'),'absent',count(*) filter(where a.status='ABSENT'),'late',count(*) filter(where a.status='LATE'),'excused',count(*) filter(where a.status='EXCUSED'),'percentage',round(100.0*count(*) filter(where a.status in ('PRESENT','LATE'))/nullif(count(*),0),2))
 from public.attendance_entries a join public.attendance_sessions s on s.school_id=a.school_id and s.id=a.session_id
 where auth.uid() is not null and private.has_permission(tenant,'results.publish') and a.school_id=tenant and a.student_id=learner and s.class_id=class_key and s.status='FINAL' and s.attended_on between from_date and to_date
$$;
revoke all on function private.report_attendance(uuid,uuid,uuid,date,date) from public,anon,authenticated;
create or replace function private.term_report_documents(tenant uuid,class_key uuid,term_key uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rule public.grading_rules; c public.classes; t public.terms; sch public.schools; s public.students; cs record; a record; n public.report_notes;
 reports jsonb='[]'; subjects jsonb; details jsonb; subject_percent numeric; numerator numeric; denominator numeric; avg_num numeric; avg_den numeric; label text; comments text; grade_name text; year_name text;
begin
 select * into rule from public.grading_rules where school_id=tenant;
 select * into c from public.classes where school_id=tenant and id=class_key and not archived;
 select * into t from public.terms where school_id=tenant and id=term_key and not archived;
 if rule.id is null then raise exception 'Configure grading rules before publishing'; end if;
 if c.id is null or t.id is null or c.academic_year_id<>t.academic_year_id then raise exception 'Select a class and term in the same year'; end if;
 select * into sch from public.schools where id=tenant;
 select name into grade_name from public.grades where id=c.grade_id;
 select name into year_name from public.academic_years where id=c.academic_year_id;
 for s in select st.* from public.students st where st.school_id=tenant and exists(select 1 from public.enrollments e
 where e.school_id=tenant and e.class_id=class_key and e.student_id=st.id and e.starts_on<=t.ends_on and coalesce(e.ends_on,t.ends_on)>=t.starts_on) order by st.surname,st.first_name,st.id loop
  subjects='[]';avg_num=0;avg_den=0;
  for cs in select cl.*,su.name subject_name,su.code subject_code from public.class_subjects cl join public.subjects su on su.school_id=cl.school_id and su.id=cl.subject_id
   where cl.school_id=tenant and cl.class_id=class_key and not cl.archived and not su.archived order by su.name,cl.id loop
   numerator=0;denominator=0;details='[]';comments='';
   for a in select ass.*,m.mark,m.status,m.comment from public.assessments ass left join public.assessment_marks m
    on m.school_id=ass.school_id and m.assessment_id=ass.id and m.student_id=s.id
    where ass.school_id=tenant and ass.class_subject_id=cs.id and ass.term_id=term_key and not ass.archived
    and exists(select 1 from public.enrollments e where e.school_id=tenant and e.class_id=class_key and e.student_id=s.id and ass.assessed_on>=e.starts_on and (e.ends_on is null or ass.assessed_on<=e.ends_on)) order by ass.assessed_on,ass.id loop
    if a.status is null or a.status='INCOMPLETE' then raise exception 'Complete every applicable assessment before publishing'; end if;
    if a.status<>'EXEMPT' then numerator=numerator+(case when a.status='ABSENT' then 0 else a.mark/a.max_mark*100 end)*a.weight; denominator=denominator+a.weight; end if;
    details=details||jsonb_build_array(jsonb_build_object('name',a.name,'type',a.assessment_type,'date',a.assessed_on,'mark',a.mark,'max_mark',a.max_mark,'weight',a.weight,'status',a.status,'percent',case when a.status='EXEMPT' then null when a.status='ABSENT' then 0 else round(a.mark/a.max_mark*100,2) end));
    if a.comment<>'' then comments=comments||case when comments='' then '' else E'\n' end||a.name||': '||a.comment; end if;
   end loop;
   if jsonb_array_length(details)=0 then raise exception 'Each subject needs an applicable assessment'; end if;
   subject_percent=case when denominator=0 then null else round(numerator/denominator,2) end;
   label=null;
   if subject_percent is not null then
    select value->>'label' into label from jsonb_array_elements(rule.bands) where (value->>'min')::numeric<=subject_percent order by (value->>'min')::numeric desc limit 1;
    avg_num=avg_num+subject_percent*cs.weight;avg_den=avg_den+cs.weight;
   end if;
   subjects=subjects||jsonb_build_array(jsonb_build_object('id',cs.subject_id,'name',cs.subject_name,'code',cs.subject_code,'weight',cs.weight,'percent',subject_percent,'grade',coalesce(label,'Exempt'),'passed',subject_percent>=rule.pass_percent,'comment',comments,'assessments',details));
  end loop;
  if jsonb_array_length(subjects)=0 or avg_den=0 then raise exception 'At least one graded subject is required'; end if;
  select * into n from public.report_notes where school_id=tenant and class_id=class_key and term_id=term_key and student_id=s.id;
  reports=reports||jsonb_build_array(jsonb_build_object('student_id',s.id,'student_name',s.first_name||' '||s.surname,'admission_number',s.admission_number,
   'school_name',sch.name,'school_address',sch.address,'school_color',sch.brand_color,'class_name',c.name,'grade_name',grade_name,'year_name',year_name,'year_id',c.academic_year_id,'term_name',t.name,'term_id',t.id,
   'subjects',subjects,'average',round(avg_num/avg_den,2),'pass_percent',rule.pass_percent,'principal_comment',coalesce(n.principal_comment,''),'promotion_status',coalesce(n.promotion_status,''),'attendance',private.report_attendance(tenant,class_key,s.id,t.starts_on,t.ends_on)));
 end loop;
 if jsonb_array_length(reports)=0 then raise exception 'This class has no learners enrolled in the term'; end if;
 return reports;
end $$;

-- Keep privileged implementations out of the exposed API schema. Public signatures,
-- defaults, return types and existing checked behavior remain compatible.
do $$declare f record; args text; body text; i integer; stability text;begin
 for f in select p.oid,p.proname,p.pronargs,p.provolatile,pg_get_function_arguments(p.oid) arguments,pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_function_result(p.oid) result_type
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef
  and p.proname in ('assessment_gradebook','close_enrollment','create_school','enroll_student','my_permissions','preview_term_results','publish_term_results','save_assessment_marks','save_report_note','set_membership','subject_gradebook','withdraw_term_results') loop
  args='';for i in 1..f.pronargs loop args=args||case when i>1 then ',' else '' end||'$'||i;end loop;
  execute format('alter function public.%I(%s) set schema private',f.proname,f.identity_arguments);
  execute format('revoke all on function private.%I(%s) from public,anon,authenticated',f.proname,f.identity_arguments);
  execute format('grant execute on function private.%I(%s) to authenticated',f.proname,f.identity_arguments);
  stability=case f.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end;
  body=format('select private.%I(%s)',f.proname,args);
  execute format('create function public.%I(%s) returns %s language sql %s security invoker set search_path='''' as %L',f.proname,f.arguments,f.result_type,stability,body);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname,f.identity_arguments);
  execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.identity_arguments);
 end loop;
end $$;

create or replace function private.advanced_read(tenant uuid,request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare op text=request->>'op';result jsonb;job private.data_jobs;start_day date=coalesce(nullif(request->>'from','')::date,current_date-365);end_day date=coalesce(nullif(request->>'to','')::date,current_date);a jsonb;f jsonb;l jsonb;page integer=greatest(coalesce((request->>'page')::integer,0),0);
begin
 if auth.uid() is null or not private.is_active() or not private.is_member(tenant) then raise exception 'Not authorized';end if;
 if op='book' then
  if not private.has_permission(tenant,'library.manage') then raise exception 'Not authorized';end if;
  return (select to_jsonb(b) from public.library_books b where school_id=tenant and id=(request->>'id')::uuid);
 elsif op='export_page' then
  if not private.has_permission(tenant,'data.export') then raise exception 'Not authorized';end if;
  select * into job from private.data_jobs where id=(request->>'id')::uuid and school_id=tenant and actor_id=auth.uid() and kind='EXPORT' and expires_at>now();
  if job.id is null then raise exception 'Data job expired or unavailable';end if;
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(value order by ordinal),'[]') from jsonb_array_elements(job.payload) with ordinality x(value,ordinal) where ordinal>page::bigint*250 and ordinal<=(page::bigint+1)*250),'count',jsonb_array_length(job.payload));
 end if;
 if not private.has_permission(tenant,'analytics.view') then raise exception 'Not authorized';end if;
 if start_day>end_day or end_day-start_day>3660 then raise exception 'Choose a date range of at most ten years';end if;
 if op='calendar' then
  select coalesce(jsonb_agg(x order by x.starts_on,x.id),'[]') into result from
  (select id,name,starts_on,ends_on,version from public.terms where school_id=tenant and not archived and starts_on<=end_day and ends_on>=start_day order by starts_on,id limit 501) x;
  if jsonb_array_length(result)>500 then raise exception 'Choose a smaller calendar range';end if;return result;
 elsif op not in ('analytics','ai_context') then raise exception 'Unknown data operation';end if;
 select coalesce(jsonb_agg(x order by x.year_name,x.term_name,x.grade_name,x.class_name),'[]') into a from (
 select r.document->>'year_name' year_name,r.document->>'grade_name' grade_name,r.document->>'term_name' term_name,r.document->>'class_name' class_name,count(*) reports,
 round(avg((r.document->>'average')::numeric),2) average,
 count(*) filter(where (r.document->>'average')::numeric >= (r.document->>'pass_percent')::numeric) passed
 from public.published_reports r join public.result_publications p on p.school_id=r.school_id and p.id=r.publication_id
 where r.school_id=tenant and p.active and (p.created_at at time zone (select timezone from public.schools where id=tenant))::date between start_day and end_day
 group by r.document->>'year_name',r.document->>'grade_name',r.document->>'term_name',r.document->>'class_name' order by 1,2,3,4 limit 501) x;
 if jsonb_array_length(a)>500 then raise exception 'Choose a smaller report range';end if;
 if private.has_permission(tenant,'finance.reports') then
 select jsonb_build_object('balance_minor',coalesce(sum(amount_minor),0)::text,'monthly',coalesce((select jsonb_agg(x order by x."month") from (
 select to_char(posted_on,'YYYY-MM') as "month",sum(amount_minor)::text net_minor from public.finance_entries where school_id=tenant and posted_on between start_day and end_day group by 1) x),'[]')) into f
 from public.finance_entries where school_id=tenant and posted_on<=end_day;
 end if;
 if private.has_permission(tenant,'library.reports') then
 select jsonb_build_object('open_loans',count(*) filter(where closed_on is null),'overdue_now',count(*) filter(where closed_on is null and due_on<(now() at time zone (select timezone from public.schools where id=tenant))::date),'issued_in_range',count(*) filter(where issued_on between start_day and end_day)) into l from public.library_loans where school_id=tenant;
 end if;
 result=jsonb_build_object('schema_version',1,'generated_at',now(),'from',start_day,'to',end_day,
 'learners',(select count(*) from public.students where school_id=tenant and not archived),
 'teachers',(select count(*) from public.staff where school_id=tenant and not archived and is_teacher and employment_status='ACTIVE'),
 'classes',(select count(*) from public.classes where school_id=tenant and not archived),
 'academics',a,'finance',f,'library',l,'currency',(select currency from public.schools where id=tenant),
 'attendance',(select jsonb_build_object('total',count(*),'present',count(*) filter(where ae.status='PRESENT'),'late',count(*) filter(where ae.status='LATE'),'absent',count(*) filter(where ae.status='ABSENT'),'excused',count(*) filter(where ae.status='EXCUSED'),'percentage',round(100.0*count(*) filter(where ae.status in ('PRESENT','LATE'))/nullif(count(*),0),2)) from public.attendance_entries ae join public.attendance_sessions ats on ats.school_id=ae.school_id and ats.id=ae.session_id where ae.school_id=tenant and ats.status='FINAL' and ats.attended_on between start_day and end_day and private.can_read_attendance(tenant,ats.id,ae.student_id)),
 'limitations',jsonb_build_array('Attendance counts finalized learner sessions; late counts as attended and excused remains in the denominator','Academic groups use active publications created in this date range; annual and term reports may both appear','Library open and overdue counts describe current circulation','No learner ranking or automated eligibility decisions'));
 if op='ai_context' then
 -- Only whole-school counts. Exclude class/term labels, small groups and financial records.
 return jsonb_build_object('schema_version',1,'generated_at',now(),'purpose','School operations context for human review','counts',jsonb_build_object('learners',case when (result->>'learners')::int>=10 then result->'learners' else null end,'teachers',case when (result->>'teachers')::int>=10 then result->'teachers' else null end),'suppression','Counts below ten are withheld; combining datasets may still identify people','external_delivery',false);
 end if;return result;
end $$;
commit;
