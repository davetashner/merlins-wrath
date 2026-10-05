import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { holdKey, playerState, stubPointerLock, takeControl, turnTo } from './helpers/player';
import {
  collectProblems,
  data,
  fightSkeleton,
  interact,
  ready,
  run,
  SLICE_URL,
  walkNorth,
  W,
} from './helpers/slice';

// mw-e01.9: RECORDS the slice playthrough that e2e/slice-playthrough.spec.ts replays. Not part of
// `pnpm e2e`: it runs only under `pnpm slice:record` (SLICE_RECORD=1), and writes the input log to
// e2e/logs/slice-playthrough.json. Re-record whenever controller tuning, the slice's layout, the
// Forgotten miner or any other sim or content change moves the run (the playthrough then fails with
// a hash mismatch, which is its job). A bot drives the run through the page's own input listeners
// while the page logs what its sampler receives, stamped with the sim tick (src/game/loop/input-log.ts):
//   segment 0  new game as the knight → corridor → arena → the fight → the key → the alcove chest →
//              save → deliberate death
//   segment 1  (after "Load last save") alcove → iron door with the key → vestibule → save
// The two saves' state hashes are the golden hashes the playthrough checks.

const OUT = 'e2e/logs/slice-playthrough.json';

interface Saved {
  slot: string;
  tick: number;
  hash: string;
}

test.skip(process.env['SLICE_RECORD'] !== '1', 'run with pnpm slice:record');

test('record the slice playthrough', async ({ page }) => {
  test.setTimeout(600_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto(SLICE_URL);
  await ready(page);
  const app = page.locator('#app');
  await takeControl(page);

  // Spawn room: up to the wooden door and open it.
  await walkNorth(page, 4.5);
  await expect(page.getByTestId('interact-prompt')).toContainText('Open', { timeout: 10_000 });
  await interact(page);
  await expect
    .poll(async () => (await data<{ doors: Record<string, unknown> }>(page, 'mechanisms')).doors)
    .toMatchObject({ 'spawn-door': { status: 'open' } });
  // The corridor, to its far end, and the fight.
  await walkNorth(page, 24.2);
  await expect.poll(async () => data<string[]>(page, 'checkpoints')).toEqual(['cp-1', 'cp-2']);
  const fight = await fightSkeleton(page);
  test.info().annotations.push({ type: 'fight-ticks', description: String(fight.ticks) });
  await expect
    .poll(
      async () =>
        (await data<Record<string, unknown>>(page, 'facts'))['entity:slice/skeleton.slain'],
    )
    .toBe(true);

  // The key at the miner's body.
  const prompt = page.getByTestId('interact-prompt');
  // The miner's own loot (crowns, scrap, mw-ju8.19) lies beside the key: Interact takes whatever the
  // prompt names, one at a time, until the key is on the ring.
  const hasKey = async () =>
    JSON.stringify((await data<{ pack: unknown[] }>(page, 'items')).pack).includes(
      'rusted-gallery-key',
    );
  for (let attempt = 0; attempt < 12 && !(await hasKey()); attempt++) {
    const text = (await prompt.textContent({ timeout: 5_000 })) ?? '';
    if (/Take|Pick up/.test(text)) {
      await interact(page);
      continue;
    }
    await turnTo(page, { x: fight.at[0], z: fight.at[2] }, { tolerance: 0.05 });
    await holdKey(page, W, 8, 6);
  }
  await expect.poll(hasKey).toBe(true);

  // Up into the alcove (the climb is the debug console's), and the chest: open it, take all.
  await run(page, 'tp 8 1.4 35.3');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await takeControl(page);
  await turnTo(page, { x: 8, z: 36.5 }, { tolerance: 0.03 });
  await expect(prompt).toContainText('Search', { timeout: 10_000 });
  await page.keyboard.press('KeyE');
  await expect(app).toHaveAttribute('data-container-window', 'open');
  await page.keyboard.press('Enter');
  await expect(prompt).toContainText('Empty', { timeout: 10_000 });

  // Save, then die on purpose.
  await run(page, 'save manual-1');
  await expect(app).toHaveAttribute('data-saved-game', /"slot":"manual-1"/);
  const saved = await data<Saved>(page, 'saved-game');
  await run(page, 'kill');
  const screen = page.locator('[data-screen="death"]');
  await expect(screen).toBeVisible({ timeout: 60_000 });
  const first = await page.evaluate(() =>
    (window as unknown as { mwInputRecording: () => unknown }).mwInputRecording(),
  );

  // Segment 1: load the save, out of the alcove to the iron door, through it, save.
  await screen.getByRole('button', { name: 'Load last save' }).click();
  await ready(page);
  await expect(app).toHaveAttribute('data-loaded-save', /"hash"/);
  await takeControl(page);
  await run(page, 'tp 0 0 35.5');
  await expect.poll(async () => (await playerState(page)).position.z).toBeCloseTo(35.5, 0);
  await takeControl(page);
  await turnTo(page, { x: 0, z: 37 }, { tolerance: 0.03 });
  await interact(page);
  await expect
    .poll(async () => (await data<{ doors: Record<string, unknown> }>(page, 'mechanisms')).doors)
    .toMatchObject({ 'exit-door': { status: 'open' } });
  await walkNorth(page, 38.5);
  await expect
    .poll(async () => (await data<Record<string, unknown>>(page, 'facts'))['slice.complete'])
    .toBe(true);
  await run(page, 'save manual-2');
  await expect(app).toHaveAttribute('data-saved-game', /"slot":"manual-2"/);
  const final = await data<Saved>(page, 'saved-game');
  const second = await page.evaluate(() =>
    (window as unknown as { mwInputRecording: () => unknown }).mwInputRecording(),
  );

  writeFileSync(
    OUT,
    `${JSON.stringify({ version: 1, segments: [first, second], golden: { save: saved, final } }, null, 2)}\n`,
  );
  expect(problems).toEqual([]);
});
