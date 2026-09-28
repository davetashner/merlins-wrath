import { expect, test } from '@playwright/test';

// mw-e28.1 AC-6: runs in every configured browser project (Chromium, Firefox, WebKit).
test.describe('audio testbed', () => {
  for (const button of ['#play-2d', '#play-3d']) {
    test(`AC-6: clicking ${button} unlocks a running AudioContext and plays the test cue with no console errors`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto('/testbed/audio.html');
      const status = page.locator('#status');
      await expect(status).toHaveAttribute('data-state', 'uncreated');

      await page.click(button);

      await expect(status).toHaveAttribute('data-state', 'running');
      await expect(status).toHaveAttribute('data-cue', 'playing');
      expect(errors).toEqual([]);
    });
  }
});
