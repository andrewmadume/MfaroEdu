import { storageShim } from './storage-test-shim.mjs';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0;
const users = Object.fromEntries(
  ['admin', 'teacher', 'unassigned', 'parent', 'student', 'stranger', 'outsider'].map((n) => [
    n,
    randomUUID(),
  ]),
);
async function as(n) {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${users[n]}',false);set role authenticated;`,
  );
}
async function create(table, values) {
  const keys = Object.keys(values);
  return (
    await db.query(
      `insert into public.${table}(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
      Object.values(values),
    )
  ).rows[0];
}
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
async function denied(sql, args = []) {
  await assert.rejects(() => db.query(sql, args));
}
async function rpc(name, args) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`,
      args,
    )
  ).rows[0].value;
}
try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(storageShim);
  for (const file of (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  for (const id of Object.values(users))
    await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [id]);
  await as('admin');
  const tenant = await rpc('create_school', ['Academic school', 'phase-three']);
  for (const [name, role] of Object.entries({
    teacher: 'TEACHER',
    unassigned: 'TEACHER',
    parent: 'PARENT',
    student: 'STUDENT',
    stranger: 'PARENT',
  }))
    await rpc('set_membership', [tenant, users[name], role, true]);
  const year = Number((await db.query('select extract(year from current_date) y')).rows[0].y);
  const academic = await create('academic_years', {
    school_id: tenant,
    name: String(year),
    starts_on: `${year}-01-01`,
    ends_on: `${year}-12-31`,
  });
  const grade = await create('grades', { school_id: tenant, name: 'Grade 7' });
  const klass = await create('classes', {
    school_id: tenant,
    name: '7A',
    academic_year_id: academic.id,
    grade_id: grade.id,
  });
  const term1 = await create('terms', {
    school_id: tenant,
    name: 'Term 1',
    academic_year_id: academic.id,
    starts_on: `${year}-01-01`,
    ends_on: `${year}-03-31`,
  });
  const term2 = await create('terms', {
    school_id: tenant,
    name: 'Term 2',
    academic_year_id: academic.id,
    starts_on: `${year}-04-01`,
    ends_on: `${year}-12-31`,
  });
  const subject = await create('subjects', {
    school_id: tenant,
    name: 'Mathematics',
    code: 'MATH',
  });
  const allocation = await create('class_subjects', {
    school_id: tenant,
    class_id: klass.id,
    subject_id: subject.id,
    weight: 2,
  });
  const secondSubject = await create('subjects', {
    school_id: tenant,
    name: 'English',
    code: 'ENG',
  });
  const secondAllocation = await create('class_subjects', {
    school_id: tenant,
    class_id: klass.id,
    subject_id: secondSubject.id,
  });
  const teacher = await create('staff', {
    school_id: tenant,
    first_name: 'Assigned',
    surname: 'Teacher',
    employee_number: 'T1',
    position: 'Teacher',
    is_teacher: true,
    user_id: users.teacher,
  });
  const assignment = await create('teacher_assignments', {
    school_id: tenant,
    staff_id: teacher.id,
    class_subject_id: allocation.id,
  });
  const learner = await create('students', {
    school_id: tenant,
    admission_number: 'S1',
    first_name: 'Test',
    surname: 'Learner',
    date_of_birth: `${year - 12}-01-01`,
    admission_date: `${year}-01-01`,
    user_id: users.student,
  });
  const sibling = await create('students', {
    school_id: tenant,
    admission_number: 'S2',
    first_name: 'Other',
    surname: 'Learner',
    date_of_birth: `${year - 12}-01-01`,
    admission_date: `${year}-01-01`,
  });
  const parent = await create('parents', {
    school_id: tenant,
    first_name: 'Test',
    surname: 'Guardian',
    user_id: users.parent,
  });
  const link = await create('student_parents', {
    school_id: tenant,
    student_id: learner.id,
    parent_id: parent.id,
    relationship: 'Guardian',
  });
  const enrollment = await rpc('enroll_student', [tenant, learner.id, klass.id, `${year}-01-01`]);
  await rpc('enroll_student', [tenant, sibling.id, klass.id, `${year}-01-01`]);
  await check('empty and overlapping grading bands rejected', async () => {
    await denied(
      'insert into public.grading_rules(school_id,bands,pass_percent,assessment_types) values($1,$2,50,$3)',
      [
        tenant,
        JSON.stringify([
          { min: 0, label: 'Low' },
          { min: 50, label: 'High' },
        ]),
        JSON.stringify(['Test']),
      ],
    );
    await denied(
      'insert into public.grading_rules(school_id,bands,pass_percent,assessment_types) values($1,$2,50,$3)',
      [tenant, '[]', '["Test"]'],
    );
  });
  const rules = await create('grading_rules', {
    school_id: tenant,
    bands: JSON.stringify([
      { min: 80, label: 'Excellent' },
      { min: 50, label: 'Achieved' },
      { min: 0, label: 'Developing' },
    ]),
    pass_percent: 50,
    assessment_types: '["Test","Exam"]',
    term_weights: JSON.stringify({ [term1.id]: 1, [term2.id]: 3 }),
  });
  const values = {
    school_id: tenant,
    class_subject_id: allocation.id,
    term_id: term1.id,
    assessment_type: 'Test',
    assessed_on: `${year}-02-01`,
    max_mark: 20,
    weight: 1,
  };
  await check('assessment date must belong to its term', () =>
    denied(
      'insert into public.assessments(school_id,class_subject_id,term_id,name,assessment_type,assessed_on,max_mark,weight) values($1,$2,$3,$4,$5,$6,20,1)',
      [tenant, allocation.id, term1.id, 'Wrong date', 'Test', `${year}-04-01`],
    ),
  );
  await check('unconfigured assessment types rejected', () =>
    denied(
      'insert into public.assessments(school_id,class_subject_id,term_id,name,assessment_type,assessed_on,max_mark,weight) values($1,$2,$3,$4,$5,$6,20,1)',
      [tenant, allocation.id, term1.id, 'Unknown', 'Unconfigured', `${year}-02-01`],
    ),
  );
  await as('teacher');
  const test = await create('assessments', { ...values, name: 'Test' });
  await check('assigned teacher can create and load own subject gradebook', async () =>
    assert.equal((await rpc('assessment_gradebook', [tenant, test.id])).learners.length, 2),
  );
  await check('teacher cannot capture another subject in the same class', () =>
    denied(
      'insert into public.assessments(school_id,class_subject_id,term_id,name,assessment_type,assessed_on,max_mark,weight) values($1,$2,$3,$4,$5,$6,20,1)',
      [tenant, secondAllocation.id, term1.id, 'English', 'Test', `${year}-02-01`],
    ),
  );
  await check('markable subject lookup hides unassigned subjects', async () =>
    assert.equal(
      (await db.query('select * from public.search_markable_subjects($1)', [tenant])).rows.length,
      1,
    ),
  );
  await check('teacher cannot read another subject draft totals', () =>
    assert.rejects(() => rpc('subject_gradebook', [tenant, secondAllocation.id, term1.id])),
  );
  const entry = (student, mark, version = 0, status = 'MARKED') => ({
    id: student.id,
    mark,
    status,
    version,
    comment: 'Good progress',
  });
  const save = (a, entries) =>
    rpc('save_assessment_marks', [tenant, a.id, a.version, JSON.stringify(entries)]);
  await check('marks above maximum rejected', () =>
    assert.rejects(() => save(test, [entry(learner, 21)])),
  );
  await check('marks below zero rejected', () =>
    assert.rejects(() => save(test, [entry(learner, -1)])),
  );
  await save(test, [entry(learner, 10), entry(sibling, null, 0, 'ABSENT')]);
  await check('duplicate learner writes rejected', () =>
    assert.rejects(() => save(test, [entry(learner, 12, 1), entry(learner, 13, 1)])),
  );
  await check('stale marks rejected atomically across the batch', async () => {
    await assert.rejects(() => save(test, [entry(learner, 15, 1), entry(sibling, 12, 0)]));
    assert.equal(
      (await rpc('assessment_gradebook', [tenant, test.id])).learners.find(
        (s) => s.id === learner.id,
      ).mark,
      10,
    );
  });
  await check('direct mark writes are denied', () =>
    denied('update public.assessment_marks set mark=20,version=version+1'),
  );
  await check('teacher cannot configure school grading rules', async () =>
    assert.equal(
      (
        await db.query(
          'update public.grading_rules set pass_percent=1,version=version+1 returning id',
        )
      ).rows.length,
      0,
    ),
  );
  await as('unassigned');
  await check('unassigned teacher cannot read or mutate gradebook', async () => {
    assert.equal((await db.query('select * from public.assessments')).rows.length, 0);
    await assert.rejects(() => rpc('assessment_gradebook', [tenant, test.id]));
    await assert.rejects(() => save(test, [entry(learner, 20, 1)]));
    await assert.rejects(() => rpc('subject_gradebook', [tenant, allocation.id, term1.id]));
  });
  await as('parent');
  await check('families cannot read unpublished assessments or marks', async () => {
    assert.equal((await db.query('select * from public.assessments')).rows.length, 0);
    assert.equal((await db.query('select * from public.assessment_marks')).rows.length, 0);
    await assert.rejects(() => rpc('assessment_gradebook', [tenant, test.id]));
    await assert.rejects(() => rpc('subject_gradebook', [tenant, allocation.id, term1.id]));
  });
  await as('admin');
  await check('subjects without assessments prevent publication', () =>
    assert.rejects(() => rpc('preview_term_results', [tenant, klass.id, term1.id])),
  );
  const english = await create('assessments', {
    ...values,
    class_subject_id: secondAllocation.id,
    name: 'English test',
    max_mark: 100,
  });
  await check('incomplete assessment marks prevent publication', () =>
    assert.rejects(() => rpc('preview_term_results', [tenant, klass.id, term1.id])),
  );
  await check('missing marks produce an incomplete subject total', async () =>
    assert.equal(
      (await rpc('subject_gradebook', [tenant, secondAllocation.id, term1.id]))[0].incomplete,
      true,
    ),
  );
  await save(english, [entry(learner, 100), entry(sibling, null, 0, 'EXEMPT')]);
  const exam = await create('assessments', {
    ...values,
    name: 'Exam',
    assessment_type: 'Exam',
    max_mark: 100,
    weight: 3,
  });
  await save(exam, [entry(learner, 90), entry(sibling, null, 0, 'EXEMPT')]);
  await rpc('save_report_note', [
    tenant,
    klass.id,
    term1.id,
    learner.id,
    0,
    'Keep up the effort',
    'Progressing',
  ]);
  let docs = await rpc('preview_term_results', [tenant, klass.id, term1.id]);
  await check('normalized assessment and subject weights produce correct results', async () => {
    const d = docs.find((d) => d.student_id === learner.id);
    assert.equal(d.subjects.find((s) => s.code === 'MATH').percent, 80);
    assert.equal(d.average, 86.67);
    assert.equal(d.subjects.find((s) => s.code === 'MATH').grade, 'Excellent');
    assert.equal(d.principal_comment, 'Keep up the effort');
  });
  await check(
    'draft subject totals use the same normalized calculation as publication',
    async () => {
      const summary = await rpc('subject_gradebook', [tenant, allocation.id, term1.id]);
      assert.equal(summary.find((s) => s.id === learner.id).percent, 80);
      assert.equal(summary.find((s) => s.id === learner.id).denominator, 4);
      assert.equal(summary.find((s) => s.id === sibling.id).percent, 0);
    },
  );
  await check('absence counts as zero and exemptions leave denominator', async () =>
    assert.equal(docs.find((d) => d.student_id === sibling.id).average, 0),
  );
  await check('changing term dates cannot orphan assessments', () =>
    denied('update public.terms set starts_on=$1,version=version+1 where id=$2', [
      `${year}-03-01`,
      term1.id,
    ]),
  );
  await check('closing enrollment cannot remove authorization of captured historical marks', () =>
    assert.rejects(() =>
      rpc('close_enrollment', [tenant, enrollment, 1, `${year}-01-31`, 'TRANSFERRED']),
    ),
  );
  await check('maximum cannot be reduced below captured scores', () =>
    denied('update public.assessments set max_mark=5,version=version+1 where id=$1', [test.id]),
  );
  await save(test, [entry(learner, 12, 1)]);
  await check('a stale publication preview is rejected', () =>
    assert.rejects(() =>
      rpc('publish_term_results', [tenant, klass.id, term1.id, JSON.stringify(docs)]),
    ),
  );
  docs = await rpc('preview_term_results', [tenant, klass.id, term1.id]);
  const publication = await rpc('publish_term_results', [
    tenant,
    klass.id,
    term1.id,
    JSON.stringify(docs),
  ]);
  await check('published reports are immutable to authenticated clients', async () => {
    await denied("update public.published_reports set document='{}'");
    await denied('delete from public.published_reports');
  });
  await as('parent');
  await check('parent sees only their linked child report', async () =>
    assert.equal((await db.query('select * from public.published_reports')).rows.length, 1),
  );
  await check('families cannot publish or inspect private result previews', async () => {
    await assert.rejects(() => rpc('preview_term_results', [tenant, klass.id, term1.id]));
    await assert.rejects(() =>
      rpc('publish_term_results', [tenant, klass.id, term1.id, JSON.stringify(docs)]),
    );
  });
  await as('student');
  await check('learner sees own published result only', async () =>
    assert.equal((await db.query('select * from public.published_reports')).rows.length, 1),
  );
  await as('stranger');
  await check('unlinked parent sees no reports', async () =>
    assert.equal((await db.query('select * from public.published_reports')).rows.length, 0),
  );
  await as('outsider');
  const other = await rpc('create_school', ['Other school', 'phase-three-other']);
  await check('cross-school reports and gradebooks stay private', async () => {
    assert.equal((await db.query('select * from public.published_reports')).rows.length, 0);
    await assert.rejects(() => rpc('assessment_gradebook', [tenant, test.id]));
  });
  await as('admin');
  const before = (
    await db.query(
      'select document from public.published_reports where publication_id=$1 and student_id=$2',
      [publication, learner.id],
    )
  ).rows[0].document;
  await save(test, [entry(learner, 20, 2)]);
  await db.query('update public.grading_rules set bands=$1,version=version+1 where id=$2', [
    JSON.stringify([{ min: 0, label: 'Revised' }]),
    rules.id,
  ]);
  await check('published snapshot survives changes to draft marks and grading rules', async () =>
    assert.deepEqual(
      (
        await db.query(
          'select document from public.published_reports where publication_id=$1 and student_id=$2',
          [publication, learner.id],
        )
      ).rows[0].document,
      before,
    ),
  );
  await as('parent');
  await check('annual report blocked until every weighted term is published', () =>
    assert.rejects(() => rpc('annual_results', [tenant, academic.id, learner.id])),
  );
  await as('admin');
  const t2math = await create('assessments', {
    ...values,
    term_id: term2.id,
    name: 'Term 2 math',
    assessed_on: `${year}-05-01`,
    max_mark: 100,
  });
  const t2eng = await create('assessments', {
    ...values,
    class_subject_id: secondAllocation.id,
    term_id: term2.id,
    name: 'Term 2 English',
    assessed_on: `${year}-05-01`,
    max_mark: 100,
  });
  await save(t2math, [entry(learner, 40), entry(sibling, 30)]);
  await save(t2eng, [entry(learner, 60), entry(sibling, 40)]);
  const t2docs = await rpc('preview_term_results', [tenant, klass.id, term2.id]);
  await rpc('publish_term_results', [tenant, klass.id, term2.id, JSON.stringify(t2docs)]);
  await as('parent');
  await check('annual report respects configured term weighting and learner access', async () => {
    const annual = await rpc('annual_results', [tenant, academic.id, learner.id]);
    assert.equal(annual.subjects.find((s) => s.code === 'MATH').percent, 50.63);
    await assert.rejects(() => rpc('annual_results', [tenant, academic.id, sibling.id]));
  });
  await as('admin');
  await rpc('withdraw_term_results', [tenant, publication, 1]);
  await as('parent');
  await check('withdrawal hides the entire release from families', async () =>
    assert.equal(
      (
        await db.query('select * from public.published_reports where publication_id=$1', [
          publication,
        ])
      ).rows.length,
      0,
    ),
  );
  await as('admin');
  await check('withdrawn history remains available to school publishers', async () =>
    assert.equal(
      (
        await db.query('select * from public.published_reports where publication_id=$1', [
          publication,
        ])
      ).rows.length,
      2,
    ),
  );
  const revised = await rpc('preview_term_results', [tenant, klass.id, term1.id]);
  const newPub = await rpc('publish_term_results', [
    tenant,
    klass.id,
    term1.id,
    JSON.stringify(revised),
  ]);
  await check('republication creates a new snapshot rather than modifying history', async () => {
    assert.notEqual(newPub, publication);
    assert.equal(
      (
        await db.query('select count(*) count from public.published_reports where student_id=$1', [
          learner.id,
        ])
      ).rows[0].count,
      3,
    );
  });
  await check('draft marks can be reset to incomplete without deleting history', async () => {
    await save(test, [entry(learner, null, 3, 'INCOMPLETE')]);
    const row = (await rpc('assessment_gradebook', [tenant, test.id])).learners.find(
      (s) => s.id === learner.id,
    );
    assert.equal(row.mark, null);
    assert.equal(row.status, 'INCOMPLETE');
    assert.equal(row.version, 4);
  });
  await check('reset marks invalidate draft totals and block publication', async () => {
    const row = (await rpc('subject_gradebook', [tenant, allocation.id, term1.id])).find(
      (s) => s.id === learner.id,
    );
    assert.equal(row.incomplete, true);
    assert.equal(row.percent, null);
    await assert.rejects(() => rpc('preview_term_results', [tenant, klass.id, term1.id]));
  });
  await check('resetting draft marks leaves published family reports unchanged', async () => {
    await as('parent');
    assert.deepEqual(
      (
        await db.query('select document from public.published_reports where publication_id=$1', [
          newPub,
        ])
      ).rows[0].document,
      revised.find((r) => r.student_id === learner.id),
    );
    await as('admin');
  });
  await check('stale resets are rejected and incomplete marks can be recaptured', async () => {
    await assert.rejects(() => save(test, [entry(learner, null, 3, 'INCOMPLETE')]));
    await save(test, [entry(learner, 20, 4)]);
    assert.equal(
      (await rpc('subject_gradebook', [tenant, allocation.id, term1.id])).find(
        (s) => s.id === learner.id,
      ).percent,
      92.5,
    );
  });
  await db.query('update public.student_parents set archived=true,version=version+1 where id=$1', [
    link.id,
  ]);
  await as('parent');
  await check('revoking guardian linkage removes report access immediately', async () =>
    assert.equal((await db.query('select * from public.published_reports')).rows.length, 0),
  );
  await as('admin');
  await db.query(
    'update public.teacher_assignments set archived=true,version=version+1 where id=$1',
    [assignment.id],
  );
  await as('teacher');
  await check('revoking subject assignment removes marking access', () =>
    assert.rejects(() => save(test, [entry(learner, 20, 3)])),
  );
  await db.exec('reset role;set role anon;');
  await check('anonymous users cannot execute academic RPCs', () =>
    assert.rejects(() => rpc('assessment_gradebook', [tenant, test.id])),
  );
  console.log(`\n${checks} Phase 3 PostgreSQL assertions passed.`);
} catch (error) {
  console.error('Phase 3 database test failed:', error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
