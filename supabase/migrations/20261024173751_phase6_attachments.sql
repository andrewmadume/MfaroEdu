begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('mfaroedu-communications','mfaroedu-communications',false,5242880,array['application/pdf','image/png','image/jpeg','text/plain']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function private.comm_file_access(object_name text,operation text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare allowed boolean;
begin
 if auth.uid() is null then return false;end if;
 -- Serialize Storage mutations with publication/withdrawal to avoid deleting a just-published file.
 if operation in ('insert','delete') then
 perform 1 from public.announcements a join public.announcement_files f on f.school_id=a.school_id and f.announcement_id=a.id where object_name=f.school_id::text||'/'||f.id::text||'/file' for share of a;
 end if;
 select exists(select 1 from public.announcement_files f join public.announcements a on a.school_id=f.school_id and a.id=f.announcement_id where object_name=f.school_id::text||'/'||f.id::text||'/file' and not f.removed and private.has_permission(f.school_id,'communication.view') and case
 when operation='read' then (f.ready and private.comm_announcement_read(f.school_id,a.id)) or (a.status='DRAFT' and private.comm_edit(f.school_id,a.id))
 when operation='insert' then a.status='DRAFT' and not f.ready and f.uploaded_by=auth.uid() and private.comm_edit(f.school_id,a.id)
 when operation='delete' then a.status='DRAFT' and private.comm_edit(f.school_id,a.id) else false end) into allowed;
 return allowed;
end
$$;
revoke all on function private.comm_file_access(text,text) from public,anon,authenticated;
grant execute on function private.comm_file_access(text,text) to authenticated;
create policy mfaroedu_attachment_read on storage.objects for select to authenticated using(bucket_id='mfaroedu-communications' and private.comm_file_access(name,'read'));
create policy mfaroedu_attachment_insert on storage.objects for insert to authenticated with check(bucket_id='mfaroedu-communications' and private.comm_file_access(name,'insert'));
create policy mfaroedu_attachment_delete on storage.objects for delete to authenticated using(bucket_id='mfaroedu-communications' and private.comm_file_access(name,'delete'));
-- No UPDATE/upsert policy: published attachments are immutable and access is checked at download time.
commit;
