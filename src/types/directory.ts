export type EntityKey =
  | 'students'
  | 'parents'
  | 'staff'
  | 'academic_years'
  | 'terms'
  | 'grades'
  | 'classes'
  | 'subjects'
  | 'student_parents'
  | 'class_subjects'
  | 'teacher_assignments'
  | 'rooms'
  | 'time_slots';
export interface SchoolRecord {
  id: string;
  school_id: string;
  archived: boolean;
  version: number;
  created_at: string;
  [field: string]: unknown;
}
export interface FieldDefinition {
  key: string;
  label: string;
  kind?: 'text' | 'email' | 'date' | 'time' | 'number' | 'textarea' | 'select' | 'checkbox' | 'reference';
  required?: boolean;
  max?: number;
  min?: number;
  options?: string[];
  reference?: EntityKey;
  hint?: string;
  immutable?: boolean;
  filter?: Record<string, string | boolean>;
}
export interface EntityDefinition {
  title: string;
  singular: string;
  description: string;
  view: string;
  manage: string;
  fields: FieldDefinition[];
  columns: string[];
  select?: string;
}
