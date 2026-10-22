import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
// Explicit local-only guard. Supply the LOCAL service-role key through the process environment.
const url = process.env.SUPABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
  throw new Error('Demo seed is restricted to local Supabase.');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Supply a local SUPABASE_SERVICE_ROLE_KEY.');
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const schoolId = '10000000-0000-4000-8000-000000000001';
const demoAccounts = {};
for (const role of ['SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT', 'ACCOUNTANT', 'LIBRARIAN']) {
  const email = `demo.${role.toLowerCase()}@school.example`;
  const password = randomBytes(24).toString('base64url');
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Demo ${role.toLowerCase().replaceAll('_', ' ')}` },
  });
  if (error)
    throw new Error(
      `Could not create ${email}: ${error.message}. Seed expects a fresh local database.`,
    );
  const membership = await db
    .from('user_roles')
    .insert({ school_id: schoolId, user_id: data.user.id, role_id: role });
  if (membership.error) throw membership.error;
  demoAccounts[role] = { id: data.user.id, email, password };
  console.log(`DEVELOPMENT ONLY ${email}\nTemporary password: ${password}\n`);
}
// The same tenant-scoped API used by the UI creates the Phase 2 demonstration records.
const admin = demoAccounts.SCHOOL_ADMIN;
const auth = await db.auth.signInWithPassword({ email: admin.email, password: admin.password });
if (auth.error) throw auth.error;
async function add(table, values) {
  const result = await db
    .from(table)
    .insert({ school_id: schoolId, ...values })
    .select()
    .single();
  if (result.error) throw result.error;
  return result.data;
}
const year = new Date().getUTCFullYear();
const academic = await add('academic_years', {
  name: String(year),
  starts_on: `${year}-01-01`,
  ends_on: `${year}-12-31`,
});
const term = await add('terms', {
  name: 'Term 1 (demo)',
  academic_year_id: academic.id,
  starts_on: `${year}-01-01`,
  ends_on: `${year}-03-31`,
});
const grade = await add('grades', { name: 'Grade 7 (demo)', sort_order: 7 });
const classroom = await add('classes', {
  name: '7A (demo)',
  academic_year_id: academic.id,
  grade_id: grade.id,
  capacity: 30,
});
const subject = await add('subjects', { name: 'Mathematics (demo)', code: 'DEMO-MATH' });
const allocation = await add('class_subjects', {
  class_id: classroom.id,
  subject_id: subject.id,
  compulsory: true,
  weight: 1,
});
const teacher = await add('staff', {
  first_name: 'Demo',
  surname: 'Teacher',
  employee_number: 'DEMO-T001',
  position: 'Teacher',
  is_teacher: true,
  user_id: demoAccounts.TEACHER.id,
});
await add('teacher_assignments', { staff_id: teacher.id, class_subject_id: allocation.id });
const guardian = await add('parents', {
  first_name: 'Demo',
  surname: 'Guardian',
  user_id: demoAccounts.PARENT.id,
});
const learner = await add('students', {
  first_name: 'Demo',
  surname: 'Learner',
  admission_number: 'DEMO-L001',
  date_of_birth: `${year - 12}-01-01`,
  admission_date: `${year}-01-01`,
  user_id: demoAccounts.STUDENT.id,
});
await add('student_parents', {
  student_id: learner.id,
  parent_id: guardian.id,
  relationship: 'Guardian',
  is_primary: true,
});
const enrollment = await db.rpc('enroll_student', {
  tenant: schoolId,
  learner: learner.id,
  target_class: classroom.id,
  start_date: `${year}-01-01`,
});
if (enrollment.error) throw enrollment.error;
await add('grading_rules', {
  bands: [
    { min: 80, label: 'Demo distinction' },
    { min: 50, label: 'Demo achieved' },
    { min: 0, label: 'Demo developing' },
  ],
  pass_percent: 50,
  assessment_types: ['Demo test', 'Demo exam'],
  term_weights: { [term.id]: 1 },
});
const assessment = await add('assessments', {
  class_subject_id: allocation.id,
  term_id: term.id,
  name: 'Demo mathematics assessment',
  assessment_type: 'Demo test',
  assessed_on: `${year}-02-01`,
  max_mark: 20,
  weight: 1,
});
const marks = await db.rpc('save_assessment_marks', {
  tenant: schoolId,
  assessment_key: assessment.id,
  expected_assessment_version: 1,
  entries: [
    {
      id: learner.id,
      mark: 16,
      status: 'MARKED',
      comment: 'Demonstration record only.',
      version: 0,
    },
  ],
});
if (marks.error) throw marks.error;
await db.auth.signOut();
console.log(
  'Phase 2/3 development records created, with draft assessment marks. No real learner data was used.',
);
