import { database } from '../lib/supabase';
import { operationError } from './directory';
import type { SchoolRecord } from '../types/directory';
export interface Enrollment extends SchoolRecord {
  student_id: string;
  class_id: string;
  academic_year_id: string;
  starts_on: string;
  ends_on: string | null;
  status: string;
}
export async function loadEnrollments(tenant: string, student: string, page: number) {
  const { data, error, count } = await database()
    .from('enrollments')
    .select('*,class:classes(name),year:academic_years(name)', { count: 'exact' })
    .eq('school_id', tenant)
    .eq('student_id', student)
    .order('starts_on', { ascending: false })
    .order('id')
    .range(page * 20, page * 20 + 19);
  if (error) throw new Error('Could not load enrollment history.');
  return { rows: data as unknown as Enrollment[], count: count ?? 0 };
}
export async function enroll(
  tenant: string,
  student: string,
  classId: string,
  start: string,
  previous?: Enrollment,
  end?: string,
  status = 'TRANSFERRED',
) {
  const { error } = await database().rpc('enroll_student', {
    tenant,
    learner: student,
    target_class: classId,
    start_date: start,
    previous_enrollment: previous?.id ?? null,
    expected_version: previous?.version ?? null,
    previous_end: end || null,
    closure_status: status,
  });
  if (error) throw operationError(error);
}
export async function closeEnrollment(
  tenant: string,
  record: Enrollment,
  end: string,
  status: string,
) {
  const { error } = await database().rpc('close_enrollment', {
    tenant,
    enrollment_key: record.id,
    expected_version: record.version,
    end_date: end,
    closure_status: status,
  });
  if (error) throw operationError(error);
}
