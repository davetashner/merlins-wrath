import { expect, test, type Page } from '@playwright/test';
import { seriousAxeViolations } from './helpers/ui';

// mw-e30.11: the title menu and the Save / Load screens in ?scene=testbed against the production
// build (Chromium). `?menu=title|load|save` opens a menu over the freshly built testbed with the sim
// paused behind it. Saves go to IndexedDB, which persists across page loads in one test; Continue and
// Load reload the page into the save's area and load it there (the death screen's hand-off, mw-e30.7),
// publishing the state hash right after the load on #app[data-loaded-save]. The Save screen publishes
// the tick and hash it saved on #app[data-save-menu-saved].
//
// CI runners draw at ~3 fps and every Playwright round trip waits on the page's main thread (~1 s
// each, see PR #168), so these specs read the menus in one evaluate (`menuState`) and wait only on
// state, never on time. The UI handles keydown synchronously; saves and deletes are async (storage),
// so their results are polled.

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

interface MenuState {
  /** data-screen of the top screen, null when none is open. */
  readonly top: string | null;
  /** The slot list's mode (load / save) when one is open. */
  readonly mode: string | null;
  /** The focused element: its row's slot (or "-"), its data-action, and its text. */
  readonly focus: { readonly slot: string; readonly action: string; readonly text: string };
  /** Continue on the title menu: disabled (aria-disabled) and its accessible description. */
  readonly continue: { readonly disabled: boolean; readonly description: string } | null;
  /** Slot rows: id, the row's actions and whether it shows a thumbnail image. */
  readonly rows: readonly {
    readonly slot: string;
    readonly actions: readonly string[];
    readonly thumbnail: boolean;
  }[];
  readonly status: string;
  readonly error: string;
  /** The open confirmation dialog's title, null when none. */
  readonly confirm: string | null;
}

/** Everything the specs check about the menus, in one round trip. */
const menuState = (page: Page): Promise<MenuState> =>
  page.evaluate(() => {
    const describedBy = (el: Element | null): string =>
      (el?.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    const screens = [...document.querySelectorAll<HTMLElement>('[data-screen]')];
    const top = screens.at(-1) ?? null;
    const active = document.activeElement as HTMLElement | null;
    const cont = document.querySelector('[data-screen="title"] [data-action="continue"]');
    const list = document.querySelector<HTMLElement>('[data-testid="save-slots"]');
    const confirm = document.querySelector('[data-screen="confirm"] h2');
    return {
      top: top?.dataset['screen'] ?? null,
      mode: list?.dataset['mode'] ?? null,
      focus: {
        slot: active?.closest<HTMLElement>('[data-slot]')?.dataset['slot'] ?? '-',
        action: active?.dataset['action'] ?? '',
        text: active?.textContent ?? '',
      },
      continue:
        cont === null
          ? null
          : {
              disabled: cont.getAttribute('aria-disabled') === 'true',
              description: describedBy(cont),
            },
      rows: [...document.querySelectorAll<HTMLElement>('[data-slot]')].map((row) => ({
        slot: row.dataset['slot'] ?? '',
        actions: [...row.querySelectorAll<HTMLElement>('[data-action]')].map(
          (el) => el.dataset['action'] ?? '',
        ),
        thumbnail: row.querySelector('img.vb-slot-thumb') !== null,
      })),
      status: document.querySelector('[data-testid="save-slots-status"]')?.textContent ?? '',
      error: document.querySelector('[data-testid="save-slots-error"]')?.textContent ?? '',
      confirm: confirm?.textContent ?? null,
    };
  });

interface Readout {
  readonly slot: string;
  readonly tick: number;
  readonly hash: string;
}

async function readout(page: Page, attribute: string): Promise<Readout> {
  const json = await page.locator('#app').getAttribute(attribute);
  return JSON.parse(json ?? 'null') as Readout;
}

/** Opens the testbed with `?menu=<menu>` and waits until the menu has focus. */
async function openMenu(page: Page, menu: 'title' | 'save'): Promise<void> {
  await page.goto(`/?scene=testbed&menu=${menu}`);
  const screen = menu === 'title' ? 'title' : 'save-slots';
  await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible({ timeout: 30_000 });
}

/** Waits for the slot list's status line to read `status`. */
async function statusIs(page: Page, status: string): Promise<void> {
  await expect.poll(async () => (await menuState(page)).status, { timeout: 15_000 }).toBe(status);
}

/** Waits until the reloaded testbed has loaded `slot` and is stepping on from it. */
async function loadedFrom(page: Page, slot: string): Promise<Readout> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-loaded-save', new RegExp(`"slot":"${slot}"`), {
    timeout: 30_000,
  });
  return readout(page, 'data-loaded-save');
}

test('AC-2: with no saves the title menu disables Continue with "No saves yet" and focuses New Game', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await openMenu(page, 'title');
  const state = await menuState(page);
  expect(state.continue).toEqual({ disabled: true, description: 'No saves yet' });
  expect(state.focus.text).toBe('New Game');
  // The disabled Continue is still announced as a button that cannot be pressed.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(await seriousAxeViolations(page)).toEqual([]);

  // New Game goes on to class selection.
  const reloaded = page.waitForEvent('load');
  await page.keyboard.press('Enter');
  await reloaded;
  await expect(page.locator('[data-screen="class-select"]')).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toContain('menu=');
  expect(problems).toEqual([]);
});

test('AC-1: with a save, Continue is focused on the title menu and loads the most recent save', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openMenu(page, 'save');
  expect((await menuState(page)).focus).toMatchObject({ slot: 'manual-1', action: 'choose' });
  await page.keyboard.press('Enter');
  await statusIs(page, 'Saved to Manual save 1');
  const saved = await readout(page, 'data-save-menu-saved');
  expect(saved.slot).toBe('manual-1');

  await openMenu(page, 'title');
  const state = await menuState(page);
  expect(state.focus.action).toBe('continue');
  expect(state.continue?.disabled).toBe(false);
  expect(state.continue?.description).toMatch(/^Last save: Manual save 1 · testbed/);
  expect(await seriousAxeViolations(page)).toEqual([]);

  await page.keyboard.press('Enter');
  const loaded = await loadedFrom(page, 'manual-1');
  expect(loaded.tick).toBe(saved.tick);
  expect(loaded.hash).toBe(saved.hash);
  // Playable: no menu holds the sim.
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('AC-3: with the keyboard alone the slot lists save, overwrite, delete and load', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await openMenu(page, 'save');
  let state = await menuState(page);
  expect(state.mode).toBe('save');
  expect(state.rows).toHaveLength(10);
  expect(state.focus).toMatchObject({ slot: 'manual-1', action: 'choose' });

  // Save into the empty first slot: no question asked.
  await page.keyboard.press('Enter');
  await statusIs(page, 'Saved to Manual save 1');
  state = await menuState(page);
  expect(state.rows[0]).toMatchObject({ actions: ['choose', 'delete'], thumbnail: true });
  expect(state.focus).toMatchObject({ slot: 'manual-1', action: 'choose' });

  // Saving over it asks first; focus starts on Cancel, → reaches Overwrite.
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await menuState(page)).confirm, { timeout: 15_000 })
    .toBe('Overwrite save?');
  expect((await menuState(page)).focus.text).toBe('Cancel');
  expect(await seriousAxeViolations(page)).toEqual([]);
  await page.keyboard.press('ArrowRight');
  expect((await menuState(page)).focus.text).toBe('Overwrite');
  await page.keyboard.press('Enter');
  await statusIs(page, 'Overwrote Manual save 1');

  // → reaches Delete, which also asks.
  await page.keyboard.press('ArrowRight');
  expect((await menuState(page)).focus).toMatchObject({ slot: 'manual-1', action: 'delete' });
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await menuState(page)).confirm, { timeout: 15_000 })
    .toBe('Delete save?');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await statusIs(page, 'Deleted Manual save 1');
  state = await menuState(page);
  expect(state.rows[0]?.actions).toEqual(['choose']);
  expect(state.focus).toMatchObject({ slot: 'manual-1', action: 'choose' });

  // ↓ moves to the next slot; save there, then Esc leaves the screen.
  await page.keyboard.press('ArrowDown');
  expect((await menuState(page)).focus).toMatchObject({ slot: 'manual-2', action: 'choose' });
  await page.keyboard.press('Enter');
  await statusIs(page, 'Saved to Manual save 2');
  expect(await seriousAxeViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  expect((await menuState(page)).top).toBeNull();

  // Title → Load (two ↓ from Continue) → the save → Enter loads it.
  await openMenu(page, 'title');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  expect((await menuState(page)).focus.action).toBe('load');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await menuState(page)).mode, { timeout: 15_000 }).toBe('load');
  state = await menuState(page);
  expect(state.rows.map((row) => row.slot)).toEqual(['manual-2']);
  expect(state.focus).toMatchObject({ slot: 'manual-2', action: 'choose' });
  // Esc goes back to the title menu, Enter on Load returns.
  await page.keyboard.press('Escape');
  expect((await menuState(page)).focus.action).toBe('load');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await menuState(page)).mode, { timeout: 15_000 }).toBe('load');
  await page.keyboard.press('Enter');
  await loadedFrom(page, 'manual-2');
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  expect(problems).toEqual([]);
});
