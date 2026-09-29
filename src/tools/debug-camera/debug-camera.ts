// The debug fly camera toggle (mw-e00.21). Turning it on remembers the camera's transform and starts
// flying from there; turning it off puts the camera back exactly where it was, so whatever owned the
// camera (the scene's view today, the gameplay camera from e02) carries on undisturbed. Keyboard and
// mouse arrive through `keyDown`/`keyUp`/`look` (see input.ts for the DOM wiring), and `update`
// moves the camera once per rendered frame.

import type { Transform } from '@game/loop/index';
import {
  IDLE_FLY_INPUT,
  poseFromTransform,
  stepFly,
  transformFromPose,
  type FlyPose,
} from './fly-camera';

/** The camera the debug camera drives (a Three.js camera in the game). */
export interface CameraTarget {
  read(): Transform;
  write(transform: Transform): void;
}

/** Key that toggles the fly camera. */
export const DEBUG_CAMERA_TOGGLE_KEY = 'F2';

type Control = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'fast';

/** KeyboardEvent.code → movement control. */
export const FLY_KEYS: Readonly<Record<string, Control>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyE: 'up',
  Space: 'up',
  KeyQ: 'down',
  ShiftLeft: 'fast',
  ShiftRight: 'fast',
};

export class DebugCamera {
  private prior: Transform | undefined;
  private pose: FlyPose | undefined;
  private readonly held = new Set<string>();
  private lookX = 0;
  private lookY = 0;

  constructor(private readonly camera: CameraTarget) {}

  get active(): boolean {
    return this.pose !== undefined;
  }

  /** Turns the fly camera on (saving the camera) or off (restoring it). Returns the new state. */
  toggle(): boolean {
    if (this.prior === undefined) {
      this.prior = this.camera.read();
      this.pose = poseFromTransform(this.prior);
    } else {
      this.camera.write(this.prior);
      this.prior = undefined;
      this.pose = undefined;
    }
    this.clear();
    return this.active;
  }

  /** A key went down; returns whether the fly camera uses it (so the page should not). */
  keyDown(code: string): boolean {
    if (!this.active || !(code in FLY_KEYS)) return false;
    this.held.add(code);
    return true;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Mouse movement to turn by, in CSS pixels (ignored while the fly camera is off). */
  look(dx: number, dy: number): void {
    if (!this.active) return;
    this.lookX += dx;
    this.lookY += dy;
  }

  /** Forgets held keys and pending mouse movement (e.g. when the window loses focus). */
  clear(): void {
    this.held.clear();
    this.lookX = 0;
    this.lookY = 0;
  }

  /** Moves the camera by `dtMs` of input; returns whether it changed. */
  update(dtMs: number): boolean {
    const pose = this.pose;
    if (pose === undefined) return false;
    const controls = new Set([...this.held].map((code) => FLY_KEYS[code]));
    const moving = controls.size > (controls.has('fast') ? 1 : 0);
    if (!moving && this.lookX === 0 && this.lookY === 0) return false;
    this.pose = stepFly(
      pose,
      {
        ...IDLE_FLY_INPUT,
        forward: controls.has('forward'),
        back: controls.has('back'),
        left: controls.has('left'),
        right: controls.has('right'),
        up: controls.has('up'),
        down: controls.has('down'),
        fast: controls.has('fast'),
        lookX: this.lookX,
        lookY: this.lookY,
      },
      // A long hitch (tab switch, breakpoint) must not fling the camera across the level.
      Math.min(dtMs, 100) / 1000,
    );
    this.lookX = 0;
    this.lookY = 0;
    this.camera.write(transformFromPose(this.pose));
    return true;
  }
}
