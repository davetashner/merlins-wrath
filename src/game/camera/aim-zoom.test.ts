import { describe, expect, it } from 'vitest';
import { loadGameContent, ARCHER_BOW_ID, PLAYER_CAMERA_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { AimZoom, SETTLE_DEGREES } from './aim-zoom';

const content = loadGameContent();

describe('AimZoom (mw-e05.21)', () => {
  it("AC-2: drawn, the FOV eases from 70° toward the bow's aim.fov (55°), about two thirds of the way in aim.time, and back after release", ({
    task,
  }) => {
    markExercised(task, 'bow', ARCHER_BOW_ID);
    markExercised(task, 'camera', PLAYER_CAMERA_ID);
    const { aim } = content.get('bow', ARCHER_BOW_ID);
    const rest = content.get('camera', PLAYER_CAMERA_ID).fov;
    expect([rest, aim.fov]).toEqual([70, 55]);
    const zoom = new AimZoom(rest);
    expect(zoom.fov).toBe(70);
    const frame = 1 / 60;
    const frames = Math.round(aim.time / frame);
    let previous = zoom.fov;
    for (let i = 0; i < frames; i++) {
      const fov = zoom.update(true, aim.fov, aim.time, frame);
      expect(fov).toBeLessThan(previous); // narrowing every frame, never past the aim
      expect(fov).toBeGreaterThan(aim.fov);
      previous = fov;
    }
    const covered = (rest - zoom.fov) / (rest - aim.fov);
    expect(covered).toBeGreaterThan(0.6);
    expect(covered).toBeLessThan(0.7);
    // Held, it settles exactly on the aim.
    for (let i = 0; i < 120; i++) zoom.update(true, aim.fov, aim.time, frame);
    expect(zoom.fov).toBe(55);
    // Released, it eases back out the same way and settles on the camera's own.
    for (let i = 0; i < frames; i++) zoom.update(false, aim.fov, aim.time, frame);
    const back = (zoom.fov - aim.fov) / (rest - aim.fov);
    expect(back).toBeGreaterThan(0.6);
    expect(back).toBeLessThan(0.7);
    for (let i = 0; i < 120; i++) zoom.update(false, aim.fov, aim.time, frame);
    expect(zoom.fov).toBe(70);
  });

  it('is the same at any frame rate, and a frame of no time changes nothing', () => {
    const a = new AimZoom(70);
    const b = new AimZoom(70);
    for (let i = 0; i < 9; i++) a.update(true, 55, 0.15, 1 / 60);
    for (let i = 0; i < 18; i++) b.update(true, 55, 0.15, 1 / 120);
    expect(a.fov).toBeCloseTo(b.fov, 9);
    const before = a.fov;
    expect(a.update(true, 55, 0.15, 0)).toBe(before);
    expect(SETTLE_DEGREES).toBeGreaterThan(0);
  });
});
