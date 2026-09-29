import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it, vi } from 'vitest';
import { loadGameContent, PLAYER_CAMERA_ID, type CameraTuning, type Frozen } from '@content/index';
import { markExercised } from '@content/testing';
import {
  box,
  DEFAULT_LOOK_SETTINGS,
  FakeCollisionWorld,
  RapierCollisionWorld,
  RapierPhysics,
  type CollisionWorld,
} from '@sim/index';
import type { Vec3 } from '../loop/render-sync';
import {
  applyOrbitPose,
  CAMERA_SKIN,
  lookForward,
  lookRight,
  lookSettings,
  nearPlaneClear,
  nearPlaneReach,
  OrbitCamera,
  RecoveringLength,
  toRadians,
  type CameraLens,
  type OrbitSubject,
} from './orbit-camera';

const TUNING: Frozen<CameraTuning> = {
  fov: 70,
  near: 0.1,
  pivotHeight: 1.5,
  shoulder: 0.5,
  distance: { min: 2, max: 6, initial: 3.5, step: 0.5 },
  pitch: { min: -70, max: 60, initial: -15 },
  mouseSensitivity: 0.003,
  stick: { deadzone: 0.15, exponent: 2, yawRate: 240, pitchRate: 160 },
  invertY: false,
  collisionRadius: 0.26,
  recoveryTime: 0.3,
};

const LENS: CameraLens = { fov: 70, near: 0.1, aspect: 16 / 9 };
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const FLOOR = box(v(-20, -1, -20), v(20, 0, 20));
/** A wall across the view 2 m behind a player at the origin looking along −z: face at z = 2. */
const WALL = box(v(-5, 0, 2), v(5, 3, 2.2));
const WALL_FACE_Z = 2;

/** Standing at the origin, looking along −z, level: the ideal camera is at +z. */
const subject = (over: Partial<OrbitSubject> = {}): OrbitSubject => ({
  feet: v(0, 0, 0),
  yaw: 0,
  pitch: 0,
  height: 1.8,
  ...over,
});

/** A CollisionWorld whose contents can be swapped between frames (an occluder comes and goes). */
function switchable(initial: CollisionWorld) {
  let current = initial;
  const world: CollisionWorld = {
    sweepCapsule: (...args) => current.sweepCapsule(...args),
    raycast: (...args) => current.raycast(...args),
    overlapCapsule: (...args) => current.overlapCapsule(...args),
    bodyVelocity: (body) => current.bodyVelocity(body),
  };
  return {
    world,
    set(next: CollisionWorld) {
      current = next;
    },
  };
}

describe('orbit camera geometry (mw-e02.4)', () => {
  it('looks along −z at yaw 0, turns left with yaw and up with pitch', () => {
    const f = lookForward(0, 0);
    expect([f.x, f.y, f.z]).toEqual([-0, 0, -1]);
    const left = lookForward(Math.PI / 2, 0);
    expect(left.x).toBeCloseTo(-1, 12);
    expect(left.z).toBeCloseTo(0, 12);
    const up = lookForward(0, Math.PI / 6);
    expect(up.y).toBeCloseTo(0.5, 12);
    expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1, 12);
    expect(lookRight(0)).toEqual({ x: 1, y: 0, z: -0 });
    expect(lookRight(Math.PI / 2).z).toBeCloseTo(-1, 12);
  });

  it('turns camera content into the sim look settings (degrees → radians)', () => {
    const look = lookSettings(TUNING);
    expect(look.minPitch).toBeCloseTo(DEFAULT_LOOK_SETTINGS.minPitch, 12);
    expect(look.maxPitch).toBeCloseTo(DEFAULT_LOOK_SETTINGS.maxPitch, 12);
    expect(look.sensitivity).toBe(0.003);
    expect(look.invertY).toBe(false);
    expect(look.stick.yawRate).toBeCloseTo(toRadians(240), 12);
    expect(look.stick.pitchRate).toBeCloseTo(toRadians(160), 12);
    expect(look.stick.deadzone).toBe(0.15);
    expect(look.stick.exponent).toBe(2);
  });

  it('with nothing in the way: behind the player, over the right shoulder, at the zoom distance', () => {
    const orbit = new OrbitCamera(TUNING, new FakeCollisionWorld([FLOOR]));
    const pose = orbit.update(subject(), LENS, 0);
    expect(pose.focus).toEqual({ x: 0.5, y: 1.5, z: 0 });
    expect(pose.position.x).toBeCloseTo(0.5, 12);
    expect(pose.position.y).toBeCloseTo(1.5, 12);
    expect(pose.position.z).toBeCloseTo(3.5, 12);
    expect(pose.boom).toBe(3.5);
    expect(pose.ideal).toBe(3.5);
  });

  it('looking down lifts the camera above the player; looking up lowers it', () => {
    const orbit = new OrbitCamera(TUNING, new FakeCollisionWorld([]));
    const down = orbit.update(subject({ pitch: toRadians(-30) }), LENS, 0);
    expect(down.position.y).toBeCloseTo(1.5 + 3.5 * 0.5, 9);
    const up = orbit.update(subject({ pitch: toRadians(30) }), LENS, 0);
    expect(up.position.y).toBeCloseTo(1.5 - 3.5 * 0.5, 9);
  });

  it('a left-shoulder rig hangs the boom left of the player', () => {
    const orbit = new OrbitCamera({ ...TUNING, shoulder: -0.5 }, new FakeCollisionWorld([]));
    expect(orbit.update(subject(), LENS, 0).focus.x).toBeCloseTo(-0.5, 12);
    const centred = new OrbitCamera({ ...TUNING, shoulder: 0 }, new FakeCollisionWorld([]));
    expect(centred.update(subject(), LENS, 0).focus.x).toBe(0);
  });

  it('lowers the pivot while crouched so it stays inside the capsule', () => {
    const orbit = new OrbitCamera(TUNING, new FakeCollisionWorld([]));
    const pose = orbit.update(subject({ height: 1 }), LENS, 0);
    expect(pose.focus.y).toBeCloseTo(1 - pose.radius, 12);
  });

  it('zooms in wheel notches within 2–6 m', () => {
    const orbit = new OrbitCamera(TUNING, new FakeCollisionWorld([]));
    expect(orbit.zoom).toBe(3.5);
    orbit.zoomBy(1);
    expect(orbit.zoom).toBe(4);
    orbit.zoomBy(10);
    expect(orbit.zoom).toBe(6);
    orbit.zoomBy(-100);
    expect(orbit.zoom).toBe(2);
    expect(orbit.update(subject(), LENS, 0).boom).toBe(2); // zooming in is immediate
  });

  it('the swept sphere is at least the collision radius, and grows to hold the near plane', () => {
    const orbit = new OrbitCamera(TUNING, new FakeCollisionWorld([]));
    const wide = { ...LENS, aspect: 32 / 9 };
    expect(nearPlaneReach(LENS)).toBeLessThan(0.26);
    expect(orbit.update(subject(), LENS, 0).radius).toBe(0.26);
    expect(nearPlaneReach(wide)).toBeGreaterThan(0.26);
    expect(orbit.update(subject(), wide, 0).radius).toBeCloseTo(
      nearPlaneReach(wide) + CAMERA_SKIN,
      12,
    );
  });

  it('points a camera along the pose', () => {
    const calls: string[] = [];
    applyOrbitPose(
      {
        ...LENS,
        position: { set: (x, y, z) => calls.push(`at ${String([x, y, z])}`) },
        lookAt: (x, y, z) => calls.push(`look ${String([x, y, z])}`),
      },
      { position: v(1, 2, 3), forward: v(0, 0, -1) },
    );
    expect(calls).toEqual(['at 1,2,3', 'look 1,2,2']);
  });
});

describe('camera collision (mw-e02.4)', () => {
  it('AC-2: a wall between the ideal position and the player puts the camera ≥ 0.2 m in front of it on the same frame', () => {
    const orbit = new OrbitCamera(TUNING, new FakeCollisionWorld([FLOOR, WALL]));
    const pose = orbit.update(subject(), LENS, 0);
    expect(WALL_FACE_Z - pose.position.z).toBeGreaterThanOrEqual(0.2);
    expect(pose.boom).toBeLessThan(pose.ideal);
    expect(nearPlaneClear(new FakeCollisionWorld([FLOOR, WALL]), pose, LENS)).toBe(true);
  });

  it('AC-2: an occluder that appears mid-recovery is respected on the very frame it appears', () => {
    const scene = switchable(new FakeCollisionWorld([FLOOR]));
    const orbit = new OrbitCamera(TUNING, scene.world);
    expect(orbit.update(subject(), LENS, 1 / 60).boom).toBe(3.5);
    scene.set(new FakeCollisionWorld([FLOOR, WALL]));
    const pose = orbit.update(subject(), LENS, 1 / 60);
    expect(WALL_FACE_Z - pose.position.z).toBeGreaterThanOrEqual(0.2);
    expect(nearPlaneClear(scene.world, pose, LENS)).toBe(true);
  });

  it('AC-2: backing up to the wall, no frame puts the camera within 0.2 m of it or its near plane inside it', () => {
    const collision = new FakeCollisionWorld([FLOOR, WALL]);
    const orbit = new OrbitCamera(TUNING, collision);
    for (let i = 0; i <= 60; i++) {
      // From 2 m away to touching (the capsule's back at the wall face), turning a little.
      const feet = v(0, 0, (i / 60) * (WALL_FACE_Z - 0.35));
      const pose = orbit.update(subject({ feet, yaw: (i - 30) / 100 }), LENS, 1 / 60);
      expect(WALL_FACE_Z - pose.position.z).toBeGreaterThanOrEqual(0.2);
      expect(nearPlaneClear(collision, pose, LENS)).toBe(true);
    }
  });

  it('AC-2: the same on the Rapier CollisionWorld the game uses', () => {
    const physics = new RapierPhysics(RAPIER);
    physics.add(FLOOR);
    physics.add(WALL);
    physics.step(0);
    const collision = new RapierCollisionWorld(physics);
    const orbit = new OrbitCamera(TUNING, collision);
    for (const pitch of [toRadians(-70), 0, toRadians(60)]) {
      const pose = orbit.update(subject({ pitch }), LENS, 1 / 60);
      expect(WALL_FACE_Z - pose.position.z).toBeGreaterThanOrEqual(0.2);
      expect(pose.position.y).toBeGreaterThanOrEqual(0.2); // and above the floor
      expect(nearPlaneClear(collision, pose, LENS)).toBe(true);
    }
  });

  it('a wall at the right shoulder pulls the boom towards the player', () => {
    const collision = new FakeCollisionWorld([box(v(0.5, 0, -5), v(0.7, 3, 5))]);
    const orbit = new OrbitCamera(TUNING, collision);
    const pose = orbit.update(subject(), LENS, 0);
    expect(0.5 - pose.focus.x).toBeGreaterThanOrEqual(0.26);
    expect(nearPlaneClear(collision, pose, LENS)).toBe(true);
  });

  it('a camera inside geometry fails the near-plane probe', () => {
    const collision = new FakeCollisionWorld([WALL]);
    expect(
      nearPlaneClear(collision, { position: v(0, 1.5, 2.1), forward: v(0, 0, -1) }, LENS),
    ).toBe(false);
    expect(
      nearPlaneClear(collision, { position: v(0, 1.5, 1.7), forward: v(0, 0, -1) }, LENS),
    ).toBe(true);
  });
});

/** Recovery after the wall vanishes, sampled at `hz`: the boom each frame and when it arrived. */
function recover(hz: number, scene = switchable(new FakeCollisionWorld([FLOOR, WALL]))) {
  const orbit = new OrbitCamera(TUNING, scene.world);
  const pulled = orbit.update(subject(), LENS, 1 / hz).boom;
  scene.set(new FakeCollisionWorld([FLOOR]));
  const booms: number[] = [];
  let arrived: number | undefined;
  for (let frame = 1; frame <= hz; frame++) {
    const { boom, ideal } = orbit.update(subject(), LENS, 1 / hz);
    booms.push(boom);
    if (arrived === undefined && boom >= ideal) arrived = frame / hz;
  }
  return { pulled, booms, arrived };
}

describe('camera recovery (mw-e02.4)', () => {
  for (const hz of [60, 144, 30]) {
    it(`AC-3: the camera returns to the ideal distance over 0.3 s ± 0.05 without overshoot (${String(hz)} Hz)`, () => {
      const { pulled, booms, arrived } = recover(hz);
      expect(pulled).toBeLessThan(2);
      expect(arrived).toBeGreaterThanOrEqual(0.25);
      expect(arrived).toBeLessThanOrEqual(0.35);
      // Never past the ideal distance, and never back in: no overshoot, no oscillation.
      for (const [i, boom] of booms.entries()) {
        expect(boom).toBeLessThanOrEqual(3.5);
        expect(boom).toBeGreaterThanOrEqual(i === 0 ? pulled : (booms[i - 1] ?? 0));
      }
      // Still moving just before arriving: the recovery takes the time, not one jump.
      const before = booms[Math.round((arrived ?? 0) * hz) - 2] ?? 3.5;
      expect(before).toBeLessThan(3.5);
    });
  }

  it('AC-3: the same on the Rapier CollisionWorld, removing the wall collider', () => {
    const physics = new RapierPhysics(RAPIER);
    physics.add(FLOOR);
    const wall = physics.add(WALL);
    physics.step(0);
    const collision = new RapierCollisionWorld(physics);
    const scene = switchable(collision);
    const orbit = new OrbitCamera(TUNING, scene.world);
    expect(orbit.update(subject(), LENS, 1 / 60).boom).toBeLessThan(2);
    physics.remove(wall);
    physics.step(0);
    let arrived: number | undefined;
    for (let frame = 1; frame <= 60 && arrived === undefined; frame++) {
      if (orbit.update(subject(), LENS, 1 / 60).boom >= 3.5) arrived = frame / 60;
    }
    expect(arrived).toBeGreaterThanOrEqual(0.25);
    expect(arrived).toBeLessThanOrEqual(0.35);
  });

  it('a partial opening only lets the camera out as far as it is clear', () => {
    const scene = switchable(new FakeCollisionWorld([WALL]));
    const orbit = new OrbitCamera(TUNING, scene.world);
    orbit.update(subject(), LENS, 1 / 60);
    scene.set(new FakeCollisionWorld([box(v(-5, 0, 3), v(5, 3, 3.2))])); // the wall moves back 1 m
    const booms = Array.from({ length: 30 }, () => orbit.update(subject(), LENS, 1 / 60).boom);
    expect(Math.max(...booms)).toBeLessThanOrEqual(3 - 0.26);
    expect(booms.at(-1)).toBeCloseTo(3 - 0.26 - CAMERA_SKIN, 9);
  });

  it('a cut places the camera at once, without recovering', () => {
    const scene = switchable(new FakeCollisionWorld([WALL]));
    const orbit = new OrbitCamera(TUNING, scene.world);
    orbit.update(subject(), LENS, 1 / 60);
    scene.set(new FakeCollisionWorld([]));
    orbit.cut();
    expect(orbit.update(subject(), LENS, 1 / 60).boom).toBe(3.5);
  });

  it('RecoveringLength: snaps in, eases out, and never passes what is allowed', () => {
    const length = new RecoveringLength(0.3);
    expect(length.value).toBeUndefined();
    expect(length.update(1, 3, 0.1)).toBe(1);
    expect(length.update(3, 3, 0.1)).toBeGreaterThan(1);
    expect(length.update(1.5, 3, 0.1)).toBe(1.5); // pulled in again
    expect(length.update(3, 3, 1)).toBe(3);
    // A shorter ideal (zoom in) mid-recovery never moves it backwards unless collision does.
    length.update(1, 3, 0);
    const a = length.update(3, 3, 0.1);
    expect(length.update(3, 2, 0.01)).toBeGreaterThanOrEqual(a);
  });
});

describe('camera content (mw-e02.4)', () => {
  it('the player rig from content places a camera clear of the testbed-sized wall', ({ task }) => {
    markExercised(task, 'camera', PLAYER_CAMERA_ID);
    const tuning = loadGameContent().get('camera', PLAYER_CAMERA_ID);
    const collision = new FakeCollisionWorld([FLOOR, WALL]);
    const orbit = new OrbitCamera(tuning, collision);
    const pose = orbit.update(subject({ pitch: toRadians(tuning.pitch.initial) }), LENS, 0);
    expect(WALL_FACE_Z - pose.position.z).toBeGreaterThanOrEqual(0.2);
    expect(nearPlaneClear(collision, pose, LENS)).toBe(true);
  });

  it('only queries the CollisionWorld (read-only)', () => {
    const collision = new FakeCollisionWorld([FLOOR, WALL]);
    const spy = vi.spyOn(collision, 'sweepCapsule');
    new OrbitCamera(TUNING, collision).update(subject(), LENS, 0);
    expect(spy).toHaveBeenCalledTimes(2); // the shoulder, then the boom
  });
});
