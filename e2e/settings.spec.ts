// Settings store and options menu in a real browser (mw-e31.1): changes persist across a reload in
// localStorage, "Reset to defaults" resets only its category, and the game still starts when the
// browser blocks storage.
import { expect, test, type Page } from '@playwright/test';
import { navigate, openScreen, openUiPage, seriousAxeViolations } from './helpers/ui';

const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);

async function openOptions(page: Page): Promise<void> {
  await openUiPage(page);
  await openScreen(page, 'options');
  await expect(page.locator('[data-screen="options"]')).toBeVisible();
}

test('AC-4: a toggle changed in the options menu persists across a reload', async ({ page }) => {
  await openOptions(page);
  // Keyboard only: E switches to the Camera tab, Enter flips the focused switch.
  await navigate(page, ['tabNext']);
  const invert = setting(page, 'camera.invertY');
  await expect(invert).toBeVisible();
  await expect(invert).toHaveAttribute('aria-checked', 'false');
  await invert.focus();
  await navigate(page, ['confirm']);
  await expect(invert).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await openOptions(page);
  await navigate(page, ['tabNext']);
  await expect(setting(page, 'camera.invertY')).toHaveAttribute('aria-checked', 'true');
});

test('AC-5: confirming "Reset to defaults" in Camera resets only camera settings', async ({
  page,
}) => {
  await openOptions(page);
  // Audio: master volume down two steps (80% → 70%).
  await page.locator('[role="tab"]', { hasText: 'Audio' }).click();
  const master = setting(page, 'audio.master');
  await master.focus();
  await navigate(page, ['left', 'left']);
  await expect(master).toHaveAttribute('aria-valuetext', '70%');
  // Camera: invert on, sensitivity up.
  await page.locator('[role="tab"]', { hasText: 'Camera' }).click();
  await setting(page, 'camera.invertY').click();
  const sensitivity = setting(page, 'camera.sensitivity');
  await sensitivity.focus();
  await navigate(page, ['right', 'right']);
  await expect(sensitivity).toHaveAttribute('aria-valuetext', '×1.2');

  await page.locator('[data-reset="camera"]').click();
  const dialog = page.getByRole('dialog', { name: 'Reset Camera settings?' });
  await expect(dialog).toBeVisible();
  expect(await seriousAxeViolations(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(setting(page, 'camera.invertY')).toHaveAttribute('aria-checked', 'false');
  await expect(sensitivity).toHaveAttribute('aria-valuetext', '×1.0');
  await page.locator('[role="tab"]', { hasText: 'Audio' }).click();
  await expect(master).toHaveAttribute('aria-valuetext', '70%');

  // And so it stays after a reload.
  await page.reload();
  await openOptions(page);
  await page.locator('[role="tab"]', { hasText: 'Audio' }).click();
  await expect(setting(page, 'audio.master')).toHaveAttribute('aria-valuetext', '70%');
});

test('the options menu has no serious accessibility violations', async ({ page }) => {
  await openOptions(page);
  expect(await seriousAxeViolations(page)).toEqual([]);
});

test('AC-6: with localStorage blocked the game starts on in-memory settings without errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.addInitScript(() => {
    // Blocked site data: touching window.localStorage throws.
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-settings-store', 'memory');
  await expect(page.locator('#app')).toHaveAttribute('data-layers', /sim .* tools/);
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});
