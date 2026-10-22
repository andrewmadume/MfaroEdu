import type {
  EntityDefinition,
  EntityKey,
  FieldDefinition,
  SchoolRecord,
} from '../types/directory';
import {phase4Enabled} from './features';
const names: FieldDefinition[] = [
  { key: 'first_name', label: 'First name', required: true, max: 80 },
  { key: 'surname', label: 'Surname', required: true, max: 80 },
];
const contacts: FieldDefinition[] = [
  { key: 'email', label: 'Email', kind: 'email', max: 254 },
  { key: 'phone', label: 'Phone', max: 30 },
];
const account = (role: string): FieldDefinition => ({
  key: 'user_id',
  label: 'Linked account ID',
  hint: `Optional. Use an existing account UUID with the ${role} role in this school.`,
  max: 36,
});
const name: FieldDefinition = { key: 'name', label: 'Name', required: true, max: 120 };
const dates: FieldDefinition[] = [
  { key: 'starts_on', label: 'Starts on', kind: 'date', required: true },
  { key: 'ends_on', label: 'Ends on', kind: 'date', required: true },
];
const ref = (
  key: string,
  label: string,
  reference: EntityKey,
  filter?: Record<string, string | boolean>,
): FieldDefinition => ({
  key,
  label,
  reference,
  filter,
  kind: 'reference',
  required: true,
  immutable: true,
});
export const entities: Record<EntityKey, EntityDefinition> = {
  students: {
    title: 'Learners',
    singular: 'learner',
    description: 'Register learners, maintain their details and preserve their enrollment history.',
    view: 'students.view',
    manage: 'students.manage',
    columns: ['admission_number', 'first_name', 'surname', 'status'],
    fields: [
      { key: 'admission_number', label: 'Admission number', required: true, max: 40 },
      ...names,
      { key: 'middle_name', label: 'Middle name', max: 80 },
      { key: 'date_of_birth', label: 'Date of birth', kind: 'date', required: true },
      {
        key: 'gender',
        label: 'Gender',
        kind: 'select',
        options: ['NOT_SPECIFIED', 'FEMALE', 'MALE', 'OTHER'],
        required: true,
      },
      { key: 'admission_date', label: 'Admission date', kind: 'date', required: true },
      ...contacts,
      { key: 'address', label: 'Address', kind: 'textarea', max: 500 },
      { key: 'emergency_name', label: 'Emergency contact name', max: 160 },
      { key: 'emergency_phone', label: 'Emergency phone', max: 30 },
      {
        key: 'status',
        label: 'Enrollment status',
        kind: 'select',
        options: ['ACTIVE', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN'],
        required: true,
        hint: 'Close active enrollments before changing this status.',
      },
      account('STUDENT'),
    ],
  },
  parents: {
    title: 'Parents & guardians',
    singular: 'guardian',
    description:
      'Maintain guardian details. Link one guardian to each of their children from the learner profile.',
    view: 'parents.view',
    manage: 'parents.manage',
    columns: ['first_name', 'surname', 'email', 'phone'],
    fields: [
      ...names,
      ...contacts,
      { key: 'address', label: 'Address', kind: 'textarea', max: 500 },
      account('PARENT'),
    ],
  },
  staff: {
    title: 'Staff & teachers',
    singular: 'staff member',
    description: 'Maintain staff profiles and assign teachers to class subjects.',
    view: 'staff.view',
    manage: 'staff.manage',
    columns: ['employee_number', 'first_name', 'surname', 'position', 'is_teacher'],
    fields: [
      { key: 'employee_number', label: 'Employee number', required: true, max: 40 },
      ...names,
      ...contacts,
      { key: 'department', label: 'Department', max: 120 },
      { key: 'position', label: 'Position', required: true, max: 120 },
      { key: 'is_teacher', label: 'Teaching staff', kind: 'checkbox' },
      {
        key: 'employment_status',
        label: 'Employment status',
        kind: 'select',
        required: true,
        options: ['ACTIVE', 'ON_LEAVE', 'LEFT'],
      },
      account('TEACHER'),
    ],
  },
  academic_years: {
    title: 'Academic years',
    singular: 'academic year',
    description: 'Keep each year’s dates and records separate. Past years remain available.',
    view: 'academics.view',
    manage: 'academics.manage',
    columns: ['name', 'starts_on', 'ends_on'],
    fields: [name, ...dates],
  },
  terms: {
    title: 'Terms',
    singular: 'term',
    description: 'Organise non-overlapping terms within each academic year.',
    view: 'academics.view',
    manage: 'academics.manage',
    columns: ['name', 'year', 'starts_on', 'ends_on'],
    select: '*,year:academic_years(name)',
    fields: [name, ref('academic_year_id', 'Academic year', 'academic_years'), ...dates],
  },
  grades: {
    title: 'Grades',
    singular: 'grade',
    description: 'Configure grade names and their display order for your school.',
    view: 'academics.view',
    manage: 'academics.manage',
    columns: ['name', 'sort_order'],
    fields: [
      name,
      {
        key: 'sort_order',
        label: 'Display order',
        kind: 'number',
        required: true,
        min: 0,
        max: 100,
      },
    ],
  },
  classes: {
    title: 'Classes',
    singular: 'class',
    description: 'Create year-specific classes, then allocate subjects and enroll learners.',
    view: 'academics.view',
    manage: 'academics.manage',
    columns: ['name', 'year', 'grade', 'capacity'],
    select: '*,year:academic_years(name),grade:grades(name)',
    fields: [
      name,
      ref('academic_year_id', 'Academic year', 'academic_years'),
      ref('grade_id', 'Grade', 'grades'),
      {
        key: 'capacity',
        label: 'Maximum learners',
        kind: 'number',
        min: 1,
        max: 1000,
        hint: 'Optional. Enrollment stops when the class is full.',
      },
    ],
  },
  subjects: {
    title: 'Subjects',
    singular: 'subject',
    description: 'Define your school’s own subjects and codes.',
    view: 'academics.view',
    manage: 'academics.manage',
    columns: ['code', 'name', 'description'],
    fields: [
      name,
      { key: 'code', label: 'Subject code', required: true, max: 24 },
      { key: 'description', label: 'Description', kind: 'textarea', max: 1000 },
    ],
  },
  student_parents: {
    title: 'Guardian links',
    singular: 'guardian link',
    description:
      'Link a guardian to this learner. Archiving a link removes that guardian’s access to this child.',
    view: 'parents.view',
    manage: 'parents.manage',
    columns: ['parent', 'relationship', 'is_primary'],
    select: '*,parent:parents(first_name,surname)',
    fields: [
      ref('student_id', 'Learner', 'students'),
      ref('parent_id', 'Guardian', 'parents'),
      { key: 'relationship', label: 'Relationship', required: true, max: 60 },
      { key: 'is_primary', label: 'Primary guardian', kind: 'checkbox' },
    ],
  },
  class_subjects: {
    title: 'Class subjects',
    singular: 'class subject',
    description: 'Configure the subjects offered to this class.',
    view: 'academics.view',
    manage: 'academics.manage',
    columns: ['subject', 'compulsory', 'weight'],
    select:
      '*,subject:subjects(code,name),class:classes(name,academic_year_id,year:academic_years(name))',
    fields: [
      ref('class_id', 'Class', 'classes'),
      ref('subject_id', 'Subject', 'subjects'),
      { key: 'compulsory', label: 'Compulsory subject', kind: 'checkbox' },
      {
        key: 'weight',
        label: 'Subject weight',
        kind: 'number',
        required: true,
        min: 0.01,
        max: 1000,
      },
    ],
  },
  teacher_assignments: {
    title: 'Teaching assignments',
    singular: 'teaching assignment',
    description:
      'Assign this teacher to a class subject. Archive an assignment to revoke class access.',
    view: 'staff.view',
    manage: 'staff.manage',
    columns: ['allocation'],
    select:
      '*,allocation:class_subjects(subject:subjects(code,name),class:classes(name,year:academic_years(name)))',
    fields: [
      ref('staff_id', 'Teacher', 'staff', { is_teacher: true, employment_status: 'ACTIVE' }),
      ref('class_subject_id', 'Class subject', 'class_subjects'),
    ],
  },
  rooms: {
    title:'Rooms',singular:'room',description:'School rooms and their capacity.',view:'timetable.view',manage:'timetable.manage',columns:['code','name','capacity'],
    fields:[{key:'code',label:'Room code',required:true,max:24},name,{key:'capacity',label:'Room capacity',kind:'number',min:1,max:1000}],
  },
  time_slots: {
    title:'Time slots',singular:'time slot',description:'Named periods in the school’s local time. Overnight periods are not supported.',view:'timetable.view',manage:'timetable.manage',columns:['name','starts_at','ends_at'],
    fields:[name,{key:'starts_at',label:'Start time',kind:'time',required:true},{key:'ends_at',label:'End time',kind:'time',required:true}],
  },
};
export const directoryGroups = [
  { title: 'People', keys: ['students', 'parents', 'staff'] },
  {
    title: 'Academic structure',
    keys: ['academic_years', 'terms', 'grades', 'classes', 'subjects'],
  },
] as const;
export function isEntityKey(key: string): key is EntityKey {
  return Object.hasOwn(entities, key) && (phase4Enabled || !['rooms','time_slots'].includes(key));
}
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if (row.subject && row.class)
      return `${displayValue(row.class)} · ${displayValue(row.subject)}`;
    if (row.name)
      return `${row.code ? `${row.code} · ` : ''}${row.name}${row.year ? ` · ${displayValue(row.year)}` : ''}`;
    if (row.first_name) return `${row.first_name} ${row.surname ?? ''}`;
    return '—';
  }
  return String(value).replaceAll('_', ' ');
}
export function recordLabel(row: SchoolRecord): string {
  if (row.subject && row.class) return displayValue(row);
  return `${row.admission_number ? `${row.admission_number} · ` : row.employee_number ? `${row.employee_number} · ` : ''}${displayValue(row)}`;
}
