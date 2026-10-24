import { PGlite } from '@electric-sql/pglite';
import { storageShim } from './storage-test-shim.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite();
let checks = 0;
const users = Object.fromEntries(
  ['admin', 'accountant', 'principal', 'teacher', 'parent', 'student', 'stranger', 'outsider'].map(
    (n) => [n, randomUUID()],
  ),
);
async function as(n) {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${users[n]}',false);set role authenticated;`,
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
let tenant;
const write = (v) => rpc('finance_write', [tenant, JSON.stringify(v)]),
  read = (v) => rpc('finance_read', [tenant, JSON.stringify(v)]);
const rejectWrite = (v) => assert.rejects(() => write(v));
const keyed = (v) => ({ ...v, request_key: randomUUID() });
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
  tenant = await rpc('create_school', ['Finance school', 'finance-school']);
  for (const [name, role] of Object.entries({
    accountant: 'ACCOUNTANT',
    principal: 'PRINCIPAL',
    teacher: 'TEACHER',
    parent: 'PARENT',
    student: 'STUDENT',
    stranger: 'PARENT',
  }))
    await rpc('set_membership', [tenant, users[name], role, true]);
  const today = (await db.query(`select (now() at time zone 'Africa/Johannesburg')::date::text d`))
      .rows[0].d,
    year = Number(today.slice(0, 4));
  const academic = await create('academic_years', {
    school_id: tenant,
    name: String(year),
    starts_on: `${year}-01-01`,
    ends_on: `${year}-12-31`,
  });
  const grade = await create('grades', { school_id: tenant, name: 'Grade 7' }),
    grade2 = await create('grades', { school_id: tenant, name: 'Grade 8' });
  const klass = await create('classes', {
    school_id: tenant,
    name: '7A',
    academic_year_id: academic.id,
    grade_id: grade.id,
  });
  const learner = await create('students', {
    school_id: tenant,
    admission_number: 'F001',
    first_name: 'Alex',
    surname: 'Learner',
    date_of_birth: `${year - 12}-01-01`,
    admission_date: `${year}-01-01`,
    user_id: users.student,
  });
  const other = await create('students', {
    school_id: tenant,
    admission_number: 'F002',
    first_name: 'Other',
    surname: 'Learner',
    date_of_birth: `${year - 12}-01-01`,
    admission_date: `${year}-01-01`,
  });
  const parent = await create('parents', {
    school_id: tenant,
    first_name: 'Alex',
    surname: 'Guardian',
    user_id: users.parent,
  });
  await create('student_parents', {
    school_id: tenant,
    student_id: learner.id,
    parent_id: parent.id,
    relationship: 'Guardian',
  });
  await rpc('enroll_student', [tenant, learner.id, klass.id, `${year}-01-01`]);
  const outsiderTenant = await rpc('create_school', ['Other school', 'other-finance']);
  await as('accountant');
  await check('accountant cannot read learner private profiles', async () => {
    assert.equal(
      (await db.query('select * from public.students where school_id=$1', [tenant])).rows.length,
      0,
    );
  });
  await check('minimal financial learner lookup omits birth dates and users', async () => {
    const r = await read({ op: 'learners' });
    assert.equal(r.count, 2);
    assert.deepEqual(Object.keys(r.rows[0]).sort(), ['admission_number', 'archived', 'id', 'name']);
  });
  await check('learner search escapes wildcard characters', async () =>
    assert.equal((await read({ op: 'learners', search: '%' })).count, 0),
  );
  await write({ op: 'settings', currency: 'ZAR', decimal_places: 2, version: 0 });
  let setup = await read({ op: 'setup' });
  const cat = (await write({ op: 'category', name: 'Tuition' })).id;
  const feeRequest = {
    op: 'fee',
    name: 'Term tuition',
    category_id: cat,
    academic_year_id: academic.id,
    grade_id: grade.id,
    amount_minor: '10001',
  };
  const feeId = (await write(feeRequest)).id;
  await check('fee creation is audited', async () => {
    await as('admin');
    assert.ok(
      (
        await db.query(
          `select * from public.audit_logs where school_id=$1 and entity='fee_structures'`,
          [tenant],
        )
      ).rows.length,
    );
    await as('accountant');
  });
  await check('invalid and cross-school fee resources rejected', async () => {
    await rejectWrite({ ...feeRequest, amount_minor: '0' });
    await rejectWrite({ ...feeRequest, academic_year_id: randomUUID() });
  });
  const issue = () =>
    keyed({
      op: 'invoice',
      student_id: learner.id,
      academic_year_id: academic.id,
      issued_on: today,
      due_on: today,
      items: [{ fee_id: feeId, version: 1, quantity: 2 }],
    });
  await check('unregistered learner cannot be invoiced', async () =>
    rejectWrite({ ...issue(), student_id: other.id }),
  );
  await check('missing and stale fee versions rejected', async () => {
    await rejectWrite({ ...issue(), items: [{ fee_id: feeId, quantity: 1 }] });
    await rejectWrite({ ...issue(), items: [{ fee_id: feeId, version: 9, quantity: 1 }] });
  });
  await check('invoice dates and quantities validated', async () => {
    await rejectWrite({ ...issue(), due_on: `${year - 1}-01-01` });
    await rejectWrite({ ...issue(), items: [{ fee_id: feeId, version: 1, quantity: 0 }] });
    await rejectWrite({ ...issue(), issued_on: `${year + 1}-01-01`, due_on: `${year + 1}-01-02` });
  });
  const wrongGrade = (await write({ ...feeRequest, name: 'Grade 8 fee', grade_id: grade2.id })).id;
  await check('grade-specific fees require matching enrollment', async () =>
    rejectWrite({ ...issue(), items: [{ fee_id: wrongGrade, version: 1, quantity: 1 }] }),
  );
  const originalRequest = issue(),
    invoiceId = (await write(originalRequest)).id;
  let inv = await read({ op: 'invoice', id: invoiceId });
  await check('invoice uses exact integer arithmetic and snapshot', async () => {
    assert.equal(inv.gross_minor, '20002');
    assert.equal(inv.balance_minor, '20002');
    assert.equal(inv.document.items[0].total_minor, '20002');
    assert.equal(inv.document.learner, 'Alex Learner');
  });
  await check('invoice retry is idempotent', async () => {
    assert.equal((await write(originalRequest)).id, invoiceId);
    assert.equal((await read({ op: 'account', student_id: learner.id })).count, 1);
    await rejectWrite({ ...originalRequest, due_on: `${year + 1}-01-01` });
  });
  await check('currency and precision lock after issue', async () => {
    await rejectWrite({
      op: 'settings',
      version: setup.settings.version,
      currency: 'ZAR',
      decimal_places: 3,
    });
    await as('admin');
    await denied(`update public.schools set currency='USD',version=version+1 where id=$1`, [
      tenant,
    ]);
    await as('accountant');
  });
  await check('fee changes preserve invoice snapshot', async () => {
    await write({
      ...feeRequest,
      id: feeId,
      version: 1,
      amount_minor: '99999',
      name: 'Changed tuition',
    });
    const r = await read({ op: 'invoice', id: invoiceId });
    assert.equal(r.document.items[0].description, 'Term tuition');
    assert.equal(r.gross_minor, '20002');
  });
  const post = (op, extra = {}) =>
    keyed({
      op,
      id: invoiceId,
      version: inv.version,
      posted_on: today,
      amount_minor: '5001',
      method: 'BANK_TRANSFER',
      reference: 'BANK-1',
      reason: 'Approved school concession',
      ...extra,
    });
  const paymentRequest = post('PAYMENT'),
    paymentId = (await write(paymentRequest)).entry_id;
  inv = await read({ op: 'invoice', id: invoiceId });
  const receipt = inv.entries.find((e) => e.id === paymentId).document;
  await check('partial payment updates balance and creates receipt', async () => {
    assert.equal(inv.balance_minor, '15001');
    assert.match(inv.entries.find((e) => e.id === paymentId).number, /^RCT-/);
    assert.equal(receipt.amount_minor, '-5001');
    assert.equal(inv.version, 2);
  });
  await check('retrying payment does not duplicate entry', async () => {
    assert.equal((await write(paymentRequest)).entry_id, paymentId);
    assert.equal((await read({ op: 'invoice', id: invoiceId })).entries.length, 2);
    await rejectWrite({ ...paymentRequest, amount_minor: '5002' });
  });
  await check('stale concurrent payment rejected', async () =>
    rejectWrite({ ...post('PAYMENT'), version: 1 }),
  );
  await check('overpayments and invalid dates roll back atomically', async () => {
    await rejectWrite(post('PAYMENT', { amount_minor: '15002' }));
    await rejectWrite(post('PAYMENT', { posted_on: `${year + 1}-01-01` }));
    assert.equal((await read({ op: 'invoice', id: invoiceId })).version, 2);
  });
  await check('direct ledger writes and deletes denied', async () => {
    await denied('update public.finance_entries set amount_minor=1 where id=$1', [paymentId]);
    await denied('delete from public.finance_entries where id=$1', [paymentId]);
    await denied(`insert into public.finance_entries(school_id) values($1)`, [tenant]);
    await denied(`update public.finance_invoices set status='VOID' where id=$1`, [invoiceId]);
  });
  const discount = (await write(post('DISCOUNT', { amount_minor: '1001' }))).entry_id;
  inv = await read({ op: 'invoice', id: invoiceId });
  const bursary = (await write(post('BURSARY', { amount_minor: '2000' }))).entry_id;
  inv = await read({ op: 'invoice', id: invoiceId });
  await check('discounts and bursaries reduce outstanding exactly', async () =>
    assert.equal(inv.balance_minor, '12000'),
  );
  await check('concessions and reversals require reason', async () => {
    await rejectWrite(post('DISCOUNT', { reason: '' }));
    await rejectWrite(post('REVERSAL', { original_entry_id: paymentId, reason: '' }));
  });
  await check('invoice cannot be voided with active credits', async () =>
    rejectWrite(post('VOID')),
  );
  await write(post('REVERSAL', { original_entry_id: paymentId }));
  inv = await read({ op: 'invoice', id: invoiceId });
  await check('full reversal restores balance and retains original receipt', async () => {
    assert.equal(inv.balance_minor, '17001');
    const entry = inv.entries.find((e) => e.id === paymentId);
    assert.equal(entry.reversed, true);
    assert.deepEqual(entry.document, receipt);
    await rejectWrite(post('REVERSAL', { original_entry_id: paymentId }));
  });
  await check('statement has exact opening, running and closing balances', async () => {
    const s = await read({ op: 'statement', student_id: learner.id, from: today, to: today });
    assert.equal(s.opening_minor, '0');
    assert.equal(s.closing_minor, '17001');
    assert.equal(s.rows.at(-1).running_minor, '17001');
  });
  await check('financial report nets payment reversals and concessions', async () => {
    const r = await read({ op: 'report', from: today, to: today });
    assert.equal(r.billed_minor, '20002');
    assert.equal(r.collected_minor, '0');
    assert.equal(r.concessions_minor, '3001');
    assert.equal(r.outstanding_minor, '17001');
  });
  await check('reports before the first invoice exclude later activity', async () => {
    const r = await read({ op: 'report', from: `${year - 1}-01-01`, to: `${year - 1}-12-31` });
    assert.equal(r.billed_minor, '0');
    assert.equal(r.outstanding_minor, '0');
    assert.equal(r.collected_minor, '0');
  });
  for (const role of ['parent', 'student'])
    await check(`${role} can read own invoices and statement only`, async () => {
      await as(role);
      assert.equal((await read({ op: 'learners' })).count, 1);
      assert.equal((await read({ op: 'invoice', id: invoiceId })).id, invoiceId);
      await assert.rejects(() => read({ op: 'account', student_id: other.id }));
      await assert.rejects(() => read({ op: 'setup' }));
      await assert.rejects(() => read({ op: 'report', from: today, to: today }));
      await rejectWrite(post('PAYMENT'));
    });
  await check('unlinked family, teacher and unrelated school denied', async () => {
    for (const role of ['stranger', 'teacher', 'outsider']) {
      await as(role);
      await assert.rejects(() => read({ op: 'invoice', id: invoiceId }));
      await rejectWrite(post('PAYMENT'));
    }
  });
  await check('principal can report but cannot post', async () => {
    await as('principal');
    assert.equal((await read({ op: 'report', from: today, to: today })).outstanding_minor, '17001');
    await rejectWrite(post('PAYMENT'));
  });
  await as('accountant');
  await write(post('REVERSAL', { original_entry_id: discount }));
  inv = await read({ op: 'invoice', id: invoiceId });
  await write(post('REVERSAL', { original_entry_id: bursary }));
  inv = await read({ op: 'invoice', id: invoiceId });
  await write(post('VOID'));
  inv = await read({ op: 'invoice', id: invoiceId });
  await check('void retains history and zeroes invoice balance', async () => {
    assert.equal(inv.status, 'VOID');
    assert.equal(inv.balance_minor, '0');
    assert.equal(inv.entries.length, 8);
    await rejectWrite(post('PAYMENT'));
  });
  await check('report nets voids without dropping historical payments', async () => {
    const r = await read({ op: 'report', from: today, to: today });
    assert.equal(r.billed_minor, '0');
    assert.equal(r.outstanding_minor, '0');
    assert.equal(r.concessions_minor, '0');
  });
  await check('voided history still locks currency precision', async () =>
    rejectWrite({
      op: 'settings',
      version: setup.settings.version,
      currency: 'ZAR',
      decimal_places: 0,
    }),
  );
  await check('invalid method and missing idempotency key rejected', async () => {
    const request = { ...issue(), items: [{ fee_id: feeId, version: 2, quantity: 1 }] };
    delete request.request_key;
    await rejectWrite(request);
  });
  const pagingInvoice = (
    await write({ ...issue(), items: [{ fee_id: feeId, version: 2, quantity: 1 }] })
  ).id;
  await check('invalid payment method cannot post a credit', async () =>
    rejectWrite(
      keyed({
        op: 'PAYMENT',
        id: pagingInvoice,
        version: 1,
        posted_on: today,
        amount_minor: '1',
        method: 'INVALID',
      }),
    ),
  );
  for (let n = 0; n < 25; n++)
    await write(
      keyed({
        op: 'PAYMENT',
        id: pagingInvoice,
        version: n + 1,
        posted_on: today,
        amount_minor: '1',
        method: 'CASH',
      }),
    );
  const snapshot = await read({
    op: 'statement',
    student_id: learner.id,
    from: today,
    to: today,
    page: 0,
  });
  await check('statements paginate without losing running totals', async () => {
    const next = await read({
      op: 'statement',
      student_id: learner.id,
      from: today,
      to: today,
      page: 1,
      as_at: snapshot.as_at,
    });
    assert.equal(snapshot.rows.length, 20);
    assert.equal(snapshot.count, 34);
    assert.equal(next.rows.length, 14);
    assert.equal(new Set([...snapshot.rows, ...next.rows].map((e) => e.id)).size, 34);
    assert.equal(next.rows.at(-1).running_minor, snapshot.closing_minor);
  });
  await write(
    keyed({
      op: 'PAYMENT',
      id: pagingInvoice,
      version: 26,
      posted_on: today,
      amount_minor: '1',
      method: 'CASH',
    }),
  );
  await check('printed statement snapshot excludes later concurrent entries', async () => {
    const old = await read({
      op: 'statement',
      student_id: learner.id,
      from: today,
      to: today,
      page: 1,
      as_at: snapshot.as_at,
    });
    const latest = await read({
      op: 'statement',
      student_id: learner.id,
      from: today,
      to: today,
      page: 1,
    });
    assert.equal(old.count, 34);
    assert.equal(latest.count, 35);
    assert.equal(old.closing_minor, snapshot.closing_minor);
  });
  await check('backdated credits cannot produce negative historical balances', async () => {
    const past = `${year - 1}-12-31`;
    const h = (
      await write({
        ...issue(),
        issued_on: past,
        items: [{ fee_id: feeId, version: 2, quantity: 1 }],
      })
    ).id;
    const p = (
      await write(
        keyed({
          op: 'PAYMENT',
          id: h,
          version: 1,
          posted_on: past,
          amount_minor: '99999',
          method: 'CASH',
        }),
      )
    ).entry_id;
    await write(
      keyed({
        op: 'REVERSAL',
        id: h,
        version: 2,
        posted_on: today,
        original_entry_id: p,
        reason: 'Corrected payment',
      }),
    );
    await rejectWrite(
      keyed({
        op: 'PAYMENT',
        id: h,
        version: 3,
        posted_on: past,
        amount_minor: '99999',
        method: 'CASH',
      }),
    );
    await rejectWrite(keyed({ op: 'VOID', id: h, version: 3, posted_on: past, reason: 'Cancel' }));
    assert.equal((await read({ op: 'invoice', id: h })).version, 3);
    await write(
      keyed({
        op: 'PAYMENT',
        id: h,
        version: 3,
        posted_on: today,
        amount_minor: '99999',
        method: 'CASH',
      }),
    );
    assert.equal((await read({ op: 'invoice', id: h })).balance_minor, '0');
  });
  await check('tenant UUID never grants access by itself', async () => {
    await assert.rejects(() =>
      rpc('finance_read', [outsiderTenant, JSON.stringify({ op: 'setup' })]),
    );
    await assert.rejects(() =>
      rpc('finance_write', [outsiderTenant, JSON.stringify({ op: 'category', name: 'Attack' })]),
    );
  });
  await check('document numbering grows beyond six digits without truncation', async () => {
    await db.exec('reset role');
    await db.query('update private.finance_counters set counter=999999 where school_id=$1', [
      tenant,
    ]);
    await as('accountant');
    const created = await write({
      ...issue(),
      items: [{ fee_id: feeId, version: 2, quantity: 1 }],
    });
    assert.equal((await read({ op: 'invoice', id: created.id })).number, 'INV-1000000');
  });
  await check('anonymous user cannot call finance RPC or read ledger', async () => {
    await db.exec('reset role;set role anon');
    await denied('select public.finance_read($1,$2)', [tenant, '{"op":"learners"}']);
    await denied('select * from public.finance_entries');
  });
  await as('admin');
  await rpc('set_membership', [tenant, users.accountant, 'ACCOUNTANT', false]);
  await check('revoked accountant immediately loses finance access', async () => {
    await as('accountant');
    await assert.rejects(() => read({ op: 'learners' }));
    await rejectWrite(post('PAYMENT'));
  });
  console.log(`\n${checks} Phase 5 database assertions passed (embedded PostgreSQL).`);
} finally {
  await db.close();
}
