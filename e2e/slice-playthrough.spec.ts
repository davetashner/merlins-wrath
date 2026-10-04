import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { playerState, stubPointerLock, takeControl, turnTo } from './helpers/player';
import { collectProblems, data, interact, ready, run, SLICE_URL, walkNorth } from './helpers/slice';

// mw-e01.9: the vertical slice played start to finish against the production build (Chromium), from a
// recorded input log (e2e/logs/slice-playthrough.json, recorded by `pnpm slice:record`, see
// e2e/slice-record.spec.ts): new game as the knight, the corridor, the fight with the Forgotten miner,
// its key, the alcove chest, a manual save, a deliberate death, Load last save, the iron door, and
// the slice's pass (the slice.complete fact).
//
// The page plays the log back itself (src/game/loop/input-log.ts, debug pages only): each input is
// handed to the sim tick it was recorded at, so the run reaches the same sim state hashes however
// slowly CI draws frames (software GL, ~2 fps, at most five ticks a frame). The test waits on
// published state, never on wall time. The golden hashes in the log file are the two saves' state
// hashes (#app[data-saved-game]); a sim, content or tuning change that moves the run changes them:
// re-record with `pnpm slice:record` and review the diff.
//
// The load and reload budgets (contract §1) are measured inside the page, as e2e/title.spec.ts and
// e2e/slice-saves.spec.ts do, so Playwright round trips never add to them.

interface Saved {
  slot: string;
  tick: number;
  hash: string;
  status?: string;
  requestedAt?: number | null;
}

interface Recording {
  segments: unknown[];
  golden: { save: Saved; final: Saved };
}

const recording = JSON.parse(readFileSync('e2e/logs/slice-playthrough.json', 'utf8')) as Recording;

/** 50 Mbps down, a modest uplink and a broadband round trip (contract §1). */
const BROADBAND = {
  offline: false,
  latency: 20,
  downloadThroughput: (50 * 1_000_000) / 8,
  uploadThroughput: (10 * 1_000_000) / 8,
};

/**
 * On every page of the run: hands the page the next segment of the log (one per load, counted in
 * sessionStorage), grants pointer lock as a browser does, and stamps when the player first stands
 * grounded and when it first moves on from a loaded save.
 */
async function prepare(page: Page, segments: unknown[]): Promise<void> {
  await page.addInitScript(
    (log) => {
      const w = window as unknown as {
        mwInputReplay?: unknown;
        playableAt?: number;
        loadedPlayableAt?: number;
      };
      const index = Number(sessionStorage.getItem('mwSegment') ?? '0');
      sessionStorage.setItem('mwSegment', String(index + 1));
      w.mwInputReplay = { events: log[index] ?? [] };
      // The log holds the sim's inputs, not the menus' (the container window pauses the sim): while
      // the chest's window is open, "Take all" is pressed (Enter) once a frame, as the recording did.
      const takeAll = (): void => {
        const app = document.querySelector<HTMLElement>('#app');
        if (app?.dataset['containerWindow'] !== 'open') return;
        for (const type of ['keydown', 'keyup']) {
          window.dispatchEvent(new KeyboardEvent(type, { code: 'Enter', key: 'Enter' }));
        }
        requestAnimationFrame(takeAll);
      };
      new MutationObserver(() => requestAnimationFrame(takeAll)).observe(document, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-container-window'],
      });
      const observer = new MutationObserver(() => {
        const app = document.querySelector<HTMLElement>('#app');
        const player = app?.dataset['player'];
        if (player === undefined) return;
        if (w.playableAt === undefined && player.includes('"grounded":true')) {
          w.playableAt = performance.now();
        }
        const loaded = app?.dataset['loadedSave'];
        if (loaded === undefined || w.loadedPlayableAt !== undefined) return;
        if (
          (JSON.parse(player) as { tick: number }).tick >
          (JSON.parse(loaded) as { tick: number }).tick
        ) {
          w.loadedPlayableAt = Date.now();
          observer.disconnect();
        }
      });
      observer.observe(document, { attributes: true, subtree: true });
    },
    segments.map((segment) => (segment as { events: unknown[] }).events),
  );
}

async function replayDone(page: Page): Promise<void> {
  await expect(page.locator('#app')).toHaveAttribute('data-input-replay', /"done":true/, {
    timeout: 300_000,
  });
}

test('AC-1, AC-2, AC-3: the recorded slice run reaches slice.complete at the golden state hashes, within the load budgets', async ({
  page,
}) => {
  // About 2 500 sim ticks with a death beat: ~4 minutes at CI's ~10 ticks a second.
  test.setTimeout(540_000);
  const problems = collectProblems(page);
  await prepare(page, recording.segments);
  const app = page.locator('#app');

  // Initial load to playable at 50 Mbps, then the network is let go so the rest is not throttled.
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', BROADBAND);
  await page.goto(SLICE_URL);
  await ready(page);
  const loadMs = await page.evaluate(
    () => (window as unknown as { playableAt?: number }).playableAt ?? Infinity,
  );
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  test.info().annotations.push({ type: 'load-ms', description: String(Math.round(loadMs)) });
  expect(loadMs).toBeLessThanOrEqual(10_000);

  // Segment 0: fight, loot, save, deliberate death. The save's tick and state hash are the golden.
  await replayDone(page);
  await expect(app).toHaveAttribute('data-saved-game', /"slot":"manual-1"/, { timeout: 30_000 });
  const saved = await data<Saved>(page, 'saved-game');
  expect({ tick: saved.tick, hash: saved.hash }).toEqual({
    tick: recording.golden.save.tick,
    hash: recording.golden.save.hash,
  });
  expect((await data<Record<string, unknown>>(page, 'facts'))['entity:slice/skeleton.slain']).toBe(
    true,
  );
  const screen = page.locator('[data-screen="death"]');
  // The 90-tick death beat runs first: seconds of wall time on a slow runner.
  await expect(screen).toBeVisible({ timeout: 90_000 });
  const creaturesAtDeath = await data<unknown>(page, 'creatures');

  // Load last save: the world is the save's, the skeleton still slain, and playable within 3 s warm.
  await screen.getByRole('button', { name: 'Load last save' }).click();
  await ready(page);
  await expect(app).toHaveAttribute('data-loaded-save', /"hash"/, { timeout: 30_000 });
  const loaded = await data<Saved>(page, 'loaded-save');
  expect(loaded).toMatchObject({ slot: 'manual-1', status: 'loaded', tick: saved.tick });
  expect(loaded.hash).toBe(recording.golden.save.hash);
  expect(await data<unknown>(page, 'creatures')).toEqual(creaturesAtDeath);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { loadedPlayableAt?: number }).loadedPlayableAt ?? null,
        ),
      { timeout: 30_000 },
    )
    .not.toBeNull();
  const playableAt = await page.evaluate(
    () => (window as unknown as { loadedPlayableAt?: number }).loadedPlayableAt ?? Infinity,
  );
  const reloadMs = playableAt - (loaded.requestedAt ?? 0);
  test.info().annotations.push({ type: 'reload-ms', description: String(reloadMs) });
  expect(reloadMs).toBeGreaterThan(0);
  expect(reloadMs).toBeLessThanOrEqual(3_000);

  // Segment 1: the replay continues from the save, through the iron door, to the pass.
  await replayDone(page);
  await expect
    .poll(async () => (await data<Record<string, unknown>>(page, 'facts'))['slice.complete'], {
      timeout: 60_000,
    })
    .toBe(true);
  await expect(app).toHaveAttribute('data-saved-game', /"slot":"manual-2"/, { timeout: 30_000 });
  const final = await data<Saved>(page, 'saved-game');
  expect({ tick: final.tick, hash: final.hash }).toEqual({
    tick: recording.golden.final.tick,
    hash: recording.golden.final.hash,
  });

  // JS heap within 1.5 GB (contract §1; Chromium's measure).
  const heap = await page.evaluate(
    () => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize,
  );
  test.info().annotations.push({ type: 'heap-mb', description: String(Math.round(heap / 1e6)) });
  expect(heap).toBeLessThanOrEqual(1.5 * 1024 ** 3);
  expect(problems).toEqual([]);
});

test('AC-4: with IndexedDB unavailable, saving shows the fallback message and the run still reaches the exit', async ({
  page,
}) => {
  test.setTimeout(480_000);
  const problems = collectProblems(page);
  // Private-mode simulation (e2e/save-storage.spec.ts): the browser exposes indexedDB but throws on open.
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
  });
  await stubPointerLock(page);
  // Segment 0 up to and through its save, without the deliberate death: the in-memory store would
  // not survive the page reload that Load last save makes, so the run goes on in the same page.
  const untilSave = (recording.segments[0] as { events: { op: string }[] }).events.filter(
    (event) => !JSON.stringify(event).includes('"op":"kill"'),
  );
  await prepare(page, [{ events: untilSave }]);
  await page.goto(SLICE_URL);
  await ready(page);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-save-store', 'memory');

  // The save goes into the in-memory store: the persistent warning is on screen, the save still
  // hashes as recorded.
  await replayDone(page);
  await expect(app).toHaveAttribute('data-saved-game', /"slot":"manual-1"/, { timeout: 30_000 });
  const banner = page.getByRole('alert');
  await expect(banner).toHaveText(/^Saves will not persist/);
  const saved = await data<Saved>(page, 'saved-game');
  expect(saved.hash).toBe(recording.golden.save.hash);
  await expect(banner).toBeVisible();

  // On to the exit: out of the alcove, the key opens the iron door, through it is the pass.
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
    .poll(async () => (await data<Record<string, unknown>>(page, 'facts'))['slice.complete'], {
      timeout: 60_000,
    })
    .toBe(true);
  await expect(banner).toBeVisible();
  // The one warning is the store's own report that IndexedDB refused to open.
  expect(problems.filter((line) => !/^warning: SaveStorageError: .*mw-saves/.test(line))).toEqual(
    [],
  );
});
