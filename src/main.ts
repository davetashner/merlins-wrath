import {
  compileMoves,
  loadGameContent,
  PLAYER_CAMERA_ID,
  PLAYER_CONTROLLER_ID,
} from '@content/index';
import { layers } from '@game/index';
import { ActionSampler, inputGlyph, type InputDevice } from '@game/input/index';
import { browserFrameSources, createGameLoop, object3DBinding } from '@game/loop/index';
import { bootPhysics } from '@game/physics-loader';
import { formatBudgetWarning, installGamePhysics, playerFocus } from '@game/physics-objects';
import { createUiGameBridge } from '@game/ui/index';
import { attachPlayerInput, setupTestbedPlayer, type TestbedPlayer } from '@game/player/index';
import {
  readPhysicsObjectTransform,
  readSceneTransform,
  resolveSceneRequest,
  SceneLoader,
} from '@game/scene/index';
import { openSaveStore } from '@game/save/storage/index';
import { missingFeatures } from '@game/support';
import { VfxSystem } from '@game/vfx/index';
import { createRenderBootstrap } from '@render/bootstrap/index';
import { createHitVolumeOverlay } from '@render/debug/hit-volumes';
import { createGreyboxView } from '@render/greybox/index';
import { createPlayerCapsule } from '@render/player/index';
import { createVfxRenderer } from '@render/vfx/index';
import {
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  hitVolumeSystem,
  noAllies,
  PhysicsObjectComponent,
  playerStart,
  RapierCollisionWorld,
  registerSceneComponents,
  World,
  type ActionFrame,
  type RapierPhysics,
} from '@sim/index';
import { compactProbe, setupAnimationDemo, type AnimDemo } from '@tools/anim-demo/setup';
import { bindDebugCameraInput, DebugCamera } from '@tools/debug-camera/index';
import { layer as tools } from '@tools/index';
import { FramePerfProbe, formatPerfReport, parsePerfParam } from '@tools/perf/frame-probe';
import { formatVfxStats, parseVfxParam, VfxDemo } from '@tools/vfx-demo/index';
import { UiRoot } from '@ui/index';
import {
  DEBUG_CAMERA_HINT,
  GAMEPAD_DISCONNECTED_HINT,
  playerControlsHint,
  sceneErrorMessage,
  sceneLabel,
} from '@ui/scene-hud';
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

  const hud = document.createElement('div');
  hud.dataset['testid'] = 'scene-hud';
  const label = document.createElement('p');
  label.dataset['testid'] = 'scene-label';
  const hint = document.createElement('p');
  hint.dataset['testid'] = 'debug-camera-hint';
  hint.textContent = DEBUG_CAMERA_HINT;
  const controls = document.createElement('p');
  controls.dataset['testid'] = 'player-controls-hint';
  hud.append(label, controls, hint);
  root.append(hud);

  // Keyboard + mouse and gamepad → one ActionFrame per sim tick (mw-e02.1, mw-e02.9); a click on the
  // canvas takes control (pointer lock) of the player, once there is one (mw-e02.23). A gamepad needs
  // no click: the sampler polls it every tick while the page has focus.
  const sampler = new ActionSampler();

  // The HUD/menu layer (mw-e00.23). Screens pushed onto it may capture input (gameplay action frames
  // are withheld) and pause the sim; menus need the pointer, so capture releases pointer lock.
  const ui = new UiRoot(root);
  const uiInput = ui.attachInput({
    window: globalThis.window,
    navigator: globalThis.navigator,
    now: () => performance.now(),
  });
  const bridge = createUiGameBridge({
    ui,
    sampleCommands: sampler.sampleCommands,
    drain: () => sampler.sample(),
  });
  ui.subscribe(({ capturesInput }) => {
    root.dataset['uiCapture'] = String(capturesInput);
    if (capturesInput && document.pointerLockElement !== null) document.exitPointerLock();
  });
  // The controls hint follows the device last used (mw-e02.9 AC-5); a disconnect says so (AC-4).
  let shown: InputDevice | 'gone' | undefined;
  let padGone = false;
  const showControls = (): void => {
    if (player === undefined) return;
    const device = sampler.lastDevice;
    const gone = padGone && device === 'gamepad';
    if ((gone ? 'gone' : device) === shown) return;
    shown = gone ? 'gone' : device;
    root.dataset['inputDevice'] = device;
    const bindings = { keyboardMouse: sampler.bindings, gamepad: sampler.padBindings };
    const glyph = (action: 'move' | 'jump' | 'sprint' | 'crouch' | 'dodge') =>
      inputGlyph(action, device, bindings);
    controls.textContent = gone
      ? GAMEPAD_DISCONNECTED_HINT
      : playerControlsHint(device, {
          move: glyph('move'),
          jump: glyph('jump'),
          sprint: glyph('sprint'),
          crouch: glyph('crouch'),
          dodge: glyph('dodge'),
        });
  };
  const playerInput = attachPlayerInput(sampler, {
    window: globalThis.window,
    document: globalThis.document,
    element: view.canvas,
    gamepad: {
      navigator: globalThis.navigator,
      hasFocus: () => document.hasFocus(),
      onConnect: () => {
        padGone = false;
        root.dataset['gamepad'] = 'connected';
      },
      onDisconnect: () => {
        padGone = true;
        root.dataset['gamepad'] = 'disconnected';
      },
    },
  });
  let player: TestbedPlayer | undefined;

  bindDebugCameraInput(debugCamera, {
    keys: globalThis.window,
    surface: view.canvas,
    onToggle: (active) => {
      root.dataset['debugCamera'] = active ? 'on' : 'off';
      hint.textContent = active ? `${DEBUG_CAMERA_HINT} · ON` : DEBUG_CAMERA_HINT;
      // The fly camera shares WASD: the player lets go of input and the camera while it flies.
      playerInput.enabled = !active;
      if (player) player.drivesCamera = !active;
      writeCameraData();
    },
  });
  root.dataset['debugCamera'] = 'off';

  // Fixed-step sim on requestAnimationFrame (mw-e00.20). The sim owns its physics (mw-e03.35), so the
  // world starts once the physics module has loaded; the dynamic import keeps Rapier and its WASM
  // out of the initial bundle.
  const startWorld = (physics: RapierPhysics): void => {
    const world = registerSceneComponents(new World<ActionFrame>({ seed: BOOT_SEED, physics }));
    // Swept hitboxes and region-tagged hurtboxes (mw-e04.2). No faction table is loaded yet, so
    // nobody counts as an ally; ?hitboxes draws what the system tests each tick.
    world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
    // Physics objects (mw-e03.39): scene props fall, stack and get knocked about in the sim; bodies
    // near the player never get forced to sleep. Budget warnings go to the console and to the
    // `data-physics-budget` debug attribute.
    const focus = playerFocus(world);
    installGamePhysics(world, {
      focus: focus.read,
      onBudgetExceeded: (warning) => {
        console.warn(formatBudgetWarning(warning));
        root.dataset['physicsBudget'] = JSON.stringify(warning);
      },
    });
    const hitOverlay = createHitVolumeOverlay();
    hitOverlay.enabled = new URLSearchParams(location.search).has('hitboxes');
    view.scene.add(hitOverlay.object);
    root.dataset['hitboxOverlay'] = hitOverlay.enabled ? 'on' : 'off';

    const content = loadGameContent();

    // VFX (mw-e29.1): effects from content, simulated each frame after the sim and the camera have
    // moved, drawn by src/render/vfx. Presentation only: the system reads entity transforms and never
    // writes to the sim. Sockets need skeletons, so entity effects emit from the entity's origin for
    // now. `?vfx` shows the stats overlay; `?vfx=demo` / `?vfx=stress` spawn the test effects.
    const vfx = new VfxSystem({
      effects: content.all('vfx-effect'),
      anchors: (entity) =>
        readPhysicsObjectTransform(world, entity) ?? readSceneTransform(world, entity),
    });
    const vfxView = createVfxRenderer(view.scene);
    const vfxMode = parseVfxParam(location.search);
    let vfxDemo: VfxDemo | undefined;
    let vfxStats: HTMLElement | undefined;
    let vfxStatsAgeMs = Infinity;
    if (vfxMode !== undefined) {
      vfxStats = document.createElement('pre');
      vfxStats.dataset['testid'] = 'vfx-stats';
      hud.append(vfxStats);
    }
    const showVfxStats = (elapsedMs: number): void => {
      vfxStatsAgeMs += elapsedMs;
      if (vfxStats === undefined || vfxStatsAgeMs < 250) return;
      vfxStatsAgeMs = 0;
      const stats = vfx.stats();
      vfxStats.textContent = formatVfxStats(stats);
      root.dataset['vfx'] = JSON.stringify(stats);
    };

    let lastFrameMs: number | undefined;
    // Animated demo characters in the testbed (mw-e02.20), and the probe the e2e reads.
    let animation: AnimDemo | undefined;
    let publishedProbe = '';
    const { loop, sync } = createGameLoop({
      world,
      sources,
      sampleCommands: bridge.sampleCommands,
      simPaused: bridge.simPaused,
      onStep: () => {
        animation?.driver.capture();
      },
      draw: (frame) => {
        uiInput.poll();
        bridge.frame();
        const { timeMs } = frame;
        const elapsedMs = timeMs - (lastFrameMs ?? timeMs);
        if (debugCamera.update(elapsedMs)) writeCameraData();
        lastFrameMs = timeMs;
        player?.frame(frame);
        hitOverlay.sync(world);
        if (animation !== undefined) {
          animation.driver.frame(frame.alpha, Math.max(0, elapsedMs) / 1000, camera.position);
          const probe = JSON.stringify(compactProbe(animation.driver.probe()));
          if (probe !== publishedProbe) root.dataset['animation'] = publishedProbe = probe;
        }
        showControls();
        vfxDemo?.update(elapsedMs / 1000);
        vfx.update(elapsedMs / 1000, camera.position);
        vfxView.draw(vfx.batches, vfx.markers);
        showVfxStats(elapsedMs);
        view.renderFrame(timeMs);
      },
    });

    // The scene loader fills the world from content (mw-e00.21); static colliders go into the
    // sim's Rapier world, bound to stone piece entities, and movable props become physics objects
    // drawn from their sim pose (mw-e03.39).
    const scenes = new SceneLoader({
      world,
      sync,
      colliders: physics,
      content,
      objects: createGreyboxView(view.renderer, view.scene),
      binding: (object, read) => object3DBinding(object, read),
      physics: {},
    });
    const request = resolveSceneRequest(location.search, scenes.available());
    if (request.kind === 'scene') {
      const scene = content.get('scene', request.id);
      const loaded = scenes.load(scene.id);
      camera.position.set(...scene.camera.position);
      camera.lookAt(...scene.camera.target);
      // A controllable player (mw-e02.23) in scenes with a player start; it collides with the
      // scene through the sim's Rapier world (mw-e02.21) and brings the orbit camera (mw-e02.4),
      // which queries the same world read-only to stay out of walls.
      if (playerStart(loaded.layout.spawns) !== undefined) {
        const tuning = content.get('controller', PLAYER_CONTROLLER_ID);
        const cameraTuning = content.get('camera', PLAYER_CAMERA_ID);
        camera.fov = cameraTuning.fov;
        camera.near = cameraTuning.near;
        camera.updateProjectionMatrix();
        player = setupTestbedPlayer({
          world,
          scene: loaded,
          sync,
          tuning,
          cameraTuning,
          collision: new RapierCollisionWorld(physics),
          // The knight's moves: the dodge roll and backstep are playable (mw-e04.8).
          moves: compileMoves(content.all('move')),
          object: createPlayerCapsule(tuning.capsule),
          binding: (object, read) => {
            view.scene.add(object);
            return object3DBinding(object, read);
          },
          camera,
          publish: (readout) => {
            root.dataset['player'] = JSON.stringify(readout);
          },
          // The e2e clipping probe (mw-e02.4 AC-5): frames drawn, and how many clipped (must be 0).
          publishCamera: (readout) => {
            root.dataset['orbitCamera'] = JSON.stringify(readout);
          },
        });
        focus.entity = player.entity; // bodies near the player never get forced to sleep
        // The mouse wheel zooms the orbit camera while the player has control (2–6 m).
        view.canvas.addEventListener(
          'wheel',
          (event) => {
            if (!playerInput.locked) return;
            event.preventDefault();
            player?.zoom(Math.sign(event.deltaY));
          },
          { passive: false },
        );
        showControls();
      }
      if (scene.id === 'testbed') {
        animation = setupAnimationDemo({
          world,
          sync,
          content,
          // The player's combat (mw-e04.8) already runs the action timeline.
          sharedTimeline: player !== undefined,
          binding: (object, read) => {
            view.scene.add(object);
            return object3DBinding(object, read);
          },
        });
      }
      if (vfxMode === 'demo' || vfxMode === 'stress') {
        const [x, y, z] = scene.camera.target;
        const centre = playerStart(loaded.layout.spawns)?.position ?? { x, y, z };
        vfxDemo = new VfxDemo(vfx, vfxMode, centre);
      }
      label.textContent = sceneLabel(scene, __BUILD_SHA__);
      root.dataset['scene'] = scene.id;
    } else {
      label.textContent = `No scene · build ${__BUILD_SHA__}`;
      showSceneError(root, request.requested, request.available);
    }
    // Debug attribute (mw-e03.35 AC-4): colliders registered in the physics world.
    root.dataset['colliders'] = String(physics.count());
    // Debug attribute (mw-e03.39): the physics objects the scene spawned.
    root.dataset['physicsObjects'] = String(world.query(PhysicsObjectComponent).ids().length);
    writeCameraData();
    loop.start();
  };

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.dataset['testid'] = 'physics-status';
  root.append(status);
  void bootPhysics(
    () => import('@dimforge/rapier3d-deterministic'),
    (state) => {
      root.dataset['physics'] = state;
      status.textContent = state === 'loading' ? PHYSICS_LOADING_TEXT : '';
    },
  ).then((boot) => {
    if (!boot.ok) {
      // No physics, no sim (AC-5): say so instead of failing with an uncaught exception.
      status.setAttribute('role', 'alert');
      status.textContent = PHYSICS_FAILED_TEXT;
      console.error(boot.error);
      return;
    }
    root.dataset['physicsVersion'] = boot.module.version();
    status.remove();
    startWorld(boot.physics);
  });
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
