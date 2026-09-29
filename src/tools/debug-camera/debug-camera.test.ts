import type { Transform } from '@game/loop/index';
import { describe, expect, it, vi } from 'vitest';
import { DEBUG_CAMERA_TOGGLE_KEY, DebugCamera, type CameraTarget } from './debug-camera';
import {
  FLY_FAST_MULTIPLIER,
  FLY_SPEED,
  IDLE_FLY_INPUT,
  LOOK_SENSITIVITY,
  MAX_PITCH,
  poseFromTransform,
  stepFly,
  transformFromPose,
  type FlyPose,
} from './fly-camera';
import { bindDebugCameraInput } from './input';

const origin = { x: 0, y: 0, z: 0 };

function fakeCamera(start: Transform): CameraTarget & { transform: Transform } {
  return {
    transform: start,
    read() {
      return this.transform;
    },
    write(transform) {
      this.transform = transform;
    },
  };
}

/** A camera 10 m up looking along +x and 30° down. */
const PRIOR = transformFromPose({
  position: { x: 1, y: 10, z: -3 },
  yaw: -Math.PI / 2,
  pitch: -Math.PI / 6,
});

describe('fly camera maths (mw-e00.21)', () => {
  it('round-trips a pose through its transform', () => {
    const pose: FlyPose = { position: { x: 1, y: 2, z: 3 }, yaw: 0.7, pitch: -0.4 };
    const back = poseFromTransform(transformFromPose(pose));
    expect(back.position).toEqual(pose.position);
    expect(back.yaw).toBeCloseTo(pose.yaw, 12);
    expect(back.pitch).toBeCloseTo(pose.pitch, 12);
  });

  it('flies forward along the view, sideways, and straight up', () => {
    const level: FlyPose = { position: origin, yaw: 0, pitch: 0 };
    const ahead = stepFly(level, { ...IDLE_FLY_INPUT, forward: true }, 1);
    expect(ahead.position.z).toBeCloseTo(-FLY_SPEED, 12);
    const right = stepFly(level, { ...IDLE_FLY_INPUT, right: true }, 0.5);
    expect(right.position.x).toBeCloseTo(FLY_SPEED / 2, 12);
    const up = stepFly(level, { ...IDLE_FLY_INPUT, up: true, fast: true }, 1);
    expect(up.position.y).toBeCloseTo(FLY_SPEED * FLY_FAST_MULTIPLIER, 12);
    // Diagonals are not faster than straight lines.
    const diagonal = stepFly(level, { ...IDLE_FLY_INPUT, forward: true, left: true }, 1);
    expect(Math.hypot(diagonal.position.x, diagonal.position.z)).toBeCloseTo(FLY_SPEED, 12);
    // Opposite keys cancel out.
    const still = stepFly(level, { ...IDLE_FLY_INPUT, up: true, down: true }, 1);
    expect(still.position).toEqual(origin);
  });

  it('turns with the mouse and clamps the pitch', () => {
    const level: FlyPose = { position: origin, yaw: 0, pitch: 0 };
    const turned = stepFly(level, { ...IDLE_FLY_INPUT, lookX: 100, lookY: 10_000 }, 0);
    expect(turned.yaw).toBeCloseTo(-100 * LOOK_SENSITIVITY, 12);
    expect(turned.pitch).toBe(-MAX_PITCH);
    expect(poseFromTransform(transformFromPose({ ...level, pitch: Math.PI / 2 })).pitch).toBe(
      MAX_PITCH,
    );
  });
});

describe('debug camera toggle (mw-e00.21)', () => {
  it('AC-5: moves the camera with WASD and mouse input, and toggling off restores the prior camera', () => {
    const camera = fakeCamera(PRIOR);
    const debug = new DebugCamera(camera);
    expect(debug.update(16)).toBe(false); // off: does nothing
    expect(debug.keyDown('KeyW')).toBe(false);
    debug.look(5, 5);

    expect(debug.toggle()).toBe(true);
    expect(debug.active).toBe(true);
    expect(debug.update(16)).toBe(false); // on, but no input
    expect(debug.keyDown('KeyW')).toBe(true);
    expect(debug.keyDown('KeyZ')).toBe(false);
    expect(debug.update(500)).toBe(true);
    const moved = camera.transform;
    expect(moved.position.x).toBeGreaterThan(PRIOR.position.x + 0.5); // along +x, the view direction
    expect(moved.position.y).toBeLessThan(PRIOR.position.y); // and down, with the pitch
    debug.keyUp('KeyW');
    debug.look(40, 0);
    expect(debug.update(16)).toBe(true);
    expect(camera.transform.rotation).not.toEqual(moved.rotation);
    expect(camera.transform.position).toEqual(moved.position);

    expect(debug.toggle()).toBe(false);
    expect(camera.transform).toBe(PRIOR);
    expect(debug.update(16)).toBe(false);
  });

  it('holding only Shift does not move; a long frame is capped at 100 ms', () => {
    const camera = fakeCamera(transformFromPose({ position: origin, yaw: 0, pitch: 0 }));
    const debug = new DebugCamera(camera);
    debug.toggle();
    debug.keyDown('ShiftLeft');
    expect(debug.update(16)).toBe(false);
    debug.keyDown('Space');
    debug.update(5_000);
    expect(camera.transform.position.y).toBeCloseTo(FLY_SPEED * FLY_FAST_MULTIPLIER * 0.1, 12);
    debug.clear();
    expect(debug.update(16)).toBe(false);
  });
});

/** Dispatches a DOM-like event with extra fields on `target`. */
function send(target: EventTarget, type: string, fields: object): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), fields);
  target.dispatchEvent(event);
  return event;
}

describe('debug camera input wiring (mw-e00.21)', () => {
  it('AC-5: F2 toggles, keys fly without scrolling the page, dragging looks, blur drops keys', () => {
    const camera = fakeCamera(PRIOR);
    const debug = new DebugCamera(camera);
    const keys = new EventTarget();
    const surface = new EventTarget();
    const onToggle = vi.fn();
    const unbind = bindDebugCameraInput(debug, { keys, surface, onToggle });

    expect(send(keys, 'keydown', { code: 'KeyW', repeat: false }).defaultPrevented).toBe(false);
    const toggle = send(keys, 'keydown', { code: DEBUG_CAMERA_TOGGLE_KEY, repeat: false });
    expect(toggle.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    send(keys, 'keydown', { code: DEBUG_CAMERA_TOGGLE_KEY, repeat: true }); // auto-repeat: ignored
    expect(onToggle).toHaveBeenCalledTimes(1);

    expect(send(keys, 'keydown', { code: 'KeyD', repeat: false }).defaultPrevented).toBe(true);
    expect(debug.update(100)).toBe(true);
    send(keys, 'keyup', { code: 'KeyD' });
    expect(debug.update(100)).toBe(false);

    send(keys, 'keydown', { code: 'KeyS', repeat: false });
    send(keys, 'blur', {});
    expect(debug.update(100)).toBe(false);

    send(surface, 'pointermove', { clientX: 10, clientY: 10, buttons: 0 }); // hover: no look
    expect(debug.update(16)).toBe(false);
    send(surface, 'pointerdown', { clientX: 10, clientY: 10, buttons: 1 });
    send(surface, 'pointermove', { clientX: 30, clientY: 15, buttons: 1 });
    const before = camera.transform;
    expect(debug.update(16)).toBe(true);
    expect(poseFromTransform(camera.transform).yaw).toBeCloseTo(
      poseFromTransform(before).yaw - 20 * LOOK_SENSITIVITY,
      9,
    );
    expect(poseFromTransform(camera.transform).pitch).toBeCloseTo(
      poseFromTransform(before).pitch - 5 * LOOK_SENSITIVITY,
      9,
    );

    send(keys, 'keydown', { code: DEBUG_CAMERA_TOGGLE_KEY, repeat: false });
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(camera.transform).toBe(PRIOR);

    unbind();
    send(keys, 'keydown', { code: DEBUG_CAMERA_TOGGLE_KEY, repeat: false });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('toggles without an onToggle callback', () => {
    const debug = new DebugCamera(fakeCamera(PRIOR));
    const keys = new EventTarget();
    bindDebugCameraInput(debug, { keys, surface: new EventTarget() });
    send(keys, 'keydown', { code: DEBUG_CAMERA_TOGGLE_KEY, repeat: false });
    expect(debug.active).toBe(true);
  });
});
