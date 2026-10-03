import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e27.4 AC-4: world state survives a save, closing the tab and loading the save, against the
// production build (Chromium). The greybox slice does not exist yet, so this plays the testbed (owner
// decision): the closet door (mw-e17.5) is the door, and the healing draught and closet key lying on
// the floor (mw-e17.7) are the loot, as no scene has a chest yet. The player takes the draught,
// takes the key, opens the locked closet door with Interact (the key unlocks it), and saves with the debug console.
// The tab closes; a new tab opens the testbed, the player dies (`kill`) and loads the save from the
// death screen, the only way to load a save in a fresh tab so far. The save carries the level's
// changes (#app[data-level-deltas], published after the save and after the load), and after the load
// the door is open and the loot gone from the floor (#app[data-level-deltas] after the load measures
// the loaded world against the level as built).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Stack {
  item: string;
  count: number;
}

interface ItemsData {
  pack: Stack[];
  world: Stack[];
  taken: number;
}

interface Mechanisms {
  doors: Record<string, { status: string; openness: number }>;
}

interface LevelDeltas {
  level: string;
  entities: { id: string; destroyed?: true; aspects?: Record<string, unknown> }[];
}

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

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

/** Opens the testbed with the debug console and waits for the player to stand in a running sim. */
async function openTestbed(page: Page): Promise<void> {
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

/** Types `line` into the debug console and closes it again. */
async function run(page: Page, line: string): Promise<void> {
  await type(page, line);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

/** Types `line` into the debug console, leaving it open. */
async function type(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  // One input event for the whole line: per-key typing costs a round trip a character on a slow runner.
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
}

/** Turns the player to face the point (x, z) through a convergent mouse-look loop (helpers/player). */
async function face(page: Page, x: number, z: number): Promise<void> {
  await turnTo(page, { x, z });
}

/** Interacts (E) once the prompt offers `label`. */
async function interact(page: Page, label: string): Promise<void> {
  await expect(page.getByTestId('interact-prompt')).toContainText(label);
  await page.keyboard.press('KeyE');
}

const DRAUGHT = { x: 1, z: -1 };
const KEY = { x: 3.5, z: 3 };
const DOOR = { x: 5, z: 4 };

test('AC-4: open a door, loot, save, close the tab, load the save: the door is open, the loot gone', async ({
  context,
}) => {
  test.setTimeout(120_000);
  const first = await context.newPage();
  const problems = collectProblems(first);
  await stubPointerLock(first);
  await openTestbed(first);
  await takeControl(first);

  // Loot: the draught by the start, then the closet key.
  await face(first, DRAUGHT.x, DRAUGHT.z);
  await interact(first, 'Take Healing draught');
  await expect.poll(async () => (await data<ItemsData>(first, 'items'))?.taken).toBe(1);
  await run(first, `tp ${String(KEY.x)} 0 ${String(KEY.z - 1.2)}`);
  await takeControl(first);
  await face(first, KEY.x, KEY.z);
  await interact(first, 'Take');
  await expect.poll(async () => (await data<ItemsData>(first, 'items'))?.taken).toBe(2);
  expect((await data<ItemsData>(first, 'items'))?.world).toEqual([]);

  // The door.
  await run(first, `tp ${String(DOOR.x - 1.2)} 0 ${String(DOOR.z)}`);
  await takeControl(first);
  await face(first, DOOR.x, DOOR.z);
  // Interact on the locked door tries the keyring: the key unlocks it and the door swings open.
  await interact(first, 'Unlock');
  await expect
    .poll(async () => (await data<Mechanisms>(first, 'mechanisms'))?.doors['closet-door'], {
      timeout: 10_000,
    })
    .toEqual({ status: 'open', openness: 1 });

  await run(first, 'save manual-1');
  await expect(first.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/);
  // The save holds the level's changes: the loot gone, the door unlocked and open.
  const saved = (await data<LevelDeltas[]>(first, 'level-deltas')) ?? [];
  const testbed = saved.find(({ level }) => level === 'testbed');
  expect(testbed?.entities).toEqual(
    expect.arrayContaining([
      { id: 'spawn:testbed-draught', destroyed: true },
      { id: 'spawn:closet-key', destroyed: true },
      {
        id: 'spawn:closet-door',
        aspects: expect.objectContaining({
          door: expect.objectContaining({ openness: 1, target: 1 }),
          lock: { locked: false },
        }) as unknown,
      },
    ]),
  );
  expect(problems).toEqual([]);
  await first.close();

  // A new tab: the area as built, then the save.
  const second = await context.newPage();
  const later = collectProblems(second);
  await openTestbed(second);
  expect((await data<Mechanisms>(second, 'mechanisms'))?.doors['closet-door']?.status).toBe(
    'locked',
  );
  expect((await data<ItemsData>(second, 'items'))?.world).toHaveLength(2);
  await type(second, 'kill');
  const screen = second.locator('[data-screen="death"]');
  await expect(screen).toBeVisible();
  await screen.getByRole('button', { name: 'Load last save' }).click();
  await openTestbed(second);
  await expect(second.locator('#app')).toHaveAttribute('data-loaded-save', /"slot":"manual-1"/);
  await expect
    .poll(async () => (await data<Mechanisms>(second, 'mechanisms'))?.doors['closet-door'])
    .toEqual({ status: 'open', openness: 1 });
  // Measured against the freshly built level's baseline, the loaded world has the saved changes:
  // the draught and the key are gone from the floor and the door is unlocked and open.
  const loaded = (await data<LevelDeltas[]>(second, 'level-deltas')) ?? [];
  expect(loaded.find(({ level }) => level === 'testbed')?.entities).toEqual(testbed?.entities);
  expect(later).toEqual([]);
});
