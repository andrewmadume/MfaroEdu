begin;
create function public.search_markable_subjects(tenant uuid,search_term text default '',page_number integer default 0) returns table(id uuid,school_id uuid,archived boolean,version integer,created_at timestamptz,subject jsonb,class jsonb,total bigint) language sql stable security invoker set search_path='' as $$
 select cs.id,cs.school_id,cs.archived,cs.version,cs.created_at,to_jsonb(s),to_jsonb(c)||jsonb_build_object('year',to_jsonb(y)),count(*) over()
 from public.class_subjects cs join public.classes c on c.school_id=cs.school_id and c.id=cs.class_id
 join public.subjects s on s.school_id=cs.school_id and s.id=cs.subject_id join public.academic_years y on y.school_id=c.school_id and y.id=c.academic_year_id
 where cs.school_id=tenant and private.can_mark(tenant,cs.id) and not cs.archived and not c.archived and not s.archived and not y.archived
 and position(lower(left(search_term,80)) in lower(c.name||' '||s.name||' '||s.code||' '||y.name))>0
 order by c.name,s.name,cs.id limit 20 offset greatest(page_number,0)*20
$$;
revoke all on function public.search_markable_subjects(uuid,text,integer) from public,anon;
grant execute on function public.search_markable_subjects(uuid,text,integer) to authenticated;
commit;
