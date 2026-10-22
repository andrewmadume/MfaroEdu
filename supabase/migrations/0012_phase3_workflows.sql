begin;
create function private.assessment_roster(tenant uuid, assessment_key uuid) returns setof public.students language sql stable security definer set search_path='' as $$
 select s.* from public.students s where s.school_id=tenant and exists(
 select 1 from public.assessments a join public.class_subjects cs on cs.school_id=a.school_id and cs.id=a.class_subject_id
 join public.enrollments e on e.school_id=cs.school_id and e.class_id=cs.class_id and e.student_id=s.id
 where a.school_id=tenant and a.id=assessment_key and a.assessed_on>=e.starts_on and (e.ends_on is null or a.assessed_on<=e.ends_on))
$$;
create function public.assessment_gradebook(tenant uuid, assessment_key uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.assessments; result jsonb;
begin
 select * into a from public.assessments where school_id=tenant and id=assessment_key;
 if a.id is null or not private.can_mark(tenant,a.class_subject_id) then raise exception 'Not authorized'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.first_name||' '||s.surname,'admission_number',s.admission_number,
 'mark',m.mark,'status',m.status,'comment',coalesce(m.comment,''),'version',coalesce(m.version,0)) order by s.surname,s.first_name,s.id),'[]') into result
 from private.assessment_roster(tenant,assessment_key) s left join public.assessment_marks m on m.school_id=tenant and m.assessment_id=assessment_key and m.student_id=s.id;
 return jsonb_build_object('assessment',to_jsonb(a),'learners',result);
end $$;
create function public.save_assessment_marks(tenant uuid, assessment_key uuid, expected_assessment_version integer, entries jsonb) returns void language plpgsql security definer set search_path='' as $$
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
  if st is null or st not in ('MARKED','ABSENT','EXEMPT') or (st='MARKED' and (score is null or score<0 or score>a.max_mark)) or (st<>'MARKED' and score is not null) or length(note)>1000 then raise exception 'Invalid mark or status'; end if;
  select * into previous from public.assessment_marks where school_id=tenant and assessment_id=assessment_key and student_id=learner;
  if coalesce(previous.version,0)<>expected then raise exception 'Marks changed; reload before saving'; end if;
  if previous.id is null then
   insert into public.assessment_marks(school_id,assessment_id,student_id,mark,status,comment) values(tenant,assessment_key,learner,score,st,note);
  else
   update public.assessment_marks set mark=score,status=st,comment=note,version=version+1 where id=previous.id;
  end if;
 end loop;
end $$;
create function public.save_report_note(tenant uuid,class_key uuid,term_key uuid,learner uuid,expected_version integer,note text,promotion text) returns void language plpgsql security definer set search_path='' as $$
declare previous public.report_notes;
begin
 if not private.has_permission(tenant,'results.publish') then raise exception 'Not authorized'; end if;
 perform 1 from public.schools where id=tenant for update;
 if not exists(select 1 from public.enrollments e join public.terms t on t.school_id=e.school_id and t.academic_year_id=e.academic_year_id
 where e.school_id=tenant and e.class_id=class_key and e.student_id=learner and t.id=term_key and e.starts_on<=t.ends_on and coalesce(e.ends_on,t.ends_on)>=t.starts_on) then raise exception 'Learner is not enrolled in this term'; end if;
 select * into previous from public.report_notes where school_id=tenant and class_id=class_key and term_id=term_key and student_id=learner;
 if expected_version is null or coalesce(previous.version,0)<>expected_version then raise exception 'Report note changed; reload before saving'; end if;
 if previous.id is null then
  insert into public.report_notes(school_id,class_id,term_id,student_id,principal_comment,promotion_status) values(tenant,class_key,term_key,learner,note,promotion);
 else update public.report_notes set principal_comment=note,promotion_status=promotion,version=version+1 where id=previous.id; end if;
end $$;

create function private.term_report_documents(tenant uuid,class_key uuid,term_key uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
    if a.status is null then raise exception 'Complete every applicable assessment before publishing'; end if;
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
create function public.preview_term_results(tenant uuid,class_key uuid,term_key uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission(tenant,'results.publish') then raise exception 'Not authorized'; end if;
 return private.term_report_documents(tenant,class_key,term_key);
end $$;
create function public.publish_term_results(tenant uuid,class_key uuid,term_key uuid,expected_documents jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare documents jsonb; item jsonb; publication uuid;
begin
 if not private.has_permission(tenant,'results.publish') then raise exception 'Not authorized'; end if;
 perform 1 from public.schools where id=tenant for update;
 documents=private.term_report_documents(tenant,class_key,term_key);
 if expected_documents is null or documents<>expected_documents then raise exception 'Results changed; review the preview again'; end if;
 update public.result_publications set active=false,version=version+1 where school_id=tenant and class_id=class_key and term_id=term_key and active;
 insert into public.result_publications(school_id,class_id,term_id,created_by,rules) select tenant,class_key,term_key,auth.uid(),to_jsonb(r) from public.grading_rules r where r.school_id=tenant returning id into publication;
 for item in select value from jsonb_array_elements(documents) loop
  insert into public.published_reports(school_id,publication_id,student_id,document) values(tenant,publication,(item->>'student_id')::uuid,item);
 end loop;
 return publication;
end $$;
create function public.withdraw_term_results(tenant uuid,publication_key uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_permission(tenant,'results.publish') then raise exception 'Not authorized'; end if;
 perform 1 from public.schools where id=tenant for update;
 update public.result_publications set active=false,version=version+1 where school_id=tenant and id=publication_key and version=expected_version and active;
 if not found then raise exception 'Publication changed; reload before withdrawing'; end if;
end $$;
revoke all on function private.assessment_roster(uuid,uuid),private.term_report_documents(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.assessment_gradebook(uuid,uuid),public.save_assessment_marks(uuid,uuid,integer,jsonb),public.save_report_note(uuid,uuid,uuid,uuid,integer,text,text),public.preview_term_results(uuid,uuid,uuid),public.publish_term_results(uuid,uuid,uuid,jsonb),public.withdraw_term_results(uuid,uuid,integer) from public,anon;
grant execute on function public.assessment_gradebook(uuid,uuid),public.save_assessment_marks(uuid,uuid,integer,jsonb),public.save_report_note(uuid,uuid,uuid,uuid,integer,text,text),public.preview_term_results(uuid,uuid,uuid),public.publish_term_results(uuid,uuid,uuid,jsonb),public.withdraw_term_results(uuid,uuid,integer) to authenticated;
commit;
