begin;
-- Resetting a score is an audited versioned update; published snapshots remain unchanged.
alter table public.assessment_marks drop constraint assessment_marks_status_check;
alter table public.assessment_marks add constraint assessment_marks_status_check check(status in ('MARKED','ABSENT','EXEMPT','INCOMPLETE'));
create or replace function public.save_assessment_marks(tenant uuid, assessment_key uuid, expected_assessment_version integer, entries jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a public.assessments; item jsonb; learner uuid; previous public.assessment_marks; st text; score numeric; note text; expected integer;
begin
 perform 1 from public.schools where id=tenant for update;
 select * into a from public.assessments where school_id=tenant and id=assessment_key;
 if a.id is null or not private.can_mark(tenant,a.class_subject_id) then raise exception 'Not authorized'; end if;
 if a.archived or a.version<>expected_assessment_version then raise exception 'Assessment changed; reload before saving'; end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) not between 1 and 1000 then raise exception 'Invalid mark entries'; end if;
 if (select count(*) from jsonb_array_elements(entries))<>(select count(distinct value->>'id') from jsonb_array_elements(entries)) then raise exception 'Duplicate learner entries'; end if;
 for item in select value from jsonb_array_elements(entries) loop
  learner=(item->>'id')::uuid; st=item->>'status'; score=(item->>'mark')::numeric;note=coalesce(item->>'comment','');expected=(item->>'version')::integer;
  if expected is null or expected<0 or not exists(select 1 from private.assessment_roster(tenant,assessment_key) where id=learner) then raise exception 'Learner is not enrolled on the assessment date'; end if;
  if st is null or st not in ('MARKED','ABSENT','EXEMPT','INCOMPLETE') or (st='MARKED' and (score is null or score<0 or score>a.max_mark)) or (st<>'MARKED' and score is not null) or length(note)>1000 then raise exception 'Invalid mark or status'; end if;
  select * into previous from public.assessment_marks where school_id=tenant and assessment_id=assessment_key and student_id=learner;
  if coalesce(previous.version,0)<>expected then raise exception 'Marks changed; reload before saving'; end if;
  if previous.id is null then
   insert into public.assessment_marks(school_id,assessment_id,student_id,mark,status,comment) values(tenant,assessment_key,learner,score,st,note);
  else
   update public.assessment_marks set mark=score,status=st,comment=note,version=version+1 where id=previous.id;
  end if;
 end loop;
end $$;

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
   'subjects',subjects,'average',round(avg_num/avg_den,2),'pass_percent',rule.pass_percent,'principal_comment',coalesce(n.principal_comment,''),'promotion_status',coalesce(n.promotion_status,''),'attendance',null));
 end loop;
 if jsonb_array_length(reports)=0 then raise exception 'This class has no learners enrolled in the term'; end if;
 return reports;
end $$;

create or replace function public.subject_gradebook(tenant uuid,allocation uuid,term_key uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cs public.class_subjects;t public.terms;c public.classes;rule public.grading_rules;result jsonb;
begin
 if not private.can_mark(tenant,allocation) then raise exception 'Not authorized'; end if;
 select * into cs from public.class_subjects where school_id=tenant and id=allocation;
 select * into c from public.classes where school_id=tenant and id=cs.class_id;
 select * into t from public.terms where school_id=tenant and id=term_key and not archived;
 if t.id is null or c.academic_year_id<>t.academic_year_id then raise exception 'Select a class and term in the same year'; end if;
 select * into rule from public.grading_rules where school_id=tenant;
 with roster as (
  select s.id,s.first_name||' '||s.surname name,s.admission_number,s.surname from public.students s where s.school_id=tenant and exists(
   select 1 from public.enrollments e where e.school_id=tenant and e.student_id=s.id and e.class_id=c.id and e.starts_on<=t.ends_on and coalesce(e.ends_on,t.ends_on)>=t.starts_on)
 ), scores as (
  select s.*,a.id assessment_id,a.weight,a.max_mark,m.status,m.mark from roster s left join public.assessments a on a.school_id=tenant and a.class_subject_id=allocation and a.term_id=term_key and not a.archived
  and exists(select 1 from public.enrollments e where e.school_id=tenant and e.student_id=s.id and e.class_id=c.id and a.assessed_on>=e.starts_on and (e.ends_on is null or a.assessed_on<=e.ends_on))
  left join public.assessment_marks m on m.school_id=tenant and m.assessment_id=a.id and m.student_id=s.id
 ), totals as (
  select id,name,admission_number,surname,count(assessment_id)=0 or bool_or(status is null or status='INCOMPLETE') incomplete,
   sum(case when status in ('MARKED','ABSENT') then weight else 0 end) denominator,
   sum(case when status='MARKED' then mark/max_mark*100*weight else 0 end) numerator
  from scores group by id,name,admission_number,surname
 ), results as (
  select *,case when incomplete or denominator=0 then null else round(numerator/denominator,2) end percent from totals
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'admission_number',admission_number,'incomplete',incomplete,'denominator',denominator,'percent',percent,'grade',
  case when incomplete then 'Incomplete' when denominator=0 then 'Exempt' else (select value->>'label' from jsonb_array_elements(rule.bands) where (value->>'min')::numeric<=percent order by (value->>'min')::numeric desc limit 1) end) order by surname,name,id),'[]') into result from results;
 return result;
end $$;

-- CREATE OR REPLACE retains the existing restricted function grants.
commit;
