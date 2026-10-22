import { test, expect, type Page } from '@playwright/test';
const tenant = '10000000-0000-4000-8000-000000000001',
  uid = '20000000-0000-4000-8000-000000000001';
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page: Page, role = 'ACCOUNTANT') {
  const learner = { id: id(1), name: 'Alex Learner', admission_number: 'S001', archived: false };
  let settings: any = { id: id(2), currency: 'ZAR', decimal_places: 2, version: 1 },
    categories: any[] = [{ id: id(3), name: 'Tuition', version: 1, archived: false }],
    fees: any[] = [
      {
        id: id(4),
        name: 'Term tuition',
        amount_minor: '10001',
        category_id: id(3),
        academic_year_id: id(5),
        grade_id: null,
        version: 1,
        archived: false,
      },
    ],
    invoices: any[] = [];
  let fail = false;
  let calls: any[] = [];
  const doc = () => ({
    school: 'Demo School',
    address: '12 Learning Lane',
    learner: learner.name,
    admission: learner.admission_number,
    year: '2026',
    currency: 'ZAR',
    decimal_places: 2,
    items: [
      {
        description: 'Term tuition',
        category: 'Tuition',
        quantity: 1,
        unit_minor: '10001',
        total_minor: '10001',
      },
    ],
  });
  await page.addInitScript(
    ({ uid }) => {
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
            role: 'authenticated',
            email: 'fixture@example.test',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
      (window as any).__prints = 0;
      window.print = () => {
        (window as any).__prints++;
      };
    },
    { uid },
  );
  await page.route('https://test-school.supabase.co/**', async (route) => {
    const request = route.request(),
      name = new URL(request.url()).pathname.split('/').pop(),
      input = request.method() === 'POST' ? request.postDataJSON() : {};
    let body: any = [],
      status = 200;
    if (name === 'profiles') body = { id: uid, display_name: 'Finance Example', active: true };
    else if (name === 'user_roles')
      body = [
        {
          school_id: tenant,
          user_id: uid,
          role_id: role,
          schools: {
            id: tenant,
            name: 'Demo School',
            slug: 'demo',
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
        'finance.view',
        ...(role === 'ACCOUNTANT'
          ? ['finance.view_all', 'finance.manage', 'finance.reports', 'academics.view']
          : []),
      ];
    else if (name === 'finance_read') {
      const r = input.request;
      if (r.op === 'setup')
        body = {
          settings,
          locked: invoices.length > 0,
          categories,
          fees,
          years: [{ id: id(5), name: '2026', archived: false }],
          grades: [],
        };
      else if (r.op === 'learners')
        body = {
          rows: learner.name.toLowerCase().includes((r.search ?? '').toLowerCase())
            ? [learner]
            : [],
          count: 1,
        };
      else if (r.op === 'account')
        body = {
          settings,
          rows: invoices,
          count: invoices.length,
          balance_minor: String(invoices.reduce((a, i) => a + BigInt(i.balance_minor), 0n)),
        };
      else if (r.op === 'invoice') body = invoices.find((i) => i.id === r.id);
      else if (r.op === 'statement') {
        const entries = invoices.flatMap((i) =>
          i.entries.map((e: any) => ({ ...e, invoice_number: i.number })),
        );
        let total = 0n;
        body = {
          settings,
          count: entries.length,
          opening_minor: '0',
          closing_minor: String(entries.reduce((a, e) => a + BigInt(e.amount_minor), 0n)),
          rows: entries.map((e) => {
            total += BigInt(e.amount_minor);
            return { ...e, running_minor: String(total) };
          }),
        };
      } else if (r.op === 'report')
        body = {
          settings,
          billed_minor: '10001',
          collected_minor: '2500',
          concessions_minor: '1000',
          outstanding_minor: '6501',
        };
    } else if (name === 'finance_write') {
      const r = input.request;
      calls.push(r);
      if (fail) {
        status = 400;
        body = { message: 'Finance record changed; reload before saving', code: 'P0001' };
      } else if (r.op === 'settings') {
        settings = { ...settings, version: settings.version + 1 };
        body = { id: settings.id };
      } else if (r.op === 'category') {
        categories.push({ id: id(7), name: r.name, version: 1, archived: false });
        body = { id: id(7) };
      } else if (r.op === 'fee') {
        fees.push({ ...r, id: id(8), version: 1, archived: false });
        body = { id: id(8) };
      } else if (r.op === 'invoice') {
        const invoice = {
          id: id(9),
          number: 'INV-000001',
          issued_on: r.issued_on,
          due_on: r.due_on,
          gross_minor: '10001',
          balance_minor: '10001',
          status: 'ISSUED',
          version: 1,
          document: doc(),
          entries: [
            {
              id: id(10),
              number: 'INV-000001',
              posted_on: r.issued_on,
              kind: 'INVOICE',
              amount_minor: '10001',
              document: {},
              reversed: false,
            },
          ],
        };
        invoices.push(invoice);
        body = { id: invoice.id };
      } else {
        const i = invoices.find((i) => i.id === r.id),
          amount = String(-BigInt(r.amount_minor));
        i.entries.push({
          id: id(11 + i.entries.length),
          number: r.op === 'PAYMENT' ? 'RCT-000002' : 'ADJ-000003',
          posted_on: r.posted_on,
          kind: r.op,
          amount_minor: amount,
          method: r.method,
          reference: r.reference,
          reason: r.reason,
          reversed: false,
          document: { ...doc(), invoice_number: i.number },
        });
        i.balance_minor = String(BigInt(i.balance_minor) + BigInt(amount));
        i.version++;
        body = { id: i.id };
      }
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  });
  return {
    setFail: (value: boolean) => (fail = value),
    calls,
    seed: () => {
      invoices = [
        {
          id: id(9),
          number: 'INV-000001',
          issued_on: '2026-01-01',
          due_on: '2026-02-01',
          gross_minor: '10001',
          balance_minor: '10001',
          status: 'ISSUED',
          version: 1,
          document: doc(),
          entries: [
            {
              id: id(10),
              number: 'INV-000001',
              posted_on: '2026-01-01',
              kind: 'INVOICE',
              amount_minor: '10001',
              reversed: false,
              document: {},
            },
          ],
        },
      ];
    },
  };
}
test('accountant issues an invoice, records payment and bursary, prints receipt and statement', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/finance');
  await page.getByRole('button', { name: 'Alex Learner' }).click();
  await page.getByRole('button', { name: 'Issue an invoice', exact: true }).click();
  await page.getByRole('combobox', { name: 'Academic year', exact: true }).selectOption(id(5));
  await page.getByRole('checkbox', { name: 'Term tuition' }).check();
  await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'INV-000001', exact: true })).toBeVisible();
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('25.00');
  await page.getByLabel('Payment method').selectOption('BANK_TRANSFER');
  await page.getByLabel('Reference', { exact: true }).fill('BANK-REF');
  await page.getByRole('button', { name: 'Record payment received', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print RCT-000002' })).toBeVisible();
  expect(f.calls.at(-1).amount_minor).toBe('2500');
  await page.getByRole('button', { name: 'Print RCT-000002' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__prints)).toBe(1);
  await expect(page.locator('#print-reports')).toContainText('ZAR 25.00');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-reports')).toBeVisible();
  await expect(page.locator('.finance-workspace')).toBeHidden();
  await page.screenshot({
    path: `../../work/phase5-receipt-print-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('combobox', { name: 'Transaction', exact: true }).selectOption('BURSARY');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('10.00');
  await page.getByLabel('Reason', { exact: true }).fill('School bursary');
  await page.getByRole('button', { name: 'Record concession', exact: true }).click();
  await expect(page.getByText('ZAR 65.01').first()).toBeVisible();
  await page.getByRole('button', { name: 'Print full statement / Save PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__prints)).toBe(2);
  await expect(page.locator('#print-reports')).toContainText('Account statement');
  await expect(page.locator('#print-reports')).toContainText('BURSARY');
  await page.getByRole('button', { name: 'Financial reports', exact: true }).click();
  await expect(page.getByText('Net payments received')).toBeVisible();
  await page.screenshot({
    path: `../../work/phase5-finance-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('finance setup saves exact fees and categories', async ({ page }) => {
  const f = await fixture(page);
  await page.goto('http://127.0.0.1:4174/finance');
  await page.getByRole('button', { name: 'Fees & currency', exact: true }).click();
  await page.getByLabel('Category name').fill('Transport');
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(page.locator('.finance-chip').filter({ hasText: 'Transport' })).toBeVisible();
  await page.getByLabel('Fee name', { exact: true }).fill('Bus fees');
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption(id(7));
  await page.getByRole('combobox', { name: 'Academic year', exact: true }).selectOption(id(5));
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('10.01');
  await page.getByRole('button', { name: 'Add fee structure', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Bus fees/ })).toBeVisible();
  expect(f.calls.at(-1).amount_minor).toBe('1001');
});
test('parent sees own account without posting controls and can print invoices', async ({
  page,
}) => {
  const f = await fixture(page, 'PARENT');
  f.seed();
  await page.goto('http://127.0.0.1:4174/finance');
  await page.getByRole('button', { name: 'Alex Learner' }).click();
  await page.getByRole('button', { name: 'Open INV-000001' }).click();
  await expect(page.getByRole('button', { name: 'Issue an invoice', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Record payment received', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fees & currency', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Financial reports', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Print invoice / Save PDF' }).click();
  await expect(page.locator('#print-reports')).toContainText('INV-000001');
});
test('conflict retains entered payment details for review', async ({ page }) => {
  const f = await fixture(page);
  f.seed();
  f.setFail(true);
  await page.goto('http://127.0.0.1:4174/finance');
  await page.getByRole('button', { name: 'Alex Learner' }).click();
  await page.getByRole('button', { name: 'Open INV-000001' }).click();
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('25.00');
  await page.getByRole('button', { name: 'Record payment received', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Finance record changed');
  await expect(page.getByLabel('Amount (ZAR)', { exact: true })).toHaveValue('25.00');
  expect(f.calls).toHaveLength(1);
});
