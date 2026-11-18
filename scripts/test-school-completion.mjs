import { PGlite } from '@electric-sql/pglite';
import { storageShim } from './storage-test-shim.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite();
let tenant,
  other,
  checks = 0;
const users = Object.fromEntries(
  ['admin', 'principal', 'teacher', 'parent', 'student', 'staff', 'outsider', 'invitee'].map(
    (n) => [n, randomUUID()],
  ),
);
const as = async (n) =>
  db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${users[n]}',false);set role authenticated;`,
  );
const call = async (name, school, r) =>
  (await db.query(`select public.${name}($1,$2) value`, [school, JSON.stringify(r)])).rows[0].value;
const tools = (r) => call('school_tools', tenant, r),
  data = (r) => call('school_data', tenant, r);
const create = async (table, v) => {
  const k = Object.keys(v);
  return (
    await db.query(
      `insert into public.${table}(${k}) values(${k.map((_, i) => '$' + (i + 1))}) returning *`,
      Object.values(v),
    )
  ).rows[0];
};
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log('PASS ' + name);
};
const deny = (fn) => assert.rejects(fn);
try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(storageShim);
  for (const f of (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(await readFile(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8'));
  for (const [name, id] of Object.entries(users))
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
      id,
      `${name}@example.test`,
    ]);
  await as('admin');
  tenant = (
    await db.query("select public.create_school('Completion School','completion-school') id")
  ).rows[0].id;
  for (const [n, r] of Object.entries({
    principal: 'PRINCIPAL',
    teacher: 'TEACHER',
    parent: 'PARENT',
    student: 'STUDENT',
    staff: 'ACCOUNTANT',
  }))
    await db.query('select public.set_membership($1,$2,$3,true)', [tenant, users[n], r]);
  other = (await db.query("select public.create_school('Other School','other-completion') id"))
    .rows[0].id;
  const year = await create('academic_years', {
      school_id: tenant,
      name: '2026',
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
    }),
    grade = await create('grades', { school_id: tenant, name: '7' }),
    klass = await create('classes', {
      school_id: tenant,
      name: '7A',
      academic_year_id: year.id,
      grade_id: grade.id,
    });
  const student = await create('students', {
    school_id: tenant,
    admission_number: 'S1',
    first_name: 'Example',
    surname: 'Learner',
    date_of_birth: '2014-01-01',
    admission_date: '2026-01-01',
    user_id: users.student,
  });
  const guardian = await create('parents', {
    school_id: tenant,
    first_name: 'Example',
    surname: 'Parent',
    user_id: users.parent,
  });
  const link = await create('student_parents', {
    school_id: tenant,
    student_id: student.id,
    parent_id: guardian.id,
    relationship: 'Parent',
  });
  const staff = await create('staff', {
    school_id: tenant,
    employee_number: 'E1',
    first_name: 'Staff',
    surname: 'Example',
    position: 'Accountant',
    user_id: users.staff,
    is_teacher: false,
  });
  const event = {
    op: 'save_event',
    request_key: randomUUID(),
    title: 'Parent meeting',
    description: 'Private audience',
    category: 'PARENT_MEETING',
    starts_at: '2026-11-20T08:00:00Z',
    ends_at: '2026-11-20T09:00:00Z',
    roles: ['PARENT'],
    class_id: null,
  };
  let e;
  await check('calendar creation retries return the same event', async () => {
    e = await tools(event);
    assert.equal((await tools(event)).id, e.id);
  });
  await check('changed event retry and invalid time ranges are rejected', async () => {
    await deny(() => tools({ ...event, title: 'Changed' }));
    await deny(() => tools({ ...event, request_key: randomUUID(), ends_at: event.starts_at }));
  });
  await check('event audiences are enforced at SQL RLS', async () => {
    await as('teacher');
    assert.equal((await db.query('select * from public.school_events')).rows.length, 0);
    await as('parent');
    assert.equal((await db.query('select * from public.school_events')).rows.length, 1);
  });
  await check('teachers cannot mutate calendar through RPC or direct writes', async () => {
    await as('teacher');
    await deny(() => tools({ ...event, request_key: randomUUID() }));
    await deny(() => create('school_events', { school_id: tenant, title: 'Bypass' }));
  });
  await check('class events exclude unrelated families', async () => {
    await as('admin');
    await tools({ ...event, request_key: randomUUID(), title: 'Class only', class_id: klass.id });
    await as('parent');
    assert.equal((await db.query('select * from public.school_events')).rows.length, 1);
    await as('admin');
    const placement = (
      await db.query('select public.enroll_student($1,$2,$3,$4) id', [
        tenant,
        student.id,
        klass.id,
        '2026-01-01',
      ])
    ).rows[0].id;
    await db.query('select public.close_enrollment($1,$2,$3,$4,$5)', [
      tenant,
      placement,
      1,
      '2026-06-30',
      'TRANSFERRED',
    ]);
    await as('parent');
    assert.equal(
      (await db.query('select * from public.school_events')).rows.length,
      1,
      'An old placement must not reveal a future class event',
    );
  });
  await check('stale event edits and foreign-school classes are rejected', async () => {
    await as('admin');
    await tools({ ...e, op: 'save_event', title: 'Updated', version: e.version });
    await deny(() => tools({ ...e, op: 'save_event', title: 'Stale' }));
    await deny(() =>
      call('school_tools', other, { ...event, request_key: randomUUID(), class_id: klass.id }),
    );
  });
  let invitation;
  await check('invitations never expose stored tokens in list responses', async () => {
    invitation = await tools({
      op: 'create_invitation',
      email: 'invitee@example.test',
      role_id: 'TEACHER',
    });
    assert.equal(invitation.token.length, 64);
    const list = await tools({ op: 'invitations' });
    assert.equal(list.length, 1);
    assert.equal(JSON.stringify(list).includes(invitation.token), false);
  });
  await check('ordinary members cannot invite or grant platform roles', async () => {
    await as('teacher');
    await deny(() =>
      tools({ op: 'create_invitation', email: 'x@example.test', role_id: 'PARENT' }),
    );
    await as('admin');
    await deny(() =>
      tools({ op: 'create_invitation', email: 'x@example.test', role_id: 'SUPER_ADMIN' }),
    );
  });
  await check('invitation links are bound to server-verified email', async () => {
    await as('outsider');
    await deny(() =>
      call('school_tools', null, { op: 'accept_invitation', token: invitation.token }),
    );
    await db.exec('reset role');
    await db.query('update auth.users set raw_user_meta_data=$1 where id=$2', [
      JSON.stringify({ email: 'invitee@example.test' }),
      users.outsider,
    ]);
    await as('outsider');
    await deny(() =>
      call('school_tools', null, { op: 'accept_invitation', token: invitation.token }),
    );
  });
  await check('unverified invitee cannot accept a link', async () => {
    await db.exec('reset role');
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [users.invitee]);
    await as('invitee');
    await deny(() =>
      call('school_tools', null, { op: 'accept_invitation', token: invitation.token }),
    );
    await db.exec('reset role');
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [users.invitee]);
  });
  await check('verified acceptance is idempotent and grants only the invited role', async () => {
    await as('invitee');
    assert.equal(
      (await call('school_tools', null, { op: 'accept_invitation', token: invitation.token }))
        .school_id,
      tenant,
    );
    await call('school_tools', null, { op: 'accept_invitation', token: invitation.token });
    assert.deepEqual(
      (
        await db.query('select role_id from public.user_roles where school_id=$1 and user_id=$2', [
          tenant,
          users.invitee,
        ])
      ).rows,
      [{ role_id: 'TEACHER' }],
    );
    await as('admin');
    const receipts = await tools({ op: 'invitations' });
    assert.equal(receipts.find((i) => i.id === invitation.id).accepted_by, users.invitee);
  });
  await check('revoked and expired invitations cannot be accepted', async () => {
    await as('admin');
    const i = await tools({
      op: 'create_invitation',
      email: 'outsider@example.test',
      role_id: 'PARENT',
    });
    await tools({ op: 'revoke_invitation', id: i.id });
    await as('outsider');
    await deny(() => call('school_tools', null, { op: 'accept_invitation', token: i.token }));
    await as('admin');
    const x = await tools({
      op: 'create_invitation',
      email: 'outsider@example.test',
      role_id: 'PARENT',
    });
    await db.exec('reset role');
    await db.query(
      "update private.school_invitations set expires_at=now()-interval '1 second' where id=$1",
      [x.id],
    );
    await as('outsider');
    await deny(() => call('school_tools', null, { op: 'accept_invitation', token: x.token }));
  });
  let doc;
  const reserve = {
    op: 'reserve_document',
    id: randomUUID(),
    title: 'Learner certificate',
    filename: 'certificate.pdf',
    mime_type: 'application/pdf',
    byte_size: 12,
    audience: 'LEARNER',
    student_id: student.id,
  };
  await check('private document reservation retries preserve a single record', async () => {
    await as('admin');
    doc = await tools(reserve);
    assert.equal((await tools(reserve)).id, doc.id);
    await deny(() => tools({ ...reserve, title: 'Different' }));
  });
  await check('unsafe filenames, unsupported types and foreign learners are rejected', async () => {
    await deny(() => tools({ ...reserve, id: randomUUID(), filename: '../bad.pdf' }));
    await deny(() => tools({ ...reserve, id: randomUUID(), mime_type: 'text/html' }));
    await deny(() => call('school_tools', other, { ...reserve, id: randomUUID() }));
  });
  await check('pending documents are hidden and finalization verifies real metadata', async () => {
    await deny(() => tools({ op: 'finish_document', id: doc.id, version: doc.version }));
    await as('parent');
    assert.equal((await db.query('select * from public.school_documents')).rows.length, 0);
    await as('admin');
  });
  await check('Storage upload requires a reservation and forbids overwrite', async () => {
    await deny(() =>
      db.query("insert into storage.objects(bucket_id,name) values('mfaroedu-documents',$1)", [
        tenant + '/' + randomUUID() + '/file',
      ]),
    );
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('mfaroedu-documents',$1,$2)",
      [tenant + '/' + doc.id + '/file', JSON.stringify({ size: 12, mimetype: 'application/pdf' })],
    );
    doc = await tools({ op: 'finish_document', id: doc.id, version: doc.version });
    await deny(() =>
      db.query("insert into storage.objects(bucket_id,name) values('mfaroedu-documents',$1)", [
        tenant + '/' + doc.id + '/file',
      ]),
    );
  });
  await check(
    'linked families see ready learner documents, unrelated teachers do not',
    async () => {
      await as('parent');
      assert.equal((await db.query('select * from public.school_documents')).rows.length, 1);
      assert.equal(
        (await db.query("select * from storage.objects where bucket_id='mfaroedu-documents'")).rows
          .length,
        1,
      );
      await as('teacher');
      assert.equal((await db.query('select * from public.school_documents')).rows.length, 0);
    },
  );
  await check(
    'guardian-link revocation immediately removes document and object access',
    async () => {
      await as('admin');
      await db.query(
        'update public.student_parents set archived=true,version=version+1 where id=$1',
        [link.id],
      );
      await as('parent');
      assert.equal((await db.query('select * from public.school_documents')).rows.length, 0);
      assert.equal(
        (await db.query("select * from storage.objects where bucket_id='mfaroedu-documents'")).rows
          .length,
        0,
      );
    },
  );
  await check(
    'personal staff documents are visible only to that staff account and managers',
    async () => {
      await as('admin');
      const s = await tools({
        ...reserve,
        id: randomUUID(),
        audience: 'STAFF_MEMBER',
        student_id: null,
        staff_id: staff.id,
      });
      await db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('mfaroedu-documents',$1,$2)",
        [tenant + '/' + s.id + '/file', JSON.stringify({ size: 12, mimetype: 'application/pdf' })],
      );
      await tools({ op: 'finish_document', id: s.id, version: s.version });
      await as('staff');
      assert.equal((await db.query('select * from public.school_documents')).rows.length, 1);
      await as('teacher');
      assert.equal((await db.query('select * from public.school_documents')).rows.length, 0);
    },
  );
  await check(
    'archive revokes downloads before file cleanup, and live bytes cannot be deleted',
    async () => {
      await as('admin');
      const deleted = await db.query(
        "delete from storage.objects where bucket_id='mfaroedu-documents' and name=$1 returning id",
        [tenant + '/' + doc.id + '/file'],
      );
      assert.equal(deleted.rows.length, 0);
      await tools({ op: 'archive_document', id: doc.id, version: doc.version });
      await as('student');
      assert.equal((await db.query('select * from public.school_documents')).rows.length, 0);
      await as('admin');
      assert.equal(
        (
          await db.query(
            "delete from storage.objects where bucket_id='mfaroedu-documents' and name=$1 returning id",
            [tenant + '/' + doc.id + '/file'],
          )
        ).rows.length,
        1,
      );
    },
  );
  const teacherRow = {
    employee_number: 'NEW1',
    first_name: 'New',
    surname: 'Teacher',
    position: 'Teacher',
    department: 'Science',
    email: 'new@example.test',
  };
  let job;
  await check(
    'teacher import is a no-write preview followed by atomic idempotent commit',
    async () => {
      job = await data({ op: 'preview', module: 'staff', rows: [teacherRow] });
      assert.ok(job.id);
      assert.equal(
        (await db.query("select * from public.staff where employee_number='NEW1'")).rows.length,
        0,
      );
      assert.equal((await data({ op: 'commit', id: job.id })).count, 1);
      assert.equal((await data({ op: 'commit', id: job.id })).count, 1);
    },
  );
  await check('subject imports reject extra columns and case-insensitive duplicates', async () => {
    assert.equal(
      (
        await data({
          op: 'preview',
          module: 'subjects',
          rows: [{ code: 'Math', name: 'Math', extra: 'bad' }],
        })
      ).errors.length,
      1,
    );
    assert.equal(
      (
        await data({
          op: 'preview',
          module: 'subjects',
          rows: [
            { code: 'A', name: 'A' },
            { code: 'a', name: 'B' },
          ],
        })
      ).errors.length,
      2,
    );
  });
  await check('subject commit rechecks conflicts and inserts nothing on failure', async () => {
    job = await data({
      op: 'preview',
      module: 'subjects',
      rows: [
        { code: 'NEW', name: 'New' },
        { code: 'CONFLICT', name: 'Conflict' },
      ],
    });
    await create('subjects', { school_id: tenant, code: 'CONFLICT', name: 'Existing' });
    await deny(() => data({ op: 'commit', id: job.id }));
    assert.equal((await db.query("select * from public.subjects where code='NEW'")).rows.length, 0);
    await data({ op: 'discard', id: job.id });
  });
  await check('principal exports every supported module with actor-owned snapshots', async () => {
    await as('principal');
    for (const module of [
      'students',
      'staff',
      'subjects',
      'attendance',
      'results',
      'fees',
      'library',
    ]) {
      const j = await data({ op: 'start_export', module });
      assert.ok(j.id);
      assert.ok(Array.isArray((await data({ op: 'export_page', id: j.id, page: 0 })).rows));
      if (module !== 'students')
        await deny(() => call('advanced_read', tenant, { op: 'export_page', id: j.id, page: 0 }));
      await as('admin');
      await deny(() => data({ op: 'export_page', id: j.id, page: 0 }));
      await as('principal');
      await data({ op: 'discard', id: j.id });
    }
  });
  await check('teachers cannot import or create private exports', async () => {
    await as('teacher');
    await deny(() => data({ op: 'preview', module: 'staff', rows: [teacherRow] }));
    await deny(() => data({ op: 'start_export', module: 'attendance' }));
  });
  await check('branding validates HTTPS and rejects active content logos', async () => {
    await as('admin');
    await deny(() =>
      db.query("update public.schools set website='javascript:bad',version=version+1 where id=$1", [
        tenant,
      ]),
    );
    await deny(() =>
      db.query(
        "update public.schools set logo_data='data:image/svg+xml;base64,abcd',version=version+1 where id=$1",
        [tenant],
      ),
    );
    await db.query(
      "update public.schools set website='https://school.example',report_title='Progress report',report_layout='COMPACT',version=version+1 where id=$1",
      [tenant],
    );
  });
  await check('public privileged functions are invokers and new tables have RLS', async () => {
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('school_events','school_documents') and c.relrowsecurity",
        )
      ).rows[0].n,
      2,
    );
  });
  await check(
    'outsiders and anonymous requests cannot read resources or execute tools',
    async () => {
      await as('outsider');
      assert.equal((await db.query('select * from public.school_documents')).rows.length, 0);
      assert.equal((await db.query('select * from public.school_events')).rows.length, 0);
      await deny(() => tools({ op: 'invitations' }));
      await db.exec('reset role;set role anon');
      await deny(() => tools({ op: 'invitations' }));
      await deny(() => data({ op: 'start_export', module: 'staff' }));
    },
  );
  console.log(`\n${checks} completion security/workflow assertions passed.`);
} catch (e) {
  console.error('Completion database failure:', e.message, e.detail ?? '', e.where ?? '');
  process.exitCode = 1;
} finally {
  await db.close();
}
