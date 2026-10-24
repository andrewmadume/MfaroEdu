import { database } from '../lib/supabase';
import { validateAttachment, validText } from '../lib/community';
import type { Announcement, AnnouncementFile } from '../types/community';
export type CommunityModule = 'communication' | 'library';
export type ModuleRequest = Record<string, unknown>;
const allowed = new Set([
  'Not authorized',
  'A request key is required',
  'Request key already used for different details',
  'Record changed; reload before saving',
  'Only assigned classes may be announced',
  'Select an active class',
  'Only the current draft may be edited',
  'Only drafts may be published',
  'Finish or remove pending attachments before publishing',
  'Announcement is already withdrawn',
  'Attachments can only change on a draft',
  'Use at most five attachments',
  'Attachment unavailable',
  'Attachment upload is incomplete',
  'Remove the stored file first',
  'Messaging is not enabled for this recipient',
  'Notification unavailable',
  'Announcement unavailable',
  'Conversation unavailable',
  'Close open loans before archiving this book',
  'Select an active book',
  'A copy cannot move to another book',
  'Return the borrowed copy before changing it',
  'Select an available copy and active learner',
  'This copy is already on loan',
  'Learner borrowing limit reached',
  'Invalid issue or due date',
  'Issue date overlaps the copy borrowing history',
  'This loan is already closed',
  'Closing date cannot precede the latest loan activity or exceed today',
  'Renewal limit reached',
  'Renewal must extend the due date by at most one year',
  'Record a return or loss note',
  'Book unavailable',
  'Borrowing record unavailable',
]);
export async function moduleCall<T>(
  module: CommunityModule,
  action: 'read' | 'write',
  tenant: string,
  request: ModuleRequest,
): Promise<T> {
  const { data, error } = await database().rpc(`${module}_${action}`, { tenant, request });
  if (error)
    throw new Error(
      allowed.has(error.message)
        ? error.message + '.'
        : error.code === '23505'
          ? 'These details already exist. Reload and review the current record.'
          : 'The request was not completed. Check your connection and access, then reload and try again.',
    );
  return data as T;
}
export interface MessageDelivery {
  recipient_id: string;
  body: string;
  request_key: string;
}
// External transports must run on a trusted server and enforce the same recipient rules.
// Only the transactional in-app transport is registered. No external delivery is claimed.
export interface CommunicationTransport {
  channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';
  send(tenant: string, message: MessageDelivery): Promise<{ id: string; message_id: string }>;
}
export const inAppTransport: CommunicationTransport = {
  channel: 'IN_APP',
  send: (tenant, message) =>
    moduleCall('communication', 'write', tenant, {
      op: 'message',
      ...message,
      body: validText(message.body, 5000),
    }),
};
export const attachmentPath = (tenant: string, id: string) => `${tenant}/${id}/file`;
export async function finishAttachment(tenant: string, announcementId: string, fileId: string) {
  const current = await moduleCall<Announcement>('communication', 'read', tenant, {
    op: 'announcement',
    id: announcementId,
  });
  return moduleCall('communication', 'write', tenant, {
    op: 'finish_file',
    id: announcementId,
    version: current.version,
    file_id: fileId,
    request_key: crypto.randomUUID(),
  });
}
export async function uploadAttachment(
  tenant: string,
  announcement: Announcement,
  file: File,
  existing?: AnnouncementFile,
) {
  validateAttachment(file);
  if (
    existing &&
    (existing.filename !== file.name ||
      existing.byte_size !== file.size ||
      existing.mime_type !== file.type)
  )
    throw new Error(
      'Choose the original file, or remove this pending attachment and upload a new one.',
    );
  const fileId = existing?.id ?? crypto.randomUUID();
  if (!existing)
    await moduleCall('communication', 'write', tenant, {
      op: 'reserve_file',
      id: announcement.id,
      version: announcement.version,
      filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
      request_key: fileId,
    });
  const { error } = await database()
    .storage.from('mfaroedu-communications')
    .upload(attachmentPath(tenant, fileId), file, {
      contentType: file.type,
      upsert: false,
      cacheControl: '0',
    });
  if (error && String((error as { statusCode?: string }).statusCode) !== '409')
    throw new Error(
      'Upload did not finish. Reload the draft and retry or remove the pending attachment.',
    );
  await finishAttachment(tenant, announcement.id, fileId);
}
export async function removeAttachment(
  tenant: string,
  announcementId: string,
  file: AnnouncementFile,
) {
  const { error } = await database()
    .storage.from('mfaroedu-communications')
    .remove([attachmentPath(tenant, file.id)]);
  if (error) throw new Error('The stored file could not be removed. Reload and try again.');
  const current = await moduleCall<Announcement>('communication', 'read', tenant, {
    op: 'announcement',
    id: announcementId,
  });
  await moduleCall('communication', 'write', tenant, {
    op: 'remove_file',
    id: announcementId,
    version: current.version,
    file_id: file.id,
    request_key: crypto.randomUUID(),
  });
}
export async function downloadAttachment(tenant: string, file: AnnouncementFile) {
  const { data, error } = await database()
    .storage.from('mfaroedu-communications')
    .download(attachmentPath(tenant, file.id));
  if (error || !data) throw new Error('This attachment is unavailable or your access has changed.');
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' })),
    link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
