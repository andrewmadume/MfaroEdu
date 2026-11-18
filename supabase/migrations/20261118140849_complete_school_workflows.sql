begin;
-- Finish the previously deferred school workflows. All privileged implementations
-- remain in the unexposed private schema, behind invoker RPCs with fresh checks.
insert into public.permissions values
 ('events.view','View authorized school events'),('events.manage','Manage school calendar'),
 ('documents.view','Read authorized private documents'),('documents.manage','Manage private documents');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p
 where p.id in ('events.view','documents.view');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p
 where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN','PRINCIPAL') and p.id in ('events.manage','documents.manage');

alter table public.schools add column website text not null default '' check(website='' or (length(website)<=254 and website ~ '^https://[^[:space:]]+$')),
 add column logo_data text not null default '' check(logo_data='' or (length(logo_data)<=280000 and logo_data ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$')),
 add column report_title text not null default 'Academic report card' check(length(trim(report_title)) between 1 and 100),
 add column report_footer text not null default 'Empowering Schools. Inspiring Futures.' check(length(report_footer)<=500),
 add column report_layout text not null default 'STANDARD' check(report_layout in ('STANDARD','COMPACT'));
grant update(website,logo_data,report_title,report_footer,report_layout) on public.schools to authenticated;

create table public.school_events (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),
 title text not null check(length(trim(title)) between 1 and 160),description text not null default '' check(length(description)<=3000),
 category text not null check(category in ('EVENT','EXAM','MEETING','PARENT_MEETING','HOLIDAY','SPORT','ACADEMIC')),
 starts_at timestamptz not null,ends_at timestamptz not null,all_day boolean not null default false,
 class_id uuid,roles text[] not null default array['SCHOOL_ADMIN','PRINCIPAL','TEACHER','PARENT','STUDENT','ACCOUNTANT','LIBRARIAN'],
 archived boolean not null default false,version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(school_id,class_id) references public.classes(school_id,id),
 check(ends_at>starts_at and ends_at<=starts_at+interval '366 days'),
 check(not all_day or ((starts_at at time zone 'UTC')::time=time '00:00' and (ends_at at time zone 'UTC')::time=time '00:00')),
 check(cardinality(roles) between 1 and 7 and roles <@ array['SCHOOL_ADMIN','PRINCIPAL','TEACHER','PARENT','STUDENT','ACCOUNTANT','LIBRARIAN'])
);
create index school_events_dates on public.school_events(school_id,starts_at,id);
create index school_events_class on public.school_events(school_id,class_id);
alter table public.school_events enable row level security;
revoke all on public.school_events from public,anon,authenticated;
grant select on public.school_events to authenticated;
create function private.event_class_access(tenant uuid,class_key uuid,event_time timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select private.teaches_class(tenant,class_key) or (private.is_member(tenant) and exists(
 select 1 from public.enrollments e join public.students s on s.school_id=e.school_id and s.id=e.student_id join public.schools sch on sch.id=e.school_id
 where e.school_id=tenant and e.class_id=class_key and not s.archived and (event_time at time zone sch.timezone)::date between e.starts_on and coalesce(e.ends_on,(event_time at time zone sch.timezone)::date)
 and ((s.user_id=auth.uid() and private.has_role(tenant,'STUDENT')) or (private.has_role(tenant,'PARENT') and exists(
 select 1 from public.student_parents sp join public.parents p on p.school_id=sp.school_id and p.id=sp.parent_id where sp.school_id=tenant and sp.student_id=s.id and not sp.archived and not p.archived and p.user_id=auth.uid())))))
$$;
revoke all on function private.event_class_access(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.event_class_access(uuid,uuid,timestamptz) to authenticated;
create policy event_read on public.school_events for select to authenticated using(
 private.has_permission(school_id,'events.manage') or (not archived and private.has_permission(school_id,'events.view')
 and exists(select 1 from public.user_roles r where r.school_id=school_events.school_id and r.user_id=(select auth.uid()) and r.active and r.role_id=any(school_events.roles))
 and (class_id is null or private.event_class_access(school_id,class_id,starts_at))));
create trigger event_guard before update on public.school_events for each row execute function private.guard_school_record();
create trigger event_audit after insert or update on public.school_events for each row execute function private.audit_change();

create table public.school_documents (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),
 title text not null check(length(trim(title)) between 1 and 160),filename text not null check(length(filename) between 1 and 120 and filename !~ '[/\\\x00-\x1f]'),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','text/plain')),
 byte_size integer not null check(byte_size between 1 and 5242880),
 audience text not null check(audience in ('SCHOOL','STAFF','LEARNER','STAFF_MEMBER','ADMIN')),
 student_id uuid,staff_id uuid,ready boolean not null default false,archived boolean not null default false,
 created_by uuid not null references public.profiles(id),version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(school_id,student_id) references public.students(school_id,id),foreign key(school_id,staff_id) references public.staff(school_id,id),
 check((audience='LEARNER')=(student_id is not null)),check((audience='STAFF_MEMBER')=(staff_id is not null))
);
create index school_documents_list on public.school_documents(school_id,archived,created_at desc,id);
create index school_documents_student on public.school_documents(school_id,student_id);
create index school_documents_staff on public.school_documents(school_id,staff_id);
create index school_documents_creator on public.school_documents(created_by);
create unique index school_document_object_path on public.school_documents((school_id::text||'/'||id::text||'/file'));
alter table public.school_documents enable row level security;
revoke all on public.school_documents from public,anon,authenticated;
grant select on public.school_documents to authenticated;
create function private.can_read_document(d public.school_documents) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission(d.school_id,'documents.manage') or (
 private.has_permission(d.school_id,'documents.view') and d.ready and not d.archived and (
 d.audience='SCHOOL' or
 (d.audience='STAFF' and exists(select 1 from public.user_roles r where r.school_id=d.school_id and r.user_id=auth.uid() and r.active and r.role_id in ('SCHOOL_ADMIN','PRINCIPAL','TEACHER','ACCOUNTANT','LIBRARIAN'))) or
 (d.audience='STAFF_MEMBER' and exists(select 1 from public.staff s where s.school_id=d.school_id and s.id=d.staff_id and s.user_id=auth.uid() and not s.archived)) or
 (d.audience='LEARNER' and (private.has_permission(d.school_id,'students.view_all') or exists(
 select 1 from public.students s where s.school_id=d.school_id and s.id=d.student_id and not s.archived and (
 (s.user_id=auth.uid() and private.has_role(d.school_id,'STUDENT')) or
 (private.has_role(d.school_id,'PARENT') and exists(select 1 from public.student_parents sp join public.parents p on p.school_id=sp.school_id and p.id=sp.parent_id where sp.school_id=d.school_id and sp.student_id=s.id and not sp.archived and not p.archived and p.user_id=auth.uid()))))))))
$$;
revoke all on function private.can_read_document(public.school_documents) from public,anon,authenticated;
grant execute on function private.can_read_document(public.school_documents) to authenticated;
create policy document_read on public.school_documents for select to authenticated using(private.can_read_document(school_documents));
create trigger document_guard before update on public.school_documents for each row execute function private.guard_school_record();
create trigger document_audit after insert or update on public.school_documents for each row execute function private.audit_change();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('mfaroedu-documents','mfaroedu-documents',false,5242880,array['application/pdf','image/png','image/jpeg','text/plain'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function private.document_object_access(object_name text,action text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare d public.school_documents;
begin
 select * into d from public.school_documents where object_name=school_id::text||'/'||id::text||'/file' for update;
 if d.id is null then return false;end if;
 -- Storage DELETE needs SELECT visibility as well. Managers retain metadata
 -- access for cleanup; ordinary audiences lose access immediately on archive.
 if action='read' then return private.has_permission(d.school_id,'documents.manage') or (d.ready and not d.archived and private.can_read_document(d));end if;
 if not private.has_permission(d.school_id,'documents.manage') then return false;end if;
 return case action when 'insert' then not d.ready and not d.archived when 'delete' then d.archived or not d.ready else false end;
end $$;
revoke all on function private.document_object_access(text,text) from public,anon,authenticated;
grant execute on function private.document_object_access(text,text) to authenticated;
create policy school_document_object_read on storage.objects for select to authenticated using(bucket_id='mfaroedu-documents' and private.document_object_access(name,'read'));
create policy school_document_object_insert on storage.objects for insert to authenticated with check(bucket_id='mfaroedu-documents' and private.document_object_access(name,'insert'));
create policy school_document_object_delete on storage.objects for delete to authenticated using(bucket_id='mfaroedu-documents' and private.document_object_access(name,'delete'));

-- Invitations are explicit, single-use, email-bound school grants. The server
-- stores only a SHA-256 digest of a high-entropy random link; verified email is checked
-- from auth.users, never editable user_metadata. No service key reaches a client.
create table private.school_invitations (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),
 email text not null,role_id text not null references public.roles(id) check(role_id<>'SUPER_ADMIN'),
 token_hash bytea not null unique,created_by uuid not null references public.profiles(id),
 expires_at timestamptz not null default now()+interval '7 days',revoked boolean not null default false,
 accepted_by uuid references public.profiles(id),created_at timestamptz not null default now()
);
create index school_invites_school on private.school_invitations(school_id,created_at);
create index school_invites_creator on private.school_invitations(created_by);
create index school_invites_accepted on private.school_invitations(accepted_by);
create index school_invites_role on private.school_invitations(role_id);
alter table private.school_invitations enable row level security;
revoke all on private.school_invitations from public,anon,authenticated;

create function private.school_tools(tenant uuid,request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text=request->>'op';e public.school_events;d public.school_documents;i private.school_invitations;rid uuid;token text;mail text;v_roles text[];answer jsonb;
begin
 if auth.uid() is null or not private.is_active() then raise exception 'Not authorized';end if;
 if op in ('accept_invitation','invitation_preview') then
  select * into i from private.school_invitations where token_hash=sha256(convert_to(request->>'token','UTF8'));
  if i.id is null or i.revoked or i.expires_at<=now() or (i.accepted_by is not null and i.accepted_by<>auth.uid()) then raise exception 'Invitation expired or unavailable';end if;
  -- Keep the same school-before-membership lock order as membership management.
  perform 1 from public.schools where id=i.school_id for update;
  select * into i from private.school_invitations where token_hash=sha256(convert_to(request->>'token','UTF8')) for update;
  if i.revoked or i.expires_at<=now() or (i.accepted_by is not null and i.accepted_by<>auth.uid()) or not exists(select 1 from public.user_roles r join public.role_permissions p on p.role_id=r.role_id join public.profiles pr on pr.id=r.user_id where r.school_id=i.school_id and r.user_id=i.created_by and pr.active and r.active and p.permission_id='members.manage') then raise exception 'Invitation expired or unavailable';end if;
  select lower(to_jsonb(u)->>'email') into mail from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if mail is distinct from i.email then raise exception 'Sign in with the verified invited email';end if;
  if op='invitation_preview' then return jsonb_build_object('school_name',(select name from public.schools where id=i.school_id),'role_id',i.role_id,'expires_at',i.expires_at);end if;
  if i.accepted_by is null then
   insert into public.user_roles(school_id,user_id,role_id,active) values(i.school_id,auth.uid(),i.role_id,true) on conflict(school_id,user_id,role_id) do update set active=true;
   update private.school_invitations set accepted_by=auth.uid() where id=i.id;
  end if;
  return jsonb_build_object('school_id',i.school_id);
 end if;
 if not private.is_member(tenant) then raise exception 'Not authorized';end if;
 perform 1 from public.schools where id=tenant for update;
 if not private.is_member(tenant) then raise exception 'Not authorized';end if;
 if op in ('create_invitation','revoke_invitation','invitations') then
  if not private.has_permission(tenant,'members.manage') then raise exception 'Not authorized';end if;
  if op='invitations' then
   select coalesce(jsonb_agg(x),'[]') into answer from (select id,email,role_id,expires_at,revoked,accepted_by is not null as accepted from private.school_invitations where school_id=tenant order by created_at desc,id limit 50) x;return answer;
  elsif op='revoke_invitation' then
   update private.school_invitations set revoked=true where school_id=tenant and id=(request->>'id')::uuid;
   insert into public.audit_logs(school_id,actor_id,action,entity,entity_id) values(tenant,auth.uid(),'REVOKE_INVITE','membership',request->>'id');
   return '{}'::jsonb;
  end if;
  mail=lower(trim(request->>'email'));
  if mail is null or length(mail)>254 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or request->>'role_id' is null or request->>'role_id' not in ('SCHOOL_ADMIN','PRINCIPAL','TEACHER','PARENT','STUDENT','ACCOUNTANT','LIBRARIAN') then raise exception 'Check invitation email and role';end if;
  if (select count(*) from private.school_invitations where school_id=tenant and created_at>now()-interval '1 day')>=100 then raise exception 'Daily invitation limit reached';end if;
  update private.school_invitations set revoked=true where school_id=tenant and email=mail and role_id=request->>'role_id' and accepted_by is null;
  token=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into private.school_invitations(school_id,email,role_id,token_hash,created_by) values(tenant,mail,request->>'role_id',sha256(convert_to(token,'UTF8')),auth.uid()) returning id into rid;
  insert into public.audit_logs(school_id,actor_id,action,entity,entity_id,metadata) values(tenant,auth.uid(),'INVITE','membership',rid::text,jsonb_build_object('role',request->>'role_id'));
  return jsonb_build_object('id',rid,'token',token);
 elsif op='save_event' then
  if not private.has_permission(tenant,'events.manage') then raise exception 'Not authorized';end if;
  if request->>'class_id' is not null and not exists(select 1 from public.classes where school_id=tenant and id=(request->>'class_id')::uuid and not archived) then raise exception 'Choose an active class';end if;
  select array_agg(value) into v_roles from jsonb_array_elements_text(request->'roles');
  if request->>'id' is null then
   rid=(request->>'request_key')::uuid;
   if rid is null then raise exception 'A request key is required';end if;
   select * into e from public.school_events where school_id=tenant and id=rid;
   if e.id is not null then
    if e.title<>trim(request->>'title') or e.description<>coalesce(request->>'description','') or e.category<>request->>'category' or e.starts_at<>(request->>'starts_at')::timestamptz or e.ends_at<>(request->>'ends_at')::timestamptz or e.roles is distinct from v_roles or e.class_id is distinct from (request->>'class_id')::uuid or e.all_day is distinct from coalesce((request->>'all_day')::boolean,false) then raise exception 'Document request changed';end if;
    return to_jsonb(e);
   end if;
   insert into public.school_events(id,school_id,title,description,category,starts_at,ends_at,all_day,class_id,roles)
   values(rid,tenant,trim(request->>'title'),coalesce(request->>'description',''),request->>'category',(request->>'starts_at')::timestamptz,(request->>'ends_at')::timestamptz,coalesce((request->>'all_day')::boolean,false),(request->>'class_id')::uuid,v_roles) returning * into e;
  else
   update public.school_events set title=trim(request->>'title'),description=coalesce(request->>'description',''),category=request->>'category',starts_at=(request->>'starts_at')::timestamptz,ends_at=(request->>'ends_at')::timestamptz,all_day=coalesce((request->>'all_day')::boolean,false),class_id=(request->>'class_id')::uuid,roles=v_roles,archived=coalesce((request->>'archived')::boolean,false),version=version+1
   where school_id=tenant and id=(request->>'id')::uuid and version=(request->>'version')::integer returning * into e;
   if e.id is null then raise exception 'Record changed; reload before saving';end if;
  end if;
  return to_jsonb(e);
 elsif op='reserve_document' then
  if not private.has_permission(tenant,'documents.manage') then raise exception 'Not authorized';end if;
  rid=(request->>'id')::uuid;
  select * into d from public.school_documents where id=rid and school_id=tenant;
  if d.id is not null then
   if d.created_by<>auth.uid() or d.archived or d.title<>trim(request->>'title') or d.filename<>request->>'filename' or d.byte_size<>(request->>'byte_size')::integer or d.mime_type<>request->>'mime_type' or d.audience<>request->>'audience' or d.student_id is distinct from (request->>'student_id')::uuid or d.staff_id is distinct from (request->>'staff_id')::uuid then raise exception 'Document request changed';end if;
   return to_jsonb(d);
  end if;
  if (select count(*) from public.school_documents where school_id=tenant and not ready and not archived)>=20 then raise exception 'Finish or archive pending uploads first';end if;
  insert into public.school_documents(id,school_id,title,filename,mime_type,byte_size,audience,student_id,staff_id,created_by)
  values(rid,tenant,trim(request->>'title'),request->>'filename',request->>'mime_type',(request->>'byte_size')::integer,request->>'audience',(request->>'student_id')::uuid,(request->>'staff_id')::uuid,auth.uid()) returning * into d;
  return to_jsonb(d);
 elsif op in ('finish_document','archive_document') then
  if not private.has_permission(tenant,'documents.manage') then raise exception 'Not authorized';end if;
  select * into d from public.school_documents where school_id=tenant and id=(request->>'id')::uuid for update;
  if d.id is null or d.version<>(request->>'version')::integer then raise exception 'Record changed; reload before saving';end if;
  if op='finish_document' then
   if d.archived or not exists(select 1 from storage.objects where bucket_id='mfaroedu-documents' and name=tenant::text||'/'||d.id::text||'/file' and (metadata->>'size')::bigint=d.byte_size and metadata->>'mimetype'=d.mime_type) then raise exception 'Upload incomplete; retry the original file';end if;
   if not d.ready then update public.school_documents set ready=true,version=version+1 where id=d.id returning * into d;end if;
  else update public.school_documents set archived=true,version=version+1 where id=d.id returning * into d;end if;
  return to_jsonb(d);
 end if;
 raise exception 'Unknown school operation';
end $$;
create function public.school_tools(tenant uuid,request jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select private.school_tools(tenant,request)$$;
revoke all on function private.school_tools(uuid,jsonb),public.school_tools(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.school_tools(uuid,jsonb),public.school_tools(uuid,jsonb) to authenticated;

-- Branding is snapshotted along with academic results, preserving past releases.
alter function private.term_report_documents(uuid,uuid,uuid) rename to term_report_documents_before_branding;
create function private.term_report_documents(tenant uuid,class_key uuid,term_key uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(d||jsonb_build_object('school_logo',s.logo_data,'school_website',s.website,'report_title',s.report_title,'report_footer',s.report_footer,'report_layout',s.report_layout)),'[]')
 from public.schools s cross join lateral jsonb_array_elements(private.term_report_documents_before_branding(tenant,class_key,term_key)) d where s.id=tenant and private.has_permission(tenant,'results.publish')
$$;
revoke all on function private.term_report_documents(uuid,uuid,uuid),private.term_report_documents_before_branding(uuid,uuid,uuid) from public,anon,authenticated;
-- Additional imports use the same bounded, actor-owned, expiring job snapshots.
alter table private.data_jobs add column module text not null default 'students';
create function private.directory_import_errors(tenant uuid,module text,rows jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare item jsonb;n integer=0;errors jsonb='[]';problem text;v_code text;
begin
 if module not in ('staff','subjects') or jsonb_typeof(rows) is distinct from 'array' then raise exception 'Invalid import';end if;
 if jsonb_array_length(rows) not between 1 and 500 or octet_length(rows::text)>500000 then raise exception 'Use 1 to 500 records per import';end if;
 for item in select value from jsonb_array_elements(rows) loop
  n=n+1;problem=null;
  if jsonb_typeof(item)<>'object' then problem='Use template columns';
  elsif module='staff' then
   v_code=trim(item->>'employee_number');
   if exists(select 1 from jsonb_object_keys(item) k where k not in ('employee_number','first_name','surname','position','department','email')) or coalesce(length(v_code),0) not between 1 and 40 or coalesce(length(trim(item->>'first_name')),0) not between 1 and 80 or coalesce(length(trim(item->>'surname')),0) not between 1 and 80 or coalesce(length(trim(item->>'position')),0) not between 1 and 120 or length(coalesce(item->>'department',''))>120 or (coalesce(item->>'email','')<>'' and (length(item->>'email')>254 or item->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) then problem='Check teacher names, employee number, position and email';
   elsif exists(select 1 from public.staff s where s.school_id=tenant and lower(trim(s.employee_number))=lower(v_code)) then problem='Employee number already exists';
   elsif (select count(*) from jsonb_array_elements(rows) x where lower(trim(x->>'employee_number'))=lower(v_code))>1 then problem='Employee number repeats in this file';end if;
  else
   v_code=trim(item->>'code');
   if exists(select 1 from jsonb_object_keys(item) k where k not in ('code','name','description')) or coalesce(length(v_code),0) not between 1 and 24 or coalesce(length(trim(item->>'name')),0) not between 1 and 120 or length(coalesce(item->>'description',''))>1000 then problem='Check subject code, name and description lengths';
   elsif exists(select 1 from public.subjects s where s.school_id=tenant and lower(trim(s.code))=lower(v_code)) then problem='Subject code already exists';
   elsif (select count(*) from jsonb_array_elements(rows) x where lower(trim(x->>'code'))=lower(v_code))>1 then problem='Subject code repeats in this file';end if;
  end if;
  if problem is not null then errors=errors||jsonb_build_array(jsonb_build_object('row',n+1,'message',problem));end if;
 end loop;
 return errors;
end $$;
revoke all on function private.directory_import_errors(uuid,text,jsonb) from public,anon,authenticated;

create function private.school_data(tenant uuid,request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text=request->>'op';module text=request->>'module';rows jsonb;errors jsonb;job private.data_jobs;rid uuid;item jsonb;answer jsonb;perm text;
begin
 if auth.uid() is null or not private.is_member(tenant) then raise exception 'Not authorized';end if;
 perform 1 from public.schools where id=tenant for update;
 if not private.is_member(tenant) then raise exception 'Not authorized';end if;
 if op in ('discard','export_page','commit') then
  select * into job from private.data_jobs where school_id=tenant and id=(request->>'id')::uuid and actor_id=auth.uid() and expires_at>now() for update;
  if job.id is null then raise exception 'Data job expired or unavailable';end if;
  module=job.module;
 end if;
 if module not in ('students','staff','subjects','attendance','results','fees','library') or module is null then raise exception 'Unknown data module';end if;
 if op in ('preview','commit') then
  if not private.has_permission(tenant,'data.import') or not private.has_permission(tenant,case module when 'staff' then 'staff.manage' when 'subjects' then 'academics.manage' else 'students.manage' end) or module not in ('staff','subjects') then raise exception 'Not authorized';end if;
 else
  perm=case module when 'students' then 'students.view_all' when 'staff' then 'staff.view' when 'subjects' then 'academics.view' when 'attendance' then 'attendance.view' when 'results' then 'results.publish' when 'fees' then 'finance.reports' when 'library' then 'library.reports' end;
  if not private.has_permission(tenant,'data.export') or not private.has_permission(tenant,perm) then raise exception 'Not authorized';end if;
 end if;
 if op='discard' then delete from private.data_jobs where id=job.id;return '{}'::jsonb;end if;
 if op='export_page' then
  if job.kind<>'EXPORT' then raise exception 'Data job expired or unavailable';end if;
  if coalesce((request->>'page')::int,0) not between 0 and 40 then raise exception 'Invalid export page';end if;
  select coalesce(jsonb_agg(value order by ord),'[]') into rows from jsonb_array_elements(job.payload) with ordinality x(value,ord) where ord>coalesce((request->>'page')::int,0)*250 and ord<=(coalesce((request->>'page')::int,0)+1)*250;
  return jsonb_build_object('rows',rows,'count',jsonb_array_length(job.payload));
 end if;
 if op='commit' then
  if job.kind<>'IMPORT' then raise exception 'Data job expired or unavailable';end if;
  if job.result is not null then return job.result;end if;
  errors=private.directory_import_errors(tenant,module,job.payload);
  if jsonb_array_length(errors)>0 then raise exception 'Import changed; preview the file again';end if;
  for item in select value from jsonb_array_elements(job.payload) loop
   if module='staff' then insert into public.staff(school_id,employee_number,first_name,surname,position,department,email,is_teacher) values(tenant,trim(item->>'employee_number'),trim(item->>'first_name'),trim(item->>'surname'),trim(item->>'position'),nullif(trim(item->>'department'),''),nullif(trim(item->>'email'),''),true);
   else insert into public.subjects(school_id,code,name,description) values(tenant,trim(item->>'code'),trim(item->>'name'),nullif(trim(item->>'description'),''));end if;
  end loop;
  answer=jsonb_build_object('count',jsonb_array_length(job.payload));
  update private.data_jobs set result=answer,payload='[]' where id=job.id;
  insert into public.audit_logs(school_id,actor_id,action,entity,entity_id,metadata) values(tenant,auth.uid(),'IMPORT',module,job.id::text,answer);
  return answer;
 end if;
 if op not in ('preview','start_export') then raise exception 'Unknown data operation';end if;
 delete from private.data_jobs where school_id=tenant and expires_at<now();
 if (select count(*) from private.data_jobs where school_id=tenant and actor_id=auth.uid() and result is null)>=5 then raise exception 'Finish or discard an existing data job first';end if;
 if op='preview' then
  rows=request->'rows';errors=private.directory_import_errors(tenant,module,rows);
  if jsonb_array_length(errors)>0 then return jsonb_build_object('count',jsonb_array_length(rows),'errors',errors);end if;
 else
  if module='students' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select id,admission_number,first_name,surname,date_of_birth,admission_date,status,archived from public.students where school_id=tenant order by id limit 10001)x;
  elsif module='staff' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select employee_number,first_name,surname,position,department,email,is_teacher,employment_status,archived from public.staff where school_id=tenant order by id limit 10001)x;
  elsif module='subjects' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select code,name,description,archived from public.subjects where school_id=tenant order by id limit 10001)x;
  elsif module='attendance' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select s.attended_on,s.name as session,c.name as class_name,st.admission_number,st.first_name,st.surname,a.status,a.reason from public.attendance_entries a join public.attendance_sessions s on s.school_id=a.school_id and s.id=a.session_id join public.classes c on c.school_id=s.school_id and c.id=s.class_id join public.students st on st.school_id=a.school_id and st.id=a.student_id where a.school_id=tenant and s.status='FINAL' and private.can_read_attendance(tenant,s.id,a.student_id) order by s.attended_on,s.id,a.id limit 10001)x;
  elsif module='results' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select r.student_id,r.created_at,r.document from public.published_reports r join public.result_publications p on p.school_id=r.school_id and p.id=r.publication_id where r.school_id=tenant and p.active order by r.id limit 10001)x;
  elsif module='fees' then select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select posted_on,kind,amount_minor::text,student_id,number,method,reference,reason from public.finance_entries where school_id=tenant order by id limit 10001)x;
  else select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select issued_on,due_on,closed_on,document from public.library_loans where school_id=tenant order by id limit 10001)x;end if;
  if jsonb_array_length(rows)>10000 or octet_length(rows::text)>20000000 then raise exception 'Export too large; narrow the school data';end if;
 end if;
 insert into private.data_jobs(school_id,actor_id,kind,module,payload) values(tenant,auth.uid(),case when op='preview' then 'IMPORT' else 'EXPORT' end,module,rows) returning id into rid;
 if op='start_export' then insert into public.audit_logs(school_id,actor_id,action,entity,entity_id,metadata) values(tenant,auth.uid(),'EXPORT',module,rid::text,jsonb_build_object('count',jsonb_array_length(rows)));end if;
 return jsonb_build_object('id',rid,'count',jsonb_array_length(rows),'errors','[]'::jsonb);
end $$;
create function public.school_data(tenant uuid,request jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select private.school_data(tenant,request)$$;
revoke all on function private.school_data(uuid,jsonb),public.school_data(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.school_data(uuid,jsonb),public.school_data(uuid,jsonb) to authenticated;

-- Older learner-only job endpoints must not become an alternative route around
-- the per-module checks on the new snapshots.
do $$ declare definition text;begin
 select pg_get_functiondef('private.advanced_read(uuid,jsonb)'::regprocedure) into definition;
 if position('kind=''EXPORT'' and expires_at>now()' in definition)=0 then raise exception 'Review legacy export authorization before applying this migration';end if;
 definition=replace(definition,'kind=''EXPORT'' and expires_at>now()','kind=''EXPORT'' and module=''students'' and expires_at>now()');execute definition;
 select pg_get_functiondef('private.advanced_write(uuid,jsonb)'::regprocedure) into definition;
 if position('job.expires_at<now()' in definition)=0 then raise exception 'Review legacy import authorization before applying this migration';end if;
 definition=replace(definition,'job.expires_at<now()','job.expires_at<now() or job.module<>''students''');execute definition;
 -- Non-teaching staff may link their appropriate existing staff-role account.
 -- Teaching profiles still require the teacher role for academic access.
 select pg_get_functiondef('private.validate_phase2_record()'::regprocedure) into definition;
 if position('and role_id=expected_role and active' in definition)=0 then raise exception 'Review staff account validation before applying this migration';end if;
 definition=replace(definition,'and role_id=expected_role and active','and (role_id=expected_role or (tg_table_name=''staff'' and (j->>''is_teacher'')::boolean=false and role_id in (''SCHOOL_ADMIN'',''PRINCIPAL'',''ACCOUNTANT'',''LIBRARIAN''))) and active');execute definition;
end $$;
commit;
