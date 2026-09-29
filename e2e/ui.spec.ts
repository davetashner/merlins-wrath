import { expect, test, type Page } from '@playwright/test';
import {
  clippedText,
  focused,
  focusInTopScreen,
  focusRing,
  galleryValues,
  installVirtualPad,
  interactiveComponents,
  navigate,
  openScreen,
  openUiPage,
  seriousAxeViolations,
  setPadConnected,
  topScreen,
  type UiDevice,
  type UiStep,
} from './helpers/ui';

// mw-e00.23: the UI kit's component gallery (testbed/ui.html) in the production build. Navigation is
// real key presses or a virtual standard-mapping gamepad (e2e/helpers/ui.ts).

const DIRECTIONS: readonly UiStep[] = ['up', 'down', 'left', 'right'];

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(msg.text());
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/**
 * Breadth-first search of the gallery's focus graph using only directional presses: every component
 * reached is expanded in all four directions by replaying its path from a freshly opened screen.
 * Returns the components reached and the path to each.
 */
async function traverse(page: Page, device: UiDevice): Promise<Map<string, UiStep[]>> {
  await openScreen(page, 'gallery');
  const start = await focused(page);
  if (start === null) throw new Error('nothing focused on open');
  const paths = new Map<string, UiStep[]>([[start, []]]);
  const queue = [start];
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    const path = paths.get(key) ?? [];
    for (const dir of DIRECTIONS) {
      await openScreen(page, 'gallery');
      await navigate(page, [...path, dir], device);
      const reached = await focused(page);
      if (reached !== null && !paths.has(reached)) {
        paths.set(reached, [...path, dir]);
        queue.push(reached);
      }
    }
  }
  return paths;
}

test.describe('UI component gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installVirtualPad(page);
  });

  for (const device of ['keyboard', 'gamepad'] as const) {
    test(`AC-3: every interactive component is reachable with ${device} directions`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const problems = collectProblems(page);
      await openUiPage(page);
      const paths = await traverse(page, device);
      const expected = await interactiveComponents(page);
      expect(expected.length).toBeGreaterThanOrEqual(10);
      expect([...paths.keys()].sort()).toEqual([...expected].sort());
      expect(problems).toEqual([]);
    });
  }

  test('AC-3: the focus ring is visible with contrast ≥ 3:1 on every component', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openUiPage(page);
    const paths = await traverse(page, 'keyboard');
    for (const [key, path] of paths) {
      await openScreen(page, 'gallery');
      await navigate(page, path);
      const ring = await focusRing(page);
      expect(ring, key).not.toBeNull();
      expect(ring?.style, key).not.toBe('none');
      expect(ring?.width ?? 0, key).toBeGreaterThanOrEqual(2);
      expect(ring?.contrast ?? 0, key).toBeGreaterThanOrEqual(3);
    }
  });

  for (const device of ['keyboard', 'gamepad'] as const) {
    test(`AC-3: focus never escapes an open modal (${device})`, async ({ page }) => {
      await openUiPage(page);
      const paths = await traverse(page, device);
      const opener = [...paths.entries()].find(([key]) => key.startsWith('gallery/button#2'));
      expect(opener, 'the confirm opener is reachable').toBeDefined();
      await openScreen(page, 'gallery');
      await navigate(page, [...(opener?.[1] ?? []), 'confirm'], device);
      expect(await topScreen(page)).toBe('confirm');
      const moves: UiStep[] =
        device === 'keyboard'
          ? ['up', 'down', 'left', 'right', 'next', 'next', 'next', 'prev', 'prev', 'prev']
          : ['up', 'down', 'left', 'right', 'right', 'right', 'left', 'left', 'down', 'up'];
      for (const move of [...moves, ...moves]) {
        await navigate(page, [move], device);
        expect(await focusInTopScreen(page), `after ${move}`).toBe(true);
      }
      // A click on the gallery behind the backdrop cannot take focus either.
      await page.mouse.click(40, 40);
      expect(await focusInTopScreen(page)).toBe(true);
      await navigate(page, ['back'], device);
      expect(await topScreen(page)).toBe('gallery');
      expect(await focused(page)).toBe(opener?.[0]);
    });
  }

  test('confirm presses a button exactly once (Enter, Space, gamepad A)', async ({ page }) => {
    await openUiPage(page);
    await navigate(page, ['confirm']);
    await page.keyboard.press('Space');
    await navigate(page, ['confirm'], 'gamepad');
    expect((await galleryValues(page))['primary']).toBe(3);
  });

  test('AC-6: a gamepad disconnecting mid-menu keeps focus; the keyboard carries on', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openUiPage(page);
    await openScreen(page, 'gallery');
    await navigate(page, ['right'], 'gamepad');
    const before = await focused(page);
    await setPadConnected(page, false);
    expect(await focused(page)).toBe(before);
    await navigate(page, ['left'], 'keyboard');
    expect(await focused(page)).not.toBe(before);
    expect(problems).toEqual([]);
  });

  test('AC-4: at --ui-text-scale 2.0 and 1280×720 no text is clipped', async ({ page }) => {
    await openUiPage(page, '/testbed/ui.html?scale=2');
    await expect(page.locator('[data-testid="ui-root"]')).toHaveAttribute(
      'style',
      /--ui-text-scale: 2/,
    );
    expect(await clippedText(page)).toEqual([]);
    // Open the modal too: its text must fit as well.
    await navigate(page, ['right', 'right', 'confirm']);
    expect(await topScreen(page)).toBe('confirm');
    expect(await clippedText(page)).toEqual([]);
  });

  test('AC-7: axe-core finds no serious or critical violations', async ({ page }) => {
    await openUiPage(page);
    expect(await seriousAxeViolations(page)).toEqual([]);
    await navigate(page, ['right', 'right', 'confirm']);
    expect(await topScreen(page)).toBe('confirm');
    expect(await seriousAxeViolations(page)).toEqual([]);
  });
});
