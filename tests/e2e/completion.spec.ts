import { test, expect, type Page } from '@playwright/test';
const tenant = '10000000-0000-4000-8000-000000000001',
  a = '20000000-0000-4000-8000-000000000001',
  b = '20000000-0000-4000-8000-000000000002';
const session = (id: string) => ({
  access_token: 'synthetic',
  refresh_token: 'synthetic',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'synthetic@example.test',
    app_metadata: {},
    user_metadata: {},
  },
});
async function fixture(page: Page) {
  let actor = a,
    events: any[] = [],
    docs: any[] = [],
    invites: any[] = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        email: 'accepted@example.test',
        role_id: 'TEACHER',
        expires_at: '2030-01-01T00:00:00Z',
        revoked: false,
        accepted: true,
        accepted_by: b,
      },
    ],
    school: any = {
      id: tenant,
      name: 'Completion School',
      slug: 'completion',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
      brand_color: '#0047d6',
      version: 1,
    };
  const calls: any[] = [];
  let job: any = null;
  const counts: string[] = [];
  await page.addInitScript(
    (s) => localStorage.setItem('sb-test-school-auth-token', JSON.stringify(s)),
    session(a),
  );
  await page.route('https://test-school.supabase.co/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      name = url.pathname.split('/').pop();
    let body: any = [];
    if (url.pathname.includes('/storage/v1/')) {
      if (req.method() === 'GET')
        await route.fulfill({ body: 'Synthetic private bytes', contentType: 'application/pdf' });
      else await route.fulfill({ json: { Key: url.pathname } });
      return;
    }
    const input = req.method() === 'POST' ? req.postDataJSON() : {},
      r = input?.request ?? {};
    if (name === 'profiles')
      body = { id: actor, display_name: actor === a ? 'Account A' : 'Account B', active: true };
    else if (name === 'user_roles')
      body = [{ school_id: tenant, role_id: 'SCHOOL_ADMIN', schools: school }];
    else if (name === 'my_permissions')
      body = [
        'dashboard.view',
        'school.view',
        'school.update',
        'students.view',
        'students.view_all',
        'members.view',
        'members.manage',
        'events.view',
        'events.manage',
        'documents.view',
        'documents.manage',
        'analytics.view',
        'data.import',
        'data.export',
        'staff.manage',
        'staff.view',
        'academics.manage',
        'academics.view',
        'attendance.view',
        'results.publish',
        'finance.reports',
        'library.reports',
      ];
    else if (name === 'platform_read') body = { allowed: false };
    else if (['students', 'staff', 'classes'].includes(name ?? '') && req.method() === 'HEAD') {
      counts.push(actor);
      await route.fulfill({
        status: 200,
        headers: {
          'content-range': `0-0/${actor === a ? 999 : 2}`,
          'access-control-expose-headers': 'content-range',
          'content-type': 'application/json',
        },
        body: '',
      });
      return;
    } else if (name === 'schools' && req.method() === 'PATCH') {
      school = { ...school, ...req.postDataJSON() };
      body = school;
    } else if (name === 'school_events')
      body = events.filter((v) => v.archived === (url.searchParams.get('archived') === 'eq.true'));
    else if (name === 'school_documents')
      body = docs.filter((v) => v.archived === (url.searchParams.get('archived') === 'eq.true'));
    else if (name === 'school_tools') {
      calls.push(r);
      if (r.op === 'save_event') {
        if (r.id) {
          const e = events.find((v) => v.id === r.id);
          Object.assign(e, r, { version: e.version + 1 });
          body = e;
        } else {
          body = { ...r, id: r.request_key, version: 1, archived: false };
          events.push(body);
        }
      } else if (r.op === 'reserve_document') {
        body = { ...r, version: 1, ready: false, archived: false };
        docs.push(body);
      } else if (r.op === 'finish_document') {
        const d = docs.find((v) => v.id === r.id);
        Object.assign(d, { ready: true, version: d.version + 1 });
        body = d;
      } else if (r.op === 'archive_document') {
        const d = docs.find((v) => v.id === r.id);
        Object.assign(d, { archived: true, version: d.version + 1 });
        body = d;
      } else if (r.op === 'invitations') body = invites;
      else if (r.op === 'create_invitation') {
        body = { id: crypto.randomUUID(), token: 'a'.repeat(64) };
        invites.push({
          ...body,
          email: r.email,
          role_id: r.role_id,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          revoked: false,
          accepted: false,
        });
      } else if (r.op === 'revoke_invitation') {
        invites.find((v) => v.id === r.id).revoked = true;
        body = {};
      } else if (r.op === 'accept_invitation') body = { school_id: tenant };
      else if (r.op === 'invitation_preview')
        body = {
          school_name: school.name,
          role_id: 'TEACHER',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        };
    } else if (name === 'advanced_read')
      body = {
        learners: 0,
        teachers: 0,
        classes: 0,
        generated_at: new Date().toISOString(),
        academics: [],
        finance: null,
        library: null,
        limitations: [],
      };
    else if (name === 'school_data') {
      calls.push(r);
      if (r.op === 'preview') {
        job = { id: crypto.randomUUID(), count: r.rows.length, errors: [], rows: r.rows };
        body = job;
      } else if (r.op === 'commit') body = { count: job.count };
      else if (r.op === 'start_export') {
        job = { id: crypto.randomUUID(), count: 1 };
        body = job;
      } else if (r.op === 'export_page')
        body = { rows: [{ code: 'SCI', name: 'Science' }], count: 1 };
      else body = {};
    } else if (name === 'operations_read') body = { total: 1, percentage: 100 };
    else if (name === 'logout') {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      json: body,
      headers: {
        'content-range': `0-${Math.max(0, (Array.isArray(body) ? body.length : 1) - 1)}/${Array.isArray(body) ? body.length : 1}`,
      },
    });
  });
  return {
    calls,
    counts,
    change: async (out: boolean) => {
      actor = b;
      await page.evaluate(
        async ({ s, out }) => {
          const c = new BroadcastChannel('sb-test-school-auth-token');
          if (out) {
            localStorage.removeItem('sb-test-school-auth-token');
            c.postMessage({ event: 'SIGNED_OUT', session: null });
            await new Promise((r) => setTimeout(r, 100));
          }
          localStorage.setItem('sb-test-school-auth-token', JSON.stringify(s));
          c.postMessage({ event: 'SIGNED_IN', session: s });
          await new Promise((r) => setTimeout(r, 100));
          c.close();
        },
        { s: session(b), out },
      );
    },
  };
}
for (const out of [true, false])
  test(`account change ${out ? 'with sign-out on roadmap' : 'without null session'} replaces scoped query cache`, async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.goto('http://127.0.0.1:4174/');
    await expect(page.locator('.stat strong').first()).toHaveText('999');
    if (out) {
      await page.getByRole('link', { name: 'View the development roadmap', exact: true }).click();
      await expect(page.getByText('Room to grow.')).toBeVisible();
    }
    await f.change(out);
    if (out) await page.getByRole('link', { name: 'MfaroEdu', exact: true }).click();
    await expect(page.locator('.user-chip')).toContainText('Account B');
    await expect(page.locator('.stat strong').first()).toHaveText('2');
    expect(f.counts).toContain(b);
  });
test('school calendar creates a role-scoped event, exports it and archives it', async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/calendar');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.getByLabel('Event title').fill('Parent meeting');
  await page.getByLabel('Starts', { exact: true }).fill('2026-11-20T08:00');
  await page.getByLabel('Ends', { exact: true }).fill('2026-11-20T09:00');
  await page.screenshot({
    path: '../../work/completion-event-editor-' + info.project.name + '.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Parent meeting', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '../../work/completion-calendar-' + info.project.name + '.png',
    fullPage: true,
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export visible events' }).click();
  expect((await download).suggestedFilename()).toBe('school-events.ics');
  await page.getByRole('button', { name: 'Edit event' }).click();
  await page.getByLabel('Archived', { exact: true }).check();
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByText('No matching events.')).toBeVisible();
  expect(f.calls.filter((r) => r.op === 'save_event')).toHaveLength(2);
});
test('private documents upload, download, archive and expose cleanup controls', async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto('http://127.0.0.1:4174/documents');
  await page.getByLabel('Document title').fill('School policy');
  await page.getByLabel('Document file').setInputFiles({
    name: 'policy.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('Synthetic private bytes'),
  });
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'School policy', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '../../work/completion-documents-' + info.project.name + '.png',
    fullPage: true,
  });
  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download document' }).click();
  expect((await d).suggestedFilename()).toBe('policy.pdf');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Archive document' }).click();
  await expect(page.getByText('No matching documents.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('true');
  await expect(page.getByRole('button', { name: 'Retry file cleanup' })).toBeVisible();
});
test('administrator creates and revokes an email-bound invitation', async ({ page }) => {
  await fixture(page);
  await page.goto('http://127.0.0.1:4174/members');
  await expect(page.getByRole('cell', { name: b, exact: true })).toBeVisible();
  await page.getByLabel('Invitation email').fill('teacher@example.test');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  await expect(page.getByLabel('Private invitation link')).toHaveValue(/\/join#token=a{64}$/);
  await page.getByRole('button', { name: 'Revoke invitation' }).click();
  await expect(page.getByRole('cell', { name: 'Revoked', exact: true })).toBeVisible();
});
test('verified invitation acceptance clears its token and opens the workspace', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/join#token=' + 'a'.repeat(64));
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
  expect(page.url()).not.toContain('token=');
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Your school at a glance' })).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem('mfaroedu-pending-invitation')),
  ).toBeNull();
  expect(f.calls.some((r) => r.op === 'accept_invitation')).toBe(true);
});
test('teacher CSV is previewed and confirmed, and subject export downloads a snapshot', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/advanced');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByLabel('Choose additional CSV').setInputFiles({
    name: 'teachers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'employee_number,first_name,surname,position,department,email\nE1,New,Teacher,Teacher,Science,new@example.test\n',
    ),
  });
  await page.getByRole('button', { name: 'Validate additional import' }).click();
  await page.getByRole('button', { name: 'Confirm additional import' }).click();
  await expect(page.getByRole('status')).toContainText('1 records imported.');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export type').selectOption('subjects');
  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download selected CSV' }).click();
  expect((await d).suggestedFilename()).toBe('mfaroedu-subjects.csv');
  expect(f.calls.some((r) => r.op === 'commit')).toBe(true);
});
test('school branding saves HTTPS website and report format', async ({ page }) => {
  await fixture(page);
  await page.goto('http://127.0.0.1:4174/settings');
  await page.getByLabel('School website').fill('https://school.example');
  await page.getByLabel('Report title', { exact: true }).fill('Learner progress');
  await page.getByLabel('Report format').selectOption('COMPACT');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('School details saved.');
});
