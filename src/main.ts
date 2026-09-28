import { layers } from '@game/index';
import { openSaveStore } from '@game/save/storage/index';
import { layer as tools } from '@tools/index';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.dataset['layers'] = [...layers, tools].join(' ');
  void startSaves(app);
}

// Opens save storage (mw-e30.2). If the browser blocks IndexedDB the game runs on in-memory saves,
// and the player must be told for as long as that lasts.
async function startSaves(root: HTMLElement): Promise<void> {
  const saves = await openSaveStore({
    indexedDB: globalThis.indexedDB,
    storage: globalThis.navigator.storage,
  });
  root.dataset['saveStore'] = saves.store.kind;
  if (saves.warning !== undefined) {
    const banner = document.createElement('p');
    banner.setAttribute('role', 'alert');
    banner.dataset['testid'] = 'save-warning';
    banner.textContent = saves.warning;
    root.prepend(banner);
    console.warn(saves.reason);
  }
}
