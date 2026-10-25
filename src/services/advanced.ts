import { database } from '../lib/supabase';
import type { DataJob } from '../types/advanced';
const safe = new Set([
  'Not authorized',
  'Supply a list of learners',
  'Use 1 to 500 learners per import',
  'Finish or discard an existing data job first',
  'Export supports up to 10000 learners',
  'Data job expired or unavailable',
  'Import changed; preview the file again',
  'Choose a date range of at most ten years',
  'Choose a smaller calendar range',
  'Choose a smaller report range',
  'Record changed; reload before saving',
  'Request key already used for different details',
  'Close open loans before archiving this book',
]);
export async function advancedCall<T>(
  action: 'read' | 'write',
  tenant: string,
  request: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await database().rpc(`advanced_${action}`, { tenant, request });
  if (error)
    throw new Error(
      safe.has(error.message)
        ? error.message
        : 'Request not completed. Check your connection and access, then try again.',
    );
  return data as T;
}
export async function exportLearners(tenant: string) {
  const job = await advancedCall<DataJob>('write', tenant, { op: 'start_export' });
  const rows: Record<string, unknown>[] = [];
  try {
    for (let page = 0; page < Math.max(1, Math.ceil(job.count / 250)); page++) {
      const part = await advancedCall<{ rows: Record<string, unknown>[]; count: number }>(
        'read',
        tenant,
        { op: 'export_page', id: job.id, page },
      );
      rows.push(...part.rows);
    }
    if (rows.length !== job.count)
      throw new Error('Export was interrupted. Please start a new export.');
    return rows;
  } finally {
    await advancedCall('write', tenant, { op: 'discard_job', id: job.id }).catch(() => {});
  }
}
export async function platformCall<T>(request: Record<string, unknown>): Promise<T> {
  const { data, error } = await database().rpc('platform_read', { request });
  if (error) throw new Error('Platform operator access is required.');
  return data as T;
}
