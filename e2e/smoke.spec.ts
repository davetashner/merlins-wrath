import { expect, test } from '@playwright/test';

test('AC-5: the built app loads with zero console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  await expect(page).toHaveTitle('The Vesper Bell');
  await expect(page.locator('#app')).toHaveAttribute('data-layers', /sim .* tools/);
  expect(errors).toEqual([]);
});
