import { database } from '../lib/supabase';
import { validateAttachment } from '../lib/community';

const messages = new Set([
  'Not authorized',
  'Invitation expired or unavailable',
  'Sign in with the verified invited email',
  'Check invitation email and role',
  'Daily invitation limit reached',
  'Choose an active class',
  'Record changed; reload before saving',
  'Document request changed',
  'Finish or archive pending uploads first',
  'Upload incomplete; retry the original file',
  'Data job expired or unavailable',
  'Import changed; preview the file again',
  'Use 1 to 500 records per import',
  'Finish or discard an existing data job first',
  'Export too large; narrow the school data',
]);
export async function schoolCall<T>(
  tenant: string | null,
  request: Record<string, unknown>,
  data = false,
): Promise<T> {
  const { data: result, error } = await database().rpc(data ? 'school_data' : 'school_tools', {
    tenant,
    request,
  });
  if (error)
    throw new Error(
      messages.has(error.message)
        ? error.message
        : 'The request could not be completed. Check your input, connection and access, then reload.',
    );
  return result as T;
}
export interface SchoolEvent {
  id: string;
  title: string;
  description: string;
  category: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  class_id: string | null;
  roles: string[];
  archived: boolean;
  version: number;
}
export interface SchoolDocument {
  id: string;
  title: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  audience: string;
  student_id: string | null;
  staff_id: string | null;
  ready: boolean;
  archived: boolean;
  version: number;
}
export async function schoolList<T>(
  table: 'school_events' | 'school_documents',
  tenant: string,
  page: number,
  archived = false,
  search = '',
) {
  const { data, error, count } = await database()
    .from(table)
    .select('*', { count: 'exact' })
    .eq('school_id', tenant)
    .eq('archived', archived)
    .ilike('title', `%${search.replace(/[\\%_]/g, '\\$&')}%`)
    .order(table === 'school_events' ? 'starts_at' : 'created_at', {
      ascending: table === 'school_events',
    })
    .order('id')
    .range(page * 20, page * 20 + 19);
  if (error) throw new Error('Could not load these records. Check your connection and access.');
  return { rows: data as T[], count: count ?? 0 };
}
const docPath = (tenant: string, id: string) => `${tenant}/${id}/file`;
export async function uploadDocument(tenant: string, document: SchoolDocument, file: File) {
  validateAttachment(file);
  if (
    file.name !== document.filename ||
    file.size !== document.byte_size ||
    file.type !== document.mime_type
  )
    throw new Error(
      'Retry with the original file. Archive this pending entry to use a different file.',
    );
  const { error } = await database()
    .storage.from('mfaroedu-documents')
    .upload(docPath(tenant, document.id), file, {
      contentType: file.type,
      upsert: false,
      cacheControl: '0',
    });
  if (error && String((error as { statusCode?: string }).statusCode) !== '409')
    throw new Error('Upload interrupted. Reload and retry this pending upload.');
  return schoolCall<SchoolDocument>(tenant, {
    op: 'finish_document',
    id: document.id,
    version: document.version,
  });
}
export async function downloadDocument(tenant: string, document: SchoolDocument) {
  const { data, error } = await database()
    .storage.from('mfaroedu-documents')
    .download(docPath(tenant, document.id));
  if (error || !data) throw new Error('Document unavailable or your access has changed.');
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.filename;
  window.document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function archiveDocument(tenant: string, document: SchoolDocument) {
  await schoolCall(tenant, { op: 'archive_document', id: document.id, version: document.version });
  const { error } = await database()
    .storage.from('mfaroedu-documents')
    .remove([docPath(tenant, document.id)]);
  if (error)
    throw new Error(
      'Document access was revoked. Stored bytes could not be removed; retry cleanup from Archived.',
    );
}
