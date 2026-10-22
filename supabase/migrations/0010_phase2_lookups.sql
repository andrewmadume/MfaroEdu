begin;
-- Invoker security keeps the same class-subject RLS as ordinary table reads.
create function public.search_class_subjects(tenant uuid, search_term text default '', page_number integer default 0)
returns table(id uuid,school_id uuid,archived boolean,version integer,created_at timestamptz,subject jsonb,class jsonb,total bigint)
language sql stable security invoker set search_path='' as $$
 select cs.id,cs.school_id,cs.archived,cs.version,cs.created_at,
 jsonb_build_object('code',s.code,'name',s.name),jsonb_build_object('name',c.name,'year',jsonb_build_object('name',y.name)),count(*) over()
 from public.class_subjects cs join public.subjects s on s.school_id=cs.school_id and s.id=cs.subject_id
 join public.classes c on c.school_id=cs.school_id and c.id=cs.class_id
 join public.academic_years y on y.school_id=c.school_id and y.id=c.academic_year_id
 where cs.school_id=tenant and not cs.archived and not c.archived and not s.archived and not y.archived
 and position(lower(left(coalesce(search_term,''),80)) in lower(s.name||' '||s.code||' '||c.name||' '||y.name))>0
 order by y.starts_on desc,c.name,s.name,cs.id limit 20 offset least(greatest(page_number,0),100000)*20
$$;
revoke all on function public.search_class_subjects(uuid,text,integer) from public,anon;
grant execute on function public.search_class_subjects(uuid,text,integer) to authenticated;
commit;
