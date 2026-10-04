// @vitest-environment happy-dom
// AC-3 [integration] (mw-e01.2): Continue on the title screen loads the most recent save, and the
// world it loads into has the state hash the save was written with. Three "pages" share one
// IndexedDB save store and one session store, as the browser tabs do: the first plays and saves (an
// older autosave, then a newer manual save, then unsaved progress), the second boots to the title
// and presses Continue (which hands the save to the death screen's reload, mw-e30.7), and the third
// is the page that reload builds, which loads the pending save before its first sim step. The real
// reload, scene and renderer run end to end in e2e/save-menus.spec.ts.
import 'fake-indexeddb/auto';
import { defineComponent, hashWorld, World } from '@sim/index';
import { UiRoot } from '@ui/index';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DeathReload, type DeathReloadReadout } from '../death/controller';
import { takePendingLoad, type PendingLoadStorage } from '../death/pending';
import { createGameSaveRegistry } from '../sections';
import { openSaveStore, type SaveStore } from '../storage/index';
import { SaveMenus } from './controller';

const Position = defineComponent<{ x: number }>('Position');
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const T0 = 1_790_000_000_000;
const MIN = 60_000;
const AREA = 'slice';

/** A fresh world, as boot builds it: one entity at x = 0, tick 0. */
function freshWorld(): World<never> {
  const w = new World({ seed: 11 }).register(Position);
  w.add(w.spawn(), Position, { x: 0 });
  return w;
}

/** Moves the world on: every Position by `dx`, the clock by `ticks`. */
function play(w: World<never>, dx: number, ticks: number): void {
  for (const id of w.query(Position).ids()) {
    const at = w.get(id, Position);
    if (at !== undefined) w.set(id, Position, { x: at.x + dx });
  }
  for (let i = 0; i < ticks; i++) w.step([]);
}

function sessionStorage(): PendingLoadStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/** One page: a UI root, its world and the death screen's reload over the shared stores. */
function page(store: SaveStore, session: PendingLoadStorage, clock: { now: number }) {
  document.body.innerHTML = '';
  const ui = new UiRoot(document.body, { unstyled: true });
  const world = freshWorld();
  const readouts: DeathReloadReadout[] = [];
  const navigations: (string | undefined)[] = [];
  const reload = new DeathReload({
    ui,
    world,
    store,
    registry: createGameSaveRegistry(),
    build,
    now: () => clock.now,
    session,
    areaId: AREA,
    navigate: (area) => navigations.push(area),
    chosenClass: () => 'knight',
    toTitle: () => undefined,
    describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: AREA }),
    publish: (readout) => readouts.push(readout),
  });
  return { ui, world, reload, readouts, navigations };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Continue on the title screen (mw-e01.2)', () => {
  it('AC-3: loads the most recent save, and the sim state hash equals the saved hash', async () => {
    const { store } = await openSaveStore({ indexedDB: new IDBFactory(), storage: undefined });
    const session = sessionStorage();
    const clock = { now: T0 };

    // Page 1: play, autosave, play on, save manually (the most recent), then play on unsaved.
    const first = page(store, session, clock);
    play(first.world, 2, 30);
    await first.reload.debugSave('auto-1');
    clock.now = T0 + MIN;
    play(first.world, 3, 45);
    await first.reload.debugSave('manual-1');
    const saved = first.readouts.at(-1);
    expect(saved).toMatchObject({ kind: 'saved', slot: 'manual-1', tick: 75 });
    clock.now = T0 + 2 * MIN;
    play(first.world, 5, 20);
    expect(hashWorld(first.world)).not.toBe(saved?.kind === 'saved' ? saved.hash : '');

    // Page 2: the title screen. Continue is focused and describes the manual save; pressing it
    // reloads into the save's area with the save pending.
    const title = page(store, session, clock);
    const menus = new SaveMenus({
      ui: title.ui,
      world: title.world,
      store,
      registry: createGameSaveRegistry(),
      build,
      now: () => clock.now,
      describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: AREA }),
      load: (load) => {
        title.reload.reload(load);
      },
      newGame: () => undefined,
    });
    const menu = await menus.openTitle();
    expect(document.activeElement).toBe(menu.continueButton);
    title.ui.intent('confirm', 'keyboard');
    expect(title.navigations).toEqual([AREA]);

    // Page 3: the reloaded page loads the pending save into its fresh world before the first step.
    const resumed = page(store, session, clock);
    const pending = takePendingLoad(session);
    expect(pending).toMatchObject({ slot: 'manual-1', areaId: AREA });
    await resumed.reload.resume(pending);
    await flush();
    const loaded = resumed.readouts.at(-1);
    expect(loaded).toMatchObject({ kind: 'loaded', slot: 'manual-1', status: 'loaded' });
    if (saved?.kind !== 'saved' || loaded?.kind !== 'loaded') throw new Error('no save or load');
    expect(loaded.tick).toBe(saved.tick);
    expect(loaded.hash).toBe(saved.hash);
    expect(hashWorld(resumed.world)).toBe(saved.hash);
    expect(resumed.world.tick).toBe(75);
  });
});
