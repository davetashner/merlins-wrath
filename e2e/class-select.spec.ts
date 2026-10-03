import { expect, test, type Page } from '@playwright/test';
import { navigate, seriousAxeViolations } from './helpers/ui';

// mw-e19.5: a new game in ?scene=testbed against the production build (Chromium). `?newgame` opens
// the class selection screen over the greybox testbed (the sim paused behind it); the keyboard picks a
// class, and the page publishes the sim's player.class on #app[data-player-class] while the kit panel
// in the HUD lists what the player carries.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/** The class of the card holding focus, if any. */
const focusedClass = (page: Page): Promise<string | null> =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['class'] ?? null);

test('AC-3: selecting Sorcerer and entering the testbed gives the sorcerer kit in the HUD', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&newgame');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  const screen = page.locator('[data-screen="class-select"]');
  await expect(screen).toBeVisible();
  await expect(screen.locator('[role="radio"]')).toHaveCount(4);
  await expect(app).not.toHaveAttribute('data-player-class', /./);
  expect(await seriousAxeViolations(page)).toEqual([]);

  // Keyboard only. Focus starts on the first card; nothing is highlighted, so Confirm is disabled.
  const confirm = page.getByTestId('class-confirm');
  await expect(confirm).toBeDisabled();
  await expect.poll(() => focusedClass(page)).toBe('knight');
  await navigate(page, ['right', 'right']);
  await expect.poll(() => focusedClass(page)).toBe('sorcerer');
  await navigate(page, ['confirm']);
  await expect(screen.locator('[data-class="sorcerer"]')).toHaveAttribute('aria-checked', 'true');
  await expect(confirm).toBeEnabled();
  await expect(confirm).toBeFocused();
  await navigate(page, ['confirm']);

  // In the testbed: the screen is gone, the sim runs, and the player is a sorcerer with its kit.
  await expect(screen).toHaveCount(0);
  await expect(app).toHaveAttribute('data-player-class', 'sorcerer');
  await expect(app).toHaveAttribute('data-ui-capture', 'false');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  const kit = page.getByTestId('class-kit');
  await expect(kit).toBeVisible();
  await expect(kit.locator('[data-part="class"]')).toHaveText('Sorcerer');
  await expect(kit.locator('[data-part="gold"]')).toHaveText('30 gold');
  await expect(kit.locator('li')).toHaveText([
    'Ash staff (equipped)',
    'Travelling robe (equipped)',
    'Mana draught ×2',
  ]);
  expect(problems).toEqual([]);
});

test('?class=thief applies the thief at boot, and the default boot has no class', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&class=thief');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-player-class', 'thief', { timeout: 5_000 });
  await expect(page.locator('[data-screen="class-select"]')).toHaveCount(0);
  await expect(page.getByTestId('class-kit').locator('li')).toHaveText([
    'Hunting knife (equipped)',
    'Leather jerkin (equipped)',
    'Lockpicks (equipped)',
  ]);

  await page.goto('/?scene=testbed');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 5_000 });
  await expect(app).not.toHaveAttribute('data-player-class', /./);
  await expect(page.getByTestId('class-kit')).toHaveCount(0);
  expect(problems).toEqual([]);
});
