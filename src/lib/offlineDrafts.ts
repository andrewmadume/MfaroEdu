import { z } from 'zod';
import type { BookDraft } from '../types/advanced';
const uuid = z.string().uuid();
export const draftSchema = z
  .object({
    schema: z.literal(1),
    id: uuid,
    user: uuid,
    tenant: uuid,
    school_name: z.string().min(1).max(120),
    saved_at: z.string().datetime(),
    request_key: uuid,
    attempted: z.boolean(),
    book: z
      .object({
        id: uuid.optional(),
        version: z.number().int().min(0),
        title: z.string().trim().min(1).max(200),
        author: z.string().trim().min(1).max(160),
        isbn: z.string().max(32),
        category: z.string().max(100),
        publisher: z.string().max(160),
        archived: z.boolean(),
      })
      .strict(),
  })
  .strict();
async function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('mfaroedu-catalogue-drafts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('Offline storage is unavailable in this browser.'));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const req = run(tx.objectStore('drafts'));
    let value: T;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = () => {
      db.close();
      reject(new Error('Could not save the offline draft.'));
    };
    tx.onabort = tx.onerror;
  });
}
export async function listDrafts(user: string): Promise<BookDraft[]> {
  const rows = await transaction<unknown[]>('readonly', (s) => s.getAll());
  return rows
    .map((r) => draftSchema.safeParse(r))
    .filter((r) => r.success && r.data.user === user)
    .map((r) => (r as { success: true; data: BookDraft }).data)
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}
export async function saveDraft(draft: BookDraft) {
  const parsed = validateDraft(draft);
  const drafts = await listDrafts(parsed.user);
  if (drafts.length >= 100 && !drafts.some((d) => d.id === parsed.id))
    throw new Error('Remove an old draft before creating another.');
  await transaction('readwrite', (s) => s.put(parsed));
}
export async function removeDraft(id: string) {
  await transaction('readwrite', (s) => s.delete(id));
}
export async function clearDrafts() {
  await transaction('readwrite', (s) => s.clear());
}
export function validateDraft(input: unknown): BookDraft {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      'Complete the book title and author, check field lengths, and open the draft from your school workspace.',
    );
  return parsed.data;
}
