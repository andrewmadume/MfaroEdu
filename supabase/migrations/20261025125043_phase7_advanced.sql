begin;
create index result_publications_analytics on public.result_publications(school_id,created_at) where active;
create index finance_entries_reporting on public.finance_entries(school_id,posted_on);
create index library_loans_reporting on public.library_loans(school_id,issued_on);
insert into public.permissions values
 ('analytics.view','Read school-wide aggregate reports'),('data.export','Export school learners'),('data.import','Preview and commit learner imports');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p
 where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL') and p.id in ('analytics.view','data.export');
insert into public.role_permissions values ('SUPER_ADMIN','data.import'),('SCHOOL_ADMIN','data.import');

-- Short-lived snapshots are private and accessible only through checked RPCs.
create table private.data_jobs (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 actor_id uuid not null references public.profiles(id), kind text not null check(kind in ('IMPORT','EXPORT')),
 payload jsonb not null, result jsonb, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '15 minutes'
);
create index data_jobs_owner on private.data_jobs(school_id,actor_id,expires_at);
create index data_jobs_actor on private.data_jobs(actor_id);
create index data_jobs_expiry on private.data_jobs(expires_at);
alter table private.data_jobs enable row level security;
revoke all on private.data_jobs from public,anon,authenticated;

create function private.import_errors(tenant uuid,rows jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare item jsonb; n integer=0; errors jsonb='[]'; problem text; dob date; admitted date;
begin
 if jsonb_typeof(rows) is distinct from 'array' then raise exception 'Supply a list of learners';end if;
 if jsonb_array_length(rows) not between 1 and 500 or octet_length(rows::text)>500000 then raise exception 'Use 1 to 500 learners per import';end if;
 for item in select value from jsonb_array_elements(rows) loop
 n=n+1;problem=null;
 begin
 if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('admission_number','first_name','surname','date_of_birth','admission_date')) then problem='Use the five template columns only';
 elsif length(trim(coalesce(item->>'admission_number',''))) not between 1 and 40 or length(trim(coalesce(item->>'first_name',''))) not between 1 and 80 or length(trim(coalesce(item->>'surname',''))) not between 1 and 80 then problem='Admission number and names are required within the column limits';
 elsif coalesce(item->>'date_of_birth','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(item->>'admission_date','') !~ '^\d{4}-\d{2}-\d{2}$' then problem='Use real dates in YYYY-MM-DD format';
 else
 dob=(item->>'date_of_birth')::date;admitted=(item->>'admission_date')::date;
 if dob>=admitted then problem='Birth date must precede admission date';
 elsif exists(select 1 from public.students s where s.school_id=tenant and lower(trim(s.admission_number))=lower(trim(item->>'admission_number'))) then problem='Admission number already exists';
 elsif (select count(*) from jsonb_array_elements(rows) x where lower(trim(x->>'admission_number'))=lower(trim(item->>'admission_number')))>1 then problem='Admission number repeats in this file';end if;
 end if;
 exception when invalid_datetime_format or datetime_field_overflow then problem='Use real dates in YYYY-MM-DD format';end;
 if problem is not null then errors=errors||jsonb_build_array(jsonb_build_object('row',n+1,'message',problem));end if;
 end loop;
 return errors;
end $$;

create function private.advanced_write(tenant uuid,request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text=request->>'op';job private.data_jobs;rows jsonb;errors jsonb;rid uuid;item jsonb;n integer=0;
begin
 if auth.uid() is null or not private.is_active() or not private.is_member(tenant) then raise exception 'Not authorized';end if;
 if op='sync_book' then
  return private.library_write(tenant,(request-'op')||jsonb_build_object('op','book'));
 end if;
 if not private.has_permission(tenant,case when op in ('preview_import','commit_import') then 'data.import' else 'data.export' end) then raise exception 'Not authorized';end if;
 perform 1 from public.schools where id=tenant for update;
 -- Membership can be revoked while waiting for the lock.
 if not private.has_permission(tenant,case when op in ('preview_import','commit_import') then 'data.import' else 'data.export' end) then raise exception 'Not authorized';end if;
 if op in ('preview_import','start_export') then
  delete from private.data_jobs where school_id=tenant and expires_at<now();
  if (select count(*) from private.data_jobs where school_id=tenant and actor_id=auth.uid() and result is null)>=5 then raise exception 'Finish or discard an existing data job first';end if;
  if op='preview_import' then
   rows=request->'rows';errors=private.import_errors(tenant,rows);
   if jsonb_array_length(errors)>0 then return jsonb_build_object('errors',errors,'count',jsonb_array_length(rows));end if;
   insert into private.data_jobs(school_id,actor_id,kind,payload) values(tenant,auth.uid(),'IMPORT',rows) returning id into rid;
  else
   -- One SQL statement takes a coherent export snapshot; pagination reads the snapshot.
   select coalesce(jsonb_agg(x order by x.admission_number,x.id),'[]') into rows from
    (select id,admission_number,first_name,surname,date_of_birth,admission_date,status,archived from public.students where school_id=tenant order by id limit 10001) x;
   if jsonb_array_length(rows)>10000 then raise exception 'Export supports up to 10000 learners';end if;
   insert into private.data_jobs(school_id,actor_id,kind,payload) values(tenant,auth.uid(),'EXPORT',rows) returning id into rid;
   insert into public.audit_logs(school_id,actor_id,action,entity,entity_id,metadata) values(tenant,auth.uid(),'EXPORT','students',rid::text,jsonb_build_object('count',jsonb_array_length(rows)));
  end if;
  return jsonb_build_object('id',rid,'count',jsonb_array_length(rows),'errors','[]'::jsonb,'expires_at',now()+interval '15 minutes');
 end if;
 select * into job from private.data_jobs where id=(request->>'id')::uuid and school_id=tenant and actor_id=auth.uid() for update;
 if job.id is null or job.expires_at<now() then raise exception 'Data job expired or unavailable';end if;
 if op='discard_job' then delete from private.data_jobs where id=job.id;return '{}'::jsonb;end if;
 if op<>'commit_import' or job.kind<>'IMPORT' then raise exception 'Unknown data operation';end if;
 if job.result is not null then return job.result;end if;
 errors=private.import_errors(tenant,job.payload);
 if jsonb_array_length(errors)>0 then raise exception 'Import changed; preview the file again';end if;
 -- All rows and audit records commit together. Any constraint failure rolls back everything.
 for item in select value from jsonb_array_elements(job.payload) loop
 insert into public.students(school_id,admission_number,first_name,surname,date_of_birth,admission_date)
 values(tenant,trim(item->>'admission_number'),trim(item->>'first_name'),trim(item->>'surname'),(item->>'date_of_birth')::date,(item->>'admission_date')::date);n=n+1;
 end loop;
 update private.data_jobs set result=jsonb_build_object('count',n),payload='[]'::jsonb where id=job.id;
 insert into public.audit_logs(school_id,actor_id,action,entity,entity_id,metadata) values(tenant,auth.uid(),'IMPORT','students',job.id::text,jsonb_build_object('count',n));
 return jsonb_build_object('count',n);
end $$;

create function private.advanced_read(tenant uuid,request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 'limitations',jsonb_build_array('Attendance module is not released','Academic groups use active publications created in this date range; annual and term reports may both appear','Library open and overdue counts describe current circulation','No learner ranking or automated eligibility decisions'));
 if op='ai_context' then
 -- Only whole-school counts. Exclude class/term labels, small groups and financial records.
 return jsonb_build_object('schema_version',1,'generated_at',now(),'purpose','School operations context for human review','counts',jsonb_build_object('learners',case when (result->>'learners')::int>=10 then result->'learners' else null end,'teachers',case when (result->>'teachers')::int>=10 then result->'teachers' else null end),'suppression','Counts below ten are withheld; combining datasets may still identify people','external_delivery',false);
 end if;return result;
end $$;

create function private.platform_read(request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;page integer=greatest(coalesce((request->>'page')::integer,0),0);begin
 if request->>'op'='access' then return jsonb_build_object('allowed',auth.uid() is not null and private.is_platform_admin());end if;
 if auth.uid() is null or not private.is_platform_admin() then raise exception 'Not authorized';end if;
 select coalesce(jsonb_agg(x order by x.name,x.id),'[]') into result from (
 select s.id,s.name,s.slug,s.created_at,coalesce(p.status,'trial') status,coalesce(p.plan_code,'trial') plan_code,
 (select count(*) from public.user_roles u where u.school_id=s.id and u.active and u.role_id='SCHOOL_ADMIN') administrators,
 (select count(*) from public.students st where st.school_id=s.id and not st.archived) learners
 from public.schools s left join private.school_subscriptions p on p.school_id=s.id order by s.name,s.id limit 20 offset page::bigint*20) x;
 return jsonb_build_object('rows',result,'count',(select count(*) from public.schools));
end $$;

-- Exposed entry points are invokers; privileged implementations live only in private.
create function public.advanced_read(tenant uuid,request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.advanced_read(tenant,request)$$;
create function public.advanced_write(tenant uuid,request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.advanced_write(tenant,request)$$;
create function public.platform_read(request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.platform_read(request)$$;
revoke all on function private.import_errors(uuid,jsonb) from public,anon,authenticated;
revoke all on function private.advanced_read(uuid,jsonb),private.advanced_write(uuid,jsonb),private.platform_read(jsonb),public.advanced_read(uuid,jsonb),public.advanced_write(uuid,jsonb),public.platform_read(jsonb) from public,anon,authenticated;
grant execute on function private.advanced_read(uuid,jsonb),private.advanced_write(uuid,jsonb),private.platform_read(jsonb),public.advanced_read(uuid,jsonb),public.advanced_write(uuid,jsonb),public.platform_read(jsonb) to authenticated;
commit;
