import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'allow' });
test('public application shell loads offline after installation', async ({ page, context }) => {
  await page.goto('/roadmap');
  await expect(page.getByRole('heading', { name: 'Learners & staff' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Learners & staff' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('You’re offline');
  await context.setOffline(false);
});
