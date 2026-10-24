begin;
insert into public.permissions values ('communication.view','Read authorized announcements, messages and notifications'),('communication.post','Publish assigned-class announcements'),('communication.manage','Manage school communication and settings');
insert into public.role_permissions select r.id,'communication.view' from public.roles r;
insert into public.role_permissions values ('SUPER_ADMIN','communication.post'),('SUPER_ADMIN','communication.manage'),('SCHOOL_ADMIN','communication.post'),('SCHOOL_ADMIN','communication.manage'),('PRINCIPAL','communication.post'),('PRINCIPAL','communication.manage'),('TEACHER','communication.post');
create table private.phase6_requests(school_id uuid not null references public.schools(id),request_key uuid not null,module text not null,actor_id uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(school_id,request_key));
alter table private.phase6_requests enable row level security;
revoke all on private.phase6_requests from public,anon,authenticated;
create table public.communication_settings(id uuid primary key default gen_random_uuid(),school_id uuid not null unique references public.schools(id),family_messages_enabled boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.announcements(
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),author_id uuid not null references public.profiles(id),author_name text not null,
 title text not null check(length(trim(title)) between 1 and 160),body text not null check(length(trim(body)) between 1 and 10000),scope text not null check(scope in ('SCHOOL','CLASS','TEACHERS','PARENTS','STUDENTS')),class_id uuid,
 status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','WITHDRAWN')),published_at timestamptz,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id),foreign key(school_id,class_id) references public.classes(school_id,id),check((scope='CLASS')=(class_id is not null))
);
create index announcements_school_feed on public.announcements(school_id,status,published_at desc,id);
create index announcements_author on public.announcements(school_id,author_id,created_at desc);
create table public.message_threads(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),member_a uuid not null references public.profiles(id),member_b uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(school_id,id),unique(school_id,member_a,member_b),check(member_a<member_b));
create index message_thread_a on public.message_threads(school_id,member_a);
create index message_thread_b on public.message_threads(school_id,member_b);
create table public.messages(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),thread_id uuid not null,sender_id uuid not null references public.profiles(id),sender_name text not null,body text not null check(length(trim(body)) between 1 and 5000),created_at timestamptz not null default clock_timestamp(),unique(school_id,id),foreign key(school_id,thread_id) references public.message_threads(school_id,id));
create index messages_thread_time on public.messages(school_id,thread_id,created_at desc,id);
create table public.communication_notifications(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),user_id uuid not null references public.profiles(id),kind text not null check(kind in ('ANNOUNCEMENT','MESSAGE')),source_id uuid not null,read_at timestamptz,created_at timestamptz not null default now(),unique(school_id,user_id,kind,source_id));
create index notification_inbox on public.communication_notifications(school_id,user_id,created_at desc,id);
create index notification_unread on public.communication_notifications(school_id,user_id) where read_at is null;
create table public.announcement_files(id uuid primary key,school_id uuid not null references public.schools(id),announcement_id uuid not null,filename text not null check(length(filename) between 1 and 120 and filename !~ '[/\\]'),mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg','text/plain')),byte_size integer not null check(byte_size between 1 and 5242880),uploaded_by uuid not null references public.profiles(id),ready boolean not null default false,removed boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id),foreign key(school_id,announcement_id) references public.announcements(school_id,id));
create index announcement_files_parent on public.announcement_files(school_id,announcement_id) where not removed;

create function private.comm_audience(tenant uuid,audience text,klass uuid,viewer uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id where p.id=viewer and p.active and u.school_id=tenant and u.active and (
 u.role_id in ('SCHOOL_ADMIN','PRINCIPAL') or audience='SCHOOL' or (audience='TEACHERS' and u.role_id='TEACHER') or (audience='PARENTS' and u.role_id='PARENT') or (audience='STUDENTS' and u.role_id='STUDENT') or (audience='CLASS' and (
 (u.role_id='TEACHER' and exists(select 1 from public.staff s join public.teacher_assignments t on t.school_id=s.school_id and t.staff_id=s.id join public.class_subjects cs on cs.school_id=t.school_id and cs.id=t.class_subject_id where s.school_id=tenant and s.user_id=viewer and s.is_teacher and s.employment_status='ACTIVE' and not s.archived and not t.archived and not cs.archived and cs.class_id=klass)) or
 (u.role_id in ('PARENT','STUDENT') and exists(select 1 from public.enrollments e join public.students s on s.school_id=e.school_id and s.id=e.student_id join public.schools school on school.id=e.school_id where e.school_id=tenant and e.class_id=klass and not s.archived and e.starts_on<=(now() at time zone school.timezone)::date and coalesce(e.ends_on,'infinity'::date)>=(now() at time zone school.timezone)::date and ((u.role_id='STUDENT' and s.user_id=viewer) or (u.role_id='PARENT' and exists(select 1 from public.student_parents sp join public.parents p on p.school_id=sp.school_id and p.id=sp.parent_id where sp.school_id=tenant and sp.student_id=s.id and not sp.archived and not p.archived and p.user_id=viewer)))))))))
$$;
create function private.comm_edit(tenant uuid,announcement_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.announcements a where a.school_id=tenant and a.id=announcement_key and (private.has_permission(tenant,'communication.manage') or (a.author_id=auth.uid() and private.has_permission(tenant,'communication.post') and a.scope='CLASS' and private.teaches_class(tenant,a.class_id))))
$$;
create function private.comm_announcement_read(tenant uuid,announcement_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.has_permission(tenant,'communication.view') and exists(select 1 from public.announcements a where a.school_id=tenant and a.id=announcement_key and ((a.status='PUBLISHED' and private.comm_audience(tenant,a.scope,a.class_id,auth.uid())) or private.comm_edit(tenant,a.id)))
$$;
create function private.comm_thread_read(tenant uuid,thread_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.has_permission(tenant,'communication.view') and exists(select 1 from public.message_threads where school_id=tenant and id=thread_key and auth.uid() in (member_a,member_b))
$$;
create function private.comm_teacher_family(tenant uuid,teacher uuid,family uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.staff st join public.teacher_assignments ta on ta.school_id=st.school_id and ta.staff_id=st.id join public.class_subjects cs on cs.school_id=ta.school_id and cs.id=ta.class_subject_id join public.enrollments e on e.school_id=cs.school_id and e.class_id=cs.class_id join public.students s on s.school_id=e.school_id and s.id=e.student_id join public.schools school on school.id=e.school_id where st.school_id=tenant and st.user_id=teacher and st.is_teacher and st.employment_status='ACTIVE' and not st.archived and not ta.archived and not cs.archived and not s.archived and e.starts_on<=(now() at time zone school.timezone)::date and coalesce(e.ends_on,'infinity'::date)>=(now() at time zone school.timezone)::date and (
 (s.user_id=family and exists(select 1 from public.user_roles u where u.school_id=tenant and u.user_id=family and u.active and u.role_id='STUDENT')) or exists(select 1 from public.student_parents sp join public.parents p on p.school_id=sp.school_id and p.id=sp.parent_id join public.user_roles u on u.school_id=p.school_id and u.user_id=p.user_id and u.active and u.role_id='PARENT' where sp.school_id=tenant and sp.student_id=s.id and not sp.archived and not p.archived and p.user_id=family)))
$$;
create function private.comm_pair(tenant uuid,other_user uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare mine_staff boolean;theirs_staff boolean;theirs_admin boolean;mine_admin boolean;
begin
 if auth.uid() is null or other_user=auth.uid() or not private.has_permission(tenant,'communication.view') or not exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id where p.id=other_user and p.active and u.school_id=tenant and u.active) then return false;end if;
 select coalesce(bool_or(role_id not in ('PARENT','STUDENT')),false),coalesce(bool_or(role_id in ('SCHOOL_ADMIN','PRINCIPAL')),false) into mine_staff,mine_admin from public.user_roles where school_id=tenant and user_id=auth.uid() and active;
 select coalesce(bool_or(role_id not in ('PARENT','STUDENT')),false),coalesce(bool_or(role_id in ('SCHOOL_ADMIN','PRINCIPAL')),false) into theirs_staff,theirs_admin from public.user_roles where school_id=tenant and user_id=other_user and active;
 if private.is_platform_admin() then mine_staff=true;mine_admin=true;end if;
 if mine_staff and theirs_staff then return true;end if;
 if not exists(select 1 from public.communication_settings where school_id=tenant and family_messages_enabled) then return false;end if;
 return mine_admin or theirs_admin or (mine_staff and private.comm_teacher_family(tenant,auth.uid(),other_user)) or (theirs_staff and private.comm_teacher_family(tenant,other_user,auth.uid()));
end $$;
create function private.comm_notification_read(tenant uuid,notice_kind text,source uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and case when notice_kind='ANNOUNCEMENT' then exists(select 1 from public.announcements a where a.school_id=tenant and a.id=source and a.status='PUBLISHED' and private.comm_audience(tenant,a.scope,a.class_id,auth.uid())) when notice_kind='MESSAGE' then exists(select 1 from public.messages m where m.school_id=tenant and m.id=source and private.comm_thread_read(tenant,m.thread_id)) else false end
$$;
do $$declare t text;begin foreach t in array array['communication_settings','announcements','message_threads','messages','communication_notifications','announcement_files'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
 if t not in ('communication_notifications') then execute format('create trigger audit_phase6 after insert or update on public.%I for each row execute function private.audit_change()',t);end if;
 if t in ('communication_settings','announcements','announcement_files') then execute format('create trigger phase6_version before update on public.%I for each row execute function private.guard_school_record()',t);end if;
 end loop;end $$;
create policy comm_settings_read on public.communication_settings for select to authenticated using(private.has_permission(school_id,'communication.view'));
create policy announcement_read on public.announcements for select to authenticated using(private.comm_announcement_read(school_id,id));
create policy thread_read on public.message_threads for select to authenticated using(private.comm_thread_read(school_id,id));
create policy message_read on public.messages for select to authenticated using(private.comm_thread_read(school_id,thread_id));
create policy notification_read on public.communication_notifications for select to authenticated using(user_id=(select auth.uid()) and private.has_permission(school_id,'communication.view') and private.comm_notification_read(school_id,kind,source_id));
create policy file_read on public.announcement_files for select to authenticated using(not removed and private.comm_announcement_read(school_id,announcement_id) and (ready or private.comm_edit(school_id,announcement_id)));

create function private.communication_write(tenant uuid,request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text=request->>'op';target uuid=nullif(request->>'id','')::uuid;key uuid=(request->>'request_key')::uuid;ver integer=coalesce((request->>'version')::integer,0);a public.announcements;f public.announcement_files;old private.phase6_requests;result jsonb;rid uuid;thread_key uuid;other_user uuid;title text;author text;scope_value text;klass uuid;state text;
begin
 if auth.uid() is null or not private.has_permission(tenant,'communication.view') then raise exception 'Not authorized';end if;
 if key is null then raise exception 'A request key is required';end if;
 perform 1 from public.schools where id=tenant for update;
 -- Membership administration uses the same lock; recheck after any wait for it.
 if not private.has_permission(tenant,'communication.view') then raise exception 'Not authorized';end if;
 select * into old from private.phase6_requests where school_id=tenant and request_key=key;
 if found then if old.module<>'communication' or old.actor_id<>auth.uid() or old.payload<>request then raise exception 'Request key already used for different details';end if;return old.result;end if;
 select display_name into author from public.profiles where id=auth.uid();author=coalesce(nullif(trim(author),''),'School member');
 if op='settings' then
 if not private.has_permission(tenant,'communication.manage') then raise exception 'Not authorized';end if;
 if exists(select 1 from public.communication_settings where school_id=tenant and version<>ver) then raise exception 'Record changed; reload before saving';end if;
 insert into public.communication_settings(school_id,family_messages_enabled) values(tenant,(request->>'family_messages_enabled')::boolean) on conflict(school_id) do update set family_messages_enabled=excluded.family_messages_enabled,version=communication_settings.version+1 returning id into rid;
 elsif op='draft' then
 scope_value=request->>'scope';klass=nullif(request->>'class_id','')::uuid;
 if not private.has_permission(tenant,'communication.post') or (not private.has_permission(tenant,'communication.manage') and (scope_value<>'CLASS' or klass is null or not private.teaches_class(tenant,klass))) then raise exception 'Only assigned classes may be announced';end if;
 if scope_value='CLASS' and not exists(select 1 from public.classes where school_id=tenant and id=klass and not archived) then raise exception 'Select an active class';end if;
 if target is null then insert into public.announcements(school_id,author_id,author_name,title,body,scope,class_id) values(tenant,auth.uid(),author,trim(request->>'title'),trim(request->>'body'),scope_value,klass) returning id into rid;
 else select * into a from public.announcements where school_id=tenant and id=target for update;
 if a.id is null or not private.comm_edit(tenant,target) then raise exception 'Not authorized';end if;
 if a.version<>ver or a.status<>'DRAFT' then raise exception 'Only the current draft may be edited';end if;
 update public.announcements set title=trim(request->>'title'),body=trim(request->>'body'),scope=scope_value,class_id=klass,version=version+1 where id=target returning id into rid;end if;
 elsif op in ('publish','withdraw','reserve_file','finish_file','remove_file') then
 select * into a from public.announcements where school_id=tenant and id=target for update;
 if a.id is null or not private.comm_edit(tenant,target) then raise exception 'Not authorized';end if;
 if a.version<>ver then raise exception 'Record changed; reload before saving';end if;
 if op='publish' then
 if a.status<>'DRAFT' then raise exception 'Only drafts may be published';end if;
 if exists(select 1 from public.announcement_files where school_id=tenant and announcement_id=target and not removed and (not ready or not exists(select 1 from storage.objects o where o.bucket_id='mfaroedu-communications' and o.name=tenant::text||'/'||announcement_files.id::text||'/file'))) then raise exception 'Finish or remove pending attachments before publishing';end if;
 update public.announcements set status='PUBLISHED',published_at=clock_timestamp(),version=version+1 where id=target;
 insert into public.communication_notifications(school_id,user_id,kind,source_id) select distinct tenant,u.user_id,'ANNOUNCEMENT',target from public.user_roles u where u.school_id=tenant and u.active and private.comm_audience(tenant,a.scope,a.class_id,u.user_id) on conflict do nothing;
 elsif op='withdraw' then
 if a.status='WITHDRAWN' then raise exception 'Announcement is already withdrawn';end if;
 update public.announcements set status='WITHDRAWN',version=version+1 where id=target;
 else
 if a.status<>'DRAFT' then raise exception 'Attachments can only change on a draft';end if;
 if op='reserve_file' then
 if (select count(*) from public.announcement_files where school_id=tenant and announcement_id=target and not removed)>=5 then raise exception 'Use at most five attachments';end if;
 insert into public.announcement_files(id,school_id,announcement_id,filename,mime_type,byte_size,uploaded_by) values(key,tenant,target,request->>'filename',request->>'mime_type',(request->>'byte_size')::integer,auth.uid()) returning id into rid;
 else
 select * into f from public.announcement_files where school_id=tenant and announcement_id=target and id=(request->>'file_id')::uuid and not removed for update;
 if f.id is null then raise exception 'Attachment unavailable';end if;
 if op='finish_file' then
 if not exists(select 1 from storage.objects o where o.bucket_id='mfaroedu-communications' and o.name=tenant::text||'/'||f.id::text||'/file' and (o.metadata->>'size')::bigint=f.byte_size and o.metadata->>'mimetype'=f.mime_type) then raise exception 'Attachment upload is incomplete';end if;
 update public.announcement_files set ready=true,version=version+1 where id=f.id;
 else
 if exists(select 1 from storage.objects o where o.bucket_id='mfaroedu-communications' and o.name=tenant::text||'/'||f.id::text||'/file') then raise exception 'Remove the stored file first';end if;
 update public.announcement_files set removed=true,version=version+1 where id=f.id;end if;rid=f.id;
 end if;
 update public.announcements set version=version+1 where id=target;
 end if;rid=coalesce(rid,target);
 elsif op='message' then
 other_user=(request->>'recipient_id')::uuid;
 if not private.comm_pair(tenant,other_user) then raise exception 'Messaging is not enabled for this recipient';end if;
 insert into public.message_threads(school_id,member_a,member_b) values(tenant,least(auth.uid(),other_user),greatest(auth.uid(),other_user)) on conflict(school_id,member_a,member_b) do update set school_id=excluded.school_id returning id into thread_key;
 insert into public.messages(school_id,thread_id,sender_id,sender_name,body) values(tenant,thread_key,auth.uid(),author,trim(request->>'body')) returning id into rid;
 insert into public.communication_notifications(school_id,user_id,kind,source_id) values(tenant,other_user,'MESSAGE',rid);
 result=jsonb_build_object('id',thread_key,'message_id',rid);
 elsif op='read_notification' then
 update public.communication_notifications set read_at=coalesce(read_at,clock_timestamp()) where school_id=tenant and id=target and user_id=auth.uid() and private.comm_notification_read(tenant,kind,source_id) returning id into rid;
 if rid is null then raise exception 'Notification unavailable';end if;
 else raise exception 'Unknown communication operation';end if;
 result=coalesce(result,jsonb_build_object('id',rid));
 insert into private.phase6_requests(school_id,request_key,module,actor_id,payload,result) values(tenant,key,'communication',auth.uid(),request,result);return result;
end $$;

create function private.communication_read(tenant uuid,request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare op text=request->>'op';target uuid=nullif(request->>'id','')::uuid;page integer=greatest(coalesce((request->>'page')::integer,0),0);q text='%'||replace(replace(replace(left(coalesce(request->>'search',''),100),'\','\\'),'%','\%'),'_','\_')||'%';rows jsonb;total bigint;unread bigint;result jsonb;folder text=coalesce(request->>'folder','feed');
begin
 if auth.uid() is null or not private.has_permission(tenant,'communication.view') then raise exception 'Not authorized';end if;
 if op='settings' then return jsonb_build_object('settings',(select to_jsonb(s) from public.communication_settings s where school_id=tenant),'classes',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name||' · '||y.name) order by y.starts_on desc,c.name),'[]') from public.classes c join public.academic_years y on y.school_id=c.school_id and y.id=c.academic_year_id where c.school_id=tenant and not c.archived and not y.archived and (private.has_permission(tenant,'communication.manage') or private.teaches_class(tenant,c.id))));
 elsif op='announcements' then
 select count(*) into total from public.announcements a where a.school_id=tenant and private.comm_announcement_read(tenant,a.id) and (case when folder='manage' then private.comm_edit(tenant,a.id) else a.status='PUBLISHED' end) and (a.title||' '||a.body) ilike q;
 select coalesce(jsonb_agg(x),'[]') into rows from (select a.*,c.name class_name,(select count(*) from public.announcement_files f where f.school_id=tenant and f.announcement_id=a.id and not f.removed and f.ready) file_count from public.announcements a left join public.classes c on c.school_id=a.school_id and c.id=a.class_id where a.school_id=tenant and private.comm_announcement_read(tenant,a.id) and (case when folder='manage' then private.comm_edit(tenant,a.id) else a.status='PUBLISHED' end) and (a.title||' '||a.body) ilike q order by coalesce(a.published_at,a.created_at) desc,a.id limit 20 offset page*20) x;return jsonb_build_object('rows',rows,'count',total);
 elsif op='announcement' then
 if not private.comm_announcement_read(tenant,target) then raise exception 'Announcement unavailable';end if;
 select to_jsonb(a)||jsonb_build_object('can_edit',private.comm_edit(tenant,a.id),'files',(select coalesce(jsonb_agg(f order by f.created_at,f.id),'[]') from public.announcement_files f where f.school_id=tenant and f.announcement_id=a.id and not f.removed and (f.ready or private.comm_edit(tenant,a.id)))) into result from public.announcements a where a.school_id=tenant and a.id=target;return result;
 elsif op='recipients' then
 select count(*) into total from public.profiles p where p.active and p.display_name ilike q and private.comm_pair(tenant,p.id);
 select coalesce(jsonb_agg(x),'[]') into rows from (select p.id,coalesce(nullif(p.display_name,''),'School member') name,(select string_agg(u.role_id,', ' order by u.role_id) from public.user_roles u where u.school_id=tenant and u.user_id=p.id and u.active) roles from public.profiles p where p.active and p.display_name ilike q and private.comm_pair(tenant,p.id) order by p.display_name,p.id limit 20 offset page*20) x;return jsonb_build_object('rows',rows,'count',total);
 elsif op='threads' then
 select count(*) into total from public.message_threads t where t.school_id=tenant and auth.uid() in(t.member_a,t.member_b);
 select coalesce(jsonb_agg(x),'[]') into rows from (select t.id,case when t.member_a=auth.uid() then t.member_b else t.member_a end recipient_id,coalesce(nullif(p.display_name,''),'School member') recipient_name,m.body preview,m.created_at last_message_at from public.message_threads t join public.profiles p on p.id=case when t.member_a=auth.uid() then t.member_b else t.member_a end join lateral(select body,created_at from public.messages where school_id=tenant and thread_id=t.id order by created_at desc,id desc limit 1)m on true where t.school_id=tenant and auth.uid() in(t.member_a,t.member_b) order by m.created_at desc,t.id limit 20 offset page*20)x;return jsonb_build_object('rows',rows,'count',total);
 elsif op='thread' then
 if not private.comm_thread_read(tenant,target) then raise exception 'Conversation unavailable';end if;
 select count(*) into total from public.messages where school_id=tenant and thread_id=target;
 select coalesce(jsonb_agg(x order by x.created_at,x.id),'[]') into rows from(select * from public.messages where school_id=tenant and thread_id=target order by created_at desc,id desc limit 20 offset page*20)x;
 select jsonb_build_object('rows',rows,'count',total,'recipient_id',p.id,'recipient_name',coalesce(nullif(p.display_name,''),'School member'),'can_reply',private.comm_pair(tenant,p.id)) into result from public.message_threads t join public.profiles p on p.id=case when t.member_a=auth.uid() then t.member_b else t.member_a end where t.school_id=tenant and t.id=target;return result;
 elsif op='notifications' then
 select count(*) filter(where n.read_at is null),count(*) filter(where not coalesce((request->>'unread_only')::boolean,false) or n.read_at is null) into unread,total from public.communication_notifications n where n.school_id=tenant and n.user_id=auth.uid() and private.comm_notification_read(tenant,n.kind,n.source_id);
 select coalesce(jsonb_agg(x),'[]') into rows from(select n.id,n.kind,n.read_at,n.created_at,case when n.kind='ANNOUNCEMENT' then a.id else m.thread_id end target_id,case when n.kind='ANNOUNCEMENT' then a.title else 'Message from '||m.sender_name end title from public.communication_notifications n left join public.announcements a on a.school_id=n.school_id and a.id=n.source_id and n.kind='ANNOUNCEMENT' left join public.messages m on m.school_id=n.school_id and m.id=n.source_id and n.kind='MESSAGE' where n.school_id=tenant and n.user_id=auth.uid() and private.comm_notification_read(tenant,n.kind,n.source_id) and (not coalesce((request->>'unread_only')::boolean,false) or n.read_at is null) order by n.created_at desc,n.id limit 20 offset page*20)x;return jsonb_build_object('rows',rows,'count',total,'unread',unread);
 end if;raise exception 'Unknown communication operation';
end $$;
create function public.communication_read(tenant uuid,request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select private.communication_read(tenant,request)$$;
create function public.communication_write(tenant uuid,request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.communication_write(tenant,request)$$;
revoke all on function private.comm_audience(uuid,text,uuid,uuid),private.comm_teacher_family(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.comm_edit(uuid,uuid),private.comm_announcement_read(uuid,uuid),private.comm_thread_read(uuid,uuid),private.comm_pair(uuid,uuid),private.comm_notification_read(uuid,text,uuid),private.communication_read(uuid,jsonb),private.communication_write(uuid,jsonb),public.communication_read(uuid,jsonb),public.communication_write(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.comm_edit(uuid,uuid),private.comm_announcement_read(uuid,uuid),private.comm_thread_read(uuid,uuid),private.comm_pair(uuid,uuid),private.comm_notification_read(uuid,text,uuid),private.communication_read(uuid,jsonb),private.communication_write(uuid,jsonb),public.communication_read(uuid,jsonb),public.communication_write(uuid,jsonb) to authenticated;
commit;
