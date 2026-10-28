import { database } from '../lib/supabase';
import { entities } from '../lib/directory';
import { validateRecord } from '../schemas/directory';
import type { EntityKey, SchoolRecord } from '../types/directory';
export interface ListOptions {
  page?: number;
  search?: string;
  archived?: boolean;
  sort?: string;
  descending?: boolean;
  filters?: Record<string, string | boolean>;
  classId?: string;
}
const messages = new Set([
  'Select an active record in this school',
  'Account must hold the matching role in this school',
  'Birth date must be in the past',
  'Admission date must not follow an existing enrollment',
  'Capacity cannot be lower than current enrollment',
  'Close active enrollments before changing learner status',
  'Year dates must contain existing terms and enrollments',
  'Close active enrollments before archiving',
  'Term dates must be within the academic year',
  'Terms must not overlap',
  'Assign an active teacher',
  'Select an active learner',
  'Select an active class',
  'Enrollment date must be within the academic year',
  'Enrollment cannot precede admission',
  'Enrollment changed; reload before moving',
  'Invalid closure details',
  'Closure date exceeds academic year',
  'Enrollment dates overlap',
  'Class is at capacity',
  'Enrollment changed; reload before closing',
  'Relationship identity is immutable',
  'Archive linked schedules before changing this resource',
  'Enrollment dates must preserve captured attendance',
  'Reopen affected registers before changing enrollment',
  'Year dates must preserve captured attendance',
]);
export function operationError(error: { code?: string; message?: string } | null): Error {
  if (error?.message && messages.has(error.message)) return new Error(`${error.message}.`);
  if (error?.code === '23505')
    return new Error(
      'A record with these details already exists. Check identifiers and primary guardian links.',
    );
  if (error?.code === '23503')
    return new Error(
      'Select related records from this school. A required record may no longer be available.',
    );
  if (error?.code === '23514')
    return new Error(
      'These values do not meet the record’s requirements. Check the dates and required fields.',
    );
  return new Error(
    'The change was not saved. Your access or this record may have changed. Reload and try again.',
  );
}
export async function listRecords(tenant: string, entity: EntityKey, options: ListOptions = {}) {
  const def = entities[entity];
  let select = def.select ?? '*';
  if (entity === 'students' && options.classId) select += ',enrollments!inner(class_id,status)';
  let query = database()
    .from(entity)
    .select(select, { count: 'exact' })
    .eq('school_id', tenant)
    .eq('archived', options.archived ?? false);
  if (options.search?.trim())
    query = query.ilike('search_text', `%${options.search.trim().replace(/[\\%_]/g, '\\$&')}%`);
  for (const [key, value] of Object.entries(options.filters ?? {})) query = query.eq(key, value);
  if (entity === 'students' && options.classId)
    query = query.eq('enrollments.class_id', options.classId).eq('enrollments.status', 'ACTIVE');
  const sort = def.fields.some((f) => f.key === options.sort)
    ? options.sort!
    : def.fields.some((f) => f.key === 'surname')
      ? 'surname'
      : def.fields.some((f) => f.key === 'name')
        ? 'name'
        : 'created_at';
  const page = options.page ?? 0;
  const { data, error, count } = await query
    .order(sort, { ascending: !options.descending })
    .order('id')
    .range(page * 20, page * 20 + 19);
  if (error)
    throw new Error(
      `Could not load ${def.title.toLowerCase()}. Check your connection and try again.`,
    );
  return { rows: data as unknown as SchoolRecord[], count: count ?? 0 };
}
export async function getRecord(tenant: string, entity: EntityKey, id: string) {
  const { data, error } = await database()
    .from(entity)
    .select(entities[entity].select ?? '*')
    .eq('school_id', tenant)
    .eq('id', id)
    .single();
  if (error) throw new Error('This record is not available.');
  return data as unknown as SchoolRecord;
}
export async function lookupRecords(tenant: string, entity: EntityKey, options: ListOptions) {
  if (entity === 'staff' && options.filters?.timetable) {
    const { data, error } = await database().rpc('timetable_teachers', {
      tenant,
      search_term: options.search ?? '',
      page_number: options.page ?? 0,
    });
    if (error) throw new Error('Could not load timetable teachers.');
    return { rows: data.rows as SchoolRecord[], count: Number(data.count) };
  }
  if (entity !== 'class_subjects') return listRecords(tenant, entity, options);
  const { data, error } = await database().rpc(
    options.filters?.markable ? 'search_markable_subjects' : 'search_class_subjects',
    {
      tenant,
      search_term: options.search ?? '',
      page_number: options.page ?? 0,
    },
  );
  if (error) throw new Error('Could not load class subjects.');
  return { rows: data as SchoolRecord[], count: Number(data?.[0]?.total ?? 0) };
}
export async function getTimetableTeacher(tenant: string, id: string) {
  const { data, error } = await database().rpc('operations_read', {
    tenant,
    request: { op: 'teachers', resource_key: id },
  });
  if (error || !data.rows[0]) throw new Error('This timetable teacher is not available.');
  return data.rows[0] as SchoolRecord;
}
export async function saveRecord(
  tenant: string,
  entity: EntityKey,
  input: Record<string, unknown>,
  existing?: SchoolRecord,
) {
  const values = validateRecord(entity, input);
  const query = existing
    ? database()
        .from(entity)
        .update({ ...values, version: existing.version + 1 })
        .eq('school_id', tenant)
        .eq('id', existing.id)
        .eq('version', existing.version)
    : database()
        .from(entity)
        .insert({ ...values, school_id: tenant });
  const { data, error } = await query.select().single();
  if (error || !data) throw operationError(error);
  return data as SchoolRecord;
}
export async function archiveRecord(tenant: string, entity: EntityKey, record: SchoolRecord) {
  const { error, data } = await database()
    .from(entity)
    .update({ archived: !record.archived, version: record.version + 1 })
    .eq('school_id', tenant)
    .eq('id', record.id)
    .eq('version', record.version)
    .select('id')
    .single();
  if (error || !data) throw operationError(error);
}
export async function schoolCounts(tenant: string) {
  const tables = ['students', 'staff', 'classes'] as const;
  const results = await Promise.all(
    tables.map(async (table) => {
      const { error, count } = await database()
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('school_id', tenant)
        .eq('archived', false);
      if (error) throw new Error('School totals could not be loaded.');
      return count ?? 0;
    }),
  );
  return { students: results[0], staff: results[1], classes: results[2] };
}
