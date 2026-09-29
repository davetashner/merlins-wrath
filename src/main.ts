import { layers } from '@game/index';
import { loadPhysics } from '@game/physics-loader';
import { openSaveStore } from '@game/save/storage/index';
import { missingFeatures } from '@game/support';
import { createRenderBootstrap } from '@render/bootstrap/index';
import { layer as tools } from '@tools/index';
import {
  PHYSICS_FAILED_TEXT,
  PHYSICS_LOADING_TEXT,
  unsupportedMessage,
  type MissingFeature,
} from '@ui/unsupported';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.dataset['layers'] = [...layers, tools].join(' ');
  void startSaves(app);
  startRenderer(app);
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

// Renderer and physics bootstrap (mw-e00.19). Checks the minimum features first so a browser
// without WebGL 2 or WebAssembly gets a readable screen instead of a blank page or uncaught error.
function startRenderer(root: HTMLElement): void {
  const missing = missingFeatures(globalThis);
  if (missing.length > 0) {
    showUnsupported(root, missing);
    return;
  }
  try {
    createRenderBootstrap({
      container: root,
      onFirstFrame: () => {
        root.dataset['firstFrameMs'] = String(Math.round(performance.now()));
      },
    });
  } catch {
    // The context can still fail to create (blocklisted GPU, hardware acceleration off).
    showUnsupported(root, ['webgl2']);
    return;
  }

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.dataset['testid'] = 'physics-status';
  root.append(status);
  // The dynamic import keeps Rapier and its WASM out of the initial bundle.
  loadPhysics(
    () => import('@dimforge/rapier3d-deterministic'),
    (state) => {
      root.dataset['physics'] = state;
      status.textContent = state === 'loading' ? PHYSICS_LOADING_TEXT : '';
    },
  ).then(
    (physics) => {
      root.dataset['physicsVersion'] = physics.version();
      status.remove();
    },
    (error: unknown) => {
      status.setAttribute('role', 'alert');
      status.textContent = PHYSICS_FAILED_TEXT;
      console.error(error);
    },
  );
}

function showUnsupported(root: HTMLElement, missing: readonly MissingFeature[]): void {
  const message = unsupportedMessage(missing);
  const screen = document.createElement('section');
  screen.setAttribute('role', 'alert');
  screen.dataset['testid'] = 'unsupported-browser';
  const heading = document.createElement('h2');
  heading.textContent = message.heading;
  const body = document.createElement('p');
  body.textContent = message.body;
  const details = document.createElement('ul');
  for (const line of message.details) {
    const item = document.createElement('li');
    item.textContent = line;
    details.append(item);
  }
  screen.append(heading, body, details);
  root.dataset['boot'] = 'unsupported';
  root.append(screen);
}
