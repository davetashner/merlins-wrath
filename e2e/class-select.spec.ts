import { expect, test, type Page } from '@playwright/test';
import { navigate, seriousAxeViolations } from './helpers/ui';

// mw-e19.5: a new game in ?scene=testbed against the production build (Chromium). `?newgame` opens
// the class selection screen over the greybox testbed (the sim paused behind it); the keyboard picks a
// class, and the page publishes the sim's player.class on #app[data-player-class] while the kit panel
// in the HUD lists what the player carries.
//
// mw-e01.15: the game configuration (src/content/data/game/game.json) makes only the Knight playable in
// m1; the other cards are locked. The per-class tests of mw-e19.5 unlock every class with
// ?allclasses, which a build with the debug console honours (the e2e build has it).

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
  await page.goto('/?scene=testbed&newgame&allclasses');
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
  await page.goto('/?scene=testbed&class=thief&allclasses');
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

test('AC-5: a new game offers only the Knight; locked cards cannot be confirmed and the run starts as the knight', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&newgame');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  const screen = page.locator('[data-screen="class-select"]');
  await expect(screen.locator('[role="radio"]')).toHaveCount(4);
  expect(await seriousAxeViolations(page)).toEqual([]);

  // AC-1 in the browser: Knight focused; the other three locked with a badge and the reason.
  await expect.poll(() => focusedClass(page)).toBe('knight');
  await expect(screen.locator('[data-class="knight"] [data-part="lock"]')).toHaveCount(0);
  for (const id of ['archer', 'sorcerer', 'thief']) {
    const locked = screen.locator(`[data-class="${id}"]`);
    await expect(locked.locator('[data-part="lock"]')).toBeVisible();
    await expect(locked).toHaveAccessibleDescription('Not playable in this build yet');
  }

  // AC-2: a locked card takes focus but neither confirm nor a click picks it.
  const confirm = page.getByTestId('class-confirm');
  await navigate(page, ['right', 'right']);
  await expect.poll(() => focusedClass(page)).toBe('sorcerer');
  await navigate(page, ['confirm']);
  // A locked card is aria-disabled, so Playwright only clicks it when forced (a player's mouse can).
  await screen.locator('[data-class="thief"]').click({ force: true });
  await expect.poll(() => focusedClass(page)).toBe('thief');
  await expect(screen.locator('[aria-checked="true"]')).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveAccessibleDescription('Not playable in this build yet');
  await expect(app).not.toHaveAttribute('data-player-class', /./);

  // Back to the Knight: confirm, confirm.
  await navigate(page, ['left', 'left', 'left']);
  await expect.poll(() => focusedClass(page)).toBe('knight');
  await navigate(page, ['confirm']);
  await expect(confirm).toBeFocused();
  await navigate(page, ['confirm']);
  await expect(screen).toHaveCount(0);
  await expect(app).toHaveAttribute('data-player-class', 'knight');
  await expect(page.getByTestId('class-kit').locator('[data-part="class"]')).toHaveText('Knight');
  expect(problems).toEqual([]);
});
