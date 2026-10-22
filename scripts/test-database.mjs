import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
let tests = 0;
const admin = '20000000-0000-4000-8000-000000000001',
  teacher = '20000000-0000-4000-8000-000000000002',
  outsider = '20000000-0000-4000-8000-000000000003',
  unverified = '20000000-0000-4000-8000-000000000004';
async function check(name, fn) {
  await fn();
  tests++;
  console.log(`PASS ${name}`);
}
async function denied(sql) {
  await assert.rejects(() => db.exec(sql));
}
async function asUser(id) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`,
  );
}
try {
  // Supabase provides these objects. This shim tests actual PostgreSQL grants/RLS,
  // not Auth HTTP endpoints, JWT verification, email delivery, or Storage.
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
    console.log(`APPLIED ${file}`);
  }
  await db.exec(
    `insert into auth.users(id,email_confirmed_at) values('${admin}',now()),('${teacher}',now()),('${outsider}',now()),('${unverified}',null);`,
  );
  await asUser(admin);
  const schoolA = (await db.query(`select public.create_school('School A','school-a') as id`))
    .rows[0].id;
  await asUser(outsider);
  const schoolB = (await db.query(`select public.create_school('School B','school-b') as id`))
    .rows[0].id;
  await check('creator receives school administrator membership', async () =>
    assert.equal(
      (await db.query(`select role_id from public.user_roles where school_id='${schoolB}'`)).rows[0]
        .role_id,
      'SCHOOL_ADMIN',
    ),
  );
  await asUser(admin);
  await check('cross-school reads return no rows', async () =>
    assert.equal(
      (await db.query(`select * from public.schools where id='${schoolB}'`)).rows.length,
      0,
    ),
  );
  await check('cross-school updates affect no rows', async () =>
    assert.equal(
      (
        await db.query(
          `update public.schools set name='Hacked',version=version+1 where id='${schoolB}' returning id`,
        )
      ).rows.length,
      0,
    ),
  );
  await check('cannot add members to another school', () =>
    denied(`select public.set_membership('${schoolB}','${teacher}','TEACHER',true)`),
  );
  await check('cannot self-assign or escalate platform access', () =>
    denied(`select public.set_membership('${schoolA}','${teacher}','SUPER_ADMIN',true)`),
  );
  await check('direct role writes are blocked', () =>
    denied(
      `insert into public.user_roles values('${schoolB}','${admin}','SCHOOL_ADMIN',true,now())`,
    ),
  );
  await check('role definitions cannot be edited', () =>
    denied(
      `update public.role_permissions set permission_id='members.manage' where role_id='TEACHER'`,
    ),
  );
  await db.exec(`select public.set_membership('${schoolA}','${teacher}','TEACHER',true)`);
  await check('own school details can be updated', async () =>
    assert.equal(
      (
        await db.query(
          `update public.schools set name='Updated school',version=2 where id='${schoolA}' and version=1 returning name`,
        )
      ).rows[0].name,
      'Updated school',
    ),
  );
  await check('stale version updates affect no rows', async () =>
    assert.equal(
      (
        await db.query(
          `update public.schools set name='Stale',version=2 where id='${schoolA}' and version=1 returning id`,
        )
      ).rows.length,
      0,
    ),
  );
  await check('invalid version increments rejected', () =>
    denied(`update public.schools set version=99 where id='${schoolA}'`),
  );
  await check('invalid timezone rejected on update', () =>
    denied(`update public.schools set timezone='Invalid',version=3 where id='${schoolA}'`),
  );
  await check('audit records exist', async () =>
    assert.ok(
      (await db.query(`select * from public.audit_logs where school_id='${schoolA}'`)).rows
        .length >= 3,
    ),
  );
  await check('audit records cannot be erased', () =>
    denied(`delete from public.audit_logs where school_id='${schoolA}'`),
  );
  await check('cross-school audit records hidden', async () =>
    assert.equal(
      (await db.query(`select * from public.audit_logs where school_id='${schoolB}'`)).rows.length,
      0,
    ),
  );
  await asUser(teacher);
  await check('teacher has dashboard but not settings permission', async () => {
    const p = (await db.query(`select public.my_permissions('${schoolA}') as p`)).rows[0].p;
    assert.ok(p.includes('dashboard.view'));
    assert.ok(!p.includes('school.update'));
  });
  await check('teacher cannot update school', async () =>
    assert.equal(
      (
        await db.query(
          `update public.schools set name='No',version=3 where id='${schoolA}' returning id`,
        )
      ).rows.length,
      0,
    ),
  );
  await check('teacher cannot manage memberships', () =>
    denied(`select public.set_membership('${schoolA}','${outsider}','TEACHER',true)`),
  );
  await check('teacher cannot read school audit', async () =>
    assert.equal((await db.query(`select * from public.audit_logs`)).rows.length, 0),
  );
  await check('profile name editable, active status protected', async () => {
    await db.exec(`update public.profiles set display_name='Teacher' where id='${teacher}'`);
    await denied(`update public.profiles set active=false where id='${teacher}'`);
  });
  await asUser(admin);
  await db.exec(`select public.set_membership('${schoolA}','${teacher}','TEACHER',false)`);
  await asUser(teacher);
  await check('revoked membership immediately loses school access', async () =>
    assert.equal((await db.query(`select * from public.schools`)).rows.length, 0),
  );
  await db.exec(`reset role;update public.profiles set active=false where id='${admin}'`);
  await asUser(admin);
  await check('inactive account cannot read schools', async () =>
    assert.equal((await db.query(`select * from public.schools`)).rows.length, 0),
  );
  await check('inactive account cannot create school', () =>
    denied(`select public.create_school('New School','new-school')`),
  );
  await asUser(unverified);
  await check('unverified account cannot create school', () =>
    denied(`select public.create_school('Unverified school','unverified-school')`),
  );
  await db.exec('reset role;set role anon;');
  await check('anonymous user has no table access', () => denied('select * from public.schools'));
  await check('anonymous user cannot call provisioning RPC', () =>
    denied(`select public.create_school('Bad School','bad-school')`),
  );
  console.log(`\n${tests} database security assertions passed (embedded PostgreSQL).`);
} finally {
  await db.close();
}
