begin;
-- Trigger-only lookup. Identifiers come from the fixed trigger below, never from API input.
create function private.require_active_record(relation text, tenant uuid, record_key uuid) returns void language plpgsql security definer set search_path='' as $$
declare found boolean; begin
 execute format('select exists(select 1 from public.%I where school_id=$1 and id=$2 and not archived)',relation) into found using tenant,record_key;
 if not found then raise exception 'Select an active record in this school'; end if;
end $$;
create function private.validate_phase2_record() returns trigger language plpgsql security definer set search_path='' as $$
declare j jsonb=to_jsonb(new); previous jsonb; key text; year_row public.academic_years; expected_role text;
begin
 if tg_op='UPDATE' then
 previous=to_jsonb(old);
 -- Moving relationships would rewrite history. Archive the relationship and create a new one.
 foreach key in array array['academic_year_id','grade_id','student_id','parent_id','staff_id','class_subject_id','class_id','subject_id'] loop
 if previous ? key and j->key is distinct from previous->key then raise exception 'Relationship identity is immutable'; end if;
 end loop;
 end if;
 if tg_table_name in ('students','parents','staff') then
 expected_role=case tg_table_name when 'students' then 'STUDENT' when 'parents' then 'PARENT' else 'TEACHER' end;
 if j->>'user_id' is not null and (tg_op='INSERT' or j->>'user_id' is distinct from previous->>'user_id') then
 if not exists(select 1 from public.user_roles where school_id=new.school_id and user_id=(j->>'user_id')::uuid and role_id=expected_role and active) then raise exception 'Account must hold the matching role in this school'; end if;
 end if;
 end if;
 if tg_table_name='students' then
 if (j->>'date_of_birth')::date>=current_date then raise exception 'Birth date must be in the past'; end if;
 if exists(select 1 from public.enrollments where school_id=new.school_id and student_id=new.id and starts_on<(j->>'admission_date')::date) then raise exception 'Admission date must not follow an existing enrollment'; end if;
 if (new.archived or j->>'status'<>'ACTIVE') and exists(select 1 from public.enrollments where school_id=new.school_id and student_id=new.id and status='ACTIVE') then raise exception 'Close active enrollments before changing learner status'; end if;
 end if;
 if tg_table_name='classes' and j->>'capacity' is not null then
 if (select count(*) from public.enrollments where school_id=new.school_id and class_id=new.id and status='ACTIVE')>(j->>'capacity')::integer then raise exception 'Capacity cannot be lower than current enrollment'; end if;
 end if;
 if tg_table_name='academic_years' then
 if exists(select 1 from public.terms where school_id=new.school_id and academic_year_id=new.id and (starts_on<(j->>'starts_on')::date or ends_on>(j->>'ends_on')::date))
 or exists(select 1 from public.enrollments where school_id=new.school_id and academic_year_id=new.id and (starts_on<(j->>'starts_on')::date or coalesce(ends_on,starts_on)>(j->>'ends_on')::date)) then raise exception 'Year dates must contain existing terms and enrollments'; end if;
 end if;
 if tg_table_name in ('classes','academic_years') and new.archived then
 if exists(select 1 from public.enrollments e where e.school_id=new.school_id and e.status='ACTIVE' and ((tg_table_name='classes' and e.class_id=new.id) or (tg_table_name='academic_years' and e.academic_year_id=new.id))) then raise exception 'Close active enrollments before archiving'; end if;
 end if;
 if tg_table_name='terms' then
 select * into year_row from public.academic_years where school_id=new.school_id and id=(j->>'academic_year_id')::uuid for update;
 if (j->>'starts_on')::date<year_row.starts_on or (j->>'ends_on')::date>year_row.ends_on then raise exception 'Term dates must be within the academic year'; end if;
 if exists(select 1 from public.terms where school_id=new.school_id and academic_year_id=year_row.id and id<>new.id and not archived and not new.archived and starts_on<=(j->>'ends_on')::date and ends_on>=(j->>'starts_on')::date) then raise exception 'Terms must not overlap'; end if;
 end if;
 -- Only check reference availability for new records or reactivation; historical edits remain possible.
 if tg_op='INSERT' or (previous->>'archived'='true' and not new.archived) then
 foreach key in array array['academic_year_id','grade_id','student_id','parent_id','staff_id','class_subject_id','class_id','subject_id'] loop
 if j->>key is not null then
 perform private.require_active_record(case key when 'academic_year_id' then 'academic_years' when 'grade_id' then 'grades' when 'student_id' then 'students' when 'parent_id' then 'parents' when 'staff_id' then 'staff' when 'class_subject_id' then 'class_subjects' when 'class_id' then 'classes' else 'subjects' end,new.school_id,(j->>key)::uuid);
 end if;
 end loop;
 if tg_table_name='teacher_assignments' and not exists(select 1 from public.staff where school_id=new.school_id and id=(j->>'staff_id')::uuid and is_teacher and employment_status='ACTIVE') then raise exception 'Assign an active teacher'; end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['academic_years','terms','grades','classes','subjects','students','parents','staff','student_parents','class_subjects','teacher_assignments'] loop
 execute format('create trigger validate_record before insert or update on public.%I for each row execute function private.validate_phase2_record()',t);
 end loop;
end $$;

-- Record a new enrollment, or atomically close an existing enrollment and move the learner.
-- Expected version prevents two administrators from silently moving the same learner twice.
create function public.enroll_student(tenant uuid, learner uuid, target_class uuid, start_date date, previous_enrollment uuid default null, expected_version integer default null, previous_end date default null, closure_status text default 'TRANSFERRED') returns uuid language plpgsql security definer set search_path='' as $$
declare c public.classes; y public.academic_years; old_row public.enrollments; result uuid;
begin
 if not private.has_permission(tenant,'enrollments.manage') then raise exception 'Not authorized'; end if;
 perform 1 from public.students where school_id=tenant and id=learner and not archived and status='ACTIVE' for update;
 if not found then raise exception 'Select an active learner'; end if;
 select * into c from public.classes where school_id=tenant and id=target_class and not archived for update;
 if not found then raise exception 'Select an active class'; end if;
 select * into y from public.academic_years where school_id=tenant and id=c.academic_year_id and not archived for share;
 if not found or start_date is null or start_date<y.starts_on or start_date>y.ends_on then raise exception 'Enrollment date must be within the academic year'; end if;
 if start_date<(select admission_date from public.students where school_id=tenant and id=learner) then raise exception 'Enrollment cannot precede admission'; end if;
 if previous_enrollment is not null then
 select * into old_row from public.enrollments where school_id=tenant and id=previous_enrollment and student_id=learner and status='ACTIVE' and version=expected_version for update;
 if not found then raise exception 'Enrollment changed; reload before moving'; end if;
 if previous_end is null or previous_end<old_row.starts_on or previous_end>=start_date or closure_status not in ('COMPLETED','TRANSFERRED') then raise exception 'Invalid closure details'; end if;
 if previous_end>(select ends_on from public.academic_years where school_id=tenant and id=old_row.academic_year_id) then raise exception 'Closure date exceeds academic year'; end if;
 update public.enrollments set ends_on=previous_end,status=closure_status,version=version+1 where school_id=tenant and id=old_row.id;
 end if;
 if exists(select 1 from public.enrollments e join public.academic_years a on a.school_id=e.school_id and a.id=e.academic_year_id where e.school_id=tenant and e.student_id=learner and e.starts_on<=y.ends_on and coalesce(e.ends_on,a.ends_on)>=start_date) then raise exception 'Enrollment dates overlap'; end if;
 if c.capacity is not null and (select count(*) from public.enrollments where school_id=tenant and class_id=c.id and status='ACTIVE')>=c.capacity then raise exception 'Class is at capacity'; end if;
 insert into public.enrollments(school_id,student_id,academic_year_id,class_id,starts_on) values(tenant,learner,c.academic_year_id,c.id,start_date) returning id into result;
 return result;
end $$;
create function public.close_enrollment(tenant uuid, enrollment_key uuid, expected_version integer, end_date date, closure_status text) returns void language plpgsql security definer set search_path='' as $$
declare e public.enrollments;
begin
 if not private.has_permission(tenant,'enrollments.manage') then raise exception 'Not authorized'; end if;
 -- Serialize against enrollment creation and movement for this learner.
 perform 1 from public.students s where s.school_id=tenant and s.id=(select student_id from public.enrollments where school_id=tenant and id=enrollment_key) for update;
 select * into e from public.enrollments where school_id=tenant and id=enrollment_key and status='ACTIVE' and version=expected_version for update;
 if not found then raise exception 'Enrollment changed; reload before closing'; end if;
 if closure_status is null or closure_status not in ('COMPLETED','TRANSFERRED','WITHDRAWN') or end_date is null or end_date<e.starts_on or end_date>(select ends_on from public.academic_years where school_id=tenant and id=e.academic_year_id) then raise exception 'Invalid closure details'; end if;
 update public.enrollments set ends_on=end_date,status=closure_status,version=version+1 where school_id=tenant and id=e.id;
end $$;
revoke all on function private.require_active_record(text,uuid,uuid),private.validate_phase2_record() from public,anon,authenticated;
revoke all on function public.enroll_student(uuid,uuid,uuid,date,uuid,integer,date,text),public.close_enrollment(uuid,uuid,integer,date,text) from public,anon;
grant execute on function public.enroll_student(uuid,uuid,uuid,date,uuid,integer,date,text),public.close_enrollment(uuid,uuid,integer,date,text) to authenticated;
commit;
