import { expect, test } from '@playwright/test';
test('unconfigured application explains setup and routes work', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect your school workspace' })).toBeVisible();
  await page.getByRole('link', { name: 'View development roadmap' }).click();
  await expect(page.getByRole('heading', { name: 'Learners & staff' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('unknown paths show recovery link', async ({ page }) => {
  await page.goto('/not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to your school' })).toHaveAttribute(
    'href',
    '/',
  );
});
test('mobile and desktop login do not overflow', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
