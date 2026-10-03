import {
  createBrowserAudioEngine,
  gameSoundRegistry,
  installGestureUnlock,
  listenerPose,
} from '@audio/index';
import {
  controllerTuningFor,
  loadGameContent,
  materialPresets,
  PLAYER_CAMERA_ID,
  PLAYER_CONTROLLER_ID,
  PLAYER_CLASSES,
  PLAYER_LOCK_ON_ID,
  type GameContent,
  type PlayerClass,
} from '@content/index';
import {
  arrowReadout,
  bindArrows,
  bindSandboxDummies,
  createSandboxHud,
  dummyReadout,
  installSandboxRules,
  prepareTestbedCombat,
  readArrowTransform,
  readDummyTransform,
  readSandboxDummyTransform,
  startTestbedCombat,
  TRAINING_DUMMY,
  type SandboxHud,
} from '@game/combat/index';
import {
  bindCreatures,
  creatureReadout,
  CreatureTelegraphs,
  prepareCreatures,
  sceneCreatureErrors,
  startCreatures,
  viewCentrePoint,
  type GameCreatures,
} from '@game/creatures/index';
import { bindBreakLeftovers, BreakWatch, hasBreakables } from '@game/breakables/index';
import {
  bindWorldItems,
  ItemWatch,
  prepareConsumables,
  prepareWorldItems,
  startConsumables,
  startWorldItems,
} from '@game/items/index';
import {
  doorLeafLooks,
  hasMechanisms,
  MechanismWatch,
  readDoorLeaf,
  startMechanisms,
} from '@game/mechanisms/index';
import { createCapabilityRegistry } from '@game/capabilities';
import {
  applyClass,
  classCards,
  createClassRules,
  isPlayerClass,
  kitModel,
  newGameRequest,
  playableClasses,
} from '@game/classes';
import { attachGameAudio, attachGameVfx, soundPositions } from '@game/cues/index';
import { layers } from '@game/index';
import { ActionSampler, inputGlyph, type InputDevice } from '@game/input/index';
import { debugConsoleEnabled } from '@game/debug-console-gate';
import {
  browserFrameSources,
  CommandQueue,
  createGameLoop,
  object3DBinding,
} from '@game/loop/index';
import { installFactRegistry } from '@game/facts';
import { bootPhysics } from '@game/physics-loader';
import {
  formatBudgetWarning,
  installGamePhysics,
  playerFocus,
  propBodies,
} from '@game/physics-objects';
import { createSettingsStore } from '@game/settings/index';
import { createUiGameBridge } from '@game/ui/index';
import {
  createGameLight,
  installGameLight,
  isFire,
  lightProbe,
  lightReadout,
  lightSpawns,
  probeGrid,
  selectLights,
  type LightSpawn,
} from '@game/light/index';
import {
  attachPlayerInput,
  CONTROLLER_HOT_EVENT,
  interactPromptModel,
  lockMarkerModel,
  readControllerFile,
  setupTestbedPlayer,
  type ControllerHotUpdate,
  type TestbedPlayer,
} from '@game/player/index';
import {
  readPhysicsObjectTransform,
  readSceneTransform,
  resolveSceneRequest,
  SceneLoader,
} from '@game/scene/index';
import {
  DeathReload,
  takePendingLoad,
  type PendingLoad,
  type PendingLoadStorage,
} from '@game/save/death/index';
import { createGameSaveRegistry } from '@game/save/sections';
import { openSaveStore, type OpenedSaveStore } from '@game/save/storage/index';
import { missingFeatures } from '@game/support';
import { vfxTextureManifest, vfxTextureUrls, VfxSystem } from '@game/vfx/index';
import { createRenderBootstrap } from '@render/bootstrap/index';
import { createLeftover, disposeLeftover } from '@render/breakables/index';
import { createWorldItemMesh, disposeWorldItemMesh } from '@render/items/index';
import { createDoorLeaf, disposeDoorLeaf } from '@render/mechanisms/index';
import {
  createArrowShaft,
  createSandboxDummy,
  createTrainingDummy,
  disposeArrowShaft,
} from '@render/combat/index';
import { createCreatureProxy, showCreatureTelegraph } from '@render/creatures/index';
import { createHitVolumeOverlay } from '@render/debug/hit-volumes';
import { createGreyboxView } from '@render/greybox/index';
import { createLightRig } from '@render/light/index';
import { AnimationController, compileGraph } from '@render/animation/index';
import { createPlayerBody, projectToNdc } from '@render/player/index';
import { createVfxRenderer } from '@render/vfx/index';
import {
  addCapabilities,
  AttackerDummyComponent,
  classOf,
  equipChanged,
  goldChanged,
  itemAdded,
  itemRemoved,
  checkSandboxCommand,
  checkSandboxSpawn,
  DAMAGE_COMPONENTS,
  Died,
  HIT_VOLUME_COMPONENTS,
  installDebugCommands,
  LineOfSight,
  LEDGE_HANG_CAPABILITY,
  levelDeltasOf,
  persistDroppedItems,
  physicsBodiesOf,
  PhysicsObjectComponent,
  playerStart,
  RapierCollisionWorld,
  RapierSightWorld,
  creaturesInstalled,
  registerPersistence,
  registerSceneComponents,
  sceneAuthoredEntities,
  SceneSpawnComponent,
  SpilledComponent,
  testPropSpawners,
  tuneCommand,
  World,
  WorldPersistence,
  worldItemSpawner,
  zeroHealth,
  type ActionFrame,
  type DebugCommand,
  type DifficultyCommand,
  type SandboxCommand,
  type EntityId,
  type LightEmitterView,
  type RapierPhysics,
  type Vec3,
} from '@sim/index';
import {
  compactProbe,
  playerAnimationProbe,
  setupAnimationDemo,
  type AnimDemo,
} from '@tools/anim-demo/setup';
import { bindDebugCameraInput, DebugCamera } from '@tools/debug-camera/index';
import { layer as tools } from '@tools/index';
import { FramePerfProbe, formatPerfReport, parsePerfParam } from '@tools/perf/frame-probe';
import { formatVfxStats, parseVfxParam, VfxDemo } from '@tools/vfx-demo/index';
import { InteractPrompt, KitPanel, LockMarker, openClassSelect, UiRoot } from '@ui/index';
import {
  DEBUG_CAMERA_HINT,
  GAMEPAD_DISCONNECTED_HINT,
  playerControlsHint,
  SANDBOX_HINT,
  sceneErrorMessage,
  sceneLabel,
} from '@ui/scene-hud';
import {
  PHYSICS_FAILED_TEXT,
  PHYSICS_LOADING_TEXT,
  unsupportedMessage,
  type MissingFeature,
} from '@ui/unsupported';

/** The player's placeholder rig: the grey-box humanoid's animation graph (mw-e02.6). */
const PLAYER_RIG_ID = 'greybox-humanoid';

/** Release saves record until playtest builds are versioned (CHANGELOG: Unreleased). */
const GAME_VERSION = '0.0.0';

/** Where each death → reload readout is published on #app (the e2e reads them). */
const READOUT_ATTRIBUTE = { death: 'death', saved: 'savedGame', loaded: 'loadedSave' } as const;

/** Placeholder world seed until new-game/save flows choose one. */
const BOOT_SEED = 1;

/** Everything the game feeds `World.step`: sampled input plus queued debug-console commands. */
type GameCommand = ActionFrame | DebugCommand | DifficultyCommand | SandboxCommand;

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.dataset['layers'] = [...layers, tools].join(' ');
  // Player settings (mw-e31.1): per-browser, loaded first; in memory when the browser blocks storage.
  const settings = createSettingsStore({ storage: () => globalThis.localStorage });
  app.dataset['settingsStore'] = settings.persistent ? 'local' : 'memory';
  startRenderer(app, startSaves(app));
}

// Opens save storage (mw-e30.2). If the browser blocks IndexedDB the game runs on in-memory saves,
// and the player must be told for as long as that lasts.
async function startSaves(root: HTMLElement): Promise<OpenedSaveStore> {
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
  return saves;
}

// Renderer and physics bootstrap (mw-e00.19). Checks the minimum features first so a browser
// without WebGL 2 or WebAssembly gets a readable screen instead of a blank page or uncaught error.
function startRenderer(root: HTMLElement, saves: Promise<OpenedSaveStore>): void {
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
  // The contextual Interact prompt (mw-e02.5): the player's focus, with the bound key or button.
  const interactPrompt = new InteractPrompt();
  ui.hud.append(interactPrompt.element);
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
  // The lock-on marker (mw-e02.16) rides the HUD layer over the locked target's lock point.
  const lockMarker = new LockMarker();
  ui.hud.append(lockMarker.element);
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
    const glyph = (
      action: 'move' | 'jump' | 'sprint' | 'crouch' | 'dodge' | 'primaryAttack' | 'secondaryAttack',
    ) => inputGlyph(action, device, bindings);
    controls.textContent = gone
      ? GAMEPAD_DISCONNECTED_HINT
      : playerControlsHint(device, {
          move: glyph('move'),
          jump: glyph('jump'),
          sprint: glyph('sprint'),
          crouch: glyph('crouch'),
          dodge: glyph('dodge'),
          attack: glyph('primaryAttack'),
          block: glyph('secondaryAttack'),
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
  const startWorld = (physics: RapierPhysics, content: GameContent): void => {
    const world = registerSceneComponents(new World<GameCommand>({ seed: BOOT_SEED, physics }));
    // The fact registry (mw-e27.2) on the world's facts: typed declarations, and the former keys
    // that let a save's renamed facts load under their current keys (mw-e27.4).
    installFactRegistry(world.facts, content);
    // The knight's sword and shield (mw-e04.6): moves, socket tracks, the wood shield and the
    // damage model with the shield rule; and the combat sandbox's tuning (mw-e04.9).
    const combat = prepareTestbedCombat(content);
    // Every creature in content, spawnable by id from scene data and the console (mw-e12.4): the
    // bestiary's (the Forgotten miner, mw-e13.1), plus the frozen fixture creatures in debug builds.
    const creatures: GameCreatures = prepareCreatures(content, combat);
    // Debug commands first (mw-e33.1), so a teleport or cheat is what every later system sees. The
    // sim side is always present; only the console that issues them is dev/playtest-only. Props with
    // a body spawn as physics objects (mw-e33.16), like the scene's own movable props. God mode
    // joins the damage model; the sandbox's dummies are spawnable in every scene (mw-e04.9).
    const props = propBodies(content);
    const propSpawners = testPropSpawners(
      content.all('testprop').map((prop) => prop.id),
      { props, materials: materialPresets(content.all('material')) },
    );
    const spawners = new Map([...propSpawners, ...combat.spawners, ...creatures.spawners]);
    installDebugCommands(world, { spawners, damage: combat.damage });
    // The combat sandbox's rules (mw-e04.9): its commands, attacker metronomes (before the player's
    // action timeline, so a swing starts on its beat) and infinite-health refills.
    installSandboxRules(world, combat);
    const commands = new CommandQueue<GameCommand>();
    const afterStep: (() => void)[] = [];
    // Swept hitboxes and region-tagged hurtboxes (mw-e04.2). No faction table is loaded yet, so
    // nobody counts as an ally; ?hitboxes draws what the system tests each tick. The hit-volume
    // system itself joins after the player (startTestbedCombat), so swings sweep on their first
    // active tick.
    world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    // Physics objects (mw-e03.39): scene props fall, stack and get knocked about in the sim; bodies
    // near the player never get forced to sleep. Budget warnings go to the console and to the
    // `data-physics-budget` debug attribute.
    const focus = playerFocus(world);
    // The light field (mw-e03.37): level geometry goes into physics and the field's occluders through
    // one sink, so a piece that burns away stops blocking both.
    const light = createGameLight(physics);
    installGamePhysics(world, {
      // Breaks spill their contents as props (mw-e03.11).
      breakables: { props, materials: materialPresets(content.all('material')) },
      focus: focus.read,
      onBudgetExceeded: (warning) => {
        console.warn(formatBudgetWarning(warning));
        root.dataset['physicsBudget'] = JSON.stringify(warning);
      },
      levelColliders: light.colliders,
    });
    installGameLight(world, light.field);
    const hitOverlay = createHitVolumeOverlay();
    hitOverlay.enabled = new URLSearchParams(location.search).has('hitboxes');
    view.scene.add(hitOverlay.object);
    root.dataset['hitboxOverlay'] = hitOverlay.enabled ? 'on' : 'off';

    let dummy: EntityId | undefined;
    // The combat sandbox's frame-data overlay and slow motion (mw-e04.9), in the sandbox scene or
    // with ?frames anywhere.
    let sandboxHud: SandboxHud | undefined;
    let publishedDummy = '';

    // VFX (mw-e29.1): effects from content, simulated each frame after the sim and the camera have
    // moved, drawn by src/render/vfx. Presentation only: the system reads entity transforms and never
    // writes to the sim. Sockets need skeletons, so entity effects emit from the entity's origin for
    // now. `?vfx` shows the stats overlay; `?vfx=demo` / `?vfx=stress` spawn the test effects.
    const vfxAnchor = (entity: EntityId) =>
      readPhysicsObjectTransform(world, entity) ??
      readDummyTransform(world, entity) ?? // any placed entity: the dummies and the player
      readSceneTransform(world, entity);
    const vfx = new VfxSystem({ effects: content.all('vfx-effect'), anchors: vfxAnchor });
    // VFX cue sheets (mw-e29.3): the same sim events as the audio cue sheets spawn effects — hit
    // dust and sparks, the parry flash, impact puffs, break debris, burning loops. Event-driven, so
    // nothing runs per frame while no effect is live.
    attachGameVfx({
      world,
      vfx,
      sheets: content.all('vfx-cue-sheet'),
      materials: content.all('material'),
      arrows: content.all('arrow'),
      locate: vfxAnchor,
      now: () => performance.now(),
    });
    // Textures load by asset id from the texture manifest: generated placeholders (mw-e29.2) until
    // approved art replaces them under the same ids.
    const vfxView = createVfxRenderer(view.scene, {
      textureUrl: vfxTextureUrls(vfxTextureManifest()),
    });

    // Audio (mw-e28.2): the cue sheets turn sim events (hits, stagger, deaths, physics impacts) into
    // sounds from the sound manifest — the synthesised placeholder pack until final SFX land. The
    // context starts on the first click or key press (autoplay policy); until then nothing plays.
    // Positional sounds follow their entity; the listener follows the camera each frame. The e2e
    // reads the context state and the latest cues from #app[data-audio].
    const sounds = gameSoundRegistry();
    const audio = createBrowserAudioEngine({
      registry: sounds,
      dev: import.meta.env.DEV,
      entityPosition: soundPositions(world, [
        readPhysicsObjectTransform,
        readDummyTransform, // any placed entity: the dummies and the player
        readSceneTransform,
      ]),
    });
    installGestureUnlock(document, audio);
    const recentCues: string[] = [];
    attachGameAudio({
      world,
      engine: audio,
      registry: sounds,
      sheets: content.all('cue-sheet'),
      materials: content.all('material'),
      // Swing whooshes play each move's own sound (mw-e28.4); footsteps read the ground's material.
      moves: content.all('move'),
      // Arrows layer their own impact sounds (a water splash) over the surface's (mw-e05.19).
      arrows: content.all('arrow'),
      now: () => performance.now(),
      onPlay: (cue) => {
        recentCues.push(cue);
        if (recentCues.length > 10) recentCues.shift();
      },
    });
    let publishedAudio = '';
    const publishAudio = (): void => {
      const { state, voices } = audio.stats();
      const json = JSON.stringify({ state, voices, cues: recentCues });
      if (json !== publishedAudio) root.dataset['audio'] = publishedAudio = json;
    };
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

    // The creatures now (mw-e12.4 e2e): how many, how many drawn and in view, of which kinds.
    let publishedCreatures = '';
    const publishCreatures = (): void => {
      const readout = creatureReadout(
        world,
        (entity) => sync.has(entity),
        (point) => projectToNdc(camera, point),
      );
      const json = JSON.stringify(readout);
      if (json !== publishedCreatures) root.dataset['creatures'] = publishedCreatures = json;
    };

    // Rendered light mirrors the sim's light field (mw-e03.37): the greybox fill and sun follow its
    // environment, a capped pool of point/spot lights follows the emitters nearest the camera. The
    // e2e reads sim and rendered light of the scene's lit spawns from #app[data-lights], and with
    // ?lightprobe the sim level at visible floor points from #app[data-light-probe].
    const lightRig = createLightRig(view.scene);
    const sightWorld = new RapierSightWorld(physics);
    const probeLight = new URLSearchParams(location.search).has('lightprobe');
    let watchedLights: readonly LightSpawn[] = [];
    let probePoints: readonly Vec3[] = [];
    let shownEnvironment: unknown;
    let publishedLights = '';
    let publishedLightProbe = '';
    const drawLights = (): void => {
      const { field } = light;
      if (field.environment !== shownEnvironment) {
        shownEnvironment = field.environment;
        greybox.setEnvironment(field.environment);
      }
      const chosen = selectLights(field.lights(), camera.position, lightRig.caps);
      const withFire = (l: LightEmitterView) => ({ ...l, fire: isFire(world, l) });
      const drawn = lightRig.sync(chosen.points.map(withFire), chosen.spots.map(withFire));
      if (watchedLights.length > 0) {
        const readout = lightReadout(world, field, watchedLights, drawn);
        const key = JSON.stringify(readout.spawns);
        if (key !== publishedLights) {
          publishedLights = key;
          root.dataset['lights'] = JSON.stringify(readout);
        }
      }
      if (probeLight && probePoints.length > 0) {
        const samples = lightProbe(
          field,
          probePoints,
          (point) => projectToNdc(camera, point),
          (point) => sightWorld.firstCrossing(camera.position, point) === undefined,
        );
        const json = JSON.stringify(samples);
        if (json !== publishedLightProbe) root.dataset['lightProbe'] = publishedLightProbe = json;
      }
    };

    // Arrows (mw-e05.21): every arrow the sim flies or rests gets a grey-box shaft after each step.
    // Once any arrow exists, the e2e reads them from #app[data-arrows]; until then nothing is done.
    let arrowsSeen = false;
    let publishedArrows = '';
    const drawArrows = (): void => {
      const bound = bindArrows(world, sync, () => {
        const shaft = createArrowShaft();
        view.scene.add(shaft);
        return { ...object3DBinding(shaft, readArrowTransform), dispose: disposeArrowShaft };
      });
      if (bound > 0) arrowsSeen = true;
    };
    const publishArrows = (): void => {
      if (!arrowsSeen) return;
      const readout = arrowReadout(
        world,
        (entity) => sync.has(entity),
        (point) => projectToNdc(camera, point),
      );
      const json = JSON.stringify(readout);
      if (json !== publishedArrows) root.dataset['arrows'] = publishedArrows = json;
    };

    let lastFrameMs: number | undefined;
    const interactions: { tick: number; verb: string; spawn: string | null }[] = [];
    // Animated demo characters in the testbed (mw-e02.20), and the probe the e2e reads.
    let animation: AnimDemo | undefined;
    let publishedProbe = '';
    const { loop, sync } = createGameLoop({
      world,
      sources,
      // Queued debug-console commands pass even while a UI screen withholds gameplay frames.
      sampleCommands: commands.sampler(bridge.sampleCommands),
      simPaused: bridge.simPaused,
      onStep: () => {
        player?.onStep();
        animation?.driver.capture();
        for (const hook of afterStep) hook();
      },
      draw: (frame) => {
        uiInput.poll();
        bridge.frame();
        const { timeMs } = frame;
        const elapsedMs = timeMs - (lastFrameMs ?? timeMs);
        if (debugCamera.update(elapsedMs)) writeCameraData();
        lastFrameMs = timeMs;
        player?.frame(frame);
        if (player !== undefined) {
          const glyph = inputGlyph('interact', sampler.lastDevice, {
            keyboardMouse: sampler.bindings,
            gamepad: sampler.padBindings,
          });
          interactPrompt.update(interactPromptModel(player.prompt(), glyph));
        }
        if (dummy !== undefined) {
          // The e2e reads the dummy's health here (mw-e04.6 AC-7).
          const readout = JSON.stringify(dummyReadout(world, dummy) ?? null);
          if (readout !== publishedDummy) root.dataset['dummy'] = publishedDummy = readout;
        }
        sandboxHud?.frame();
        lockMarker.update(
          lockMarkerModel(
            player?.lockTarget(),
            (point) => projectToNdc(camera, point),
            root.clientWidth,
            root.clientHeight,
          ),
        );
        hitOverlay.sync(world);
        publishCreatures();
        publishArrows();
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
        audio.update(listenerPose(camera.position, camera.quaternion));
        publishAudio();
        drawLights();
        view.renderFrame(timeMs);
      },
    });

    // The scene loader fills the world from content (mw-e00.21); static colliders go into the
    // sim's Rapier world, bound to stone piece entities, and movable props become physics objects
    // drawn from their sim pose (mw-e03.39).
    const greybox = createGreyboxView(view.renderer, view.scene);
    const scenes = new SceneLoader({
      world,
      sync,
      colliders: light.colliders,
      content,
      objects: greybox,
      binding: (object, read) => object3DBinding(object, read),
      physics: {},
      light: light.field,
    });
    const request = resolveSceneRequest(location.search, scenes.available());
    if (request.kind === 'scene') {
      const scene = content.get('scene', request.id);
      const loaded = scenes.load(scene.id);
      camera.position.set(...scene.camera.position);
      camera.lookAt(...scene.camera.target);
      watchedLights = lightSpawns(loaded);
      const floor = loaded.layout.pieces[0];
      if (probeLight && floor !== undefined) probePoints = probeGrid(floor.min, floor.max, 0.02);
      // A controllable player (mw-e02.23) in scenes with a player start; it collides with the
      // scene through the sim's Rapier world (mw-e02.21) and brings the orbit camera (mw-e02.4),
      // which queries the same world read-only to stay out of walls.
      // The controller, the camera and arrows (mw-e05.21) all collide with the sim's Rapier world.
      const collision = new RapierCollisionWorld(physics);
      // New game (mw-e19.5): ?newgame opens class selection, ?class=<id> applies that class. Only the
      // game configuration's playable classes can start a run (mw-e01.15); a debug build's
      // ?allclasses unlocks every class.
      const playable = playableClasses(content, location.search, __DEBUG_CONSOLE__);
      const newGame = newGameRequest(location.search, playable);
      const capabilities = createCapabilityRegistry(content);
      if (playerStart(loaded.layout.spawns) !== undefined) {
        // No class is chosen yet (mw-e19.5), so the player moves on the base profile.
        const tuning = controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID));
        const cameraTuning = content.get('camera', PLAYER_CAMERA_ID);
        camera.fov = cameraTuning.fov;
        camera.near = cameraTuning.near;
        camera.updateProjectionMatrix();
        // The player's body is the grey-box humanoid, animated from its sim locomotion (mw-e02.6).
        const graph = compileGraph(
          content.get('anim-graph', PLAYER_RIG_ID),
          content.all('anim-clip'),
        );
        const body = createPlayerBody(graph.rig);
        let publishedPlayerProbe = '';
        player = setupTestbedPlayer({
          world,
          scene: loaded,
          sync,
          tuning,
          cameraTuning,
          collision,
          // The knight's moves: the dodge roll and backstep (mw-e04.8), the light chain and the
          // shield (mw-e04.6) are playable.
          moves: combat.moves,
          melee: combat.melee,
          // The shortbow and a quiver (mw-e05.21): 4 takes it out, hold the attack button to draw.
          bow: combat.bow,
          // Mantling for every class; ledge hangs are capability-gated (mw-e02.12) and granted
          // through the capability registry below.
          ledges: {},
          // Ladders, ropes and ivy for every class (mw-e02.13); rough walls need the climbing
          // capability, which class data (mw-e02.3) will grant the thief.
          climb: {},
          object: body.root,
          animation: {
            controller: new AnimationController(graph),
            apply: (pose) => {
              body.apply(pose);
            },
            lower: (metres) => {
              body.lower(metres);
            },
            // The e2e animation probe (mw-e02.6 AC-4): each layer's state and clip, and the states
            // and clips entered, oldest first.
            publish: (probe) => {
              const json = JSON.stringify(playerAnimationProbe(probe));
              if (json !== publishedPlayerProbe) {
                root.dataset['playerAnimation'] = publishedPlayerProbe = json;
              }
            },
          },
          binding: (object, read) => {
            view.scene.add(object);
            return object3DBinding(object, read);
          },
          camera,
          // Lock-on (mw-e02.16): the scene's targetable spawns, seen through the sim's physics.
          lockOn: {
            tuning: content.get('lock-on', PLAYER_LOCK_ON_ID),
            sight: new LineOfSight({ world: new RapierSightWorld(physics) }),
            profile: (id) => content.get('targetable', id),
            defeated: zeroHealth,
          },
          publish: (readout) => {
            root.dataset['player'] = JSON.stringify(readout);
          },
          // The e2e clipping probe (mw-e02.4 AC-5): frames drawn, and how many clipped (must be 0).
          publishCamera: (readout) => {
            root.dataset['orbitCamera'] = JSON.stringify(readout);
          },
          // Focus and Interact (mw-e02.5): reach is blocked by anything solid in the sim's Rapier
          // world. The e2e reads the player's interactions (latest last) from #app[data-interactions].
          interaction: {
            sight: new RapierSightWorld(physics),
            bodiesOf: (entity) => physicsBodiesOf(world, entity),
            publish: (event) => {
              interactions.push({
                tick: world.tick,
                verb: event.verb,
                spawn: world.get(event.target, SceneSpawnComponent)?.id ?? null,
              });
              root.dataset['interactions'] = JSON.stringify(interactions.slice(-10));
            },
          },
        });
        focus.entity = player.entity; // bodies near the player never get forced to sleep
        // The player's capabilities (mw-e19.2). A new game grants the chosen class's own (mw-e19.5,
        // below); the testbed's default boot has no class, so ledge hangs come as a class grant.
        addCapabilities(world, player.entity);
        if (newGame.kind === 'none') {
          capabilities.grant(world, player.entity, LEDGE_HANG_CAPABILITY, 'class');
        }
        // Dev hot reload (mw-e02.3): a saved player controller file retunes the player from the
        // next tick, through the same recorded command as the console's ctl.set; no page reload.
        const tuned = player.entity;
        import.meta.hot?.on(CONTROLLER_HOT_EVENT, (update: ControllerHotUpdate) => {
          const reload = readControllerFile(update);
          if (!reload.ok) {
            for (const problem of reload.problems) console.warn(problem);
          } else if (reload.id === PLAYER_CONTROLLER_ID) {
            commands.push(tuneCommand(tuned, reload.tuning));
            console.info(`${update.file}: applied to the player`);
          }
        });
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
      // Hit volumes, melee strikes, hit reactions (mw-e04.7, mw-e04.31), the player as a combatant
      // and the scene's training and sandbox dummies (mw-e04.6, mw-e04.9), after the player.
      // Arrows fly against the level and every hurtbox (mw-e05.21).
      const { dummies } = startTestbedCombat(
        world,
        combat,
        loaded.layout.spawns,
        player?.entity,
        collision,
      );
      drawArrows();
      afterStep.push(drawArrows);
      // World items (mw-e17.7): the scene's items lie in the world as physics objects; the player
      // takes one with Interact and drops (G) or throws (T) the selected one. Each gets a placeholder
      // box once it exists; the e2e reads the pack and the world items from #app[data-items], which
      // is rebuilt only after a take, drop, throw or refusal.
      const worldItems = prepareWorldItems(content);
      startWorldItems(world, worldItems, loaded.spawns, player?.entity);
      // Consumables (mw-e17.6): the use pipeline and the player's four quick slots; a thrown
      // consumable flies as a world item carrying its world properties. No buttons use the slots
      // yet (keys 1–4 are the abilities').
      startConsumables(world, prepareConsumables(content, worldItems), player?.entity);
      // Class selection (mw-e19.5): the chosen class's capabilities, kit and stats go onto the player
      // once its inventory exists, and the player then moves on the class's controller tuning. The
      // kit panel shows the class and the pack; #app[data-player-class] is the sim's player.class
      // (the e2e reads both).
      if (player !== undefined && newGame.kind !== 'none') {
        const hero = player.entity;
        const classRules = createClassRules(content, capabilities);
        const profile = content.get('controller', PLAYER_CONTROLLER_ID);
        const kitPanel = new KitPanel();
        ui.hud.append(kitPanel.element);
        let kitDirty = false;
        const markKit = (): void => {
          kitDirty = true;
        };
        world.events.on(itemAdded, markKit);
        world.events.on(itemRemoved, markKit);
        world.events.on(goldChanged, markKit);
        world.events.on(equipChanged, markKit);
        const drawKit = (): void => {
          kitDirty = false;
          kitPanel.update(kitModel(world, hero, content));
        };
        afterStep.push(() => {
          if (kitDirty) drawKit();
        });
        const choose = (classId: PlayerClass): void => {
          applyClass(world, hero, classId, classRules);
          commands.push(tuneCommand(hero, controllerTuningFor(profile, classId)));
          root.dataset['playerClass'] = classOf(world, hero) ?? '';
          drawKit();
        };
        if (newGame.kind === 'class') choose(newGame.classId);
        else if (newGame.kind === 'select') {
          openClassSelect(ui, {
            cards: classCards(content, playable),
            onConfirm: (id) => {
              if (isPlayerClass(id) && playable.has(id)) choose(id);
            },
          });
        } else if (newGame.kind === 'locked-class') {
          console.warn(
            `?class=${newGame.classId}: not playable in this build (?allclasses unlocks)`,
          );
        } else
          console.warn(`?class=${newGame.classId}: not a class (${PLAYER_CLASSES.join(', ')})`);
      }
      const itemWatch = new ItemWatch(world, player?.entity);
      let publishedItems = -1;
      const drawItems = (): void => {
        bindWorldItems(world, sync, worldItems, (_entity, size, category) => {
          const object = createWorldItemMesh(size, category);
          view.scene.add(object);
          return {
            ...object3DBinding(object, readPhysicsObjectTransform),
            dispose: disposeWorldItemMesh,
          };
        });
        if (itemWatch.version === publishedItems) return;
        publishedItems = itemWatch.version;
        root.dataset['items'] = JSON.stringify(itemWatch.readout());
      };
      drawItems();
      afterStep.push(drawItems);
      // Breakables (mw-e03.11): only in scenes that have them, debris and spilled props get boxes
      // after each step, and the e2e reads what broke from #app[data-breakables].
      if (hasBreakables(loaded.layout)) {
        const breaks = new BreakWatch(world);
        let publishedBreaks = '';
        const drawBreaks = (): void => {
          bindBreakLeftovers(world, sync, (entity, size) => {
            const object = createLeftover(size, world.has(entity, SpilledComponent));
            view.scene.add(object);
            return {
              ...object3DBinding(object, readPhysicsObjectTransform),
              dispose: disposeLeftover,
            };
          });
          const json = JSON.stringify(breaks.readout());
          if (json !== publishedBreaks) root.dataset['breakables'] = publishedBreaks = json;
        };
        drawBreaks();
        afterStep.push(drawBreaks);
      }
      // Mechanisms (mw-e03.18): only in scenes with doors, switches or signal graphs. Started after
      // the player, so doors and switches get their prompts and move the tick they are told to.
      // Door leaves collide in the sim's Rapier world, closed ones occlude the light field, and
      // each leaf follows its sim pose; the e2e reads them from #app[data-mechanisms].
      if (hasMechanisms(loaded.layout)) {
        const made = startMechanisms(world, loaded, {
          content,
          materials: materialPresets(content.all('material')),
          colliders: physics,
          occluders: light.field.statics,
        });
        const watch = new MechanismWatch(world, made);
        const leaves = doorLeafLooks(world, made, content).map(
          ({ entity, size, centre, material }) => {
            const object = createDoorLeaf(size, centre, material);
            view.scene.add(object);
            sync.bind(entity, {
              ...object3DBinding(object, readDoorLeaf),
              dispose: disposeDoorLeaf,
            });
            return { entity, object };
          },
        );
        let publishedMechanisms = '';
        const drawMechanisms = (): void => {
          for (const { entity, object } of leaves) object.visible = !watch.broken(entity);
          const json = JSON.stringify(watch.readout());
          if (json !== publishedMechanisms) root.dataset['mechanisms'] = publishedMechanisms = json;
        };
        drawMechanisms();
        afterStep.push(drawMechanisms);
      }
      // The scene's creature spawns (mw-e12.4), after combat so they are hittable and lockable. A
      // spawn naming a creature or faction that does not exist is reported, not fatal.
      const sceneCreatures = startCreatures(world, creatures, combat, loaded.layout.spawns);
      for (const line of sceneCreatureErrors(sceneCreatures)) console.error(line);
      // Every creature — the scene's, the console's, respawned ones — gets a placeholder capsule
      // (with bones for the Forgotten's placeholder-capsule-bones mesh, mw-e13.1).
      // Its body glows while it winds up a telegraphed move (mw-e04.20); the telegraph watch exists
      // only where creatures do, and a step with no telegraph change costs one empty check.
      const creatureProxies = new Map<EntityId, ReturnType<typeof createCreatureProxy>>();
      const drawCreatures = (): void => {
        bindCreatures(world, sync, (entity, look) => {
          const object = createCreatureProxy({
            id: look.id,
            radius: look.nav.radius,
            height: look.nav.height,
            armed: look.armed,
            mesh: creatures.table.get(look.id)?.def.presentation.mesh,
          });
          view.scene.add(object);
          creatureProxies.set(entity, object);
          const binding = object3DBinding(object, readSandboxDummyTransform);
          return {
            ...binding,
            dispose: (target: typeof object) => {
              creatureProxies.delete(entity);
              binding.dispose(target);
            },
          };
        });
      };
      drawCreatures();
      afterStep.push(drawCreatures);
      if (creaturesInstalled(world)) {
        const telegraphs = new CreatureTelegraphs(world);
        afterStep.push(() => {
          for (const [entity, look] of telegraphs.drain()) {
            const proxy = creatureProxies.get(entity);
            if (proxy !== undefined) showCreatureTelegraph(proxy, look);
          }
        });
      }
      // Sandbox dummies — the scene's and any the console spawns — get grey-box bodies.
      const bindDummies = (): void => {
        bindSandboxDummies(world, sync, (entity) => {
          const attacker = world.has(entity, AttackerDummyComponent);
          const object = createSandboxDummy({
            radius: combat.sandbox.tuning.dummy.radius,
            attacker,
          });
          view.scene.add(object);
          return object3DBinding(object, readSandboxDummyTransform);
        });
      };
      bindDummies();
      afterStep.push(bindDummies);
      const isSandbox = scene.id === combat.sandbox.tuning.scene;
      if (isSandbox || new URLSearchParams(location.search).has('frames')) {
        sandboxHud = createSandboxHud({
          world,
          root,
          hud: ui.hud,
          keys: globalThis.window,
          loop,
          moves: combat.moves,
          player: () => player?.entity,
          hitboxes: hitOverlay,
          visible: true,
          keysEnabled: () => !ui.capturesInput,
        });
        const sandboxHint = document.createElement('p');
        sandboxHint.dataset['testid'] = 'sandbox-hint';
        sandboxHint.textContent = SANDBOX_HINT;
        hud.append(sandboxHint);
      }
      const { radius, torso } = TRAINING_DUMMY;
      for (const entity of dummies) {
        const object = createTrainingDummy({ radius, height: torso.top });
        view.scene.add(object);
        sync.bind(entity, object3DBinding(object, readDummyTransform));
      }
      dummy = dummies[0];
      if (vfxMode === 'demo' || vfxMode === 'stress') {
        const [x, y, z] = scene.camera.target;
        const centre = playerStart(loaded.layout.spawns)?.position ?? { x, y, z };
        vfxDemo = new VfxDemo(vfx, vfxMode, centre);
      }
      // Level deltas (mw-e27.3, mw-e27.4): with everything the scene spawned in place, before the
      // first tick, the level's baseline is taken and any changes stored for it are applied. Saves
      // capture how the level differs from it; dropped items persist with the level.
      registerPersistence(world);
      levelDeltasOf(world).enter(
        world,
        new WorldPersistence({
          spawners: [worldItemSpawner(worldItems)],
          warn: (message) => {
            console.warn(message);
          },
        }),
        scene.id,
        sceneAuthoredEntities(world, loaded),
      );
      persistDroppedItems(world, () => scene.id);
      label.textContent = sceneLabel(scene, __BUILD_SHA__);
      root.dataset['scene'] = scene.id;
    } else {
      label.textContent = `No scene · build ${__BUILD_SHA__}`;
      showSceneError(root, request.requested, request.available);
    }
    // Death → reload (mw-e30.7): the player's Died opens the death screen; loading a save or
    // restarting the area reloads the page, which tears the whole world down and builds it again.
    const areaId = request.kind === 'scene' ? request.id : undefined;
    const session = sessionStore();
    const deathReload = saves.then(
      ({ store }) =>
        new DeathReload({
          ui,
          world,
          store,
          // Items no longer in content are dropped from a loaded save with a warning (mw-e17.8).
          registry: createGameSaveRegistry({
            knownItem: (id) => content.has('item', id),
            warn: (message) => {
              console.warn(message);
            },
          }),
          build: { gameVersion: GAME_VERSION, buildSha: __BUILD_SHA__, contentHash: 'unversioned' },
          now: () => Date.now(),
          session,
          areaId,
          navigate: (area) => {
            const params = new URLSearchParams(location.search);
            if (area !== undefined) params.set('scene', area);
            location.search = params.toString();
          },
          // Class selection (mw-e19) names the character and class; the knight until then.
          describe: () => ({ characterName: 'Knight', classId: 'knight', areaId: areaId ?? '' }),
          publish: (readout) => {
            root.dataset[READOUT_ATTRIBUTE[readout.kind]] = JSON.stringify(readout);
            // The level changes a save holds, and the loaded level's changes after a load
            // (mw-e27.4): the e2e reads them from #app[data-level-deltas].
            if (readout.kind !== 'death') {
              root.dataset['levelDeltas'] = JSON.stringify(levelDeltasOf(world).capture(world));
            }
          },
          warn: (message) => {
            console.warn(message);
          },
        }),
    );
    world.events.on(Died, ({ target }) => {
      if (player?.entity === target) {
        void deathReload.then((reload) => reload.playerDied());
      }
    });
    const pending: PendingLoad | undefined = takePendingLoad(session);
    // The debug console (mw-e33.1): its own chunk, loaded only in dev builds or with ?debug=1.
    const consoleGate = {
      built: __DEBUG_CONSOLE__,
      dev: import.meta.env.DEV,
      search: location.search,
    };
    const sandboxScene = request.kind === 'scene' && request.id === combat.sandbox.tuning.scene;
    if (__DEBUG_CONSOLE__ && debugConsoleEnabled({ ...consoleGate, sandbox: sandboxScene })) {
      void import('@tools/console/start').then(({ startDebugConsole, unboundDebugSpawns }) => {
        const bookmarks = new Map(
          (scenes.current?.layout.spawns ?? []).map((spawn) => [spawn.id, spawn.position] as const),
        );
        startDebugConsole({
          world,
          submit: (command) => {
            commands.push(command as GameCommand);
          },
          player: (): EntityId | undefined => player?.entity,
          // ctl.get / ctl.set / ctl.dump (mw-e02.3) over the player's live controller tuning.
          controller: content.get('controller', PLAYER_CONTROLLER_ID),
          spawnables: [...spawners.keys()].sort(),
          // Sandbox dummies take options (mw-e04.9: `spawn dummy --poise 60`); props take none.
          checkSpawn: (content, options) =>
            combat.spawners.has(content)
              ? checkSandboxSpawn(combat.sandbox, content, options, world.clock.hz)
              : Object.keys(options).length === 0
                ? undefined
                : `${content} takes no options`,
          sandbox: (command) => checkSandboxCommand(combat.sandbox, command, world.clock.hz),
          bookmarks: () => bookmarks,
          // `spawn … at-cursor` (mw-e12.4): where the centre of the view meets the level.
          cursorPoint: () =>
            viewCentrePoint(physics, { position: camera.position, quaternion: camera.quaternion }),
          scenes: scenes.available(),
          loadScene: (id) => {
            const params = new URLSearchParams(location.search);
            params.set('scene', id);
            location.search = params.toString();
          },
          loop,
          // `save [slot]` (mw-e30.7): writes the world into a slot and publishes its state hash.
          save: (slot) => {
            void deathReload
              .then((reload) => reload.debugSave(slot))
              .catch((error: unknown) => {
                console.error(error);
              });
          },
          // A UI screen (mw-e00.23): while open it captures input, so the player gets no action
          // frames and pointer lock is released; the sim keeps running.
          dom: { document, keys: globalThis.window, screens: ui },
          storage: globalThis.localStorage,
          onToggle: (open) => {
            root.dataset['debugConsole'] = open ? 'open' : 'closed';
          },
        });
        // Props the console spawned get grey-box objects like the scene's own props: a movable one
        // a body-sized box following its physics pose.
        afterStep.push(() => {
          for (const { entity, placement } of unboundDebugSpawns(world, (id) => sync.has(id))) {
            const size =
              placement.prop !== undefined && world.has(entity, PhysicsObjectComponent)
                ? props(placement.prop)?.size
                : undefined;
            sync.bind(
              entity,
              size === undefined
                ? object3DBinding(greybox.spawn(placement), readSceneTransform)
                : object3DBinding(greybox.body(placement, size), readPhysicsObjectTransform),
            );
          }
        });
        root.dataset['debugConsole'] = 'closed';
      });
    }
    // Debug attribute (mw-e03.35 AC-4): colliders registered in the physics world.
    root.dataset['colliders'] = String(physics.count());
    // Debug attribute (mw-e03.39): the physics objects the scene spawned.
    root.dataset['physicsObjects'] = String(world.query(PhysicsObjectComponent).ids().length);
    writeCameraData();
    // A save chosen on the death screen (mw-e30.7) reloaded the page into its area; it loads into the
    // freshly built world before the first sim step.
    if (pending === undefined) loop.start();
    else
      void deathReload
        .then((reload) => reload.resume(pending))
        .finally(() => {
          loop.start();
        });
  };

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.dataset['testid'] = 'physics-status';
  root.append(status);
  // Debug builds (the console built in) add the frozen fixture creatures and the dev-only scenes
  // that place them (mw-e12.4); a release build loads only the game's content and never downloads
  // them.
  const content: Promise<GameContent> = __DEBUG_CONSOLE__
    ? import('@content/dev-content').then(({ loadDevContent }) => loadDevContent())
    : Promise.resolve(loadGameContent());
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
    return content.then((loaded) => {
      startWorld(boot.physics, loaded);
    });
  });
}

// Session storage for the death → reload hand-off (mw-e30.7); a browser that blocks it gets a
// stand-in for this page only, so the death screen still works (a load then starts the area afresh).
function sessionStore(): PendingLoadStorage {
  try {
    const storage = globalThis.sessionStorage;
    storage.getItem('');
    return storage;
  } catch {
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
