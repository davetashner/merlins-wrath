// The AI debug overlay's entry point (mw-e11.17), loaded by src/main.ts in the debug console's
// chunk (only when the console is enabled, see src/game/debug-console-gate.ts), so a release build
// (VESPER_DEBUG_CONSOLE=off) neither ships nor can enable it. It builds the controller, the drawing
// (src/render/debug/ai-overlay.ts) and the console commands, selects an agent on a click while the
// pointer is free (the console open), and publishes what it drew to #app[data-ai-debug] for the
// e2e.

import type { EntityId, Vec3, World } from '@sim/index';
import { createAiOverlay, type AiOverlay } from '@render/debug/ai-overlay';
import { Vector3, type Camera, type Object3D } from 'three';
import type { ConsoleHost } from '../console/builtins';
import type { CommandRegistry } from '../console/registry';
import { registerAiDebugCommands } from './commands';
import { AiDebug } from './controller';
import type { Ray } from './model';

export interface AiDebugStartOptions {
  readonly world: World<never>;
  readonly loop: { stepOnce(): void };
  readonly registry: CommandRegistry<ConsoleHost>;
  /** Where the overlay's 3D objects go (the view's scene). */
  readonly scene: { add(object: Object3D): unknown };
  readonly camera: Camera;
  /** The page's game root: labels go in a layer over it, clicks on it select agents. */
  readonly root: HTMLElement;
  /** Whether the pointer is locked (clicks are then the player's, not selections). */
  readonly pointerLocked: () => boolean;
  readonly light?: { levelAt(point: Vec3): number };
  readonly cursorPoint?: () => Vec3 | undefined;
  /** Receives the overlay's readout (JSON) whenever it changes. */
  readonly publish?: (json: string) => void;
}

export interface AiDebugSession {
  readonly debug: AiDebug;
  readonly overlay: AiOverlay;
  /** The sim is held (OR it into the frame loop's `simPaused`). */
  held(): boolean;
  /** Draws the overlay; call every rendered frame. */
  frame(): void;
  dispose(): void;
}

/** The ray from `camera` through normalised device point (x, y). */
export function cameraRay(camera: Camera, x: number, y: number): Ray {
  camera.updateMatrixWorld();
  const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  const direction = new Vector3(x, y, 0.5).unproject(camera).sub(origin).normalize();
  return {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    direction: { x: direction.x, y: direction.y, z: direction.z },
  };
}

/** Starts the AI debug overlay (off until `ai.debug on`). */
export function startAiDebug(options: AiDebugStartOptions): AiDebugSession {
  const { world, root, camera } = options;
  const debug = new AiDebug({
    world,
    loop: options.loop,
    ...(options.light !== undefined && { light: options.light }),
    ...(options.cursorPoint !== undefined && { cursorPoint: options.cursorPoint }),
  });
  const layer = root.ownerDocument.createElement('div');
  layer.dataset['testid'] = 'ai-debug-layer';
  layer.style.cssText =
    'position:absolute;inset:0;margin:0;pointer-events:none;overflow:hidden;z-index:5;';
  root.append(layer);
  const overlay = createAiOverlay({ labels: layer });
  options.scene.add(overlay.object);
  registerAiDebugCommands(options.registry, {
    debug,
    crosshair: () => cameraRay(camera, 0, 0),
    isAlive: (entity: EntityId) => world.isAlive(entity),
  });

  const onClick = (event: MouseEvent): void => {
    if (!debug.enabled || options.pointerLocked()) return;
    const rect = root.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    debug.pick(cameraRay(camera, x, y));
  };
  root.addEventListener('click', onClick);

  let published = '';
  const publish = (json: string): void => {
    if (json === published) return;
    published = json;
    options.publish?.(json);
  };

  return {
    debug,
    overlay,
    held: () => debug.held,
    frame() {
      const frame = debug.frame();
      overlay.enabled = debug.enabled;
      if (frame !== undefined) {
        overlay.update(frame.model, camera, root.clientWidth, root.clientHeight);
      }
      publish(
        JSON.stringify({
          on: debug.enabled,
          frozen: debug.frozen,
          selected: debug.selected ?? null,
          tick: frame?.snapshot.tick ?? null,
          ...overlay.stats(),
        }),
      );
    },
    dispose() {
      root.removeEventListener('click', onClick);
      debug.dispose();
      overlay.dispose();
      layer.remove();
    },
  };
}
