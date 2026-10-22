begin;
insert into public.permissions values
 ('assessment.view','Read assigned assessments and draft marks'),('assessment.manage','Manage assigned assessments and marks'),
 ('assessment.manage_all','Manage all school assessments'),('grading.manage','Configure school grading'),
 ('results.view','Read authorized published reports'),('results.publish','Publish and withdraw school reports');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p
 where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL') and p.id like any(array['assessment.%','grading.%','results.%']);
insert into public.role_permissions values ('TEACHER','assessment.view'),('TEACHER','assessment.manage'),('TEACHER','results.view'),('STUDENT','results.view'),('PARENT','results.view');

create function private.teaches_subject(tenant uuid, allocation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(tenant,'TEACHER') and exists(select 1 from public.teacher_assignments ta
 join public.staff s on s.school_id=ta.school_id and s.id=ta.staff_id
 join public.class_subjects cs on cs.school_id=ta.school_id and cs.id=ta.class_subject_id
 join public.classes c on c.school_id=cs.school_id and c.id=cs.class_id
 where ta.school_id=tenant and ta.class_subject_id=allocation and s.user_id=auth.uid() and s.is_teacher
 and s.employment_status='ACTIVE' and not ta.archived and not s.archived and not cs.archived and not c.archived)
$$;
create function private.can_mark(tenant uuid, allocation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission(tenant,'assessment.manage_all') or (private.has_permission(tenant,'assessment.manage') and private.teaches_subject(tenant,allocation))
$$;
create function private.owns_learner(tenant uuid, learner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_member(tenant) and exists(select 1 from public.students s where s.school_id=tenant and s.id=learner and (
 (s.user_id=auth.uid() and private.has_role(tenant,'STUDENT')) or (private.has_role(tenant,'PARENT') and exists(
 select 1 from public.student_parents sp join public.parents p on p.school_id=sp.school_id and p.id=sp.parent_id
 where sp.school_id=tenant and sp.student_id=learner and not sp.archived and not p.archived and p.user_id=auth.uid()))))
$$;

create table public.grading_rules (
 id uuid primary key default gen_random_uuid(), school_id uuid not null unique references public.schools(id),
 version integer not null default 1, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 bands jsonb not null, pass_percent numeric not null check(pass_percent between 0 and 100),
 term_weights jsonb not null default '{}', assessment_types jsonb not null,
 check(jsonb_typeof(bands)='array'),check(jsonb_typeof(term_weights)='object'),check(jsonb_typeof(assessment_types)='array')
);
create table public.assessments (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),unique(school_id,id),
 class_subject_id uuid not null,term_id uuid not null,name text not null check(length(trim(name)) between 1 and 120),
 assessment_type text not null check(length(trim(assessment_type)) between 1 and 80),assessed_on date not null,
 max_mark numeric not null check(max_mark>0 and max_mark<=100000),weight numeric not null check(weight>0 and weight<=1000),
 archived boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(school_id,class_subject_id) references public.class_subjects(school_id,id),foreign key(school_id,term_id) references public.terms(school_id,id)
);
create index assessments_scope on public.assessments(school_id,class_subject_id,term_id,archived);
create table public.assessment_marks (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),assessment_id uuid not null,student_id uuid not null,
 mark numeric, status text not null check(status in ('MARKED','ABSENT','EXEMPT')),comment text not null default '' check(length(comment)<=1000),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(school_id,assessment_id,student_id),foreign key(school_id,assessment_id) references public.assessments(school_id,id),
 foreign key(school_id,student_id) references public.students(school_id,id),
 check((status='MARKED' and mark is not null and mark>=0) or (status<>'MARKED' and mark is null))
);
create table public.report_notes (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),class_id uuid not null,term_id uuid not null,student_id uuid not null,
 principal_comment text not null default '' check(length(principal_comment)<=2000),promotion_status text not null default '' check(length(promotion_status)<=120),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(school_id,class_id,term_id,student_id),foreign key(school_id,class_id) references public.classes(school_id,id),
 foreign key(school_id,term_id) references public.terms(school_id,id),foreign key(school_id,student_id) references public.students(school_id,id)
);
create table public.result_publications (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),unique(school_id,id),class_id uuid not null,term_id uuid not null,
 active boolean not null default true,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),rules jsonb not null,
 foreign key(school_id,class_id) references public.classes(school_id,id),foreign key(school_id,term_id) references public.terms(school_id,id)
);
create unique index one_live_publication on public.result_publications(school_id,class_id,term_id) where active;
create table public.published_reports (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),publication_id uuid not null,student_id uuid not null,
 created_at timestamptz not null default now(),document jsonb not null,unique(publication_id,student_id),
 foreign key(school_id,publication_id) references public.result_publications(school_id,id),foreign key(school_id,student_id) references public.students(school_id,id)
);

-- School-wide serialization prevents grading, mark and publication writes racing each other.
create function private.validate_academic_write() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.terms; c public.classes; b jsonb; last_min numeric=101; v numeric; label text; rule public.grading_rules;
begin
 perform 1 from public.schools where id=new.school_id for update;
 if tg_table_name='grading_rules' then
  if jsonb_array_length(new.bands)<1 or jsonb_array_length(new.bands)>30 or jsonb_array_length(new.assessment_types)<1 or jsonb_array_length(new.assessment_types)>30 then raise exception 'Configure grading bands and assessment types'; end if;
  for b in select value from jsonb_array_elements(new.bands) loop
   v=(b->>'min')::numeric; label=b->>'label';
   if v is null or v<0 or v>100 or v>=last_min or label is null or length(trim(label)) not between 1 and 80 then raise exception 'Bands must descend to zero with unique thresholds'; end if;
   last_min=v;
  end loop;
  if last_min<>0 then raise exception 'Bands must descend to zero with unique thresholds'; end if;
  for b in select value from jsonb_array_elements(new.assessment_types) loop
   if jsonb_typeof(b)<>'string' or length(trim(b#>>'{}')) not between 1 and 80 then raise exception 'Invalid assessment type'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(new.assessment_types))<>(select count(distinct value) from jsonb_array_elements(new.assessment_types)) then raise exception 'Duplicate assessment type'; end if;
  for label,b in select key,value from jsonb_each(new.term_weights) loop
   if jsonb_typeof(b)<>'number' or (b#>>'{}')::numeric<=0 or (b#>>'{}')::numeric>1000 or not exists(select 1 from public.terms where school_id=new.school_id and id=label::uuid and not archived) then raise exception 'Invalid annual term weights'; end if;
  end loop;
 elsif tg_table_name='assessments' then
  if tg_op='UPDATE' and (new.class_subject_id<>old.class_subject_id or new.term_id<>old.term_id) then raise exception 'Assessment allocation is immutable'; end if;
  select * into t from public.terms where school_id=new.school_id and id=new.term_id and not archived;
  select cl.* into c from public.classes cl join public.class_subjects cs on cs.school_id=cl.school_id and cs.class_id=cl.id
   join public.subjects su on su.school_id=cs.school_id and su.id=cs.subject_id
   where cs.school_id=new.school_id and cs.id=new.class_subject_id and not cs.archived and not cl.archived and not su.archived;
  if t.id is null or c.id is null or t.academic_year_id<>c.academic_year_id or new.assessed_on not between t.starts_on and t.ends_on then raise exception 'Assessment must match the class year and term dates'; end if;
  select * into rule from public.grading_rules where school_id=new.school_id;
  if rule.id is null or not (rule.assessment_types ? new.assessment_type) then raise exception 'Configure this assessment type first'; end if;
  if exists(select 1 from public.assessment_marks m where m.school_id=new.school_id and m.assessment_id=new.id and m.mark>new.max_mark) then raise exception 'Maximum mark is below an existing mark'; end if;
 end if;
 return new;
end $$;
do $$ declare tab text; begin
 foreach tab in array array['grading_rules','assessments','assessment_marks','report_notes','result_publications','published_reports'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('create trigger audit_record after insert or update on public.%I for each row execute function private.audit_change()',tab);
  if tab<>'published_reports' then execute format('create trigger guard_record before update on public.%I for each row execute function private.guard_school_record()',tab); end if;
 end loop;
end $$;
create trigger validate_rules before insert or update on public.grading_rules for each row execute function private.validate_academic_write();
create trigger validate_assessment before insert or update on public.assessments for each row execute function private.validate_academic_write();
grant insert,update on public.assessments,public.grading_rules to authenticated;
create policy rules_read on public.grading_rules for select to authenticated using(private.has_permission(school_id,'assessment.view') or private.has_permission(school_id,'results.view'));
create policy rules_insert on public.grading_rules for insert to authenticated with check(private.has_permission(school_id,'grading.manage'));
create policy rules_update on public.grading_rules for update to authenticated using(private.has_permission(school_id,'grading.manage')) with check(private.has_permission(school_id,'grading.manage'));
create policy assessment_read on public.assessments for select to authenticated using(private.can_mark(school_id,class_subject_id));
create policy assessment_insert on public.assessments for insert to authenticated with check(private.can_mark(school_id,class_subject_id));
create policy assessment_update on public.assessments for update to authenticated using(private.can_mark(school_id,class_subject_id)) with check(private.can_mark(school_id,class_subject_id));
create policy marks_read on public.assessment_marks for select to authenticated using(exists(select 1 from public.assessments a where a.school_id=assessment_marks.school_id and a.id=assessment_id and private.can_mark(a.school_id,a.class_subject_id)));
create policy notes_read on public.report_notes for select to authenticated using(private.has_permission(school_id,'results.publish'));
create policy publications_read on public.result_publications for select to authenticated using(private.has_permission(school_id,'results.publish') or (active and private.has_permission(school_id,'results.view') and private.can_read_class(school_id,class_id)));
create policy reports_read on public.published_reports for select to authenticated using(private.has_permission(school_id,'results.publish') or (private.has_permission(school_id,'results.view') and exists(
 select 1 from public.result_publications p where p.school_id=published_reports.school_id and p.id=publication_id and p.active
 and (private.teaches_class(p.school_id,p.class_id) or private.owns_learner(p.school_id,published_reports.student_id)))));
revoke all on function private.teaches_subject(uuid,uuid),private.can_mark(uuid,uuid),private.owns_learner(uuid,uuid),private.validate_academic_write() from public,anon,authenticated;
grant execute on function private.teaches_subject(uuid,uuid),private.can_mark(uuid,uuid),private.owns_learner(uuid,uuid) to authenticated;
commit;
