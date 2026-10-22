export interface Band {
  min: number;
  label: string;
}
export interface SubjectGrade {
  id: string;
  name: string;
  admission_number: string;
  incomplete: boolean;
  denominator: number;
  percent: number | null;
  grade: string;
}
export interface GradingRules {
  id: string;
  school_id: string;
  version: number;
  bands: Band[];
  pass_percent: number;
  assessment_types: string[];
  term_weights: Record<string, number>;
}
export interface Assessment {
  id: string;
  school_id: string;
  class_subject_id: string;
  term_id: string;
  name: string;
  assessment_type: string;
  assessed_on: string;
  max_mark: number;
  weight: number;
  archived: boolean;
  version: number;
}
export interface MarkEntry {
  id: string;
  name: string;
  admission_number: string;
  mark: number | null;
  status: 'MARKED' | 'ABSENT' | 'EXEMPT' | 'INCOMPLETE' | null;
  comment: string;
  version: number;
}
export interface Gradebook {
  assessment: Assessment;
  learners: MarkEntry[];
}
export interface SubjectResult {
  id: string;
  name: string;
  code: string;
  weight: number;
  percent: number | null;
  grade: string;
  passed: boolean | null;
  comment: string;
  assessments: {
    name: string;
    type: string;
    date: string;
    mark: number | null;
    max_mark: number;
    weight: number;
    status: string;
    percent: number | null;
  }[];
}
export interface ReportDocument {
  student_id: string;
  student_name: string;
  admission_number: string;
  school_name: string;
  school_address: string | null;
  school_color: string;
  class_name: string;
  grade_name: string;
  year_name: string;
  year_id: string;
  term_name: string;
  term_id: string;
  subjects: SubjectResult[];
  average: number;
  pass_percent: number;
  principal_comment: string;
  promotion_status: string;
  attendance: null;
  annual?: boolean;
}
export interface PublishedReport {
  id: string;
  publication_id: string;
  student_id: string;
  created_at: string;
  document: ReportDocument;
  publication: {
    id: string;
    active: boolean;
    version: number;
    class_id: string;
    term_id: string;
    rules: GradingRules;
  };
}
