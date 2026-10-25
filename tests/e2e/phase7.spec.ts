import { test, expect, type Page } from '@playwright/test';
const tenant = '10000000-0000-4000-8000-000000000001',
  uid = '20000000-0000-4000-8000-000000000001',
  bookId = '70000000-0000-4000-8000-000000000001',
  jobId = '70000000-0000-4000-8000-000000000002';
const csv =
  'admission_number,first_name,surname,date_of_birth,admission_date\r\nS001,Alex,Example,2014-01-01,2026-01-01\r\n';
async function fixture(page: Page, role = 'SCHOOL_ADMIN') {
  const calls: any[] = [];
  let lostResponse = false;
  let conflict = false,
    book = {
      id: bookId,
      version: 1,
      title: 'Reading Together',
      author: 'Author',
      isbn: '',
      category: 'Reading',
      publisher: '',
      archived: false,
    };
  await page.addInitScript(
    ({ uid }) =>
      localStorage.setItem(
        'sb-test-school-auth-token',
        JSON.stringify({
          access_token: 'fixture',
          refresh_token: 'fixture',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: uid,
            aud: 'authenticated',
            email: 'phase7@example.test',
            app_metadata: { provider: 'email' },
            user_metadata: {},
          },
        }),
      ),
    { uid },
  );
  await page.route('https://test-school.supabase.co/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    const r = input?.request ?? {};
    let body: any = [],
      status = 200;
    if (name === 'profiles') body = { id: uid, display_name: 'Example operator', active: true };
    else if (name === 'user_roles')
      body = [
        {
          school_id: tenant,
          role_id: role,
          schools: {
            id: tenant,
            name: 'Example School',
            slug: 'example',
            timezone: 'Africa/Johannesburg',
            currency: 'ZAR',
            brand_color: '#0047d6',
            version: 1,
          },
        },
      ];
    else if (name === 'my_permissions')
      body = [
        'dashboard.view',
        'school.view',
        'library.view',
        ...(role === 'PARENT' ? [] : ['library.manage']),
        ...(['SCHOOL_ADMIN', 'PRINCIPAL'].includes(role) ? ['analytics.view', 'data.export'] : []),
        ...(role === 'SCHOOL_ADMIN' ? ['data.import'] : []),
      ];
    else if (name === 'advanced_read') {
      calls.push(r);
      if (r.op === 'analytics')
        body = {
          schema_version: 1,
          generated_at: '2026-10-25T10:00:00Z',
          from: r.from,
          to: r.to,
          learners: 120,
          teachers: 15,
          classes: 6,
          currency: 'ZAR',
          academics: [
            {
              year_name: '2026',
              grade_name: 'Grade 7',
              term_name: 'Term 1',
              class_name: '7A',
              reports: 20,
              average: 72,
              passed: 18,
            },
          ],
          finance: {
            balance_minor: '1200500',
            monthly: [{ month: '2026-01', net_minor: '100000' }],
          },
          library: { open_loans: 12, overdue_now: 2, issued_in_range: 17 },
          limitations: ['Attendance module is not released'],
        };
      else if (r.op === 'export_page')
        body = {
          rows: [
            {
              admission_number: 'S001',
              first_name: '=unsafe',
              surname: 'Example',
              date_of_birth: '2014-01-01',
              admission_date: '2026-01-01',
              status: 'ACTIVE',
              archived: false,
            },
          ],
          count: 1,
        };
      else if (r.op === 'book') body = book;
      else if (r.op === 'calendar')
        body = [
          {
            id: bookId,
            name: 'Term 1',
            starts_on: '2026-01-01',
            ends_on: '2026-03-31',
            version: 1,
          },
        ];
      else if (r.op === 'ai_context')
        body = {
          schema_version: 1,
          counts: { learners: 120, teachers: 15 },
          external_delivery: false,
        };
    } else if (name === 'advanced_write') {
      calls.push(r);
      if (r.op === 'preview_import')
        body = {
          id: jobId,
          count: r.rows.length,
          errors: [],
          expires_at: new Date(Date.now() + 900000).toISOString(),
        };
      else if (r.op === 'commit_import') body = { count: 1 };
      else if (r.op === 'start_export') body = { id: jobId, count: 1, errors: [] };
      else if (r.op === 'sync_book') {
        if (lostResponse) {
          lostResponse = false;
          await route.abort('failed');
          return;
        }
        if (conflict && r.version === 1) {
          book = { ...book, version: 2, title: 'Server revision' };
          status = 400;
          body = { code: 'P0001', message: 'Record changed; reload before saving' };
        } else {
          book = { ...book, ...r, id: bookId, version: r.version + 1 };
          body = { id: bookId };
        }
      } else body = {};
    } else if (name === 'library_read') body = { rows: [book], count: 1 };
    else if (name === 'platform_read')
      body =
        r.op === 'access'
          ? { allowed: role === 'OPERATOR' }
          : role === 'OPERATOR'
            ? {
                rows: [
                  {
                    id: tenant,
                    name: 'Example School',
                    slug: 'example',
                    status: 'trial',
                    plan_code: 'trial',
                    learners: 120,
                    administrators: 1,
                  },
                ],
                count: 1,
              }
            : { message: 'Not authorized' };
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers: { 'Content-Range': '0-0/1' },
    });
  });
  return {
    loseNextResponse: () => {
      lostResponse = true;
    },
    calls,
    setConflict: () => {
      conflict = true;
    },
  };
}
test('administrator reads scoped analytics and validates a learner file before atomic confirmation', async ({
  page,
}, info) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/advanced');
  await expect(page.getByRole('heading', { name: 'Reports & data' })).toBeVisible();
  await expect(page.getByText('120', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page
    .getByLabel('Choose learner CSV')
    .setInputFiles({ name: 'learners.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Alex', { exact: true })).toBeVisible();
  expect(f.calls.some((r) => r.op === 'commit_import')).toBe(false);
  await page.getByRole('button', { name: 'Validate import', exact: true }).click();
  await expect(page.getByText(/Validation passed/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm import of 1 learners' }).click();
  await expect(page.getByRole('status')).toContainText('1 learners imported');
  expect(f.calls.filter((r) => r.op === 'commit_import')).toHaveLength(1);
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await page.screenshot({
    path: `../../work/phase7-reports-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('CSV export uses snapshot pages and releases the private job', async ({ page }) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/advanced');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download learner CSV' }).click();
  expect((await download).suggestedFilename()).toBe('mfaroedu-learners.csv');
  await expect(page.getByRole('status')).toContainText('1 learners exported');
  expect(
    f.calls
      .filter((r) => ['start_export', 'export_page', 'discard_job'].includes(r.op))
      .map((r) => r.op),
  ).toEqual(['start_export', 'export_page', 'discard_job']);
});
test('calendar and privacy-limited analysis context are actual downloads', async ({ page }) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/advanced');
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download calendar', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('mfaroedu-terms.ics');
  download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download analysis context' }).click();
  expect((await download).suggestedFilename()).toBe('mfaroedu-analysis-context.json');
  expect(f.calls.filter((r) => r.op === 'calendar' || r.op === 'ai_context')).toHaveLength(2);
});
test('parent has no advanced transfer controls', async ({ page }) => {
  await fixture(page, 'PARENT');
  await page.goto('http://127.0.0.1:4174/advanced');
  await expect(page.getByRole('heading', { name: 'Advanced workspace unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
});
test('offline catalogue draft survives a disconnect and resolves server conflicts explicitly', async ({
  page,
  context,
}, info) => {
  const f = await fixture(page, 'LIBRARIAN');
  await page.goto(`http://127.0.0.1:4174/offline?school=${tenant}`);
  await page.getByLabel('This trusted device may store non-personal catalogue drafts.').check();
  await page.getByRole('button', { name: 'Search catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'Reading Together — Author' }).click();
  await context.setOffline(true);
  await page.getByLabel('Book title', { exact: true }).fill('Offline revision');
  await page.getByRole('button', { name: 'Save on device' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Draft saved on this device' }),
  ).toBeVisible();
  expect(f.calls.some((r) => r.op === 'sync_book')).toBe(false);
  await expect(page.getByRole('button', { name: 'Reviewed — synchronize' })).toBeDisabled();
  await context.setOffline(false);
  f.setConflict();
  await page.getByRole('button', { name: 'Reviewed — synchronize' }).click();
  await expect(page.getByRole('heading', { name: 'Another user changed this book' })).toBeVisible();
  await expect(page.getByText('Server revision', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `../../work/phase7-conflict-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Keep my changes for review' }).click();
  expect(f.calls.filter((r) => r.op === 'sync_book')).toHaveLength(1);
  await page.getByRole('button', { name: 'Reviewed — synchronize' }).click();
  await expect(page.getByRole('status')).toContainText('Catalogue synchronized');
  expect(f.calls.filter((r) => r.op === 'sync_book').map((r) => r.version)).toEqual([1, 2]);
});
test('drafts reopen from IndexedDB and can be discarded', async ({ page }) => {
  await fixture(page, 'LIBRARIAN');
  await page.goto(`http://127.0.0.1:4174/offline?school=${tenant}`);
  await page.getByLabel('This trusted device may store non-personal catalogue drafts.').check();
  await page.getByRole('button', { name: 'New book draft' }).click();
  await page.getByLabel('Book title', { exact: true }).fill('Stored title');
  await page.getByLabel('Author', { exact: true }).fill('Author');
  await page.getByRole('button', { name: 'Save on device' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.reload();
  await page.getByRole('button', { name: 'Stored title', exact: true }).click();
  await expect(page.getByLabel('Book title', { exact: true })).toHaveValue('Stored title');
  await page.getByRole('button', { name: 'Discard local draft' }).click();
  await expect(page.getByText('No drafts on this device.')).toBeVisible();
});
test('platform operator can inspect schools and navigate to an authorized workspace', async ({
  page,
}) => {
  await fixture(page, 'OPERATOR');
  await page.goto('http://127.0.0.1:4174/platform');
  await expect(page.getByRole('heading', { name: '1 schools' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Example School', exact: true })).toHaveAttribute(
    'href',
    `/?school=${tenant}`,
  );
});
test('principal can report and export but cannot see import controls', async ({ page }) => {
  await fixture(page, 'PRINCIPAL');
  await page.goto('http://127.0.0.1:4174/advanced');
  await expect(page.getByRole('heading', { name: 'Reports & data' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
});
test('an uncertain synchronization keeps the same request key and locks edits', async ({
  page,
}) => {
  const f = await fixture(page, 'LIBRARIAN');
  await page.goto(`http://127.0.0.1:4174/offline?school=${tenant}`);
  await page.getByLabel('This trusted device may store non-personal catalogue drafts.').check();
  await page.getByRole('button', { name: 'New book draft' }).click();
  await page.getByLabel('Book title', { exact: true }).fill('Uncertain title');
  await page.getByLabel('Author', { exact: true }).fill('Author');
  f.loseNextResponse();
  await page.getByRole('button', { name: 'Reviewed — synchronize' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Book title', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reviewed — synchronize' }).click();
  await expect(page.getByRole('status')).toContainText('Catalogue synchronized');
  const writes = f.calls.filter((r) => r.op === 'sync_book');
  expect(writes).toHaveLength(2);
  expect(writes[0].request_key).toBe(writes[1].request_key);
});
test.describe('installed offline draft shell', () => {
  test.use({ serviceWorkers: 'allow' });
  test('a saved draft reopens after a fully offline reload', async ({ page, context }) => {
    await fixture(page, 'LIBRARIAN');
    await page.goto(`http://127.0.0.1:4174/offline?school=${tenant}`);
    await page.getByLabel('This trusted device may store non-personal catalogue drafts.').check();
    await page.getByRole('button', { name: 'New book draft' }).click();
    await page.getByLabel('Book title', { exact: true }).fill('Offline restart');
    await page.getByLabel('Author', { exact: true }).fill('Author');
    await page.getByRole('button', { name: 'Save on device' }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'Offline restart', exact: true }).click();
    await expect(page.getByLabel('Book title', { exact: true })).toHaveValue('Offline restart');
    await context.setOffline(false);
  });
});
