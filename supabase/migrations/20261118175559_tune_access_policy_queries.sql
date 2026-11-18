begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Preserve policy predicates and roles; evaluate the session UID once per statement.
do $$ declare r record; expression text; n integer=0;begin
 for r in select p.polname,c.relname,pg_get_expr(p.polqual,p.polrelid) as expression from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and p.polname in ('parents_read','guardians_read','staff_read','teacher_assignment_read') loop
  expression=replace(r.expression,'auth.uid()','(select auth.uid())');
  execute format('alter policy %I on public.%I using (%s)',r.polname,r.relname,expression);n=n+1;
 end loop; if n<>4 then raise exception 'Expected four scoped access policies';end if;
end $$;
-- Cover foreign-key lookups identified by hosted advisors. The current school
-- dataset is small; lock/statement timeouts prevent an unexpected long rollout.
create index if not exists "mfaro_fk_announcement_files_b338f64e" on public."announcement_files" ("uploaded_by");
create index if not exists "mfaro_fk_announcements_9d48e267" on public."announcements" ("author_id");
create index if not exists "mfaro_fk_announcements_6a5ac53b" on public."announcements" ("school_id","class_id");
create index if not exists "mfaro_fk_assessment_marks_653ce398" on public."assessment_marks" ("school_id","student_id");
create index if not exists "mfaro_fk_assessments_15d2d138" on public."assessments" ("school_id","term_id");
create index if not exists "mfaro_fk_class_subjects_a4b1562f" on public."class_subjects" ("school_id","subject_id");
create index if not exists "mfaro_fk_classes_8a30e960" on public."classes" ("school_id","grade_id");
create index if not exists "mfaro_fk_communication_notifications_1ec62d19" on public."communication_notifications" ("user_id");
create index if not exists "mfaro_fk_enrollments_95dc0df0" on public."enrollments" ("school_id","academic_year_id");
create index if not exists "mfaro_fk_enrollments_998b4519" on public."enrollments" ("school_id","class_id","academic_year_id");
create index if not exists "mfaro_fk_fee_structures_3ef5af0e" on public."fee_structures" ("school_id","academic_year_id");
create index if not exists "mfaro_fk_fee_structures_f8d7946d" on public."fee_structures" ("school_id","category_id");
create index if not exists "mfaro_fk_fee_structures_3a2d354a" on public."fee_structures" ("school_id","grade_id");
create index if not exists "mfaro_fk_finance_entries_309e9d7b" on public."finance_entries" ("school_id","invoice_id","student_id");
create index if not exists "mfaro_fk_finance_invoices_7d9e0c94" on public."finance_invoices" ("school_id","academic_year_id");
create index if not exists "mfaro_fk_library_events_56b43195" on public."library_events" ("actor_id");
create index if not exists "mfaro_fk_library_loans_bba3249f" on public."library_loans" ("created_by");
create index if not exists "mfaro_fk_message_threads_7698deaa" on public."message_threads" ("member_a");
create index if not exists "mfaro_fk_message_threads_d1d16e2d" on public."message_threads" ("member_b");
create index if not exists "mfaro_fk_messages_df469ced" on public."messages" ("sender_id");
create index if not exists "mfaro_fk_parents_9efce824" on public."parents" ("user_id");
create index if not exists "mfaro_fk_published_reports_50c539f8" on public."published_reports" ("school_id");
create index if not exists "mfaro_fk_published_reports_7f163590" on public."published_reports" ("school_id","publication_id");
create index if not exists "mfaro_fk_published_reports_1f78fe12" on public."published_reports" ("school_id","student_id");
create index if not exists "mfaro_fk_report_notes_448b12d5" on public."report_notes" ("school_id","student_id");
create index if not exists "mfaro_fk_report_notes_7014d06f" on public."report_notes" ("school_id","term_id");
create index if not exists "mfaro_fk_result_publications_de1e890b" on public."result_publications" ("created_by");
create index if not exists "mfaro_fk_result_publications_8f64fd0a" on public."result_publications" ("school_id","term_id");
create index if not exists "mfaro_fk_role_permissions_b180fdf8" on public."role_permissions" ("permission_id");
create index if not exists "mfaro_fk_staff_6eb1ed6f" on public."staff" ("user_id");
create index if not exists "mfaro_fk_students_58bd87a5" on public."students" ("user_id");
create index if not exists "mfaro_fk_teacher_assignments_8809be8f" on public."teacher_assignments" ("school_id","class_subject_id");
create index if not exists "mfaro_fk_user_roles_96074633" on public."user_roles" ("role_id");
commit;
