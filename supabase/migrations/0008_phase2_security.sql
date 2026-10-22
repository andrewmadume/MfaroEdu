begin;
insert into public.permissions(id,description) values
 ('students.view','Read authorized learner profiles'),('students.manage','Register, edit and archive learners'),
 ('students.view_all','Read every learner in the school'),('parents.view','Read authorized guardians'),('parents.manage','Manage guardians and child links'),
 ('staff.view','Read authorized staff profiles'),('staff.manage','Manage staff and teaching assignments'),
 ('academics.view','Read academic structure'),('academics.manage','Manage academic structure and subjects'),
 ('enrollments.view','Read authorized enrollment history'),('enrollments.manage','Enroll and move learners');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p
 where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN') and p.id like any(array['students.%','parents.%','staff.%','academics.%','enrollments.%']);
insert into public.role_permissions select 'PRINCIPAL',id from public.permissions where id in
 ('students.view','students.view_all','parents.view','staff.view','academics.view','enrollments.view');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p
 where r.id in ('TEACHER','STUDENT','PARENT') and p.id in ('students.view','academics.view','enrollments.view');
insert into public.role_permissions values ('TEACHER','staff.view'),('PARENT','parents.view');

create function private.has_role(tenant uuid, role_name text) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active() and exists(select 1 from public.user_roles where school_id=tenant and user_id=auth.uid() and active and role_id=role_name)
$$;
create function private.teaches_class(tenant uuid, class_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(tenant,'TEACHER') and exists(
 select 1 from public.teacher_assignments ta join public.staff s on s.school_id=ta.school_id and s.id=ta.staff_id
 join public.class_subjects cs on cs.school_id=ta.school_id and cs.id=ta.class_subject_id
 join public.classes c on c.school_id=cs.school_id and c.id=cs.class_id
 where ta.school_id=tenant and cs.class_id=class_key and s.user_id=auth.uid() and s.is_teacher and s.employment_status='ACTIVE'
 and not ta.archived and not s.archived and not cs.archived and not c.archived)
$$;
create function private.can_read_student(tenant uuid, student_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission(tenant,'students.view_all') or (private.is_member(tenant) and exists(
 select 1 from public.students s where s.school_id=tenant and s.id=student_key and not s.archived and (
 (s.user_id=auth.uid() and private.has_role(tenant,'STUDENT')) or
 (private.has_role(tenant,'PARENT') and exists(select 1 from public.student_parents sp join public.parents p on p.school_id=sp.school_id and p.id=sp.parent_id
 where sp.school_id=tenant and sp.student_id=s.id and not sp.archived and not p.archived and p.user_id=auth.uid())) or
 exists(select 1 from public.enrollments e where e.school_id=tenant and e.student_id=s.id and e.status='ACTIVE'
 and e.starts_on<=current_date and private.teaches_class(tenant,e.class_id)))))
$$;
create function private.can_read_class(tenant uuid, class_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission(tenant,'students.view_all') or private.teaches_class(tenant,class_key) or exists(
 select 1 from public.enrollments e join public.students s on s.school_id=e.school_id and s.id=e.student_id
 where e.school_id=tenant and e.class_id=class_key and not s.archived and private.is_member(tenant) and (
 (s.user_id=auth.uid() and private.has_role(tenant,'STUDENT')) or (private.has_role(tenant,'PARENT') and exists(
 select 1 from public.student_parents sp join public.parents p on p.school_id=sp.school_id and p.id=sp.parent_id
 where sp.school_id=tenant and sp.student_id=s.id and not sp.archived and not p.archived and p.user_id=auth.uid()))))
$$;
-- Every versioned school record rejects moved tenant IDs and stale write versions.
create function private.guard_school_record() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.school_id<>old.school_id or new.created_at<>old.created_at then raise exception 'Record identity is immutable'; end if;
 if new.version<>old.version+1 then raise exception 'Invalid record version'; end if;
 new.updated_at=now(); return new;
end $$;

do $$ declare t text; permission text; begin
 foreach t in array array['academic_years','terms','grades','classes','subjects','students','parents','staff','student_parents','class_subjects','teacher_assignments','enrollments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger guard_record before update on public.%I for each row execute function private.guard_school_record()',t);
 execute format('create trigger audit_record after insert or update on public.%I for each row execute function private.audit_change()',t);
 if t<>'enrollments' then
 permission=case when t='students' then 'students.manage' when t in ('parents','student_parents') then 'parents.manage' when t in ('staff','teacher_assignments') then 'staff.manage' else 'academics.manage' end;
 execute format('grant insert,update on public.%I to authenticated',t);
 execute format('create policy record_insert on public.%I for insert to authenticated with check(private.has_permission(school_id,%L))',t,permission);
 execute format('create policy record_update on public.%I for update to authenticated using(private.has_permission(school_id,%L)) with check(private.has_permission(school_id,%L))',t,permission,permission);
 end if;
 end loop;
end $$;
create policy years_read on public.academic_years for select to authenticated using(private.has_permission(school_id,'academics.view'));
create policy terms_read on public.terms for select to authenticated using(private.has_permission(school_id,'academics.view'));
create policy grades_read on public.grades for select to authenticated using(private.has_permission(school_id,'academics.view'));
create policy subjects_read on public.subjects for select to authenticated using(private.has_permission(school_id,'academics.view'));
create policy classes_read on public.classes for select to authenticated using(private.can_read_class(school_id,id));
create policy students_read on public.students for select to authenticated using(private.can_read_student(school_id,id));
create policy enrollments_read on public.enrollments for select to authenticated using(private.can_read_student(school_id,student_id));
create policy parents_read on public.parents for select to authenticated using(private.has_permission(school_id,'students.view_all') or (not archived and user_id=auth.uid() and private.has_role(school_id,'PARENT')));
create policy guardians_read on public.student_parents for select to authenticated using(private.has_permission(school_id,'students.view_all') or (not archived and exists(select 1 from public.parents p where p.school_id=school_id and p.id=parent_id and p.user_id=auth.uid() and not p.archived) and private.has_role(school_id,'PARENT')));
create policy staff_read on public.staff for select to authenticated using(private.has_permission(school_id,'students.view_all') or (not archived and user_id=auth.uid() and private.has_role(school_id,'TEACHER')));
create policy class_subject_read on public.class_subjects for select to authenticated using(private.can_read_class(school_id,class_id));
create policy teacher_assignment_read on public.teacher_assignments for select to authenticated using(private.has_permission(school_id,'students.view_all') or exists(select 1 from public.staff s where s.school_id=teacher_assignments.school_id and s.id=staff_id and s.user_id=auth.uid() and not s.archived and private.has_role(teacher_assignments.school_id,'TEACHER')));

revoke all on function private.has_role(uuid,text),private.teaches_class(uuid,uuid),private.can_read_student(uuid,uuid),private.can_read_class(uuid,uuid),private.guard_school_record() from public,anon,authenticated;
grant execute on function private.has_role(uuid,text),private.teaches_class(uuid,uuid),private.can_read_student(uuid,uuid),private.can_read_class(uuid,uuid) to authenticated;
commit;
