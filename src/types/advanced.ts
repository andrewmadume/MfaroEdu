export interface ImportRow {
  admission_number: string;
  first_name: string;
  surname: string;
  date_of_birth: string;
  admission_date: string;
}
export interface DataJob {
  id?: string;
  count: number;
  expires_at?: string;
  errors: { row: number; message: string }[];
}
export interface Analytics {
  schema_version: number;
  generated_at: string;
  from: string;
  to: string;
  learners: number;
  teachers: number;
  classes: number;
  currency: string;
  academics: {
    year_name: string;
    grade_name: string;
    term_name: string;
    class_name: string;
    reports: number;
    average: number;
    passed: number;
  }[];
  finance: null | { balance_minor: string; monthly: { month: string; net_minor: string }[] };
  library: null | { open_loans: number; overdue_now: number; issued_in_range: number };
  limitations: string[];
}
export interface CalendarTerm {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  version: number;
}
export interface BookDraft {
  schema: 1;
  id: string;
  user: string;
  tenant: string;
  school_name: string;
  saved_at: string;
  request_key: string;
  attempted: boolean;
  book: {
    id?: string;
    version: number;
    title: string;
    author: string;
    isbn: string;
    category: string;
    publisher: string;
    archived: boolean;
  };
}
export interface PlatformSchool {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_code: string;
  learners: number;
  administrators: number;
}
