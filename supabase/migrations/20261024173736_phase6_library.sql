begin;
insert into public.permissions values ('library.view','Read the catalogue and authorized borrowing history'),('library.view_all','Read all library borrowing records'),('library.manage','Manage books, copies and circulation'),('library.reports','Read library reports');
insert into public.role_permissions select r.id,'library.view' from public.roles r;
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN','LIBRARIAN') and p.id in ('library.view_all','library.manage','library.reports');
insert into public.role_permissions values ('PRINCIPAL','library.view_all'),('PRINCIPAL','library.reports');
create table public.library_settings(id uuid primary key default gen_random_uuid(),school_id uuid not null unique references public.schools(id),loan_days integer not null default 14 check(loan_days between 1 and 365),max_books integer not null default 3 check(max_books between 1 and 50),max_renewals integer not null default 2 check(max_renewals between 0 and 20),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.library_books(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),title text not null check(length(trim(title)) between 1 and 200),author text not null check(length(trim(author)) between 1 and 160),isbn text check(length(isbn)<=32),category text check(length(category)<=100),publisher text check(length(publisher)<=160),archived boolean not null default false,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id));
create index library_books_school on public.library_books(school_id,archived,title,id);
create table public.library_copies(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),book_id uuid not null,accession_number text not null check(length(trim(accession_number)) between 1 and 40),location text check(length(location)<=120),condition text not null default 'GOOD' check(condition in ('GOOD','FAIR','DAMAGED')),status text not null default 'READY' check(status in ('READY','DAMAGED','LOST','RETIRED')),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id),foreign key(school_id,book_id) references public.library_books(school_id,id),check(status<>'READY' or condition<>'DAMAGED'));
create unique index library_copy_accession on public.library_copies(school_id,lower(accession_number));
create index library_copy_book on public.library_copies(school_id,book_id,status);
create table public.library_loans(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),copy_id uuid not null,student_id uuid not null,issued_on date not null,due_on date not null check(due_on>=issued_on),closed_on date check(closed_on>=issued_on),close_kind text check(close_kind in ('RETURNED','LOST')),renewals integer not null default 0 check(renewals>=0),activity_on date not null,document jsonb not null,created_by uuid not null references public.profiles(id),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id),foreign key(school_id,copy_id) references public.library_copies(school_id,id),foreign key(school_id,student_id) references public.students(school_id,id),check((closed_on is null)=(close_kind is null)),check(activity_on>=issued_on));
create unique index library_one_open_copy on public.library_loans(school_id,copy_id) where closed_on is null;
create index library_learner_history on public.library_loans(school_id,student_id,issued_on desc,id);
create index library_open_due on public.library_loans(school_id,due_on,id) where closed_on is null;
create index library_copy_history on public.library_loans(school_id,copy_id,issued_on);
create table public.library_events(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),loan_id uuid not null,kind text not null check(kind in ('ISSUED','RENEWED','RETURNED','LOST')),happened_on date not null,details jsonb not null default '{}',actor_id uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),foreign key(school_id,loan_id) references public.library_loans(school_id,id));
create index library_event_loan on public.library_events(school_id,loan_id,created_at,id);
create function private.library_learner_read(tenant uuid,learner uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and private.has_permission(tenant,'library.view') and (private.has_permission(tenant,'library.view_all') or private.owns_learner(tenant,learner))$$;
create function private.library_loan_read(tenant uuid,loan_key uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.library_loans where school_id=tenant and id=loan_key and private.library_learner_read(tenant,student_id))$$;
do $$declare t text;begin foreach t in array array['library_settings','library_books','library_copies','library_loans','library_events'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('create trigger audit_library after insert or update on public.%I for each row execute function private.audit_change()',t);
 if t<>'library_events' then execute format('create trigger library_version before update on public.%I for each row execute function private.guard_school_record()',t);end if;
 end loop;end $$;
create policy library_settings_read on public.library_settings for select to authenticated using(private.has_permission(school_id,'library.view'));
create policy library_books_read on public.library_books for select to authenticated using(private.has_permission(school_id,'library.view') and (not archived or private.has_permission(school_id,'library.view_all')));
create policy library_copies_read on public.library_copies for select to authenticated using(private.has_permission(school_id,'library.view') and (private.has_permission(school_id,'library.view_all') or (status<>'RETIRED' and exists(select 1 from public.library_books b where b.school_id=library_copies.school_id and b.id=book_id and not b.archived))));
create policy library_loans_read on public.library_loans for select to authenticated using(private.library_learner_read(school_id,student_id));
create policy library_events_read on public.library_events for select to authenticated using(private.library_loan_read(school_id,loan_id));

create function private.library_write(tenant uuid,request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text=request->>'op';target uuid=nullif(request->>'id','')::uuid;key uuid=(request->>'request_key')::uuid;ver integer=coalesce((request->>'version')::integer,0);old private.phase6_requests;settings public.library_settings;book public.library_books;copy public.library_copies;loan public.library_loans;learner public.students;rid uuid;result jsonb;today date;day date;due date;event_kind text;
begin
 if auth.uid() is null or not private.has_permission(tenant,'library.manage') then raise exception 'Not authorized';end if;
 if key is null then raise exception 'A request key is required';end if;
 select (now() at time zone timezone)::date into today from public.schools where id=tenant for update;
 -- A librarian may have been revoked while this request waited for the school lock.
 if not private.has_permission(tenant,'library.manage') then raise exception 'Not authorized';end if;
 select * into old from private.phase6_requests where school_id=tenant and request_key=key;
 if found then if old.module<>'library' or old.actor_id<>auth.uid() or old.payload<>request then raise exception 'Request key already used for different details';end if;return old.result;end if;
 select * into settings from public.library_settings where school_id=tenant;
 if settings.id is null then settings.loan_days=14;settings.max_books=3;settings.max_renewals=2;end if;
 if op='settings' then
 if settings.id is not null and settings.version<>ver then raise exception 'Record changed; reload before saving';end if;
 insert into public.library_settings(school_id,loan_days,max_books,max_renewals) values(tenant,(request->>'loan_days')::integer,(request->>'max_books')::integer,(request->>'max_renewals')::integer) on conflict(school_id) do update set loan_days=excluded.loan_days,max_books=excluded.max_books,max_renewals=excluded.max_renewals,version=library_settings.version+1 returning id into rid;
 elsif op='book' then
 if target is null then insert into public.library_books(school_id,title,author,isbn,category,publisher) values(tenant,trim(request->>'title'),trim(request->>'author'),nullif(trim(request->>'isbn'),''),nullif(trim(request->>'category'),''),nullif(trim(request->>'publisher'),'')) returning id into rid;
 else
 select * into book from public.library_books where school_id=tenant and id=target for update;
 if book.id is null or book.version<>ver then raise exception 'Record changed; reload before saving';end if;
 if coalesce((request->>'archived')::boolean,false) and exists(select 1 from public.library_loans l join public.library_copies c on c.school_id=l.school_id and c.id=l.copy_id where l.school_id=tenant and c.book_id=target and l.closed_on is null) then raise exception 'Close open loans before archiving this book';end if;
 update public.library_books set title=trim(request->>'title'),author=trim(request->>'author'),isbn=nullif(trim(request->>'isbn'),''),category=nullif(trim(request->>'category'),''),publisher=nullif(trim(request->>'publisher'),''),archived=coalesce((request->>'archived')::boolean,false),version=version+1 where id=target returning id into rid;end if;
 elsif op='copy' then
 select * into book from public.library_books where school_id=tenant and id=(request->>'book_id')::uuid and not archived;
 if book.id is null then raise exception 'Select an active book';end if;
 if target is null then insert into public.library_copies(school_id,book_id,accession_number,location,condition,status) values(tenant,book.id,trim(request->>'accession_number'),nullif(trim(request->>'location'),''),request->>'condition',request->>'status') returning id into rid;
 else
 select * into copy from public.library_copies where school_id=tenant and id=target for update;
 if copy.id is null or copy.version<>ver then raise exception 'Record changed; reload before saving';end if;
 if copy.book_id<>book.id then raise exception 'A copy cannot move to another book';end if;
 if exists(select 1 from public.library_loans where school_id=tenant and copy_id=target and closed_on is null) then raise exception 'Return the borrowed copy before changing it';end if;
 update public.library_copies set accession_number=trim(request->>'accession_number'),location=nullif(trim(request->>'location'),''),condition=request->>'condition',status=request->>'status',version=version+1 where id=target returning id into rid;end if;
 elsif op='issue' then
 select * into copy from public.library_copies where school_id=tenant and id=(request->>'copy_id')::uuid for update;
 select * into book from public.library_books where school_id=tenant and id=copy.book_id and not archived;
 select * into learner from public.students where school_id=tenant and id=(request->>'student_id')::uuid and not archived for share;
 if copy.id is null or book.id is null or copy.status<>'READY' or learner.id is null then raise exception 'Select an available copy and active learner';end if;
 if copy.version<>ver then raise exception 'Record changed; reload before saving';end if;
 if exists(select 1 from public.library_loans where school_id=tenant and copy_id=copy.id and closed_on is null) then raise exception 'This copy is already on loan';end if;
 if (select count(*) from public.library_loans where school_id=tenant and student_id=learner.id and closed_on is null)>=settings.max_books then raise exception 'Learner borrowing limit reached';end if;
 day=(request->>'issued_on')::date;due=(request->>'due_on')::date;
 if day is null or due is null or day<learner.admission_date or day>today or due<day or due>day+365 then raise exception 'Invalid issue or due date';end if;
 if exists(select 1 from public.library_loans where school_id=tenant and copy_id=copy.id and closed_on>day) then raise exception 'Issue date overlaps the copy borrowing history';end if;
 insert into public.library_loans(school_id,copy_id,student_id,issued_on,due_on,activity_on,created_by,document) values(tenant,copy.id,learner.id,day,due,day,auth.uid(),jsonb_build_object('title',book.title,'author',book.author,'accession_number',copy.accession_number,'learner',learner.first_name||' '||learner.surname,'admission_number',learner.admission_number)) returning id into rid;
 update public.library_copies set version=version+1 where id=copy.id;
 insert into public.library_events(school_id,loan_id,kind,happened_on,details,actor_id) values(tenant,rid,'ISSUED',day,jsonb_build_object('due_on',due),auth.uid());
 elsif op in ('renew','return','lost') then
 select * into loan from public.library_loans where school_id=tenant and id=target for update;
 if loan.id is null or loan.version<>ver then raise exception 'Record changed; reload before saving';end if;
 if loan.closed_on is not null then raise exception 'This loan is already closed';end if;
 select * into copy from public.library_copies where school_id=tenant and id=loan.copy_id for update;
 day=case when op='renew' then today else (request->>'closed_on')::date end;
 if day is null or day<loan.activity_on or day>today then raise exception 'Closing date cannot precede the latest loan activity or exceed today';end if;
 if op='renew' then
 due=(request->>'due_on')::date;
 if loan.renewals>=settings.max_renewals then raise exception 'Renewal limit reached';end if;
 if due is null or due<=loan.due_on or due<today or due>today+365 then raise exception 'Renewal must extend the due date by at most one year';end if;
 update public.library_loans set due_on=due,renewals=renewals+1,activity_on=today,version=version+1 where id=target;event_kind='RENEWED';
 else
 if length(trim(coalesce(request->>'note',''))) not between 1 and 500 then raise exception 'Record a return or loss note';end if;
 update public.library_loans set closed_on=day,close_kind=case when op='lost' then 'LOST' else 'RETURNED' end,activity_on=day,version=version+1 where id=target;
 update public.library_copies set status=case when op='lost' then 'LOST' when request->>'condition'='DAMAGED' then 'DAMAGED' else 'READY' end,condition=case when op='lost' then condition else request->>'condition' end,version=version+1 where id=copy.id;
 event_kind=case when op='lost' then 'LOST' else 'RETURNED' end;end if;
 insert into public.library_events(school_id,loan_id,kind,happened_on,details,actor_id) values(tenant,target,event_kind,day,jsonb_build_object('due_on',due,'condition',request->>'condition','note',request->>'note'),auth.uid());rid=target;
 else raise exception 'Unknown library operation';end if;
 result=jsonb_build_object('id',rid);insert into private.phase6_requests(school_id,request_key,module,actor_id,payload,result) values(tenant,key,'library',auth.uid(),request,result);return result;
end $$;

create function private.library_read(tenant uuid,request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare op text=request->>'op';target uuid=nullif(request->>'id','')::uuid;learner uuid=nullif(request->>'student_id','')::uuid;page integer=greatest(coalesce((request->>'page')::integer,0),0);q text='%'||replace(replace(replace(left(coalesce(request->>'search',''),100),'\','\\'),'%','\%'),'_','\_')||'%';rows jsonb;total bigint;result jsonb;today date;filter text=coalesce(request->>'filter','ALL');
begin
 if auth.uid() is null or not private.has_permission(tenant,'library.view') then raise exception 'Not authorized';end if;
 select (now() at time zone timezone)::date into today from public.schools where id=tenant;
 if op='settings' then return coalesce((select to_jsonb(s) from public.library_settings s where school_id=tenant),jsonb_build_object('version',0,'loan_days',14,'max_books',3,'max_renewals',2));
 elsif op='books' then
 select count(*) into total from public.library_books b where b.school_id=tenant and (not b.archived or (private.has_permission(tenant,'library.view_all') and coalesce((request->>'include_archived')::boolean,false))) and (b.title||' '||b.author||' '||coalesce(b.isbn,'')||' '||coalesce(b.category,'')) ilike q;
 select coalesce(jsonb_agg(x),'[]') into rows from (select b.*,(select count(*) from public.library_copies c where c.school_id=tenant and c.book_id=b.id and c.status<>'RETIRED') copies,(select count(*) from public.library_copies c where c.school_id=tenant and c.book_id=b.id and c.status='READY' and not b.archived and not exists(select 1 from public.library_loans l where l.school_id=tenant and l.copy_id=c.id and l.closed_on is null)) available from public.library_books b where b.school_id=tenant and (not b.archived or (private.has_permission(tenant,'library.view_all') and coalesce((request->>'include_archived')::boolean,false))) and (b.title||' '||b.author||' '||coalesce(b.isbn,'')||' '||coalesce(b.category,'')) ilike q order by b.title,b.id limit 20 offset page*20)x;return jsonb_build_object('rows',rows,'count',total);
 elsif op='copies' then
 if not exists(select 1 from public.library_books where school_id=tenant and id=target and (not archived or private.has_permission(tenant,'library.view_all'))) then raise exception 'Book unavailable';end if;
 select count(*) into total from public.library_copies where school_id=tenant and book_id=target and (status<>'RETIRED' or private.has_permission(tenant,'library.view_all'));
 select coalesce(jsonb_agg(x),'[]') into rows from (select c.*,exists(select 1 from public.library_loans l where l.school_id=tenant and l.copy_id=c.id and l.closed_on is null) on_loan from public.library_copies c where c.school_id=tenant and c.book_id=target and (status<>'RETIRED' or private.has_permission(tenant,'library.view_all')) order by c.accession_number,c.id limit 20 offset page*20)x;return jsonb_build_object('rows',rows,'count',total);
 elsif op='learners' then
 if not private.has_permission(tenant,'library.manage') then raise exception 'Not authorized';end if;
 select count(*) into total from public.students s where s.school_id=tenant and not s.archived and (s.first_name||' '||s.surname||' '||s.admission_number) ilike q;
 select coalesce(jsonb_agg(x),'[]') into rows from(select s.id,s.first_name||' '||s.surname name,s.admission_number from public.students s where s.school_id=tenant and not s.archived and (s.first_name||' '||s.surname||' '||s.admission_number) ilike q order by s.surname,s.first_name,s.id limit 20 offset page*20)x;return jsonb_build_object('rows',rows,'count',total);
 elsif op='loans' then
 select count(*) into total from public.library_loans l where l.school_id=tenant and private.library_learner_read(tenant,l.student_id) and (learner is null or l.student_id=learner) and (l.document->>'title'||' '||(l.document->>'learner')||' '||(l.document->>'admission_number')||' '||(l.document->>'accession_number')) ilike q and case filter when 'OPEN' then l.closed_on is null when 'OVERDUE' then l.closed_on is null and l.due_on<today when 'CLOSED' then l.closed_on is not null else true end;
 select coalesce(jsonb_agg(x),'[]') into rows from(select l.*,l.closed_on is null and l.due_on<today overdue from public.library_loans l where l.school_id=tenant and private.library_learner_read(tenant,l.student_id) and (learner is null or l.student_id=learner) and (l.document->>'title'||' '||(l.document->>'learner')||' '||(l.document->>'admission_number')||' '||(l.document->>'accession_number')) ilike q and case filter when 'OPEN' then l.closed_on is null when 'OVERDUE' then l.closed_on is null and l.due_on<today when 'CLOSED' then l.closed_on is not null else true end order by l.issued_on desc,l.created_at desc,l.id limit 20 offset page*20)x;return jsonb_build_object('rows',rows,'count',total);
 elsif op='loan' then
 if not private.library_loan_read(tenant,target) then raise exception 'Borrowing record unavailable';end if;
 select to_jsonb(l)||jsonb_build_object('overdue',l.closed_on is null and l.due_on<today,'events',(select coalesce(jsonb_agg(e order by e.created_at,e.id),'[]') from public.library_events e where e.school_id=tenant and e.loan_id=l.id)) into result from public.library_loans l where l.school_id=tenant and l.id=target;return result;
 elsif op='report' then
 if not private.has_permission(tenant,'library.reports') then raise exception 'Not authorized';end if;
 return jsonb_build_object('as_at',today,'titles',(select count(*) from public.library_books where school_id=tenant and not archived),'copies',(select count(*) from public.library_copies where school_id=tenant and status<>'RETIRED'),'available',(select count(*) from public.library_copies c join public.library_books b on b.school_id=c.school_id and b.id=c.book_id where c.school_id=tenant and c.status='READY' and not b.archived and not exists(select 1 from public.library_loans l where l.school_id=tenant and l.copy_id=c.id and l.closed_on is null)),'on_loan',(select count(*) from public.library_loans where school_id=tenant and closed_on is null),'overdue',(select count(*) from public.library_loans where school_id=tenant and closed_on is null and due_on<today),'lost',(select count(*) from public.library_copies where school_id=tenant and status='LOST'),'damaged',(select count(*) from public.library_copies where school_id=tenant and status='DAMAGED'));
 end if;raise exception 'Unknown library operation';
end $$;
create function public.library_read(tenant uuid,request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select private.library_read(tenant,request)$$;
create function public.library_write(tenant uuid,request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.library_write(tenant,request)$$;
revoke all on function private.library_learner_read(uuid,uuid),private.library_loan_read(uuid,uuid),private.library_read(uuid,jsonb),private.library_write(uuid,jsonb),public.library_read(uuid,jsonb),public.library_write(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.library_learner_read(uuid,uuid),private.library_loan_read(uuid,uuid),private.library_read(uuid,jsonb),private.library_write(uuid,jsonb),public.library_read(uuid,jsonb),public.library_write(uuid,jsonb) to authenticated;
commit;
