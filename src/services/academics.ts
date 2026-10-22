import { database } from '../lib/supabase';
import { gradingSchema, assessmentSchema, validateMarks } from '../lib/academics';
import type {
  Assessment,
  Gradebook,
  GradingRules,
  MarkEntry,
  PublishedReport,
  ReportDocument,
  SubjectGrade,
} from '../types/academics';
const businessMessages = new Set([
  'Configure grading bands and assessment types',
  'Bands must descend to zero with unique thresholds',
  'Invalid annual term weights',
  'Assessment allocation is immutable',
  'Assessment must match the class year and term dates',
  'Configure this assessment type first',
  'Maximum mark is below an existing mark',
  'Assessment changed; reload before saving',
  'Learner is not enrolled on the assessment date',
  'Invalid mark or status',
  'Marks changed; reload before saving',
  'Report note changed; reload before saving',
  'Configure grading rules before publishing',
  'Select a class and term in the same year',
  'Complete every applicable assessment before publishing',
  'Each subject needs an applicable assessment',
  'At least one graded subject is required',
  'This class has no learners enrolled in the term',
  'Results changed; review the preview again',
  'Publication changed; reload before withdrawing',
  'Configure weights for every term in the year',
  'Publish every weighted term before generating annual results',
  'Withdraw superseded class reports before generating annual results',
]);
function failure(e: { message: string } | null): never {
  throw new Error(
    e && businessMessages.has(e.message)
      ? `${e.message}.`
      : 'The request could not be completed. Your access or the record may have changed. Reload and try again.',
  );
}
export async function gradingRules(tenant: string) {
  const { data, error } = await database()
    .from('grading_rules')
    .select('*')
    .eq('school_id', tenant)
    .maybeSingle();
  if (error) failure(error);
  return data as GradingRules | null;
}
export async function subjectGradebook(tenant: string, allocation: string, term: string) {
  const { data, error } = await database().rpc('subject_gradebook', {
    tenant,
    allocation,
    term_key: term,
  });
  if (error) failure(error);
  return data as SubjectGrade[];
}
export async function saveGrading(tenant: string, input: unknown, existing: GradingRules | null) {
  const parsed = gradingSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const values = parsed.data;
  const q = existing
    ? database()
        .from('grading_rules')
        .update({ ...values, version: existing.version + 1 })
        .eq('school_id', tenant)
        .eq('id', existing.id)
        .eq('version', existing.version)
    : database()
        .from('grading_rules')
        .insert({ ...values, school_id: tenant });
  const { data, error } = await q.select().single();
  if (error || !data) failure(error);
  return data as GradingRules;
}
export async function assessments(
  tenant: string,
  allocation: string,
  term: string,
  page: number,
  archived = false,
) {
  const { data, count, error } = await database()
    .from('assessments')
    .select('*', { count: 'exact' })
    .eq('school_id', tenant)
    .eq('class_subject_id', allocation)
    .eq('term_id', term)
    .eq('archived', archived)
    .order('assessed_on')
    .order('id')
    .range(page * 20, page * 20 + 19);
  if (error) failure(error);
  return { rows: data as Assessment[], count: count ?? 0 };
}
export async function saveAssessment(tenant: string, input: unknown, existing?: Assessment) {
  const parsed = assessmentSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const values = parsed.data;
  const q = existing
    ? database()
        .from('assessments')
        .update({ ...values, version: existing.version + 1 })
        .eq('school_id', tenant)
        .eq('id', existing.id)
        .eq('version', existing.version)
    : database()
        .from('assessments')
        .insert({ ...values, school_id: tenant });
  const { data, error } = await q.select().single();
  if (error || !data) failure(error);
}
export async function archiveAssessment(tenant: string, a: Assessment) {
  const { data, error } = await database()
    .from('assessments')
    .update({ archived: !a.archived, version: a.version + 1 })
    .eq('school_id', tenant)
    .eq('id', a.id)
    .eq('version', a.version)
    .select()
    .single();
  if (error || !data) failure(error);
}
export async function gradebook(tenant: string, id: string) {
  const { data, error } = await database().rpc('assessment_gradebook', {
    tenant,
    assessment_key: id,
  });
  if (error) failure(error);
  return data as Gradebook;
}
export async function saveMarks(tenant: string, a: Assessment, entries: MarkEntry[]) {
  validateMarks(entries, a.max_mark);
  const { error } = await database().rpc('save_assessment_marks', {
    tenant,
    assessment_key: a.id,
    expected_assessment_version: a.version,
    entries: entries.map((e) => ({ ...e, mark: e.status === 'MARKED' ? e.mark : null })),
  });
  if (error) failure(error);
}
export async function previewResults(tenant: string, classId: string, term: string) {
  const { data, error } = await database().rpc('preview_term_results', {
    tenant,
    class_key: classId,
    term_key: term,
  });
  if (error) failure(error);
  return data as ReportDocument[];
}
export async function publishResults(
  tenant: string,
  classId: string,
  term: string,
  documents: ReportDocument[],
) {
  const { error } = await database().rpc('publish_term_results', {
    tenant,
    class_key: classId,
    term_key: term,
    expected_documents: documents,
  });
  if (error) failure(error);
}
export async function reportNotes(tenant: string, classId: string, term: string) {
  const { data, error } = await database()
    .from('report_notes')
    .select('*')
    .eq('school_id', tenant)
    .eq('class_id', classId)
    .eq('term_id', term);
  if (error) failure(error);
  return data as {
    student_id: string;
    principal_comment: string;
    promotion_status: string;
    version: number;
  }[];
}
export async function saveNote(
  tenant: string,
  classId: string,
  term: string,
  student: string,
  version: number,
  note: string,
  promotion: string,
) {
  const { error } = await database().rpc('save_report_note', {
    tenant,
    class_key: classId,
    term_key: term,
    learner: student,
    expected_version: version,
    note,
    promotion,
  });
  if (error) failure(error);
}
export async function publishedReports(
  tenant: string,
  page: number,
  classId = '',
  term = '',
  history = false,
) {
  let q = database()
    .from('published_reports')
    .select('*,publication:result_publications!inner(id,active,version,class_id,term_id,rules)', {
      count: 'exact',
    })
    .eq('school_id', tenant);
  if (!history) q = q.eq('publication.active', true);
  if (classId) q = q.eq('publication.class_id', classId);
  if (term) q = q.eq('publication.term_id', term);
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .order('id')
    .range(page * 20, page * 20 + 19);
  if (error) failure(error);
  return { rows: data as unknown as PublishedReport[], count: count ?? 0 };
}
export async function batchReports(tenant: string, classId: string, term: string) {
  const rows: PublishedReport[] = [];
  for (let page = 0; ; page++) {
    const chunk = await publishedReports(tenant, page, classId, term);
    rows.push(...chunk.rows);
    if (rows.length >= chunk.count) break;
    if (page >= 100) throw new Error('Select a smaller report group.');
  }
  return rows;
}
export async function withdrawResults(tenant: string, id: string, version: number) {
  const { error } = await database().rpc('withdraw_term_results', {
    tenant,
    publication_key: id,
    expected_version: version,
  });
  if (error) failure(error);
}
export async function annualResults(tenant: string, year: string, learner: string) {
  const { data, error } = await database().rpc('annual_results', {
    tenant,
    year_key: year,
    learner,
  });
  if (error) failure(error);
  return data as ReportDocument;
}
