begin;
create function public.subject_gradebook(tenant uuid,allocation uuid,term_key uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
  select id,name,admission_number,surname,count(assessment_id)=0 or bool_or(status is null) incomplete,
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
revoke all on function public.subject_gradebook(uuid,uuid,uuid) from public,anon;
grant execute on function public.subject_gradebook(uuid,uuid,uuid) to authenticated;
commit;
