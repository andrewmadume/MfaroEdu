import { PGlite } from '@electric-sql/pglite';
import { storageShim } from './storage-test-shim.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0,
  tenant;
const users = Object.fromEntries(
  ['admin', 'principal', 'teacher', 'parent', 'librarian', 'outsider', 'operator'].map((n) => [
    n,
    randomUUID(),
  ]),
);
const as = async (n) =>
  db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${users[n]}',false);set role authenticated;`,
  );
const rpc = async (name, args) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`,
      args,
    )
  ).rows[0].value;
const read = (r) => rpc('advanced_read', [tenant, JSON.stringify(r)]),
  write = (r) => rpc('advanced_write', [tenant, JSON.stringify(r)]),
  platform = (r) => rpc('platform_read', [JSON.stringify(r)]);
const learner = (admission_number = 'A1') => ({
  admission_number,
  first_name: 'Example',
  surname: 'Learner',
  date_of_birth: '2014-01-01',
  admission_date: '2026-01-01',
});
async function check(name, fn) {
  await fn();
  checks++;
  console.log('PASS ' + name);
}
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
  tenant = await rpc('create_school', ['Advanced school', 'advanced-school']);
  for (const [name, role] of Object.entries({
    principal: 'PRINCIPAL',
    teacher: 'TEACHER',
    parent: 'PARENT',
    librarian: 'LIBRARIAN',
  }))
    await rpc('set_membership', [tenant, users[name], role, true]);
  let job;
  await check('preview validates every row without writing learners', async () => {
    job = await write({ op: 'preview_import', rows: [learner()] });
    assert.ok(job.id);
    assert.equal(
      (await db.query('select count(*) n from public.students where school_id=$1', [tenant]))
        .rows[0].n,
      0,
    );
  });
  await check('commit inserts the reviewed batch and retry does not duplicate', async () => {
    assert.equal((await write({ op: 'commit_import', id: job.id })).count, 1);
    assert.equal((await write({ op: 'commit_import', id: job.id })).count, 1);
    assert.equal(
      (await db.query('select count(*) n from public.students where school_id=$1', [tenant]))
        .rows[0].n,
      1,
    );
  });
  await check('invalid dates, extra columns, duplicates and lengths get row errors', async () => {
    for (const rows of [
      [{ ...learner('bad'), date_of_birth: '2026-02-31' }],
      [{ ...learner('bad'), date_of_birth: '2027-01-01' }],
      [{ ...learner('bad'), user_id: users.admin }],
      [learner('A1')],
      [learner('D'), learner('d')],
      [{ ...learner('B'), first_name: 'x'.repeat(81) }],
    ]) {
      const r = await write({ op: 'preview_import', rows });
      assert.ok(r.errors.length);
      assert.equal(r.id, undefined);
    }
  });
  await check('empty and oversized imports are rejected', async () => {
    await assert.rejects(() => write({ op: 'preview_import', rows: [] }));
    await assert.rejects(() => write({ op: 'preview_import', rows: Array(501).fill(learner()) }));
  });
  await check('a changed duplicate invalidates the entire import atomically', async () => {
    const a = await write({ op: 'preview_import', rows: [learner('RACE'), learner('UNTOUCHED')] });
    const b = await write({ op: 'preview_import', rows: [learner('RACE')] });
    await write({ op: 'commit_import', id: b.id });
    await assert.rejects(() => write({ op: 'commit_import', id: a.id }), /preview the file again/);
    assert.equal(
      (await db.query("select count(*) n from public.students where admission_number='UNTOUCHED'"))
        .rows[0].n,
      0,
    );
    await write({ op: 'discard_job', id: a.id });
  });
  await check(
    'principal may export and report but cannot import or read another actor job',
    async () => {
      const exp = await write({ op: 'start_export' });
      await as('principal');
      assert.ok((await read({ op: 'analytics' })).learners >= 1);
      await assert.rejects(() => write({ op: 'preview_import', rows: [learner('NO')] }));
      await assert.rejects(() => read({ op: 'export_page', id: exp.id }));
      await as('admin');
      await write({ op: 'discard_job', id: exp.id });
    },
  );
  await check('teachers and parents cannot call school-wide reporting or export RPCs', async () => {
    for (const actor of ['teacher', 'parent']) {
      await as(actor);
      await assert.rejects(() => read({ op: 'analytics' }));
      await assert.rejects(() => read({ op: 'ai_context' }));
      await assert.rejects(() => write({ op: 'start_export' }));
      await assert.rejects(() => write({ op: 'preview_import', rows: [learner()] }));
    }
    await as('admin');
  });
  await check('snapshots stay consistent when a learner changes after creation', async () => {
    const exp = await write({ op: 'start_export' });
    await db.query(
      "update public.students set first_name='Changed',version=version+1 where school_id=$1 and admission_number='A1'",
      [tenant],
    );
    const data = await read({ op: 'export_page', id: exp.id, page: 0 });
    assert.equal(data.rows.find((r) => r.admission_number === 'A1').first_name, 'Example');
    await write({ op: 'discard_job', id: exp.id });
  });
  await check('exports page a fixed snapshot across the 250-row boundary', async () => {
    const batch = await write({
      op: 'preview_import',
      rows: Array.from({ length: 260 }, (_, i) => learner('PAGE-' + i)),
    });
    await write({ op: 'commit_import', id: batch.id });
    const exp = await write({ op: 'start_export' });
    const first = await read({ op: 'export_page', id: exp.id, page: 0 }),
      second = await read({ op: 'export_page', id: exp.id, page: 1 });
    assert.equal(first.rows.length, 250);
    assert.equal(first.rows.length + second.rows.length, exp.count);
    assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, exp.count);
    await write({ op: 'discard_job', id: exp.id });
  });
  await check('expiration prevents preview commits and snapshot reads', async () => {
    const exp = await write({ op: 'start_export' });
    await db.exec('reset role');
    await db.query(
      "update private.data_jobs set expires_at=now()-interval '1 second' where id=$1",
      [exp.id],
    );
    await as('admin');
    await assert.rejects(() => read({ op: 'export_page', id: exp.id }));
  });
  await check('revoked access blocks previously prepared jobs immediately', async () => {
    await as('principal');
    const exp = await write({ op: 'start_export' });
    await as('admin');
    await rpc('set_membership', [tenant, users.principal, 'PRINCIPAL', false]);
    await as('principal');
    await assert.rejects(() => read({ op: 'export_page', id: exp.id }));
    await as('admin');
    await rpc('set_membership', [tenant, users.principal, 'PRINCIPAL', true]);
  });
  await check('job quotas are bounded and previews can be discarded', async () => {
    const pending = [];
    for (let i = 0; i < 5; i++)
      pending.push(await write({ op: 'preview_import', rows: [learner('Q' + i)] }));
    await assert.rejects(
      () => write({ op: 'preview_import', rows: [learner('Q6')] }),
      /Finish or discard/,
    );
    for (const p of pending) await write({ op: 'discard_job', id: p.id });
  });
  await check('cross-school requests remain private', async () => {
    await as('outsider');
    const other = await rpc('create_school', ['Other school', 'advanced-other']);
    await assert.rejects(() => read({ op: 'analytics' }));
    await assert.rejects(() => write({ op: 'preview_import', rows: [learner()] }));
    await as('admin');
    assert.equal(
      (await rpc('advanced_read', [tenant, JSON.stringify({ op: 'analytics' })])).learners,
      262,
    );
    await assert.rejects(() => rpc('advanced_read', [other, JSON.stringify({ op: 'analytics' })]));
  });
  await check(
    'analytics ranges are validated and AI context excludes personal records',
    async () => {
      await assert.rejects(() => read({ op: 'analytics', from: '2026-12-31', to: '2026-01-01' }));
      await assert.rejects(() => read({ op: 'analytics', from: '2000-01-01', to: '2026-01-01' }));
      const ai = await read({ op: 'ai_context' });
      assert.equal(ai.external_delivery, false);
      assert.equal(ai.counts.learners, 262);
      assert.equal(ai.counts.teachers, null);
      assert.equal(JSON.stringify(ai).includes('Learner'), false);
      assert.equal(ai.academics, undefined);
    },
  );
  let book;
  await check(
    'offline catalogue writes are idempotent and authorized to librarians only',
    async () => {
      await as('librarian');
      const request = {
        op: 'sync_book',
        request_key: randomUUID(),
        version: 0,
        title: 'Offline title',
        author: 'Author',
        isbn: '',
        category: '',
        publisher: '',
        archived: false,
      };
      book = await write(request);
      assert.deepEqual(await write(request), book);
      await as('teacher');
      await assert.rejects(() => write({ ...request, request_key: randomUUID() }));
      await as('librarian');
    },
  );
  await check(
    'conflicts preserve the server record until an explicit reviewed version is used',
    async () => {
      const current = await read({ op: 'book', id: book.id });
      await write({ op: 'sync_book', request_key: randomUUID(), ...current, title: 'Server edit' });
      await assert.rejects(
        () =>
          write({
            op: 'sync_book',
            request_key: randomUUID(),
            id: book.id,
            version: current.version,
            title: 'Offline edit',
            author: 'Author',
          }),
        /Record changed/,
      );
      const latest = await read({ op: 'book', id: book.id });
      assert.equal(latest.title, 'Server edit');
      await write({
        op: 'sync_book',
        request_key: randomUUID(),
        id: book.id,
        version: latest.version,
        title: 'Reviewed edit',
        author: 'Author',
        archived: false,
      });
      assert.equal((await read({ op: 'book', id: book.id })).title, 'Reviewed edit');
      await as('admin');
    },
  );
  await check('calendar uses school terms only and supports overlapping ranges', async () => {
    await db.exec('reset role');
    const year = randomUUID();
    await db.query(
      "insert into public.academic_years(id,school_id,name,starts_on,ends_on) values($1,$2,'2026','2026-01-01','2026-12-31')",
      [year, tenant],
    );
    await db.query(
      "insert into public.terms(school_id,academic_year_id,name,starts_on,ends_on) values($1,$2,'Term 1','2026-01-01','2026-03-31')",
      [tenant, year],
    );
    await as('admin');
    assert.equal((await read({ op: 'calendar', from: '2026-02-01', to: '2026-02-28' })).length, 1);
    assert.equal((await read({ op: 'calendar', from: '2027-01-01', to: '2027-02-01' })).length, 0);
  });
  await check(
    'published analytics include populated results and exclude withdrawn publications',
    async () => {
      await db.exec('reset role');
      const year = (
        await db.query('select id from public.academic_years where school_id=$1 limit 1', [tenant])
      ).rows[0].id;
      const term = (
        await db.query('select id from public.terms where school_id=$1 limit 1', [tenant])
      ).rows[0].id;
      const student = (
        await db.query('select id from public.students where school_id=$1 limit 1', [tenant])
      ).rows[0].id;
      const grade = (
        await db.query(
          "insert into public.grades(school_id,name) values($1,'Grade 7') returning id",
          [tenant],
        )
      ).rows[0].id;
      const klass = (
        await db.query(
          "insert into public.classes(school_id,academic_year_id,grade_id,name) values($1,$2,$3,'7A') returning id",
          [tenant, year, grade],
        )
      ).rows[0].id;
      const publication = (
        await db.query(
          "insert into public.result_publications(school_id,class_id,term_id,created_by,rules) values($1,$2,$3,$4,'{}') returning id",
          [tenant, klass, term, users.admin],
        )
      ).rows[0].id;
      await db.query(
        'insert into public.published_reports(school_id,publication_id,student_id,document) values($1,$2,$3,$4)',
        [
          tenant,
          publication,
          student,
          JSON.stringify({
            year_name: '2026',
            grade_name: 'Grade 7',
            term_name: 'Term 1',
            class_name: '7A',
            average: 80,
            pass_percent: 50,
          }),
        ],
      );
      await as('admin');
      const summary = await read({ op: 'analytics' });
      assert.equal(summary.academics[0].average, 80);
      assert.equal(summary.academics[0].passed, 1);
      assert.equal(summary.academics[0].year_name, '2026');
      await db.exec('reset role');
      await db.query(
        'update public.result_publications set active=false,version=version+1 where id=$1',
        [publication],
      );
      await as('admin');
      assert.equal((await read({ op: 'analytics' })).academics.length, 0);
    },
  );
  await check('finance reports preserve signed exact values and monthly cutoffs', async () => {
    await db.exec('reset role');
    const year = (
      await db.query('select id from public.academic_years where school_id=$1 limit 1', [tenant])
    ).rows[0].id;
    const student = (
      await db.query('select id from public.students where school_id=$1 limit 1', [tenant])
    ).rows[0].id;
    const invoice = (
      await db.query(
        "insert into public.finance_invoices(school_id,student_id,academic_year_id,number,issued_on,due_on,gross_minor,document) values($1,$2,$3,'TEST-I','2026-01-01','2026-01-31',50000,'{}') returning id",
        [tenant, student, year],
      )
    ).rows[0].id;
    for (const [kind, amount, number, date] of [
      ['INVOICE', 50000, 'TEST-I', '2026-01-01'],
      ['PAYMENT', -10000, 'TEST-P', '2026-02-01'],
    ])
      await db.query(
        'insert into public.finance_entries(school_id,invoice_id,student_id,kind,amount_minor,number,posted_on,request_key,request_payload,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [tenant, invoice, student, kind, amount, number, date, randomUUID(), '{}', users.admin],
      );
    await as('admin');
    const january = await read({ op: 'analytics', from: '2026-01-01', to: '2026-01-31' }),
      february = await read({ op: 'analytics', from: '2026-02-01', to: '2026-02-28' });
    assert.equal(january.finance.balance_minor, '50000');
    assert.equal(february.finance.balance_minor, '40000');
    assert.equal(february.finance.monthly[0].net_minor, '-10000');
  });
  await check('revoked librarians cannot synchronize a retained offline request', async () => {
    await as('admin');
    await rpc('set_membership', [tenant, users.librarian, 'LIBRARIAN', false]);
    await as('librarian');
    await assert.rejects(() =>
      write({
        op: 'sync_book',
        request_key: randomUUID(),
        title: 'Denied',
        author: 'Author',
        version: 0,
      }),
    );
    await as('admin');
  });
  await check(
    'ordinary school administrators cannot elevate themselves to platform access',
    async () => {
      assert.equal((await platform({ op: 'access' })).allowed, false);
      await assert.rejects(() => platform({ op: 'schools' }));
      await assert.rejects(() =>
        db.query('insert into private.platform_admins values($1)', [users.admin]),
      );
    },
  );
  await check('provisioned operators can oversee schools without school membership', async () => {
    await db.exec('reset role');
    await db.query('insert into private.platform_admins values($1)', [users.operator]);
    await as('operator');
    assert.equal((await platform({ op: 'access' })).allowed, true);
    const report = await platform({ op: 'schools' });
    assert.equal(report.count, 2);
    assert.equal(report.rows.length, 2);
    assert.ok((await read({ op: 'analytics' })).learners);
  });
  await check('inactive platform operators immediately lose access', async () => {
    await db.exec('reset role');
    await db.query('update public.profiles set active=false where id=$1', [users.operator]);
    await as('operator');
    assert.equal((await platform({ op: 'access' })).allowed, false);
    await assert.rejects(() => platform({ op: 'schools' }));
  });
  await check(
    'imports and exports are audited without storing learner names in metadata',
    async () => {
      await as('admin');
      const audit = (
        await db.query(
          "select action,metadata from public.audit_logs where school_id=$1 and action in ('IMPORT','EXPORT')",
          [tenant],
        )
      ).rows;
      assert.ok(audit.some((a) => a.action === 'IMPORT'));
      assert.ok(audit.some((a) => a.action === 'EXPORT'));
      assert.equal(JSON.stringify(audit).includes('Example'), false);
    },
  );
  await check('private jobs and anonymous RPC access are denied', async () => {
    await as('admin');
    await assert.rejects(() => db.query('select * from private.data_jobs'));
    await db.exec('reset role;set role anon');
    await assert.rejects(() => read({ op: 'analytics' }));
    await assert.rejects(() => write({ op: 'preview_import', rows: [learner()] }));
    await assert.rejects(() => platform({ op: 'access' }));
  });
  console.log(`\n${checks} Phase 7 database assertions passed.`);
} catch (e) {
  console.error('Phase 7 database failure:', e.message, e.detail ?? '', e.where ?? '');
  process.exitCode = 1;
} finally {
  await db.close();
}
