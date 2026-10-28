import { test, expect, type Page } from '@playwright/test';
const uid = '20000000-0000-4000-8000-000000000001';
const token = () =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        sub: uid,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        aud: 'authenticated',
      }),
    ).toString('base64url'),
    'synthetic-signature',
  ].join('.');
async function authFixture(page: Page) {
  const writes: any[] = [];
  const user = {
    id: uid,
    aud: 'authenticated',
    email: 'callback@example.test',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email' },
    user_metadata: {},
  };
  await page.route('https://test-school.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    let body: any = user;
    if (url.pathname.endsWith('/user') && route.request().method() === 'PUT')
      writes.push(route.request().postDataJSON());
    if (url.pathname.endsWith('/token'))
      body = {
        access_token: token(),
        refresh_token: 'synthetic-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user,
      };
    await route.fulfill({ json: body });
  });
  return writes;
}
for (const type of ['signup', 'invite', 'recovery'])
  test(`${type} fragment starts a verified session, clears URL tokens and permits password setup`, async ({
    page,
  }) => {
    const writes = await authFixture(page);
    await page.goto(
      `http://127.0.0.1:4174/auth/reset#access_token=${token()}&refresh_token=synthetic-refresh&type=${type}`,
    );
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    expect(page.url()).not.toContain('access_token');
    await page.getByLabel('New password', { exact: true }).fill('Synthetic-only-password-1!');
    await page.getByLabel('Confirm password', { exact: true }).fill('Synthetic-only-password-1!');
    await page.getByRole('button', { name: 'Save password', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Password updated');
    expect(writes).toHaveLength(1);
  });
test('a reset page without a valid session offers recovery instead of a password form', async ({
  page,
}) => {
  const writes = await authFixture(page);
  await page.goto('http://127.0.0.1:4174/auth/reset');
  await expect(page.getByRole('heading', { name: 'Request a fresh password link' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Request password link' })).toHaveAttribute(
    'href',
    '/auth/forgot',
  );
  expect(writes).toHaveLength(0);
});
test('used or expired email callbacks never expose an editable password form', async ({ page }) => {
  await authFixture(page);
  await page.goto(
    'http://127.0.0.1:4174/auth/reset#error=access_denied&error_code=otp_expired&error_description=Synthetic+expired+link',
  );
  await expect(page.getByRole('heading', { name: 'Request a fresh password link' })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
});
test('ordinary PKCE email recovery still exchanges its code and opens password setup', async ({
  page,
}) => {
  await authFixture(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'sb-test-school-auth-token-code-verifier',
      JSON.stringify('synthetic-verifier/PASSWORD_RECOVERY'),
    ),
  );
  await page.goto('http://127.0.0.1:4174/auth/reset?code=synthetic-code');
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  expect(page.url()).not.toContain('code=');
});
test('a rejected external callback cannot reuse an older signed-in session for password setup', async ({
  page,
}) => {
  await authFixture(page);
  await page.addInitScript(
    ({ uid }) =>
      localStorage.setItem(
        'sb-test-school-auth-token',
        JSON.stringify({
          access_token: 'synthetic-old-access',
          refresh_token: 'synthetic-old-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: uid, aud: 'authenticated', app_metadata: {}, user_metadata: {} },
        }),
      ),
    { uid },
  );
  await page.route('https://test-school.supabase.co/auth/v1/user', (route) =>
    route.fulfill({ status: 401, json: { code: 'bad_jwt', msg: 'Synthetic invalid callback' } }),
  );
  await page.goto(
    `http://127.0.0.1:4174/auth/reset#access_token=${token()}&refresh_token=synthetic-refresh&type=invite`,
  );
  await expect(page.getByRole('heading', { name: 'Request a fresh password link' })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
});
