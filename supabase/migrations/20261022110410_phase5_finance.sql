begin;
insert into public.permissions values ('finance.view','Read authorized learner accounts'),('finance.view_all','Read all school finance accounts'),('finance.manage','Issue invoices and record financial transactions'),('finance.reports','Read school financial reports');
insert into public.role_permissions select r.id,p.id from public.roles r cross join public.permissions p where r.id in ('SUPER_ADMIN','SCHOOL_ADMIN','ACCOUNTANT') and p.id like 'finance.%';
insert into public.role_permissions values ('PRINCIPAL','finance.view'),('PRINCIPAL','finance.view_all'),('PRINCIPAL','finance.reports'),('PARENT','finance.view'),('STUDENT','finance.view'),('ACCOUNTANT','academics.view') on conflict do nothing;

create table public.finance_settings (
 id uuid primary key default gen_random_uuid(),school_id uuid not null unique references public.schools(id),
 currency text not null check(currency ~ '^[A-Z]{3}$'), decimal_places integer not null check(decimal_places between 0 and 3),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.fee_categories (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),
 name text not null check(length(trim(name)) between 1 and 100),archived boolean not null default false,
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id)
);
create unique index fee_category_name on public.fee_categories(school_id,lower(name));
create table public.fee_structures (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),category_id uuid not null,academic_year_id uuid not null,grade_id uuid,
 name text not null check(length(trim(name)) between 1 and 120),amount_minor bigint not null check(amount_minor between 1 and 9000000000000),archived boolean not null default false,
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id),
 foreign key(school_id,category_id) references public.fee_categories(school_id,id),foreign key(school_id,academic_year_id) references public.academic_years(school_id,id),foreign key(school_id,grade_id) references public.grades(school_id,id)
);
create index fee_structure_school on public.fee_structures(school_id,archived,academic_year_id);
create table public.finance_invoices (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),student_id uuid not null,academic_year_id uuid not null,
 number text not null,issued_on date not null,due_on date not null check(due_on>=issued_on),gross_minor bigint not null check(gross_minor between 1 and 9000000000000),
 document jsonb not null,status text not null default 'ISSUED' check(status in ('ISSUED','VOID')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(school_id,id),unique(school_id,number),unique(school_id,id,student_id),
 foreign key(school_id,student_id) references public.students(school_id,id),foreign key(school_id,academic_year_id) references public.academic_years(school_id,id)
);
create index finance_invoice_learner on public.finance_invoices(school_id,student_id,issued_on desc,id);
create table public.finance_entries (
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id),invoice_id uuid not null,student_id uuid not null,
 kind text not null check(kind in ('INVOICE','PAYMENT','DISCOUNT','BURSARY','REVERSAL','VOID')),amount_minor bigint not null check(amount_minor<>0 and abs(amount_minor)<=9000000000000),
 posted_on date not null,number text not null,method text,reference text,reason text,original_entry_id uuid,
 request_key uuid not null,request_payload jsonb not null,document jsonb not null default '{}',created_by uuid not null,created_at timestamptz not null default now(),
 unique(school_id,id),unique(school_id,request_key),unique(school_id,original_entry_id),
 foreign key(school_id,invoice_id,student_id) references public.finance_invoices(school_id,id,student_id),foreign key(school_id,original_entry_id) references public.finance_entries(school_id,id),
 check((kind='REVERSAL')=(original_entry_id is not null)),check(kind not in ('INVOICE','REVERSAL') or amount_minor>0),check(kind not in ('PAYMENT','DISCOUNT','BURSARY','VOID') or amount_minor<0),
 check(length(reference)<=200),check(length(reason)<=1000)
);
create index finance_entry_statement on public.finance_entries(school_id,student_id,posted_on,created_at,id);
create index finance_entry_invoice on public.finance_entries(school_id,invoice_id);
create table private.finance_counters(school_id uuid primary key references public.schools(id),counter bigint not null default 0);
alter table private.finance_counters enable row level security;
revoke all on private.finance_counters from public,anon,authenticated;

create function private.finance_owns(tenant uuid,learner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission(tenant,'finance.view') and (private.has_permission(tenant,'finance.view_all') or private.owns_learner(tenant,learner))
$$;
do $$declare t text;begin
 foreach t in array array['finance_settings','fee_categories','fee_structures','finance_invoices','finance_entries'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger audit_finance after insert or update on public.%I for each row execute function private.audit_change()',t);
 if t not in ('finance_entries') then execute format('create trigger finance_version before update on public.%I for each row execute function private.guard_school_record()',t);end if;
 if t in ('finance_invoices','finance_entries') then
 execute format('create policy finance_read on public.%I for select to authenticated using(private.finance_owns(school_id,student_id))',t);
 else
 execute format('create policy finance_read on public.%I for select to authenticated using(private.has_permission(school_id,''finance.view_all''))',t);
 end if;
 end loop;
end $$;
create function private.finance_currency_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.currency<>old.currency and exists(select 1 from public.finance_invoices where school_id=old.id) then raise exception 'Finance currency is locked after the first invoice';end if;return new;
end $$;
create trigger finance_currency before update on public.schools for each row execute function private.finance_currency_guard();

create function private.finance_write(tenant uuid,request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text=request->>'op';key uuid=(request->>'request_key')::uuid;target uuid=nullif(request->>'id','')::uuid;ver integer=coalesce((request->>'version')::integer,0);
 st public.finance_settings;inv public.finance_invoices;original public.finance_entries;existing public.finance_entries;fee public.fee_structures;
 learner public.students;cat public.fee_categories;yr public.academic_years;item jsonb;lines jsonb='[]';doc jsonb;total bigint=0;amount bigint;balance bigint;qty integer;
 today date;day date;seq bigint;num text;result uuid;scale integer;school public.schools;
begin
 if auth.uid() is null or not private.has_permission(tenant,'finance.manage') then raise exception 'Not authorized';end if;
 select * into school from public.schools where id=tenant for update;
 today=(now() at time zone school.timezone)::date;
 if op in ('invoice','PAYMENT','DISCOUNT','BURSARY','REVERSAL','VOID') then
 if key is null then raise exception 'A request key is required';end if;
 select * into existing from public.finance_entries e where e.school_id=tenant and e.request_key=key;
 if found then
 if existing.request_payload<>request then raise exception 'Request key already used for different details';end if;
 return jsonb_build_object('id',existing.invoice_id,'entry_id',existing.id,'replayed',true);
 end if;end if;
 select * into st from public.finance_settings where school_id=tenant;
 if op='settings' then
 if request->>'currency'<>school.currency then raise exception 'Use the school currency';end if;
 scale=(request->>'decimal_places')::integer;
 if st.id is not null and st.version<>ver then raise exception 'Finance record changed; reload before saving';end if;
 if exists(select 1 from public.finance_invoices where school_id=tenant) and (st.currency<>request->>'currency' or st.decimal_places<>scale) then raise exception 'Finance currency is locked after the first invoice';end if;
 insert into public.finance_settings(school_id,currency,decimal_places) values(tenant,request->>'currency',scale)
 on conflict(school_id) do update set currency=excluded.currency,decimal_places=excluded.decimal_places,version=finance_settings.version+1 returning id into result;
 elsif op='category' then
 if target is null then insert into public.fee_categories(school_id,name) values(tenant,trim(request->>'name')) returning id into result;
 else update public.fee_categories set name=trim(request->>'name'),archived=coalesce((request->>'archived')::boolean,false),version=version+1 where school_id=tenant and id=target and version=ver returning id into result;
 if result is null then raise exception 'Finance record changed; reload before saving';end if;end if;
 elsif op='fee' then
 if st.id is null then raise exception 'Configure finance currency first';end if;
 select * into cat from public.fee_categories where school_id=tenant and id=(request->>'category_id')::uuid and not archived;
 select * into yr from public.academic_years where school_id=tenant and id=(request->>'academic_year_id')::uuid and not archived;
 if cat.id is null or yr.id is null or (nullif(request->>'grade_id','') is not null and not exists(select 1 from public.grades where school_id=tenant and id=(request->>'grade_id')::uuid and not archived)) then raise exception 'Select active fee resources';end if;
 amount=(request->>'amount_minor')::bigint;
 if target is null then
 insert into public.fee_structures(school_id,name,category_id,academic_year_id,grade_id,amount_minor) values(tenant,trim(request->>'name'),cat.id,yr.id,nullif(request->>'grade_id','')::uuid,amount) returning id into result;
 else update public.fee_structures set name=trim(request->>'name'),category_id=cat.id,academic_year_id=yr.id,grade_id=nullif(request->>'grade_id','')::uuid,amount_minor=amount,archived=coalesce((request->>'archived')::boolean,false),version=version+1 where school_id=tenant and id=target and version=ver returning id into result;
 if result is null then raise exception 'Finance record changed; reload before saving';end if;end if;
 elsif op='invoice' then
 if st.id is null then raise exception 'Configure finance currency first';end if;
 select * into learner from public.students where school_id=tenant and id=(request->>'student_id')::uuid and not archived;
 select * into yr from public.academic_years where school_id=tenant and id=(request->>'academic_year_id')::uuid and not archived;
 if learner.id is null or yr.id is null or not exists(select 1 from public.enrollments where school_id=tenant and student_id=learner.id and academic_year_id=yr.id and not archived) then raise exception 'Select a learner enrolled in this academic year';end if;
 day=(request->>'issued_on')::date;
 if day is null or day>today or (request->>'due_on')::date is null or (request->>'due_on')::date<day then raise exception 'Invalid invoice dates';end if;
 if jsonb_typeof(request->'items')<>'array' or jsonb_array_length(request->'items') not between 1 and 100 then raise exception 'Select between 1 and 100 invoice lines';end if;
 for item in select value from jsonb_array_elements(request->'items') loop
 select * into fee from public.fee_structures where school_id=tenant and id=(item->>'fee_id')::uuid and not archived;
 if fee.id is null or (item->>'version') is null or fee.version<>(item->>'version')::integer or fee.academic_year_id<>yr.id or not exists(select 1 from public.fee_categories where school_id=tenant and id=fee.category_id and not archived) then raise exception 'Fee structure changed; reload before issuing';end if;
 if fee.grade_id is not null and not exists(select 1 from public.enrollments e join public.classes c on c.school_id=e.school_id and c.id=e.class_id where e.school_id=tenant and e.student_id=learner.id and e.academic_year_id=yr.id and c.grade_id=fee.grade_id and not e.archived) then raise exception 'Fee does not apply to this learner grade';end if;
 qty=(item->>'quantity')::integer;if qty is null or qty not between 1 and 1000 then raise exception 'Invalid invoice quantity';end if;
 total=total+fee.amount_minor*qty;
 lines=lines||jsonb_build_array(jsonb_build_object('description',fee.name,'category',(select name from public.fee_categories where id=fee.category_id),'quantity',qty,'unit_minor',fee.amount_minor::text,'total_minor',(fee.amount_minor*qty)::text));
 end loop;
 if total not between 1 and 9000000000000 then raise exception 'Amount is outside the supported range';end if;
 insert into private.finance_counters(school_id,counter) values(tenant,1) on conflict(school_id) do update set counter=finance_counters.counter+1 returning counter into seq;
 num='INV-'||lpad(seq::text,greatest(6,length(seq::text)),'0');
 doc=jsonb_build_object('school',school.name,'address',school.address,'learner',learner.first_name||' '||learner.surname,'admission',learner.admission_number,'year',yr.name,'currency',st.currency,'decimal_places',st.decimal_places,'items',lines);
 insert into public.finance_invoices(school_id,student_id,academic_year_id,number,issued_on,due_on,gross_minor,document) values(tenant,learner.id,yr.id,num,day,(request->>'due_on')::date,total,doc) returning id into result;
 insert into public.finance_entries(school_id,invoice_id,student_id,kind,amount_minor,posted_on,number,request_key,request_payload,created_by) values(tenant,result,learner.id,'INVOICE',total,day,num,key,request,auth.uid());
 elsif op in ('PAYMENT','DISCOUNT','BURSARY','REVERSAL','VOID') then
 select * into inv from public.finance_invoices where school_id=tenant and id=target for update;
 if inv.id is null or inv.version<>ver then raise exception 'Finance record changed; reload before saving';end if;
 if inv.status<>'ISSUED' then raise exception 'This invoice is void';end if;
 day=(request->>'posted_on')::date;
 if day is null or day<inv.issued_on or day>today then raise exception 'Posting date must be between invoice date and today';end if;
 select sum(amount_minor) into balance from public.finance_entries where school_id=tenant and invoice_id=inv.id;
 amount=(request->>'amount_minor')::bigint;
 if op='REVERSAL' then
 select * into original from public.finance_entries where school_id=tenant and invoice_id=inv.id and id=(request->>'original_entry_id')::uuid and kind in ('PAYMENT','DISCOUNT','BURSARY');
 if original.id is null or exists(select 1 from public.finance_entries where school_id=tenant and original_entry_id=original.id) then raise exception 'Select an unreversed payment or concession';end if;
 if day<original.posted_on then raise exception 'Reversal date cannot precede the original entry';end if;
 amount=-original.amount_minor;
 elsif op='VOID' then
 if exists(select 1 from public.finance_entries e where e.school_id=tenant and e.invoice_id=inv.id and e.kind in ('PAYMENT','DISCOUNT','BURSARY') and not exists(select 1 from public.finance_entries r where r.school_id=tenant and r.original_entry_id=e.id)) then raise exception 'Reverse all payments and concessions before voiding';end if;
 amount=-inv.gross_minor;
 else
 if amount is null or amount<=0 or amount>balance then raise exception 'Amount must be positive and no greater than the outstanding balance';end if;
 if op='PAYMENT' and coalesce(request->>'method','') not in ('CASH','BANK_TRANSFER','CARD','OTHER') then raise exception 'Choose a payment method';end if;
 amount=-amount;
 end if;
 if op<>'PAYMENT' and length(trim(coalesce(request->>'reason',''))) not between 1 and 1000 then raise exception 'A reason is required';end if;
 insert into private.finance_counters(school_id,counter) values(tenant,1) on conflict(school_id) do update set counter=finance_counters.counter+1 returning counter into seq;
 num=(case when op='PAYMENT' then 'RCT-' when op='REVERSAL' then 'REV-' else 'ADJ-' end)||lpad(seq::text,greatest(6,length(seq::text)),'0');
 insert into public.finance_entries(school_id,invoice_id,student_id,kind,amount_minor,posted_on,number,method,reference,reason,original_entry_id,request_key,request_payload,document,created_by)
 values(tenant,inv.id,inv.student_id,op,amount,day,num,case when op='PAYMENT' then request->>'method' end,nullif(trim(request->>'reference'),''),nullif(trim(request->>'reason'),''),original.id,key,request,
 inv.document||jsonb_build_object('invoice_number',inv.number,'number',num,'kind',op,'amount_minor',amount::text,'posted_on',day,'method',request->>'method','reference',request->>'reference'),auth.uid()) returning id into result;
 -- A backdated credit or void must never create an overpaid historical account.
 if exists(select 1 from (select sum(e.amount_minor) over(order by e.posted_on,e.created_at,e.id) running from public.finance_entries e where e.school_id=tenant and e.invoice_id=inv.id) history where running<0) then raise exception 'Posting would make a historical balance negative; choose a later date';end if;
 update public.finance_invoices set version=version+1,status=case when op='VOID' then 'VOID' else status end where id=inv.id;
 return jsonb_build_object('id',inv.id,'entry_id',result);
 else raise exception 'Unknown finance operation';end if;
 return jsonb_build_object('id',result);
end $$;

create function private.finance_read(tenant uuid,request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare op text=request->>'op';learner uuid=nullif(request->>'student_id','')::uuid;target uuid=nullif(request->>'id','')::uuid;
 page integer=greatest(coalesce((request->>'page')::integer,0),0);start_date date=(request->>'from')::date;end_date date=(request->>'to')::date;
 cutoff timestamptz=least(coalesce((request->>'as_at')::timestamptz,statement_timestamp()),statement_timestamp());
 result jsonb;rows jsonb;total bigint;opening numeric;closing numeric;st public.finance_settings;
begin
 if auth.uid() is null or not private.has_permission(tenant,'finance.view') then raise exception 'Not authorized';end if;
 if op='learners' then
 select count(*) into total from public.students s where s.school_id=tenant and private.finance_owns(tenant,s.id) and (s.first_name||' '||s.surname||' '||s.admission_number) ilike '%'||replace(replace(replace(left(coalesce(request->>'search',''),100),'\','\\'),'%','\%'),'_','\_')||'%';
 select coalesce(jsonb_agg(x),'[]') into rows from (select s.id,s.first_name||' '||s.surname name,s.admission_number,s.archived from public.students s where s.school_id=tenant and private.finance_owns(tenant,s.id) and (s.first_name||' '||s.surname||' '||s.admission_number) ilike '%'||replace(replace(replace(left(coalesce(request->>'search',''),100),'\','\\'),'%','\%'),'_','\_')||'%' order by s.surname,s.first_name,s.id limit 20 offset page*20) x;
 return jsonb_build_object('rows',rows,'count',total);
 elsif op='setup' then
 if not private.has_permission(tenant,'finance.view_all') then raise exception 'Not authorized';end if;
 select * into st from public.finance_settings where school_id=tenant;
 return jsonb_build_object('settings',to_jsonb(st),'locked',exists(select 1 from public.finance_invoices where school_id=tenant),
 'categories',(select coalesce(jsonb_agg(c order by name),'[]') from public.fee_categories c where school_id=tenant),
 'fees',(select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('amount_minor',amount_minor::text) order by name),'[]') from public.fee_structures f where school_id=tenant),
 'years',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'archived',archived) order by starts_on desc),'[]') from public.academic_years where school_id=tenant),
 'grades',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order),'[]') from public.grades where school_id=tenant and not archived));
 elsif op='account' then
 if learner is null or not private.finance_owns(tenant,learner) then raise exception 'Not authorized';end if;
 select * into st from public.finance_settings where school_id=tenant;
 select count(*) into total from public.finance_invoices where school_id=tenant and student_id=learner;
 select coalesce(jsonb_agg(x order by x.issued_on desc,x.id),'[]') into rows from (select i.id,i.number,i.issued_on,i.due_on,i.status,i.version,i.document,i.gross_minor::text,
 (select sum(e.amount_minor)::text from public.finance_entries e where e.school_id=tenant and e.invoice_id=i.id) balance_minor from public.finance_invoices i where i.school_id=tenant and i.student_id=learner order by i.issued_on desc,i.id limit 20 offset page*20) x;
 return jsonb_build_object('settings',to_jsonb(st),'rows',rows,'count',total,'balance_minor',coalesce((select sum(amount_minor)::text from public.finance_entries where school_id=tenant and student_id=learner),'0'));
 elsif op='invoice' then
 select student_id into learner from public.finance_invoices where school_id=tenant and id=target;
 if learner is null or not private.finance_owns(tenant,learner) then raise exception 'Not authorized';end if;
 select to_jsonb(i)||jsonb_build_object('gross_minor',i.gross_minor::text,'balance_minor',(select sum(amount_minor)::text from public.finance_entries where school_id=tenant and invoice_id=i.id),'entries',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('amount_minor',e.amount_minor::text,'reversed',exists(select 1 from public.finance_entries r where r.school_id=tenant and r.original_entry_id=e.id)) order by e.posted_on,e.created_at,e.id),'[]') from public.finance_entries e where e.school_id=tenant and e.invoice_id=i.id)) into result from public.finance_invoices i where i.school_id=tenant and i.id=target;
 return result;
 elsif op in ('statement','report') then
 if start_date is null or end_date is null or end_date<start_date or end_date-start_date>366 then raise exception 'Choose a date range of one year or less';end if;
 if op='report' then
 if not private.has_permission(tenant,'finance.reports') then raise exception 'Not authorized';end if;
 return jsonb_build_object('settings',(select to_jsonb(s) from public.finance_settings s where school_id=tenant),
 'billed_minor',coalesce((select sum(amount_minor)::text from public.finance_entries where school_id=tenant and posted_on between start_date and end_date and kind in ('INVOICE','VOID')),'0'),
 'collected_minor',coalesce((select (-sum(e.amount_minor))::text from public.finance_entries e left join public.finance_entries o on o.school_id=e.school_id and o.id=e.original_entry_id where e.school_id=tenant and e.posted_on between start_date and end_date and (e.kind='PAYMENT' or (e.kind='REVERSAL' and o.kind='PAYMENT'))),'0'),
 'concessions_minor',coalesce((select (-sum(e.amount_minor))::text from public.finance_entries e left join public.finance_entries o on o.school_id=e.school_id and o.id=e.original_entry_id where e.school_id=tenant and e.posted_on between start_date and end_date and (e.kind in ('DISCOUNT','BURSARY') or (e.kind='REVERSAL' and o.kind in ('DISCOUNT','BURSARY')))),'0'),
 'outstanding_minor',coalesce((select sum(amount_minor)::text from public.finance_entries where school_id=tenant and posted_on<=end_date),'0'));
 end if;
 if learner is null or not private.finance_owns(tenant,learner) then raise exception 'Not authorized';end if;
 select coalesce(sum(amount_minor) filter(where posted_on<start_date),0),coalesce(sum(amount_minor),0) into opening,closing from public.finance_entries where school_id=tenant and student_id=learner and posted_on<=end_date and created_at<=cutoff;
 select count(*) into total from public.finance_entries where school_id=tenant and student_id=learner and posted_on between start_date and end_date and created_at<=cutoff;
 with history as (select e.id,e.number,e.kind,e.posted_on,e.created_at,e.amount_minor::text, i.number invoice_number,sum(e.amount_minor) over(order by e.posted_on,e.created_at,e.id)::text running_minor from public.finance_entries e join public.finance_invoices i on i.school_id=e.school_id and i.id=e.invoice_id where e.school_id=tenant and e.student_id=learner and e.posted_on<=end_date and e.created_at<=cutoff),slice as (select * from history where posted_on>=start_date order by posted_on,created_at,id limit 20 offset page*20)
 select coalesce(jsonb_agg(slice order by posted_on,created_at,id),'[]') into rows from slice;
 return jsonb_build_object('settings',(select to_jsonb(s) from public.finance_settings s where school_id=tenant),'rows',rows,'count',total,'opening_minor',opening::text,'closing_minor',closing::text,'as_at',cutoff);
 end if;
 raise exception 'Unknown finance operation';
end $$;
create function public.finance_write(tenant uuid,request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.finance_write(tenant,request)$$;
create function public.finance_read(tenant uuid,request jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select private.finance_read(tenant,request)$$;
revoke all on function private.finance_write(uuid,jsonb),private.finance_read(uuid,jsonb),private.finance_owns(uuid,uuid),private.finance_currency_guard(),public.finance_write(uuid,jsonb),public.finance_read(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.finance_write(uuid,jsonb),private.finance_read(uuid,jsonb),private.finance_owns(uuid,uuid),public.finance_write(uuid,jsonb),public.finance_read(uuid,jsonb) to authenticated;
commit;

