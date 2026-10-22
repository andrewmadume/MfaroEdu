begin;
-- Existing historical marks remain attached to the enrollment and term dates that authorized them.
create function private.protect_academic_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.schools where id=new.school_id for update;
 if tg_table_name='terms' then
  if exists(select 1 from public.assessments a where a.school_id=new.school_id and a.term_id=new.id and a.assessed_on not between new.starts_on and new.ends_on) then raise exception 'Term dates must contain existing assessments'; end if;
 elsif tg_table_name='enrollments' and tg_op='UPDATE' then
  if exists(select 1 from public.assessment_marks m join public.assessments a on a.school_id=m.school_id and a.id=m.assessment_id
   join public.class_subjects cs on cs.school_id=a.school_id and cs.id=a.class_subject_id
   where m.school_id=new.school_id and m.student_id=new.student_id and cs.class_id=old.class_id
   and a.assessed_on>=old.starts_on and (old.ends_on is null or a.assessed_on<=old.ends_on)
   and (a.assessed_on<new.starts_on or (new.ends_on is not null and a.assessed_on>new.ends_on))) then raise exception 'Enrollment dates must preserve captured marks'; end if;
 end if;
 return new;
end $$;
create trigger academic_history before update on public.terms for each row execute function private.protect_academic_history();
create trigger academic_history before insert or update on public.enrollments for each row execute function private.protect_academic_history();

-- Invoker query reads only published snapshots visible under RLS; families cannot aggregate other learners.
create function public.annual_results(tenant uuid,year_key uuid,learner uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rule public.grading_rules; t record; r record; first_doc jsonb; terms jsonb='[]'; subjects jsonb='[]'; item jsonb; subject_id text;
 total numeric; denom numeric; pct numeric; label text; avg_num numeric=0;avg_den numeric=0; result jsonb;
begin
 if not private.has_permission(tenant,'results.view') then raise exception 'Not authorized'; end if;
 select * into rule from public.grading_rules where school_id=tenant;
 if rule.id is null or not exists(select 1 from public.terms where school_id=tenant and academic_year_id=year_key and not archived) then raise exception 'Configure weights for every term in the year'; end if;
 for t in select * from public.terms where school_id=tenant and academic_year_id=year_key and not archived order by starts_on loop
  if coalesce((rule.term_weights->>t.id::text)::numeric,0)<=0 then raise exception 'Configure weights for every term in the year'; end if;
  if (select count(*) from public.published_reports pr join public.result_publications p on p.school_id=pr.school_id and p.id=pr.publication_id
   where pr.school_id=tenant and pr.student_id=learner and p.term_id=t.id and p.active)>1 then raise exception 'Withdraw superseded class reports before generating annual results'; end if;
  select pr.document into result from public.published_reports pr join public.result_publications p on p.school_id=pr.school_id and p.id=pr.publication_id
   where pr.school_id=tenant and pr.student_id=learner and p.term_id=t.id and p.active order by pr.created_at desc limit 1;
  if result is null then raise exception 'Publish every weighted term before generating annual results'; end if;
  first_doc=result;
  terms=terms||jsonb_build_array(jsonb_build_object('name',t.name,'weight',(rule.term_weights->>t.id::text)::numeric,'document',result));
 end loop;
 for subject_id in select distinct s->>'id' from jsonb_array_elements(terms) term cross join lateral jsonb_array_elements(term->'document'->'subjects') s loop
  total=0;denom=0;item=null;
  for r in select term->>'name' term_name,(term->>'weight')::numeric weight,s from jsonb_array_elements(terms) term cross join lateral jsonb_array_elements(term->'document'->'subjects') s where s->>'id'=subject_id loop
   item=r.s;
   if item->>'percent' is not null then total=total+(item->>'percent')::numeric*r.weight;denom=denom+r.weight;end if;
  end loop;
  pct=case when denom=0 then null else round(total/denom,2) end;label=null;
  select value->>'label' into label from jsonb_array_elements(rule.bands) where (value->>'min')::numeric<=pct order by (value->>'min')::numeric desc limit 1;
  if pct is not null then avg_num=avg_num+pct*(item->>'weight')::numeric;avg_den=avg_den+(item->>'weight')::numeric;end if;
  subjects=subjects||jsonb_build_array(item||jsonb_build_object('percent',pct,'grade',coalesce(label,'Exempt'),'passed',pct>=rule.pass_percent,'comment','','assessments','[]'::jsonb));
 end loop;
 if avg_den=0 then raise exception 'At least one graded subject is required'; end if;
 return first_doc||jsonb_build_object('annual',true,'term_name','Annual summary','term_id',null,'subjects',subjects,'average',round(avg_num/avg_den,2),'pass_percent',rule.pass_percent,'annual_terms',terms,'principal_comment','','promotion_status','');
end $$;
revoke all on function private.protect_academic_history(),public.annual_results(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.annual_results(uuid,uuid,uuid) to authenticated;
commit;
