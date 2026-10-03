// @vitest-environment happy-dom
// AC-4 [integration] (mw-e30.11): when the browser blocks IndexedDB, saves fall back to memory
// (mw-e30.2) and the game is told so; every save screen then shows the non-persistence warning, so a
// player never trusts a save that will vanish when the page closes.
import { defineComponent, World } from '@sim/index';
import { UiRoot } from '@ui/index';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '../sections';
import { openSaveStore, SAVES_NOT_PERSISTED_WARNING } from '../storage/index';
import { SaveMenus } from './controller';

const Position = defineComponent<{ x: number }>('Position');

describe('save screens in in-memory fallback mode', () => {
  it('AC-4: the Save and Load screens show the non-persistence warning', async () => {
    document.body.innerHTML = '';
    const opened = await openSaveStore({ indexedDB: undefined, storage: undefined });
    expect(opened.store.kind).toBe('memory');
    const world = new World({ seed: 3 }).register(Position);
    const ui = new UiRoot(document.body, { unstyled: true });
    const menus = new SaveMenus({
      ui,
      world,
      store: opened.store,
      registry: createGameSaveRegistry(),
      build: { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' },
      now: () => 1_790_000_000_000,
      describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: 'testbed' }),
      warning: opened.warning,
      load: () => undefined,
      newGame: () => undefined,
    });
    const warning = () =>
      ui.top?.element.querySelector<HTMLElement>('[data-testid="save-slots-warning"]');

    const save = await menus.openSave();
    expect(warning()?.textContent).toBe(SAVES_NOT_PERSISTED_WARNING);
    expect(warning()?.getAttribute('role')).toBe('alert');
    expect(warning()?.closest('[hidden]')).toBeNull();
    save.screen.close();

    await menus.openLoad();
    expect(warning()?.textContent).toBe(SAVES_NOT_PERSISTED_WARNING);
  });
});
