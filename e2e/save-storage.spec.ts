// Save storage in a real browser (mw-e30.2): IndexedDB is used when available, and when the browser
// refuses it (private mode) the game falls back to in-memory saves behind a persistent warning.
import { expect, test } from '@playwright/test';

test('uses IndexedDB saves with no warning in a normal browser', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-save-store', 'indexeddb');
  await expect(page.getByTestId('save-warning')).toHaveCount(0);
});

test('AC-4: when IndexedDB throws on open, uses in-memory saves and shows a persistent warning', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Private-mode simulation: some browsers expose indexedDB but throw on open.
    IDBFactory.prototype.open = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-save-store', 'memory');
  const banner = page.getByRole('alert');
  await expect(banner).toHaveText(/^Saves will not persist/);
  await expect(banner).toHaveAttribute('data-testid', 'save-warning');
  // Persistent: still shown after the page has settled.
  await page.waitForLoadState('networkidle');
  await expect(banner).toBeVisible();
});
