// The combat sandbox on the page (mw-e04.9): the glue between the sim's dummies and what the owner
// sees and presses, kept out of src/main.ts so it is tested.
//
// - F3 shows and hides the frame-data overlay (src/ui/frame-data.ts) together with the hit-volume
//   wireframes (the hitboxes and hurtboxes the sim tests); it starts shown in the sandbox scene.
// - F4 toggles debug slow motion: the frame loop runs the sim at 0.25× wall time. Only how many fixed
//   steps a frame runs changes, never a step, so tick counts and frame data are the same at any speed
//   (the console's `timescale` sets any speed).
// - After every drawn frame whose sim tick changed, the overlay is refreshed and the same frame data
//   is published as JSON on the root's `data-frame-data` (the e2e reads it), with the speed on
//   `data-time-scale` and the overlay state on `data-frame-overlay`.
// - `bindSandboxDummies` gives every sandbox dummy the sim spawned (scene or console) a render
//   object, turned to its facing.

import type { MoveTable } from '@content/index';
import { CombatFacingComponent, PlacementComponent, SandboxDummyComponent } from '@sim/index';
import type { EntityId, World } from '@sim/index';
import { FrameDataPanel } from '@ui/index';
import type { RenderSync, SceneBinding, SimView, Transform } from '../loop/render-sync';
import { DamageMeter, frameDataView, sandboxFrameData } from './frame-data';

/** The key that shows and hides the frame-data overlay. */
export const FRAME_OVERLAY_KEY = 'F3';
/** The key that toggles slow motion. */
export const SLOW_MOTION_KEY = 'F4';
/** The slow-motion speed (sim time per wall time). */
export const SLOW_MOTION_SCALE = 0.25;

/** Where keys come from (the window). */
export interface KeySource {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

export interface SandboxHudOptions {
  readonly world: World<never>;
  /** The page root: data attributes go here. */
  readonly root: HTMLElement;
  /** Where the overlay goes (the UI layer's HUD). */
  readonly hud: HTMLElement;
  readonly keys: KeySource;
  /** The frame loop (its time scale). */
  readonly loop: { timeScale: number };
  /** The action timeline's move table. */
  readonly moves: MoveTable;
  /** The player entity, if the scene has one. */
  readonly player: () => EntityId | undefined;
  /** The hit-volume wireframes, shown with the overlay. */
  readonly hitboxes?: { enabled: boolean };
  /** Whether the overlay starts shown. */
  readonly visible: boolean;
  /** Whether keys are for the game now (false while the console or a menu has them). */
  readonly keysEnabled?: () => boolean;
}

export interface SandboxHud {
  readonly panel: FrameDataPanel;
  /** Call once per drawn frame, after the sim stepped. */
  frame(): void;
  toggleOverlay(): void;
  toggleSlowMotion(): void;
  dispose(): void;
}

/** Mounts the overlay and the F3/F4 keys (see the file header). */
export function createSandboxHud(options: SandboxHudOptions): SandboxHud {
  const { world, root, loop, keys } = options;
  const panel = new FrameDataPanel(root.ownerDocument);
  options.hud.append(panel.element);
  const meter = new DamageMeter(world);
  let published = '';
  const show = (visible: boolean): void => {
    panel.visible = visible;
    if (options.hitboxes !== undefined) options.hitboxes.enabled = visible;
    root.dataset['frameOverlay'] = visible ? 'on' : 'off';
    published = '';
  };
  const hud: SandboxHud = {
    panel,
    frame() {
      const speed = loop.timeScale;
      root.dataset['timeScale'] = String(speed);
      const player = options.player();
      const data = sandboxFrameData(world, {
        moves: options.moves,
        meter,
        speed,
        ...(player !== undefined && { player }),
      });
      const json = JSON.stringify(data);
      if (json === published) return;
      published = json;
      root.dataset['frameData'] = json;
      if (panel.visible) panel.update(frameDataView(data));
    },
    toggleOverlay() {
      show(!panel.visible);
    },
    toggleSlowMotion() {
      loop.timeScale = loop.timeScale === 1 ? SLOW_MOTION_SCALE : 1;
      published = '';
    },
    dispose() {
      keys.removeEventListener('keydown', onKey);
      meter.dispose();
      panel.element.remove();
    },
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || options.keysEnabled?.() === false) return;
    if (event.code === FRAME_OVERLAY_KEY) hud.toggleOverlay();
    else if (event.code === SLOW_MOTION_KEY) hud.toggleSlowMotion();
    else return;
    event.preventDefault(); // F3 is the browser's find-next
  };
  keys.addEventListener('keydown', onKey);
  show(options.visible);
  return hud;
}

/** A sandbox dummy's transform for render sync: its feet, turned to its facing. */
export function readSandboxDummyTransform(view: SimView, entity: EntityId): Transform | undefined {
  const at = view.get(entity, PlacementComponent);
  if (at === undefined) return undefined;
  const facing = view.get(entity, CombatFacingComponent)?.facing ?? { x: 0, y: 0, z: 1 };
  // Yaw about +y that turns the model's +z onto the facing.
  const half = Math.atan2(facing.x, facing.z) / 2;
  return {
    position: { x: at.x, y: at.y, z: at.z },
    rotation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
  };
}

/**
 * Binds a render object to every sandbox dummy not bound yet (call after each sim step): `create`
 * builds it, given whether the dummy is an attacker.
 */
export function bindSandboxDummies<TObject>(
  world: World<never>,
  sync: RenderSync,
  create: (entity: EntityId) => SceneBinding<TObject>,
): void {
  if (!world.isRegistered(SandboxDummyComponent)) return;
  world.query(SandboxDummyComponent).forEach((entity) => {
    if (!sync.has(entity)) sync.bind(entity, create(entity));
  });
}
