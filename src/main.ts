import { loadGameContent } from '@content/index';
import { layers } from '@game/index';
import { browserFrameSources, createGameLoop, object3DBinding } from '@game/loop/index';
import { loadPhysics } from '@game/physics-loader';
import { readSceneTransform, resolveSceneRequest, SceneLoader } from '@game/scene/index';
import { openSaveStore } from '@game/save/storage/index';
import { missingFeatures } from '@game/support';
import { createRenderBootstrap } from '@render/bootstrap/index';
import { createGreyboxView } from '@render/greybox/index';
import { InMemoryColliderSink, registerSceneComponents, World } from '@sim/index';
import { bindDebugCameraInput, DebugCamera } from '@tools/debug-camera/index';
import { layer as tools } from '@tools/index';
import { FramePerfProbe, formatPerfReport, parsePerfParam } from '@tools/perf/frame-probe';
import { DEBUG_CAMERA_HINT, sceneErrorMessage, sceneLabel } from '@ui/scene-hud';
import {
  PHYSICS_FAILED_TEXT,
  PHYSICS_LOADING_TEXT,
  unsupportedMessage,
  type MissingFeature,
} from '@ui/unsupported';

/** Placeholder world seed until new-game/save flows choose one. */
const BOOT_SEED = 1;

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
  let view;
  try {
    view = createRenderBootstrap({
      container: root,
      // The game loop below draws each frame after stepping the sim (mw-e00.20).
      animationLoop: false,
      // The greybox scene below replaces the mw-e00.19 placeholder (mw-e00.21).
      placeholderScene: false,
      onFirstFrame: () => {
        root.dataset['firstFrameMs'] = String(Math.round(performance.now()));
      },
    });
  } catch {
    // The context can still fail to create (blocklisted GPU, hardware acceleration off).
    showUnsupported(root, ['webgl2']);
    return;
  }
  const { camera } = view;

  // ?perf (mw-e00.21 AC-6): times each whole frame callback (sim steps + render submission) and the
  // interval between frames, then logs percentiles once. See src/tools/perf/frame-probe.ts.
  const perf = parsePerfParam(location.search);
  const browserSources = browserFrameSources(globalThis.window);
  let sources = browserSources;
  if (perf !== undefined) {
    const probe = new FramePerfProbe(perf);
    const { scheduler } = browserSources;
    sources = {
      ...browserSources,
      scheduler: {
        request: (callback) =>
          scheduler.request(() => {
            const start = performance.now();
            callback();
            const report = probe.frame(start, performance.now() - start);
            if (report !== undefined) {
              root.dataset['perf'] = JSON.stringify(report);
              console.info(formatPerfReport(report));
            }
          }),
        cancel: (handle) => {
          scheduler.cancel(handle);
        },
      },
    };
  }

  // The debug fly camera (mw-e00.21) drives the view camera directly and hands it back on toggle-off.
  const writeCameraData = (): void => {
    const round = (n: number): number => Math.round(n * 1e4) / 1e4;
    root.dataset['camera'] = JSON.stringify({
      position: camera.position.toArray().map(round),
      quaternion: camera.quaternion.toArray().map(round),
    });
  };
  const debugCamera = new DebugCamera({
    read: () => ({
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      rotation: {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      },
    }),
    write: ({ position, rotation }) => {
      camera.position.set(position.x, position.y, position.z);
      camera.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
  });

  // Fixed-step sim on requestAnimationFrame (mw-e00.20); entities bind to scene objects through the
  // loop's sync. The scene loader fills the world from content (mw-e00.21).
  const world = registerSceneComponents(new World({ seed: BOOT_SEED }));
  let lastFrameMs: number | undefined;
  const { loop, sync } = createGameLoop({
    world,
    sources,
    draw: ({ timeMs }) => {
      if (debugCamera.update(timeMs - (lastFrameMs ?? timeMs))) writeCameraData();
      lastFrameMs = timeMs;
      view.renderFrame(timeMs);
    },
  });

  const hud = document.createElement('div');
  hud.dataset['testid'] = 'scene-hud';
  const label = document.createElement('p');
  label.dataset['testid'] = 'scene-label';
  const hint = document.createElement('p');
  hint.dataset['testid'] = 'debug-camera-hint';
  hint.textContent = DEBUG_CAMERA_HINT;
  hud.append(label, hint);
  root.append(hud);

  bindDebugCameraInput(debugCamera, {
    keys: globalThis.window,
    surface: view.canvas,
    onToggle: (active) => {
      root.dataset['debugCamera'] = active ? 'on' : 'off';
      hint.textContent = active ? `${DEBUG_CAMERA_HINT} · ON` : DEBUG_CAMERA_HINT;
      writeCameraData();
    },
  });
  root.dataset['debugCamera'] = 'off';

  const content = loadGameContent();
  const scenes = new SceneLoader({
    world,
    sync,
    // Static colliders go to the sim's physics port once mw-e03.10 lands; until then they are kept
    // in memory so loading and unloading are still checked.
    colliders: new InMemoryColliderSink(),
    content,
    objects: createGreyboxView(view.renderer, view.scene),
    binding: (object) => object3DBinding(object, readSceneTransform),
  });
  const request = resolveSceneRequest(location.search, scenes.available());
  if (request.kind === 'scene') {
    const scene = content.get('scene', request.id);
    scenes.load(scene.id);
    camera.position.set(...scene.camera.position);
    camera.lookAt(...scene.camera.target);
    label.textContent = sceneLabel(scene, __BUILD_SHA__);
    root.dataset['scene'] = scene.id;
  } else {
    label.textContent = `No scene · build ${__BUILD_SHA__}`;
    showSceneError(root, request.requested, request.available);
  }
  writeCameraData();
  loop.start();

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

// ?scene= named a scene that does not exist (mw-e00.21 AC-4): say so and link the real ones. The
// renderer keeps running on an empty world.
function showSceneError(root: HTMLElement, requested: string, available: readonly string[]): void {
  const message = sceneErrorMessage(requested, available);
  const panel = document.createElement('section');
  panel.setAttribute('role', 'alert');
  panel.dataset['testid'] = 'scene-error';
  const heading = document.createElement('h2');
  heading.textContent = message.heading;
  const body = document.createElement('p');
  body.textContent = message.body;
  const list = document.createElement('ul');
  for (const scene of message.scenes) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = scene.href;
    link.textContent = scene.id;
    item.append(link);
    list.append(item);
  }
  panel.append(heading, body, list);
  root.dataset['sceneError'] = requested;
  root.append(panel);
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
