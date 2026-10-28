import { PGlite } from '@electric-sql/pglite';
import { storageShim } from './storage-test-shim.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0,
  tenant;
const users = Object.fromEntries(
  ['admin', 'teacher', 'parent', 'student', 'other', 'outsider'].map((k) => [k, randomUUID()]),
);
const as = async (k) =>
  db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${users[k]}',false);set role authenticated;`,
  );
const rpc = async (name, args) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`,
      args,
    )
  ).rows[0].value;
const write = (r) => rpc('operations_write', [tenant, JSON.stringify(r)]),
  read = (r) => rpc('operations_read', [tenant, JSON.stringify(r)]);
const insert = async (table, values) => {
  const keys = Object.keys(values);
  return (
    await db.query(
      `insert into public.${table}(school_id,${keys.join(',')}) values($1,${keys.map((_, i) => '$' + (i + 2)).join(',')}) returning *`,
      [tenant, ...Object.values(values)],
    )
  ).rows[0];
};
async function check(name, fn) {
  await fn();
  checks++;
  console.log('PASS ' + name);
}
const denied = (fn, pattern = /Not authorized/) => assert.rejects(fn, pattern);
try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(storageShim);
  for (const f of (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(await readFile(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8'));
  for (const id of Object.values(users))
    await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [id]);
  await as('admin');
  tenant = await rpc('create_school', ['Operations school', 'operations-school']);
  for (const [who, role] of Object.entries({
    teacher: 'TEACHER',
    parent: 'PARENT',
    student: 'STUDENT',
    other: 'TEACHER',
  }))
    await rpc('set_membership', [tenant, users[who], role, true]);
  const year = await insert('academic_years', {
    name: '2026',
    starts_on: '2026-01-01',
    ends_on: '2026-12-31',
  });
  const term = await insert('terms', {
    academic_year_id: year.id,
    name: 'Term 1',
    starts_on: '2026-01-01',
    ends_on: '2026-03-31',
  });
  const grade = await insert('grades', { name: 'Grade 7' });
  const cls = await insert('classes', {
    academic_year_id: year.id,
    grade_id: grade.id,
    name: '7A',
    capacity: 30,
  });
  const cls2 = await insert('classes', {
    academic_year_id: year.id,
    grade_id: grade.id,
    name: '7B',
    capacity: 30,
  });
  const subject = await insert('subjects', { name: 'Maths', code: 'MAT' });
  const allocation = await insert('class_subjects', { class_id: cls.id, subject_id: subject.id });
  const allocation2 = await insert('class_subjects', { class_id: cls2.id, subject_id: subject.id });
  const teacher = await insert('staff', {
    employee_number: 'T1',
    first_name: 'Teacher',
    surname: 'Example',
    is_teacher: true,
    position: 'Teacher',
    user_id: users.teacher,
  });
  const teacher2 = await insert('staff', {
    employee_number: 'T2',
    first_name: 'Other',
    surname: 'Teacher',
    is_teacher: true,
    position: 'Teacher',
    user_id: users.other,
  });
  const assignment = await insert('teacher_assignments', {
    staff_id: teacher.id,
    class_subject_id: allocation.id,
  });
  await insert('teacher_assignments', { staff_id: teacher.id, class_subject_id: allocation2.id });
  await insert('teacher_assignments', { staff_id: teacher2.id, class_subject_id: allocation2.id });
  const student = await insert('students', {
    admission_number: 'A1',
    first_name: 'Alex',
    surname: 'Example',
    date_of_birth: '2014-01-01',
    admission_date: '2026-01-01',
    user_id: users.student,
  });
  const second = await insert('students', {
    admission_number: 'A2',
    first_name: 'Sam',
    surname: 'Example',
    date_of_birth: '2014-01-01',
    admission_date: '2026-01-01',
  });
  const parent = await insert('parents', {
    first_name: 'Parent',
    surname: 'Example',
    user_id: users.parent,
  });
  const link = await insert('student_parents', {
    student_id: student.id,
    parent_id: parent.id,
    relationship: 'Guardian',
  });
  const enrollment = await rpc('enroll_student', [tenant, student.id, cls.id, '2026-01-01']);
  await rpc('enroll_student', [tenant, second.id, cls.id, '2026-01-01']);
  const room = await insert('rooms', { name: 'Main', code: 'R1', capacity: 30 }),
    room2 = await insert('rooms', { name: 'Second', code: 'R2', capacity: 40 });
  const slot = await insert('time_slots', {
    name: 'Period 1',
    starts_at: '08:00',
    ends_at: '09:00',
  });
  const adjacent = await insert('time_slots', {
    name: 'Period 2',
    starts_at: '09:00',
    ends_at: '10:00',
  });
  const overlap = await insert('time_slots', {
    name: 'Overlap',
    starts_at: '08:30',
    ends_at: '09:30',
  });
  let id, book;
  await check('administrator and teacher have expected school-day permissions', async () => {
    for (const k of ['admin', 'teacher']) {
      await as(k);
      assert.ok((await rpc('my_permissions', [tenant])).includes('attendance.view'));
    }
  });
  await check('teacher opens dated register with date-specific unmarked roster', async () => {
    await as('teacher');
    id = await write({
      op: 'open',
      class_key: cls.id,
      attendance_date: '2026-02-02',
      session_name: 'Daily',
    });
    book = await read({ op: 'register', session_key: id });
    assert.equal(book.learners.length, 2);
    assert.ok(book.learners.every((r) => r.version === 0 && r.status === 'UNMARKED'));
  });
  await check('duplicate class/date/session identities are rejected case-insensitively', () =>
    denied(
      () =>
        write({
          op: 'open',
          class_key: cls.id,
          attendance_date: '2026-02-02',
          session_name: 'daily',
        }),
      /duplicate key/,
    ),
  );
  await check('unassigned teacher cannot open or inspect register', async () => {
    await as('other');
    await denied(() => read({ op: 'register', session_key: id }));
    await denied(() =>
      write({
        op: 'open',
        class_key: cls.id,
        attendance_date: '2026-02-03',
        session_name: 'Daily',
      }),
    );
    await as('teacher');
  });
  await check('out of year and future attendance dates are rejected', async () => {
    for (const date of ['2025-12-31', '2099-01-01'])
      await denied(
        () =>
          write({ op: 'open', class_key: cls.id, attendance_date: date, session_name: 'Daily' }),
        /Attendance date/,
      );
  });
  await check('incomplete roster cannot be finalized', () =>
    denied(
      () => write({ op: 'state', session_key: id, expected_version: 1, next_state: 'FINAL' }),
      /Complete every learner/,
    ),
  );
  const entry = (student_id, status, version = 0) => ({
    id: student_id,
    status,
    version,
    reason: 'Example note',
  });
  await check('attendance batch is atomic for duplicate and invalid learners', async () => {
    await denied(
      () =>
        write({
          op: 'save',
          session_key: id,
          expected_version: 1,
          entries: [entry(student.id, 'PRESENT'), entry(randomUUID(), 'ABSENT')],
        }),
      /not enrolled/,
    );
    assert.equal((await read({ op: 'register', session_key: id })).learners[0].version, 0);
    await denied(
      () =>
        write({
          op: 'save',
          session_key: id,
          expected_version: 1,
          entries: [entry(student.id, 'PRESENT'), entry(student.id, 'LATE')],
        }),
      /Invalid attendance/,
    );
  });
  await check('teacher saves attendance and stale session is rejected', async () => {
    await write({
      op: 'save',
      session_key: id,
      expected_version: 1,
      entries: [entry(student.id, 'LATE'), entry(second.id, 'EXCUSED')],
    });
    await denied(
      () =>
        write({
          op: 'save',
          session_key: id,
          expected_version: 1,
          entries: [entry(student.id, 'ABSENT', 1)],
        }),
      /Register changed/,
    );
  });
  await check('families cannot see draft attendance or class roster', async () => {
    await as('parent');
    assert.equal(
      (await read({ op: 'report', from_date: '2026-02-01', to_date: '2026-02-28' })).count,
      0,
    );
    await denied(() => read({ op: 'register', session_key: id }));
    await as('teacher');
  });
  await check('finalization releases only linked/self records with exact percentages', async () => {
    await write({ op: 'state', session_key: id, expected_version: 2, next_state: 'FINAL' });
    await as('parent');
    let report = await read({ op: 'report', from_date: '2026-02-01', to_date: '2026-02-28' });
    assert.equal(report.count, 1);
    assert.equal(report.rows[0].late, 1);
    assert.equal(report.rows[0].percentage, 100);
    assert.equal(
      (
        await read({
          op: 'history',
          from_date: '2026-02-01',
          to_date: '2026-02-28',
          learner: second.id,
        })
      ).count,
      0,
    );
    await as('student');
    assert.equal(
      (await read({ op: 'dashboard', from_date: '2026-02-02', to_date: '2026-02-02' })).total,
      1,
    );
  });
  await check('final registers reject edits and teacher reopening', async () => {
    await as('teacher');
    await denied(
      () =>
        write({
          op: 'save',
          session_key: id,
          expected_version: 3,
          entries: [entry(student.id, 'ABSENT', 1)],
        }),
      /Only open/,
    );
    await denied(
      () => write({ op: 'state', session_key: id, expected_version: 3, next_state: 'OPEN' }),
      /Only administrators/,
    );
  });
  await check('captured attendance prevents enrollment history truncation', async () => {
    await as('admin');
    await denied(
      () => rpc('close_enrollment', [tenant, enrollment, 1, '2026-02-01', 'WITHDRAWN']),
      /preserve captured attendance/,
    );
  });
  await check('retroactive enrollment cannot silently change finalized roster', async () => {
    const extra = await insert('students', {
      admission_number: 'A3',
      first_name: 'New',
      surname: 'Example',
      date_of_birth: '2014-01-01',
      admission_date: '2026-01-01',
    });
    await denied(
      () => rpc('enroll_student', [tenant, extra.id, cls.id, '2026-02-01']),
      /Reopen affected/,
    );
  });
  await check('administrator reopen hides families until corrected and finalized', async () => {
    await write({ op: 'state', session_key: id, expected_version: 3, next_state: 'OPEN' });
    await as('parent');
    assert.equal(
      (await read({ op: 'report', from_date: '2026-02-01', to_date: '2026-02-28' })).count,
      0,
    );
    await as('admin');
    await write({
      op: 'save',
      session_key: id,
      expected_version: 4,
      entries: [entry(student.id, 'PRESENT', 1)],
    });
    await write({ op: 'state', session_key: id, expected_version: 5, next_state: 'FINAL' });
  });
  const values = {
    class_subject_id: allocation.id,
    staff_id: teacher.id,
    term_id: term.id,
    room_id: room.id,
    time_slot_id: slot.id,
    weekday: 1,
    active: true,
  };
  let schedule;
  await check('administrator creates weekly schedule with actual term dates', async () => {
    schedule = await write({ op: 'schedule', values });
    let rows = await read({
      op: 'week',
      term_key: term.id,
      on_date: '2026-02-02',
      view_kind: 'CLASS',
      resource_key: cls.id,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lesson_on, '2026-02-02');
    assert.equal(rows[0].starts_at, '08:00');
  });
  await check('class conflicts reject different overlapping periods', () =>
    denied(
      () => write({ op: 'schedule', values: { ...values, time_slot_id: overlap.id } }),
      /Class already/,
    ),
  );
  await check('teacher conflicts span different classes', () =>
    denied(
      () =>
        write({
          op: 'schedule',
          values: { ...values, class_subject_id: allocation2.id, room_id: room2.id },
        }),
      /Teacher already/,
    ),
  );
  await check('room conflicts span different classes and teachers', () =>
    denied(
      () =>
        write({
          op: 'schedule',
          values: { ...values, class_subject_id: allocation2.id, staff_id: teacher2.id },
        }),
      /Room already/,
    ),
  );
  await check('adjacent time periods do not conflict', async () => {
    await write({ op: 'schedule', values: { ...values, time_slot_id: adjacent.id } });
  });
  await check('room capacity and teacher assignment are enforced', async () => {
    const tiny = await insert('rooms', { name: 'Small', code: 'SM', capacity: 5 });
    await denied(
      () => write({ op: 'schedule', values: { ...values, weekday: 2, room_id: tiny.id } }),
      /Room capacity/,
    );
    await denied(
      () => write({ op: 'schedule', values: { ...values, weekday: 2, staff_id: teacher2.id } }),
      /Assign this teacher/,
    );
  });
  await check(
    'active schedules protect resource times, assignments and term boundaries',
    async () => {
      await denied(
        () =>
          db.query('update public.time_slots set starts_at=$1,version=version+1 where id=$2', [
            '07:30',
            slot.id,
          ]),
        /Archive linked/,
      );
      await denied(
        () =>
          db.query(
            'update public.teacher_assignments set archived=true,version=version+1 where id=$1',
            [assignment.id],
          ),
        /Archive linked/,
      );
      await denied(
        () =>
          db.query('update public.terms set ends_on=$1,version=version+1 where id=$2', [
            '2026-03-30',
            term.id,
          ]),
        /Archive linked/,
      );
    },
  );
  await check(
    'nonoverlapping terms permit the same resources, and empty weekdays are rejected',
    async () => {
      const later = await insert('terms', {
        academic_year_id: year.id,
        name: 'Term 2',
        starts_on: '2026-04-01',
        ends_on: '2026-06-30',
      });
      await write({ op: 'schedule', values: { ...values, term_id: later.id } });
      const short = await insert('terms', {
        academic_year_id: year.id,
        name: 'One day',
        starts_on: '2026-07-01',
        ends_on: '2026-07-01',
      });
      await denied(
        () => write({ op: 'schedule', values: { ...values, term_id: short.id, weekday: 1 } }),
        /No lesson dates/,
      );
    },
  );
  await check('cross-year overlapping terms still detect teacher conflicts', async () => {
    const another = await insert('academic_years', {
      name: 'Parallel year',
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
    });
    const anotherTerm = await insert('terms', {
      academic_year_id: another.id,
      name: 'Parallel term',
      starts_on: '2026-02-01',
      ends_on: '2026-02-28',
    });
    const anotherClass = await insert('classes', {
      academic_year_id: another.id,
      grade_id: grade.id,
      name: 'Parallel class',
    });
    const anotherAllocation = await insert('class_subjects', {
      class_id: anotherClass.id,
      subject_id: subject.id,
    });
    await insert('teacher_assignments', {
      staff_id: teacher.id,
      class_subject_id: anotherAllocation.id,
    });
    await denied(
      () =>
        write({
          op: 'schedule',
          values: {
            ...values,
            class_subject_id: anotherAllocation.id,
            term_id: anotherTerm.id,
            room_id: room2.id,
          },
        }),
      /Teacher already/,
    );
  });
  await check(
    'attendance analytics aggregate finalized statuses for the selected dates',
    async () => {
      const report = await rpc('advanced_read', [
        tenant,
        JSON.stringify({ op: 'analytics', from: '2026-02-01', to: '2026-02-28' }),
      ]);
      assert.equal(report.attendance.total, 2);
      assert.equal(report.attendance.percentage, 50);
      assert.equal(report.attendance.excused, 1);
    },
  );
  await check(
    'new report publications snapshot attendance and retain it after corrections',
    async () => {
      await insert('grading_rules', {
        bands: JSON.stringify([
          { min: 50, label: 'Pass' },
          { min: 0, label: 'Developing' },
        ]),
        pass_percent: 50,
        assessment_types: '["Test"]',
        term_weights: JSON.stringify({ [term.id]: 1 }),
      });
      const assessment = await insert('assessments', {
        class_subject_id: allocation.id,
        term_id: term.id,
        name: 'Example test',
        assessment_type: 'Test',
        assessed_on: '2026-02-01',
        max_mark: 20,
        weight: 1,
      });
      await rpc('save_assessment_marks', [
        tenant,
        assessment.id,
        1,
        JSON.stringify([
          { id: student.id, status: 'MARKED', mark: 15, comment: '', version: 0 },
          { id: second.id, status: 'MARKED', mark: 10, comment: '', version: 0 },
        ]),
      ]);
      const docs = await rpc('preview_term_results', [tenant, cls.id, term.id]);
      assert.equal(docs.find((d) => d.student_id === student.id).attendance.present, 1);
      await rpc('publish_term_results', [tenant, cls.id, term.id, JSON.stringify(docs)]);
      await write({ op: 'state', session_key: id, expected_version: 6, next_state: 'OPEN' });
      await write({
        op: 'save',
        session_key: id,
        expected_version: 7,
        entries: [entry(student.id, 'ABSENT', 2)],
      });
      await write({ op: 'state', session_key: id, expected_version: 8, next_state: 'FINAL' });
      const stored = (
        await db.query(
          'select document from public.published_reports where school_id=$1 and student_id=$2',
          [tenant, student.id],
        )
      ).rows[0].document;
      assert.equal(stored.attendance.present, 1);
      assert.equal(
        (await rpc('preview_term_results', [tenant, cls.id, term.id])).find(
          (d) => d.student_id === student.id,
        ).attendance.absent,
        1,
      );
    },
  );
  await check('a later return to the same class preserves earlier attendance history',async()=>{
    await rpc('close_enrollment',[tenant,enrollment,1,'2026-03-31','TRANSFERRED']);
    await rpc('enroll_student',[tenant,student.id,cls.id,'2026-04-01']);
    assert.equal((await read({op:'register',session_key:id})).learners.length,2);
  });
  await check('schedule edits require current version', () =>
    denied(
      () => write({ op: 'schedule', booking_key: schedule, expected_version: 0, values }),
      /Schedule changed/,
    ),
  );
  await check('archive releases booking and restore checks conflicts again', async () => {
    await write({
      op: 'schedule',
      booking_key: schedule,
      expected_version: 1,
      values: { ...values, active: false },
    });
    await write({ op: 'schedule', values });
    await denied(
      () => write({ op: 'schedule', booking_key: schedule, expected_version: 2, values }),
      /Class already/,
    );
    assert.equal((await read({ op: 'schedules', term_key: term.id, only_active: false })).count, 1);
  });
  await check(
    'parent timetable contains minimal assigned teacher names without staff profile access',
    async () => {
      await as('parent');
      assert.equal((await db.query('select * from public.staff')).rows.length, 0);
      const teachers = await rpc('timetable_teachers', [tenant, '', 0]);
      assert.equal(teachers.rows.length, 1);
      assert.deepEqual(Object.keys(teachers.rows[0]).sort(), ['first_name', 'id', 'surname']);
      assert.equal(
        (
          await read({
            op: 'week',
            term_key: term.id,
            on_date: '2026-02-02',
            view_kind: 'CLASS',
            resource_key: cls2.id,
          })
        ).length,
        0,
      );
      await denied(() => write({ op: 'schedule', values }));
    },
  );
  await check('outsider and anonymous APIs expose nothing', async () => {
    await as('outsider');
    await denied(() => read({ op: 'report', from_date: '2026-02-01', to_date: '2026-02-28' }));
    assert.equal((await db.query('select * from public.attendance_entries')).rows.length, 0);
    await db.exec('reset role;set role anon');
    await denied(() => read({ op: 'report' }), /permission denied/);
  });
  await check('direct attendance and timetable writes are forbidden', async () => {
    await as('admin');
    for (const table of ['attendance_sessions', 'attendance_entries', 'timetable_slots'])
      await denied(
        () => db.query(`delete from public.${table} where school_id=$1`, [tenant]),
        /permission denied/,
      );
  });
  await check(
    'linked parent revocation and teacher membership revocation take immediate effect',
    async () => {
      await as('admin');
      await db.query(
        'update public.student_parents set archived=true,version=version+1 where id=$1',
        [link.id],
      );
      await as('parent');
      assert.equal(
        (await read({ op: 'report', from_date: '2026-02-01', to_date: '2026-02-28' })).count,
        0,
      );
      await as('admin');
      await rpc('set_membership', [tenant, users.teacher, 'TEACHER', false]);
      await as('teacher');
      await denied(() => read({ op: 'register', session_key: id }));
    },
  );
  await check(
    'operations are audited without reasons or learner names in audit metadata',
    async () => {
      await as('admin');
      const rows = (
        await db.query(
          "select * from public.audit_logs where school_id=$1 and entity in ('attendance_sessions','attendance_entries','timetable_slots')",
          [tenant],
        )
      ).rows;
      assert.ok(rows.length > 5);
      assert.ok(!JSON.stringify(rows).includes('Example note'));
    },
  );
  console.log(`${checks} Phase 4 PostgreSQL assertions passed.`);
} finally {
  await db.close();
}
