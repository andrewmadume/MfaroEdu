import { expect, test, type Page } from '@playwright/test';
const schoolId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
async function fixture(page: Page, role = 'SCHOOL_ADMIN') {
  let school = {
    id: schoolId,
    name: 'Fixture School',
    slug: 'fixture-school',
    timezone: 'Africa/Johannesburg',
    currency: 'ZAR',
    brand_color: '#173f35',
    version: 1,
    phone: null,
    address: null,
    contact_email: null,
  };
  await page.addInitScript(
    ({ userId }) => {
      localStorage.setItem(
        'sb-test-school-auth-token',
        JSON.stringify({
          access_token: 'fixture-access-token',
          refresh_token: 'fixture-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: userId,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'fixture@example.test',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { userId },
  );
  await page.route('https://test-school.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname.endsWith('/profiles'))
      body = { id: userId, display_name: 'Alex Example', active: true };
    else if (url.pathname.endsWith('/user_roles'))
      body = [
        { school_id: schoolId, user_id: userId, role_id: role, active: true, schools: school },
      ];
    else if (url.pathname.endsWith('/rpc/my_permissions'))
      body =
        role === 'SCHOOL_ADMIN'
          ? [
              'dashboard.view',
              'school.view',
              'school.update',
              'members.view',
              'members.manage',
              'audit.view',
            ]
          : ['dashboard.view', 'school.view'];
    else if (url.pathname.endsWith('/schools') && route.request().method() === 'PATCH') {
      school = { ...school, ...route.request().postDataJSON() };
      body = school;
    } else if (url.pathname.endsWith('/logout')) {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify(body),
    });
  });
}
test('administrator edits school settings and returns to dashboard', async ({ page }, info) => {
  await fixture(page);
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.getByRole('heading', { name: 'Your school at a glance' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('dashboard.png'), fullPage: true });
  await page.getByRole('link', { name: 'Review school details' }).click();
  await page
    .getByRole('textbox', { name: 'School name', exact: true })
    .fill('Updated Fixture School');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.school-name')).toHaveText('Updated Fixture School');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('teacher navigation and direct settings route deny administration', async ({ page }) => {
  await fixture(page, 'TEACHER');
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.getByRole('heading', { name: 'Space to focus on teaching' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'School settings', exact: true })).toHaveCount(0);
  await page.goto('http://127.0.0.1:4174/settings');
  await expect(page.getByRole('heading', { name: 'Access unavailable' })).toBeVisible();
});
test('mobile navigation works and sign out removes session', async ({ page }, info) => {
  await fixture(page);
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.getByRole('heading', { name: 'Your school at a glance' })).toBeVisible();
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sb-test-school-auth-token'))).toBeNull();
});
