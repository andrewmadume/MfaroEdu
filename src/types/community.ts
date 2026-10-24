export interface PageResult<T> {
  rows: T[];
  count: number;
}
export interface CommSettings {
  id?: string;
  version: number;
  family_messages_enabled: boolean;
}
export interface CommSetup {
  settings: CommSettings | null;
  classes: { id: string; name: string }[];
}
export interface Announcement {
  id: string;
  school_id: string;
  author_id: string;
  author_name: string;
  title: string;
  body: string;
  scope: string;
  class_id: string | null;
  class_name?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
  version: number;
  created_at: string;
  published_at: string | null;
  can_edit?: boolean;
  files?: AnnouncementFile[];
}
export interface AnnouncementFile {
  id: string;
  announcement_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  ready: boolean;
  version: number;
}
export interface Recipient {
  id: string;
  name: string;
  roles: string;
}
export interface Thread {
  id: string;
  recipient_id: string;
  recipient_name: string;
  preview: string;
  last_message_at: string;
}
export interface Message {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}
export interface Conversation extends PageResult<Message> {
  recipient_id: string;
  recipient_name: string;
  can_reply: boolean;
}
export interface Notification {
  id: string;
  kind: 'ANNOUNCEMENT' | 'MESSAGE';
  title: string;
  target_id: string;
  read_at: string | null;
  created_at: string;
}
export interface NoticePage extends PageResult<Notification> {
  unread: number;
}
export interface LibrarySettings {
  id?: string;
  version: number;
  loan_days: number;
  max_books: number;
  max_renewals: number;
}
export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  category: string | null;
  publisher: string | null;
  archived: boolean;
  version: number;
  copies: number;
  available: number;
}
export interface BookCopy {
  id: string;
  book_id: string;
  accession_number: string;
  location: string | null;
  condition: string;
  status: string;
  version: number;
  on_loan: boolean;
}
export interface LibraryLearner {
  id: string;
  name: string;
  admission_number: string;
}
export interface Loan {
  id: string;
  copy_id: string;
  student_id: string;
  issued_on: string;
  due_on: string;
  closed_on: string | null;
  close_kind: string | null;
  renewals: number;
  version: number;
  overdue: boolean;
  document: {
    title: string;
    author: string;
    accession_number: string;
    learner: string;
    admission_number: string;
  };
  events?: {
    id: string;
    kind: string;
    happened_on: string;
    details: { due_on?: string; condition?: string; note?: string };
  }[];
}
export interface LibraryReport {
  as_at: string;
  titles: number;
  copies: number;
  available: number;
  on_loan: number;
  overdue: number;
  lost: number;
  damaged: number;
}
