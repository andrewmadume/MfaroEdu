import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0;
const users = Object.fromEntries(
  [
    'admin',
    'outsider',
    'teacher',
    'otherTeacher',
    'parent',
    'otherParent',
    'student',
    'otherStudent',
    'accountant',
  ].map((name) => [name, randomUUID()]),
);
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
async function denied(sql, args = []) {
  await assert.rejects(() => db.query(sql, args));
}
async function as(name) {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${users[name]}',false);set role authenticated;`,
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
async function rows(table) {
  return (await db.query(`select * from public.${table}`)).rows;
}
async function update(table, record, values) {
  const keys = Object.keys(values);
  return (
    await db.query(
      `update public.${table} set ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')},version=version+1 where id=$${keys.length + 1} returning *`,
      [...Object.values(values), record.id],
    )
  ).rows[0];
}
try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  for (const id of Object.values(users))
    await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [id]);
  await as('admin');
  const tenant = (await db.query("select public.create_school('School A','phase-two-a') id"))
    .rows[0].id;
  for (const [user, role] of Object.entries({
    teacher: 'TEACHER',
    otherTeacher: 'TEACHER',
    parent: 'PARENT',
    otherParent: 'PARENT',
    student: 'STUDENT',
    otherStudent: 'STUDENT',
    accountant: 'ACCOUNTANT',
  }))
    await db.query('select public.set_membership($1,$2,$3,true)', [tenant, users[user], role]);
  await as('outsider');
  const other = (await db.query("select public.create_school('School B','phase-two-b') id")).rows[0]
    .id;
  const year = Number((await db.query('select extract(year from current_date) y')).rows[0].y);
  const otherGrade = await create('grades', { school_id: other, name: 'Foreign grade' });
  const otherLearner = await create('students', {
    school_id: other,
    first_name: 'Other',
    surname: 'School',
    admission_number: 'X1',
    date_of_birth: `${year - 12}-01-01`,
    admission_date: `${year}-01-01`,
  });
  await as('admin');
  const academic = await create('academic_years', {
    school_id: tenant,
    name: String(year),
    starts_on: `${year}-01-01`,
    ends_on: `${year}-12-31`,
  });
  const nextYear = await create('academic_years', {
    school_id: tenant,
    name: String(year + 1),
    starts_on: `${year + 1}-01-01`,
    ends_on: `${year + 1}-12-31`,
  });
  const grade = await create('grades', { school_id: tenant, name: 'Grade 7', sort_order: 7 });
  const term = await create('terms', {
    school_id: tenant,
    name: 'Term 1',
    academic_year_id: academic.id,
    starts_on: `${year}-01-01`,
    ends_on: `${year}-03-31`,
  });
  const classA = await create('classes', {
    school_id: tenant,
    name: '7A',
    academic_year_id: academic.id,
    grade_id: grade.id,
    capacity: 1,
  });
  const classB = await create('classes', {
    school_id: tenant,
    name: '7B',
    academic_year_id: academic.id,
    grade_id: grade.id,
  });
  const future = await create('classes', {
    school_id: tenant,
    name: '8A',
    academic_year_id: nextYear.id,
    grade_id: grade.id,
  });
  const subject = await create('subjects', {
    school_id: tenant,
    name: 'Mathematics',
    code: 'MATH',
  });
  const allocation = await create('class_subjects', {
    school_id: tenant,
    class_id: classA.id,
    subject_id: subject.id,
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
  const office = await create('staff', {
    school_id: tenant,
    first_name: 'Office',
    surname: 'Staff',
    employee_number: 'O1',
    position: 'Office',
  });
  const teaching = await create('teacher_assignments', {
    school_id: tenant,
    staff_id: teacher.id,
    class_subject_id: allocation.id,
  });
  const studentValues = {
    school_id: tenant,
    surname: 'Learner',
    date_of_birth: `${year - 12}-01-01`,
    admission_date: `${year}-01-01`,
  };
  const learnerA = await create('students', {
    ...studentValues,
    admission_number: 'A001',
    first_name: 'First',
    user_id: users.student,
  });
  const learnerB = await create('students', {
    ...studentValues,
    admission_number: 'A002',
    first_name: 'Second',
    user_id: users.otherStudent,
  });
  const learnerC = await create('students', {
    ...studentValues,
    admission_number: 'A003',
    first_name: 'Third',
  });
  const guardian = await create('parents', {
    school_id: tenant,
    first_name: 'Linked',
    surname: 'Guardian',
    user_id: users.parent,
  });
  const otherGuardian = await create('parents', {
    school_id: tenant,
    first_name: 'Unlinked',
    surname: 'Guardian',
    user_id: users.otherParent,
  });
  const link = await create('student_parents', {
    school_id: tenant,
    student_id: learnerA.id,
    parent_id: guardian.id,
    relationship: 'Guardian',
    is_primary: true,
  });
  await create('student_parents', {
    school_id: tenant,
    student_id: learnerB.id,
    parent_id: guardian.id,
    relationship: 'Guardian',
  });
  const enroll = async (learner, klass, date = `${year}-01-01`) =>
    (
      await db.query('select public.enroll_student($1,$2,$3,$4) id', [
        tenant,
        learner.id,
        klass.id,
        date,
      ])
    ).rows[0].id;
  const enrolled = await enroll(learnerA, classA);
  await enroll(learnerB, classB);
  await check('academic and people records are created with tenant IDs', async () =>
    assert.equal((await rows('students')).length, 3),
  );
  await check('cross-school learner records invisible to administrators', async () =>
    assert.equal(
      (await db.query('select * from public.students where id=$1', [otherLearner.id])).rows.length,
      0,
    ),
  );
  await check('foreign school grade cannot be attached to a local class', () =>
    denied(
      'insert into public.classes(school_id,name,academic_year_id,grade_id) values($1,$2,$3,$4)',
      [tenant, 'Invalid', academic.id, otherGrade.id],
    ),
  );
  await check('guardian cannot be linked to a learner in another school', () =>
    denied(
      'insert into public.student_parents(school_id,student_id,parent_id,relationship) values($1,$2,$3,$4)',
      [tenant, otherLearner.id, guardian.id, 'Guardian'],
    ),
  );
  await check('admission numbers are unique within a school', () =>
    denied(
      'insert into public.students(school_id,admission_number,first_name,surname,date_of_birth,admission_date) values($1,$2,$3,$4,$5,$6)',
      [tenant, 'A001', 'Duplicate', 'Learner', `${year - 12}-01-01`, `${year}-01-01`],
    ),
  );
  await check('wrong school or role account cannot be linked to a learner', () =>
    denied('update public.students set user_id=$1,version=version+1 where id=$2', [
      users.outsider,
      learnerC.id,
    ]),
  );
  await check('term cannot extend outside its year', () =>
    denied('update public.terms set ends_on=$1,version=version+1 where id=$2', [
      `${year + 1}-01-01`,
      term.id,
    ]),
  );
  await check('terms cannot overlap', () =>
    denied(
      'insert into public.terms(school_id,academic_year_id,name,starts_on,ends_on) values($1,$2,$3,$4,$5)',
      [tenant, academic.id, 'Overlap', `${year}-03-01`, `${year}-05-01`],
    ),
  );
  await check('year dates cannot exclude existing terms', () =>
    denied('update public.academic_years set starts_on=$1,version=version+1 where id=$2', [
      `${year}-02-01`,
      academic.id,
    ]),
  );
  await check('class capacity prevents another enrollment', () =>
    denied('select public.enroll_student($1,$2,$3,$4)', [
      tenant,
      learnerC.id,
      classA.id,
      `${year}-01-02`,
    ]),
  );
  await check('overlapping learner placements rejected', () =>
    denied('select public.enroll_student($1,$2,$3,$4)', [
      tenant,
      learnerA.id,
      classB.id,
      `${year}-02-01`,
    ]),
  );
  await check('out-of-year enrollment rejected', () =>
    denied('select public.enroll_student($1,$2,$3,$4)', [
      tenant,
      learnerC.id,
      classB.id,
      `${year - 1}-12-31`,
    ]),
  );
  await check('direct enrollment writes are not allowed', () =>
    denied('update public.enrollments set class_id=$1,version=version+1 where id=$2', [
      classB.id,
      enrolled,
    ]),
  );
  await check('admission date cannot be moved past enrollment history', () =>
    denied('update public.students set admission_date=$1,version=version+1 where id=$2', [
      `${year}-02-01`,
      learnerA.id,
    ]),
  );
  await check('capacity cannot be reduced below occupied places', async () => {
    await enroll(learnerC, classB);
    await denied('update public.classes set capacity=1,version=version+1 where id=$1', [classB.id]);
    const placement = (
      await db.query("select * from public.enrollments where student_id=$1 and status='ACTIVE'", [
        learnerC.id,
      ])
    ).rows[0];
    await db.query('select public.close_enrollment($1,$2,$3,$4,$5)', [
      tenant,
      placement.id,
      placement.version,
      `${year}-01-01`,
      'WITHDRAWN',
    ]);
  });
  await check('learner with active enrollment cannot be archived', () =>
    denied('update public.students set archived=true,version=version+1 where id=$1', [learnerA.id]),
  );
  await check('class with active enrollment cannot be archived', () =>
    denied('update public.classes set archived=true,version=version+1 where id=$1', [classA.id]),
  );
  await check('only teachers can receive teaching assignments', () =>
    denied(
      'insert into public.teacher_assignments(school_id,staff_id,class_subject_id) values($1,$2,$3)',
      [tenant, office.id, allocation.id],
    ),
  );
  await check('only one primary guardian per learner', () =>
    denied(
      'insert into public.student_parents(school_id,student_id,parent_id,relationship,is_primary) values($1,$2,$3,$4,true)',
      [tenant, learnerA.id, otherGuardian.id, 'Guardian'],
    ),
  );
  await check('class subjects can be searched by human-readable names', async () =>
    assert.equal(
      (
        await db.query('select * from public.search_class_subjects($1,$2,0)', [
          tenant,
          'Mathematics',
        ])
      ).rows[0].id,
      allocation.id,
    ),
  );
  await check('record tenant cannot be reassigned', () =>
    denied('update public.students set school_id=$1,version=version+1 where id=$2', [
      other,
      learnerC.id,
    ]),
  );
  await check('historical class year is immutable', () =>
    denied('update public.classes set academic_year_id=$1,version=version+1 where id=$2', [
      nextYear.id,
      classA.id,
    ]),
  );
  await check('hard deletion is prohibited', () =>
    denied('delete from public.students where id=$1', [learnerC.id]),
  );
  await check('stale optimistic update touches no rows', async () =>
    assert.equal(
      (
        await db.query(
          'update public.students set first_name=$1,version=version+1 where id=$2 and version=0 returning id',
          ['Stale', learnerC.id],
        )
      ).rows.length,
      0,
    ),
  );
  await as('teacher');
  await check('teacher reads assigned learners only', async () =>
    assert.deepEqual(
      (await rows('students')).map((s) => s.id),
      [learnerA.id],
    ),
  );
  await check('teacher reads assigned classes only', async () =>
    assert.deepEqual(
      (await rows('classes')).map((s) => s.id),
      [classA.id],
    ),
  );
  await check('teacher cannot modify learner profiles', async () =>
    assert.equal(
      (
        await db.query(
          'update public.students set first_name=$1,version=version+1 where id=$2 returning id',
          ['Bad', learnerA.id],
        )
      ).rows.length,
      0,
    ),
  );
  await check('teacher cannot enroll learners', () =>
    denied('select public.enroll_student($1,$2,$3,$4)', [
      tenant,
      learnerC.id,
      classB.id,
      `${year}-01-01`,
    ]),
  );
  await check('teacher cannot read guardian contact records', async () =>
    assert.equal((await rows('parents')).length, 0),
  );
  await as('otherTeacher');
  await check('unassigned teacher sees no learners', async () =>
    assert.equal((await rows('students')).length, 0),
  );
  await as('parent');
  await check('parent sees multiple linked children only', async () =>
    assert.equal((await rows('students')).length, 2),
  );
  await check('parent cannot read another guardian profile', async () =>
    assert.deepEqual(
      (await rows('parents')).map((p) => p.id),
      [guardian.id],
    ),
  );
  await check('parent sees linked enrollment history only', async () =>
    assert.equal((await rows('enrollments')).length, 2),
  );
  await check('parent cannot create their own child linkage', () =>
    denied(
      'insert into public.student_parents(school_id,student_id,parent_id,relationship) values($1,$2,$3,$4)',
      [tenant, learnerC.id, guardian.id, 'Guardian'],
    ),
  );
  await as('otherParent');
  await check('unlinked parent sees no learners', async () =>
    assert.equal((await rows('students')).length, 0),
  );
  await as('student');
  await check('learner reads own profile only', async () =>
    assert.deepEqual(
      (await rows('students')).map((s) => s.id),
      [learnerA.id],
    ),
  );
  await check('learner cannot edit protected profile', async () =>
    assert.equal(
      (
        await db.query(
          'update public.students set first_name=$1,version=version+1 where id=$2 returning id',
          ['Bad', learnerA.id],
        )
      ).rows.length,
      0,
    ),
  );
  await as('accountant');
  await check('accountant cannot read learner profiles in phase 2', async () =>
    assert.equal((await rows('students')).length, 0),
  );
  await as('admin');
  await update('student_parents', link, { archived: true });
  await as('parent');
  await check('archiving guardian link immediately revokes child access', async () =>
    assert.deepEqual(
      (await rows('students')).map((s) => s.id),
      [learnerB.id],
    ),
  );
  await as('admin');
  await update('teacher_assignments', teaching, { archived: true });
  await as('teacher');
  await check('archiving teaching assignment immediately revokes class access', async () =>
    assert.equal((await rows('students')).length, 0),
  );
  await as('admin');
  await update('teacher_assignments', teaching, { archived: false });
  await check('promotion closes previous record and retains both years', async () => {
    await db.query('select public.enroll_student($1,$2,$3,$4,$5,$6,$7,$8)', [
      tenant,
      learnerA.id,
      future.id,
      `${year + 1}-01-01`,
      enrolled,
      1,
      `${year}-12-31`,
      'COMPLETED',
    ]);
    const history = (
      await db.query('select * from public.enrollments where student_id=$1 order by starts_on', [
        learnerA.id,
      ])
    ).rows;
    assert.equal(history.length, 2);
    assert.equal(history[0].status, 'COMPLETED');
    assert.equal(history[1].status, 'ACTIVE');
  });
  await check('stale enrollment movement is rejected', () =>
    denied('select public.enroll_student($1,$2,$3,$4,$5,$6,$7,$8)', [
      tenant,
      learnerA.id,
      future.id,
      `${year + 1}-01-02`,
      enrolled,
      1,
      `${year}-12-31`,
      'COMPLETED',
    ]),
  );
  await check('failed move rolls back prior closure', async () => {
    const active = (
      await db.query("select * from public.enrollments where student_id=$1 and status='ACTIVE'", [
        learnerB.id,
      ])
    ).rows[0];
    await denied('select public.enroll_student($1,$2,$3,$4,$5,$6,$7,$8)', [
      tenant,
      learnerB.id,
      classB.id,
      `${year}-02-01`,
      active.id,
      active.version,
      `${year}-02-02`,
      'TRANSFERRED',
    ]);
    assert.equal(
      (await db.query('select status from public.enrollments where id=$1', [active.id])).rows[0]
        .status,
      'ACTIVE',
    );
  });
  const current = (
    await db.query("select * from public.enrollments where student_id=$1 and status='ACTIVE'", [
      learnerB.id,
    ])
  ).rows[0];
  await db.query('select public.close_enrollment($1,$2,$3,$4,$5)', [
    tenant,
    current.id,
    current.version,
    `${year}-12-31`,
    'WITHDRAWN',
  ]);
  await update('students', learnerB, { archived: true });
  await check('archiving retains learner history', async () =>
    assert.equal(
      (await db.query('select * from public.enrollments where student_id=$1', [learnerB.id])).rows
        .length,
      1,
    ),
  );
  await check('changes create protected school audit entries', async () =>
    assert.ok(
      (
        await db.query("select * from public.audit_logs where entity='students' and school_id=$1", [
          tenant,
        ])
      ).rows.length >= 4,
    ),
  );
  await as('outsider');
  await check('other school cannot call enrollment RPC on tenant A', () =>
    denied('select public.close_enrollment($1,$2,$3,$4,$5)', [
      tenant,
      current.id,
      2,
      `${year}-12-31`,
      'COMPLETED',
    ]),
  );
  await db.exec('reset role;set role anon;');
  await check('anonymous users cannot read learner records', () =>
    denied('select * from public.students'),
  );
  await check('anonymous users cannot search class subjects', () =>
    denied('select * from public.search_class_subjects($1)', [tenant]),
  );
  console.log(`\n${checks} Phase 2 PostgreSQL assertions passed.`);
} catch (error) {
  console.error('Phase 2 database failure:', error.message, error.where ?? '');
  process.exitCode = 1;
} finally {
  await db.close();
}
