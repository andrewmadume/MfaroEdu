import { PGlite } from '@electric-sql/pglite';
import { storageShim } from './storage-test-shim.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0,
  tenant;
const users = Object.fromEntries(
  [
    'admin',
    'principal',
    'teacher',
    'otherTeacher',
    'parent',
    'otherParent',
    'student',
    'otherStudent',
    'librarian',
    'outsider',
  ].map((n) => [n, randomUUID()]),
);
async function as(name) {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${users[name]}',false);set role authenticated;`,
  );
}
async function rpc(name, args) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`,
      args,
    )
  ).rows[0].value;
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
  console.log('PASS ' + name);
}
const denied = (sql, args = []) => assert.rejects(() => db.query(sql, args));
const keyed = (v) => ({ ...v, request_key: randomUUID() });
const cw = (v) => rpc('communication_write', [tenant, JSON.stringify(v)]),
  cr = (v) => rpc('communication_read', [tenant, JSON.stringify(v)]),
  lw = (v) => rpc('library_write', [tenant, JSON.stringify(v)]),
  lr = (v) => rpc('library_read', [tenant, JSON.stringify(v)]);
const rejectC = (v) => assert.rejects(() => cw(keyed(v))),
  rejectL = (v) => assert.rejects(() => lw(keyed(v)));
try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(storageShim);
  for (const f of (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(await readFile(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8'));
  for (const [name, id] of Object.entries(users)) {
    await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [id]);
    await db.query('update public.profiles set display_name=$1 where id=$2', [name, id]);
  }
  await as('admin');
  tenant = await rpc('create_school', ['Community school', 'phase-six']);
  for (const [name, role] of Object.entries({
    principal: 'PRINCIPAL',
    teacher: 'TEACHER',
    otherTeacher: 'TEACHER',
    parent: 'PARENT',
    otherParent: 'PARENT',
    student: 'STUDENT',
    otherStudent: 'STUDENT',
    librarian: 'LIBRARIAN',
  }))
    await rpc('set_membership', [tenant, users[name], role, true]);
  const today = (await db.query(`select (now() at time zone 'Africa/Johannesburg')::date::text d`))
      .rows[0].d,
    year = Number(today.slice(0, 4)),
    past = `${year - 1}-12-31`,
    future = `${year + 1}-01-01`;
  const y = await create('academic_years', {
      school_id: tenant,
      name: String(year),
      starts_on: `${year}-01-01`,
      ends_on: `${year}-12-31`,
    }),
    grade = await create('grades', { school_id: tenant, name: 'Grade 7' }),
    klass = await create('classes', {
      school_id: tenant,
      name: '7A',
      grade_id: grade.id,
      academic_year_id: y.id,
    }),
    otherClass = await create('classes', {
      school_id: tenant,
      name: '7B',
      grade_id: grade.id,
      academic_year_id: y.id,
    });
  const student = await create('students', {
      school_id: tenant,
      first_name: 'Alex',
      surname: 'Learner',
      admission_number: 'C001',
      date_of_birth: `${year - 12}-01-01`,
      admission_date: `${year - 1}-01-01`,
      user_id: users.student,
    }),
    otherStudent = await create('students', {
      school_id: tenant,
      first_name: 'Other',
      surname: 'Learner',
      admission_number: 'C002',
      date_of_birth: `${year - 12}-01-01`,
      admission_date: `${year - 1}-01-01`,
      user_id: users.otherStudent,
    });
  const parent = await create('parents', {
    school_id: tenant,
    first_name: 'Alex',
    surname: 'Guardian',
    user_id: users.parent,
  });
  const link = await create('student_parents', {
    school_id: tenant,
    student_id: student.id,
    parent_id: parent.id,
    relationship: 'Guardian',
  });
  await rpc('enroll_student', [tenant, student.id, klass.id, `${year}-01-01`]);
  await rpc('enroll_student', [tenant, otherStudent.id, otherClass.id, `${year}-01-01`]);
  const subject = await create('subjects', { school_id: tenant, name: 'Reading', code: 'READ' }),
    allocation = await create('class_subjects', {
      school_id: tenant,
      class_id: klass.id,
      subject_id: subject.id,
    }),
    staff = await create('staff', {
      school_id: tenant,
      first_name: 'Assigned',
      surname: 'Teacher',
      employee_number: 'C1',
      position: 'Teacher',
      is_teacher: true,
      user_id: users.teacher,
    });
  const assignment = await create('teacher_assignments', {
    school_id: tenant,
    staff_id: staff.id,
    class_subject_id: allocation.id,
  });
  const draft = (scope) =>
    keyed({
      op: 'draft',
      title: 'School reading day',
      body: 'Bring your favourite book.',
      scope,
      class_id: scope === 'CLASS' ? klass.id : null,
    });
  await check('family messaging defaults to disabled', async () => {
    await as('parent');
    assert.equal((await cr({ op: 'recipients' })).count, 0);
    await rejectC({ op: 'message', recipient_id: users.teacher, body: 'Hello' });
  });
  await check('staff can contact staff while family messages are disabled', async () => {
    await as('teacher');
    assert.ok((await cr({ op: 'recipients' })).rows.some((r) => r.id === users.admin));
  });
  await check('parents cannot create announcements or alter settings', async () => {
    await as('parent');
    await assert.rejects(() => cw(draft('SCHOOL')));
    await rejectC({ op: 'settings', version: 0, family_messages_enabled: true });
  });
  await as('teacher');
  await check('teacher can see only assigned posting classes', async () =>
    assert.deepEqual(
      (await cr({ op: 'settings' })).classes.map((c) => c.id),
      [klass.id],
    ),
  );
  await check('teacher cannot post school-wide or other-class announcements', async () => {
    await assert.rejects(() => cw(draft('SCHOOL')));
    await assert.rejects(() => cw({ ...draft('CLASS'), class_id: otherClass.id }));
  });
  const draftRequest = draft('CLASS'),
    announcementId = (await cw(draftRequest)).id;
  let announcement = await cr({ op: 'announcement', id: announcementId });
  await check('draft retries are idempotent', async () => {
    assert.equal((await cw(draftRequest)).id, announcementId);
    await assert.rejects(() => cw({ ...draftRequest, title: 'Changed' }));
  });
  await check('unpublished drafts are hidden from families and unrelated teachers', async () => {
    for (const u of ['parent', 'student', 'otherTeacher']) {
      await as(u);
      await assert.rejects(() => cr({ op: 'announcement', id: announcementId }));
    }
  });
  await as('teacher');
  const fileKey = randomUUID();
  await cw({
    op: 'reserve_file',
    id: announcementId,
    version: announcement.version,
    filename: 'reading.txt',
    mime_type: 'text/plain',
    byte_size: 7,
    request_key: fileKey,
  });
  announcement = await cr({ op: 'announcement', id: announcementId });
  const path = tenant + '/' + fileKey + '/file';
  await check('private bucket has size/type limits', async () => {
    await db.exec('reset role');
    const b = (await db.query(`select * from storage.buckets where id='mfaroedu-communications'`))
      .rows[0];
    assert.equal(b.public, false);
    assert.equal(Number(b.file_size_limit), 5242880);
    assert.ok(b.allowed_mime_types.includes('application/pdf'));
    await as('teacher');
  });
  await check('pending attachment blocks publication', async () =>
    rejectC({ op: 'publish', id: announcementId, version: announcement.version }),
  );
  await check('upload finalization requires a matching stored object', async () =>
    rejectC({
      op: 'finish_file',
      id: announcementId,
      version: announcement.version,
      file_id: fileKey,
    }),
  );
  await check('unrelated teachers cannot upload to reserved paths', async () => {
    await as('otherTeacher');
    await denied(
      `insert into storage.objects(bucket_id,name,metadata) values('mfaroedu-communications',$1,'{"size":7,"mimetype":"text/plain"}')`,
      [path],
    );
    await as('teacher');
  });
  await create('storage.objects', {
    bucket_id: 'mfaroedu-communications',
    name: path,
    metadata: JSON.stringify({ size: 7, mimetype: 'text/plain' }),
  }).catch(async () => {
    await db.query(
      `insert into storage.objects(bucket_id,name,metadata) values('mfaroedu-communications',$1,$2)`,
      [path, JSON.stringify({ size: 7, mimetype: 'text/plain' })],
    );
  });
  await cw(
    keyed({
      op: 'finish_file',
      id: announcementId,
      version: announcement.version,
      file_id: fileKey,
    }),
  );
  announcement = await cr({ op: 'announcement', id: announcementId });
  await check('ready draft files remain hidden from families', async () => {
    await as('parent');
    assert.equal(
      (await db.query('select * from storage.objects where name=$1', [path])).rows.length,
      0,
    );
    await as('teacher');
  });
  const publishRequest = keyed({
    op: 'publish',
    id: announcementId,
    version: announcement.version,
  });
  await cw(publishRequest);
  announcement = await cr({ op: 'announcement', id: announcementId });
  await check('publish retry does not duplicate notifications', async () => {
    await cw(publishRequest);
    await as('parent');
    assert.equal((await cr({ op: 'notifications' })).count, 1);
    assert.equal((await cr({ op: 'notifications' })).unread, 1);
  });
  await check('class audience includes enrolled learner and linked parent', async () => {
    for (const u of ['parent', 'student']) {
      await as(u);
      assert.equal((await cr({ op: 'announcement', id: announcementId })).id, announcementId);
      assert.equal(
        (await db.query('select * from storage.objects where name=$1', [path])).rows.length,
        1,
      );
    }
  });
  await check(
    'other-class families and unrelated teachers cannot read class posts or files',
    async () => {
      for (const u of ['otherParent', 'otherStudent', 'otherTeacher']) {
        await as(u);
        await assert.rejects(() => cr({ op: 'announcement', id: announcementId }));
        assert.equal((await cr({ op: 'notifications' })).count, 0);
        assert.equal(
          (await db.query('select * from storage.objects where name=$1', [path])).rows.length,
          0,
        );
      }
    },
  );
  await as('teacher');
  await check('published text and files cannot be edited or replaced', async () => {
    await assert.rejects(() =>
      cw({ ...draft('CLASS'), id: announcementId, version: announcement.version }),
    );
    await rejectC({
      op: 'reserve_file',
      id: announcementId,
      version: announcement.version,
      filename: 'new.txt',
      mime_type: 'text/plain',
      byte_size: 1,
    });
    await db.query('delete from storage.objects where name=$1', [path]);
    assert.equal(
      (await db.query('select * from storage.objects where name=$1', [path])).rows.length,
      1,
    );
  });
  await check('announcement direct writes are denied', async () => {
    await denied(`update public.announcements set title='overwrite' where id=$1`, [announcementId]);
    await denied('delete from public.announcements where id=$1', [announcementId]);
  });
  await as('parent');
  const notice = (await cr({ op: 'notifications' })).rows[0];
  await cw(keyed({ op: 'read_notification', id: notice.id }));
  await check('notification read state is user-scoped and retained', async () => {
    assert.equal((await cr({ op: 'notifications' })).unread, 0);
    await as('otherParent');
    await rejectC({ op: 'read_notification', id: notice.id });
  });
  await as('teacher');
  await cw(keyed({ op: 'withdraw', id: announcementId, version: announcement.version }));
  await check(
    'withdrawal removes family visibility and attachment access immediately',
    async () => {
      await as('parent');
      await assert.rejects(() => cr({ op: 'announcement', id: announcementId }));
      assert.equal((await cr({ op: 'notifications' })).count, 0);
      assert.equal(
        (await db.query('select * from storage.objects where name=$1', [path])).rows.length,
        0,
      );
    },
  );
  await as('admin');
  await cw(keyed({ op: 'settings', version: 0, family_messages_enabled: true }));
  await check('family recipients contain assigned teachers and administrators only', async () => {
    await as('parent');
    const recipients = (await cr({ op: 'recipients' })).rows;
    assert.ok(recipients.some((r) => r.id === users.teacher));
    assert.ok(recipients.some((r) => r.id === users.admin));
    assert.ok(!recipients.some((r) => r.id === users.otherTeacher || r.id === users.otherParent));
    assert.ok(!Object.keys(recipients[0]).includes('email'));
  });
  const messageRequest = keyed({
      op: 'message',
      recipient_id: users.teacher,
      body: 'Can we discuss reading progress?',
    }),
    threadId = (await cw(messageRequest)).id;
  await check('message retry is idempotent and thread participants are fixed', async () => {
    await cw(messageRequest);
    assert.equal((await cr({ op: 'thread', id: threadId })).count, 1);
    await rejectC({
      op: 'message',
      recipient_id: users.otherTeacher,
      body: 'Guessing a recipient',
    });
  });
  await check('administrators cannot eavesdrop on a private conversation', async () => {
    for (const u of ['admin', 'otherTeacher', 'otherParent']) {
      await as(u);
      await assert.rejects(() => cr({ op: 'thread', id: threadId }));
      assert.equal(
        (await db.query('select * from public.messages where thread_id=$1', [threadId])).rows
          .length,
        0,
      );
    }
  });
  await as('teacher');
  await cw(
    keyed({
      op: 'message',
      recipient_id: users.parent,
      body: 'Yes, please bring the reading record.',
    }),
  );
  await check('reply reaches the same thread and creates a personal notification', async () => {
    assert.equal((await cr({ op: 'thread', id: threadId })).count, 2);
    await as('parent');
    assert.equal((await cr({ op: 'notifications' })).rows[0].kind, 'MESSAGE');
  });
  await as('admin');
  await cw(keyed({ op: 'settings', version: 1, family_messages_enabled: false }));
  await check('disabling family messaging preserves history and blocks new replies', async () => {
    await as('parent');
    assert.equal((await cr({ op: 'thread', id: threadId })).can_reply, false);
    await rejectC({ op: 'message', recipient_id: users.teacher, body: 'Not allowed' });
    assert.equal((await cr({ op: 'thread', id: threadId })).count, 2);
  });
  await as('admin');
  await cw(keyed({ op: 'settings', version: 2, family_messages_enabled: true }));
  await db.query(
    'update public.teacher_assignments set archived=true,version=version+1 where id=$1',
    [assignment.id],
  );
  await check('teacher assignment revocation immediately blocks family replies', async () => {
    await as('teacher');
    await rejectC({ op: 'message', recipient_id: users.parent, body: 'Not allowed' });
    assert.equal((await cr({ op: 'thread', id: threadId })).can_reply, false);
  });
  await as('admin');
  await db.query(
    'update public.teacher_assignments set archived=false,version=version+1 where id=$1',
    [assignment.id],
  );
  await check('stale communication settings are rejected', async () =>
    rejectC({ op: 'settings', version: 1, family_messages_enabled: false }),
  );
  await check('role and whole-school broadcasts respect their audiences', async () => {
    for (const scope of ['SCHOOL', 'TEACHERS', 'PARENTS', 'STUDENTS']) {
      await as('admin');
      const id = (await cw(draft(scope))).id;
      await cw(keyed({ op: 'publish', id, version: 1 }));
      for (const [user, visible] of [
        ['parent', scope === 'SCHOOL' || scope === 'PARENTS'],
        ['student', scope === 'SCHOOL' || scope === 'STUDENTS'],
        ['teacher', scope === 'SCHOOL' || scope === 'TEACHERS'],
      ]) {
        await as(user);
        if (visible) assert.equal((await cr({ op: 'announcement', id })).id, id);
        else await assert.rejects(() => cr({ op: 'announcement', id }));
      }
    }
  });
  await check('private message pages retain all messages without overlap', async () => {
    await as('parent');
    for (let n = 0; n < 23; n++)
      await cw(keyed({ op: 'message', recipient_id: users.teacher, body: 'Reading note ' + n }));
    const first = await cr({ op: 'thread', id: threadId, page: 0 }),
      next = await cr({ op: 'thread', id: threadId, page: 1 });
    assert.equal(first.count, 25);
    assert.equal(first.rows.length, 20);
    assert.equal(next.rows.length, 5);
    assert.equal(new Set([...first.rows, ...next.rows].map((m) => m.id)).size, 25);
  });
  await check('notification center paginates authorized notices', async () => {
    await as('teacher');
    const first = await cr({ op: 'notifications', page: 0 }),
      next = await cr({ op: 'notifications', page: 1 });
    assert.equal(first.rows.length, 20);
    assert.ok(first.count > 20);
    assert.equal(first.count, first.rows.length + next.rows.length);
    assert.equal(new Set([...first.rows, ...next.rows].map((n) => n.id)).size, first.count);
  });
  await check('invalid attachment metadata and excess attachment count rejected', async () => {
    await as('admin');
    const id = (await cw(draft('SCHOOL'))).id;
    for (const values of [
      { filename: '../bad.txt', mime_type: 'text/plain', byte_size: 1 },
      { filename: 'bad.html', mime_type: 'text/html', byte_size: 1 },
      { filename: 'big.pdf', mime_type: 'application/pdf', byte_size: 5242881 },
    ])
      await rejectC({ op: 'reserve_file', id, version: 1, ...values });
    for (let n = 0; n < 5; n++)
      await cw(
        keyed({
          op: 'reserve_file',
          id,
          version: n + 1,
          filename: 'reading-' + n + '.txt',
          mime_type: 'text/plain',
          byte_size: 7,
        }),
      );
    await rejectC({
      op: 'reserve_file',
      id,
      version: 6,
      filename: 'sixth.txt',
      mime_type: 'text/plain',
      byte_size: 7,
    });
  });
  await check('deleting a ready draft object blocks publication until repaired', async () => {
    const id = (await cw(draft('SCHOOL'))).id,
      fileId = randomUUID(),
      objectPath = tenant + '/' + fileId + '/file';
    await cw({
      op: 'reserve_file',
      id,
      version: 1,
      filename: 'notice.txt',
      mime_type: 'text/plain',
      byte_size: 7,
      request_key: fileId,
    });
    await db.query(
      `insert into storage.objects(bucket_id,name,metadata) values('mfaroedu-communications',$1,$2)`,
      [objectPath, JSON.stringify({ size: 7, mimetype: 'text/plain' })],
    );
    await cw(keyed({ op: 'finish_file', id, version: 2, file_id: fileId }));
    await db.query('delete from storage.objects where name=$1', [objectPath]);
    await rejectC({ op: 'publish', id, version: 3 });
    await cw(keyed({ op: 'remove_file', id, version: 3, file_id: fileId }));
    await cw(keyed({ op: 'publish', id, version: 4 }));
  });
  await check('anonymous users cannot read communication or attachments', async () => {
    await db.exec('reset role;set role anon');
    await denied('select public.communication_read($1,$2)', [tenant, '{"op":"threads"}']);
    await denied('select * from storage.objects');
  });

  await as('librarian');
  await check('librarian has a minimal learner lookup, not private profiles', async () => {
    assert.equal((await db.query('select * from public.students')).rows.length, 0);
    const s = await lr({ op: 'learners' });
    assert.equal(s.count, 2);
    assert.deepEqual(Object.keys(s.rows[0]).sort(), ['admission_number', 'id', 'name']);
  });
  await lw(keyed({ op: 'settings', version: 0, loan_days: 14, max_books: 1, max_renewals: 1 }));
  const bookRequest = keyed({
      op: 'book',
      title: 'Reading Together',
      author: 'School author',
      isbn: '9780000000000',
      category: 'Reading',
      publisher: 'School press',
    }),
    bookId = (await lw(bookRequest)).id;
  const copyRequest = keyed({
      op: 'copy',
      book_id: bookId,
      accession_number: 'LIB-001',
      location: 'Shelf A',
      condition: 'GOOD',
      status: 'READY',
    }),
    copyId = (await lw(copyRequest)).id,
    copy2Id = (await lw(keyed({ ...copyRequest, accession_number: 'LIB-002' }))).id;
  await check('book/copy writes are idempotent', async () => {
    await lw(bookRequest);
    await lw(copyRequest);
    assert.equal((await lr({ op: 'books' })).count, 1);
    assert.equal((await lr({ op: 'copies', id: bookId })).count, 2);
  });
  await check('accession numbers are unique within a school ignoring case', async () =>
    rejectL({ ...copyRequest, accession_number: 'lib-001' }),
  );
  await check('invalid condition and cross-school/unknown books are rejected', async () => {
    await rejectL({ ...copyRequest, accession_number: 'BAD', condition: 'DAMAGED' });
    await rejectL({ ...copyRequest, book_id: randomUUID() });
  });
  const issueRequest = keyed({
      op: 'issue',
      copy_id: copyId,
      version: 1,
      student_id: student.id,
      issued_on: past,
      due_on: past,
    }),
    loanId = (await lw(issueRequest)).id;
  let loan = await lr({ op: 'loan', id: loanId });
  await check('issue creates a single open loan, snapshot and activity event', async () => {
    assert.equal(loan.document.title, 'Reading Together');
    assert.equal(loan.events[0].kind, 'ISSUED');
    assert.equal(loan.overdue, true);
    assert.equal((await lr({ op: 'books' })).rows[0].available, 1);
    await lw(issueRequest);
    assert.equal((await lr({ op: 'loans' })).count, 1);
  });
  await check('simultaneous-style second issue and stale copy versions are rejected', async () => {
    await rejectL({ ...issueRequest, student_id: otherStudent.id, version: 2 });
    await rejectL({ ...issueRequest, student_id: otherStudent.id });
  });
  await check('learner borrowing limit is enforced across copies', async () =>
    rejectL({ ...issueRequest, copy_id: copy2Id }),
  );
  await check('a borrowed copy cannot be edited, retired or its title archived', async () => {
    await rejectL({ ...copyRequest, id: copyId, version: 2, status: 'RETIRED' });
    await rejectL({ ...bookRequest, id: bookId, version: 1, archived: true });
  });
  await check('borrower history is hidden from unrelated families and teachers', async () => {
    for (const u of ['otherParent', 'otherStudent', 'teacher']) {
      await as(u);
      await assert.rejects(() => lr({ op: 'loan', id: loanId }));
      assert.equal((await lr({ op: 'loans' })).count, 0);
    }
  });
  await check('own learner and linked parent can read history but cannot circulate', async () => {
    for (const u of ['student', 'parent']) {
      await as(u);
      assert.equal((await lr({ op: 'loans' })).count, 1);
      assert.equal((await lr({ op: 'loan', id: loanId })).id, loanId);
      await rejectL({
        op: 'return',
        id: loanId,
        version: 1,
        closed_on: today,
        condition: 'GOOD',
        note: 'Attempt',
      });
      await assert.rejects(() => lr({ op: 'report' }));
    }
  });
  await as('principal');
  await check('principal can report but cannot issue', async () => {
    assert.equal((await lr({ op: 'report' })).overdue, 1);
    await rejectL({ ...issueRequest, copy_id: copy2Id });
  });
  await as('librarian');
  await check('renewal rejects stale versions and dates that do not extend', async () => {
    await rejectL({ op: 'renew', id: loanId, version: 9, due_on: future });
    await rejectL({ op: 'renew', id: loanId, version: 1, due_on: past });
  });
  await lw(keyed({ op: 'renew', id: loanId, version: 1, due_on: future }));
  loan = await lr({ op: 'loan', id: loanId });
  await check('renewal updates due date and retains its activity history', async () => {
    assert.equal(loan.renewals, 1);
    assert.equal(loan.events.length, 2);
    assert.equal((await lr({ op: 'report' })).overdue, 0);
    await rejectL({ op: 'renew', id: loanId, version: 2, due_on: future });
  });
  await check('return cannot predate the latest renewal', async () =>
    rejectL({
      op: 'return',
      id: loanId,
      version: 2,
      closed_on: past,
      condition: 'GOOD',
      note: 'Old date',
    }),
  );
  const returnRequest = keyed({
    op: 'return',
    id: loanId,
    version: 2,
    closed_on: today,
    condition: 'DAMAGED',
    note: 'Torn cover',
  });
  await lw(returnRequest);
  loan = await lr({ op: 'loan', id: loanId });
  await check('damaged return closes the loan and makes the copy unavailable', async () => {
    assert.equal(loan.close_kind, 'RETURNED');
    assert.equal(loan.events.at(-1).details.note, 'Torn cover');
    assert.equal((await lr({ op: 'report' })).damaged, 1);
    assert.equal((await lr({ op: 'report' })).on_loan, 0);
    await lw(returnRequest);
    assert.equal((await lr({ op: 'loan', id: loanId })).events.length, 3);
  });
  await check('closed loan cannot be renewed or closed twice with a new key', async () => {
    await rejectL({ op: 'renew', id: loanId, version: 3, due_on: future });
    await rejectL({ ...returnRequest, version: 3 });
  });
  await check('damaged/lost copies cannot be issued', async () =>
    rejectL({ ...issueRequest, version: 3, issued_on: today, due_on: today }),
  );
  await lw(keyed({ ...copyRequest, id: copyId, version: 3, condition: 'FAIR', status: 'READY' }));
  await check('repair preserves previous borrowing history', async () =>
    assert.equal((await lr({ op: 'loan', id: loanId })).close_kind, 'RETURNED'),
  );
  await check('backdated issue cannot overlap past loans', async () =>
    rejectL({ ...issueRequest, version: 4, student_id: otherStudent.id }),
  );
  const secondLoan = (
    await lw(
      keyed({
        ...issueRequest,
        version: 4,
        student_id: otherStudent.id,
        issued_on: today,
        due_on: today,
      }),
    )
  ).id;
  await lw(
    keyed({
      op: 'lost',
      id: secondLoan,
      version: 1,
      closed_on: today,
      note: 'Reported missing by learner',
    }),
  );
  await check('lost book closes borrowing and records inventory loss', async () => {
    assert.equal((await lr({ op: 'report' })).lost, 1);
    assert.equal((await lr({ op: 'loan', id: secondLoan })).close_kind, 'LOST');
  });
  await check('missing/invalid dates and archived learners cannot be issued', async () => {
    await rejectL({ ...issueRequest, copy_id: copy2Id, issued_on: future, due_on: future });
    await rejectL({ ...issueRequest, copy_id: copy2Id, due_on: `${year - 2}-01-01` });
    await as('admin');
    const enrollment = (
      await db.query(
        `select id,version from public.enrollments where school_id=$1 and student_id=$2 and status='ACTIVE'`,
        [tenant, student.id],
      )
    ).rows[0];
    await rpc('close_enrollment', [tenant, enrollment.id, enrollment.version, today, 'COMPLETED']);
    await db.query('update public.students set archived=true,version=version+1 where id=$1', [
      student.id,
    ]);
    await as('librarian');
    await rejectL({ ...issueRequest, copy_id: copy2Id, issued_on: today, due_on: today });
  });
  await check('archiving a borrower keeps authorized historical loans', async () => {
    await as('parent');
    assert.equal((await lr({ op: 'loan', id: loanId })).id, loanId);
  });
  await as('admin');
  await db.query('update public.student_parents set archived=true,version=version+1 where id=$1', [
    link.id,
  ]);
  await check('revoked family link removes library history access immediately', async () => {
    await as('parent');
    await assert.rejects(() => lr({ op: 'loan', id: loanId }));
    assert.equal((await lr({ op: 'loans' })).count, 0);
  });
  await as('librarian');
  await check('direct loan/event writes and deletes are denied', async () => {
    await denied('update public.library_loans set due_on=$1 where id=$2', [future, loanId]);
    await denied('delete from public.library_events where loan_id=$1', [loanId]);
  });
  await check('catalogue search treats wildcards literally', async () =>
    assert.equal((await lr({ op: 'books', search: '%' })).count, 0),
  );
  await check('catalogue edits retain historical loan snapshots', async () => {
    await lw(keyed({ ...bookRequest, id: bookId, version: 1, title: 'Revised reading edition' }));
    assert.equal((await lr({ op: 'loan', id: loanId })).document.title, 'Reading Together');
  });
  await check('physical copy pages contain every registered accession exactly once', async () => {
    for (let n = 0; n < 23; n++)
      await lw(keyed({ ...copyRequest, accession_number: 'LIB-X' + String(n).padStart(3, '0') }));
    const first = await lr({ op: 'copies', id: bookId, page: 0 }),
      next = await lr({ op: 'copies', id: bookId, page: 1 });
    assert.equal(first.count, 25);
    assert.equal(first.rows.length, 20);
    assert.equal(next.rows.length, 5);
    assert.equal(new Set([...first.rows, ...next.rows].map((c) => c.id)).size, 25);
  });
  await check('cross-school book IDs cannot be attached even by a multi-school admin', async () => {
    await as('admin');
    const otherTenant = await rpc('create_school', ['Other community', 'other-community']);
    const otherBook = (
      await rpc('library_write', [
        otherTenant,
        JSON.stringify(keyed({ op: 'book', title: 'Other book', author: 'Other author' })),
      ])
    ).id;
    await rejectL({ ...copyRequest, book_id: otherBook, accession_number: 'CROSS' });
    await as('librarian');
  });
  await check('library activity is audited without leaking message text to audit', async () => {
    await as('admin');
    const audit = await db.query(
      `select * from public.audit_logs where school_id=$1 and entity='library_loans'`,
      [tenant],
    );
    assert.ok(audit.rows.length >= 4);
    assert.ok(!JSON.stringify(audit.rows).includes('Torn cover'));
  });
  await check('cross-tenant IDs and outsider access are denied', async () => {
    await as('outsider');
    await assert.rejects(() => cr({ op: 'announcement', id: announcementId }));
    await assert.rejects(() => lr({ op: 'books' }));
    await rejectL({ ...copyRequest, book_id: bookId });
  });
  await as('admin');
  await rpc('set_membership', [tenant, users.librarian, 'LIBRARIAN', false]);
  await check('revoked librarian immediately loses catalogue and circulation access', async () => {
    await as('librarian');
    await assert.rejects(() => lr({ op: 'books' }));
    await rejectL({ ...bookRequest, title: 'Revoked' });
  });
  await check('anonymous users cannot read library tables or RPCs', async () => {
    await db.exec('reset role;set role anon');
    await denied('select * from public.library_books');
    await denied('select public.library_read($1,$2)', [tenant, '{"op":"books"}']);
  });
  console.log(
    `\n${checks} Phase 6 database assertions passed (embedded PostgreSQL + Storage metadata/RLS shim).`,
  );
} finally {
  await db.close();
}
