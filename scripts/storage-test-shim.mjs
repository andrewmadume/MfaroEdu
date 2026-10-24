// Test-only storage catalogue. This exercises actual SQL grants/RLS, not file bytes or Storage HTTP.
export const storageShim = `create schema storage;
create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,owner_id text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`;
