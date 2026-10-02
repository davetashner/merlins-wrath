// Door geometry (mw-e03.18): leaf boxes, contacts and drawing poses for every kind of door.
import { describe, expect, it } from 'vitest';
import type { Placement } from '../stimulus/placement';
import {
  closedBox,
  contactOpenness,
  leafBox,
  leafCentre,
  leafPose,
  toLocal,
  toWorld,
  type DoorFrame,
} from './geometry';

const SIZE = { x: 1.2, y: 2.2, z: 0.1 };
const door = (over: Partial<DoorFrame> = {}): DoorFrame => ({
  kind: 'hinged',
  size: SIZE,
  origin: { x: 0, y: 0, z: 0 },
  yaw: 0,
  hinge: 'left',
  swing: 'forward',
  ...over,
});
const ball = (x: number, y: number, z: number, radius: number): Placement => ({ x, y, z, radius });

describe('door frame', () => {
  it('turns local points by the yaw and back', () => {
    const d = door({ origin: { x: 5, y: 1, z: -2 }, yaw: 90 });
    const world = toWorld(d, { x: 1, y: 0, z: 0 });
    expect(world).toEqual({ x: 5, y: 1, z: -3 });
    expect(toLocal(d, world)).toEqual({ x: 1, y: 0, z: 0 });
    for (const yaw of [0, 180, 270] as const) {
      const turned = door({ yaw });
      expect(toLocal(turned, toWorld(turned, { x: 0.25, y: 1, z: 0.5 }))).toEqual({
        x: 0.25,
        y: 1,
        z: 0.5,
      });
    }
  });

  it('lays the closed leaf across the doorway, and a trapdoor flush with the floor', () => {
    expect(closedBox(door())).toEqual({
      min: { x: -0.6, y: 0, z: -0.05 },
      max: { x: 0.6, y: 2.2, z: 0.05 },
    });
    expect(closedBox(door({ yaw: 90 }))).toEqual({
      min: { x: -0.05, y: 0, z: -0.6 },
      max: { x: 0.05, y: 2.2, z: 0.6 },
    });
    expect(closedBox(door({ kind: 'trapdoor', size: { x: 1, y: 2, z: 0.1 } }))).toEqual({
      min: { x: -0.5, y: -0.1, z: -1 },
      max: { x: 0.5, y: 0, z: 1 },
    });
    expect(leafCentre(door())).toEqual({ x: 0, y: 1.1, z: 0 });
  });
});

describe('leaf boxes', () => {
  it('moves a portcullis up and a sliding leaf towards its hinge side', () => {
    expect(leafBox(door({ kind: 'portcullis' }), 0.5)).toEqual({
      min: { x: -0.6, y: 1.1, z: -0.05 },
      max: { x: 0.6, y: 3.3000000000000003, z: 0.05 },
    });
    expect(leafBox(door({ kind: 'sliding' }), 1).max.x).toBeCloseTo(-0.6);
    expect(leafBox(door({ kind: 'sliding', hinge: 'right' }), 1).min.x).toBeCloseTo(0.6);
  });

  it('keeps a turning leaf closed until it is fully open, then stands it along its swing', () => {
    expect(leafBox(door(), 0.99)).toEqual(closedBox(door()));
    expect(leafBox(door(), 1)).toEqual({
      min: { x: -0.6, y: 0, z: 0 },
      max: { x: -0.5, y: 2.2, z: 1.2 },
    });
    expect(leafBox(door({ hinge: 'right', swing: 'back' }), 1)).toEqual({
      min: { x: 0.5, y: 0, z: -1.2 },
      max: { x: 0.6, y: 2.2, z: 0 },
    });
    const hatch = door({ kind: 'trapdoor', size: { x: 1, y: 2, z: 0.1 } });
    expect(leafBox(hatch, 1)).toEqual({
      min: { x: -0.5, y: 0, z: -1 },
      max: { x: -0.4, y: 1, z: 1 },
    });
  });
});

describe('contacts', () => {
  it('stops a swinging leaf where it first touches a body in its sweep, either way', () => {
    const crate = ball(0, 0.3, 0.6, 0.3);
    const opening = contactOpenness(door(), 0, 1, crate);
    expect(opening).toBeGreaterThan(0.2);
    expect(opening).toBeLessThan(0.35);
    // Closing onto it from fully open meets its other side.
    const closing = contactOpenness(door(), 1, 0, crate);
    expect(closing).toBeGreaterThan(0.6);
    expect(closing).toBeLessThan(0.8);
    // A sweep that ends before reaching it, or starts past it, does not.
    expect(contactOpenness(door(), 0, 0.1, crate)).toBeUndefined();
    expect(contactOpenness(door(), 0.1, 0, crate)).toBeUndefined();
    // Out of reach, above the door, below the floor, or on the other side: no contact.
    expect(contactOpenness(door(), 0, 1, ball(0, 0.3, 2, 0.3))).toBeUndefined();
    expect(contactOpenness(door(), 0, 1, ball(0, 3, 0.6, 0.3))).toBeUndefined();
    expect(contactOpenness(door(), 0, 1, ball(0, -1, 0.6, 0.3))).toBeUndefined();
    expect(contactOpenness(door(), 0, 1, ball(0, 0.3, -0.6, 0.3))).toBeUndefined();
    // Swinging back meets what is behind it.
    expect(contactOpenness(door({ swing: 'back' }), 0, 1, ball(0, 0.3, -0.6, 0.3))).toBe(opening);
  });

  it('holds a turning leaf where it is when a body sits on its hinge', () => {
    expect(contactOpenness(door(), 0.2, 0.3, ball(-0.6, 1, 0, 0.3))).toBe(0.2);
    expect(contactOpenness(door(), 0.3, 0.2, ball(-0.6, 1, 0, 0.3))).toBe(0.3);
  });

  it('lifts a trapdoor into what stands on it', () => {
    const hatch = door({ kind: 'trapdoor', size: { x: 1, y: 2, z: 0.1 } });
    // A crate resting on it keeps it shut; one hanging above stops it part way.
    expect(contactOpenness(hatch, 0, 1, ball(0, 0.3, 0, 0.3))).toBeCloseTo(0);
    const lifted = contactOpenness(hatch, 0, 1, ball(0, 1, 0, 0.3));
    expect(lifted).toBeGreaterThan(0.45);
    expect(lifted).toBeLessThan(0.6);
    expect(contactOpenness(hatch, 0, 1, ball(0, 0.3, 3, 0.3))).toBeUndefined();
  });

  it('stops a closing portcullis on the top of what is under it, and never a rising one', () => {
    const gate = door({ kind: 'portcullis' });
    const crate = ball(0, 0.3, 0, 0.3);
    expect(contactOpenness(gate, 1, 0, crate)).toBeCloseTo(0.6 / 2.2);
    expect(contactOpenness(gate, 0, 1, crate)).toBeUndefined();
    // Already pressing on it: it stays.
    expect(contactOpenness(gate, 0.2, 0.1, crate)).toBe(0.2);
    // Beside the doorway, through the wall, or not reached this tick: nothing.
    expect(contactOpenness(gate, 1, 0, ball(2, 0.3, 0, 0.3))).toBeUndefined();
    expect(contactOpenness(gate, 1, 0, ball(0, 0.3, 1, 0.3))).toBeUndefined();
    expect(contactOpenness(gate, 1, 0.9, crate)).toBeUndefined();
    expect(contactOpenness(gate, 0.1, 0, ball(0, 1, 0, 0.3))).toBeUndefined();
  });

  it('stops a closing sliding leaf at the edge of what is in the doorway', () => {
    const slide = door({ kind: 'sliding' });
    const crate = ball(0, 0.3, 0, 0.3);
    // Left-hinged: the free edge comes back from x = −0.6 (open) to +0.6 (closed).
    expect(contactOpenness(slide, 1, 0, crate)).toBeCloseTo(0.75);
    expect(contactOpenness(slide, 0, 1, crate)).toBeUndefined();
    expect(contactOpenness(slide, 1, 0, ball(0, 0.3, 1, 0.3))).toBeUndefined();
    expect(contactOpenness(slide, 1, 0, ball(0, 3, 0, 0.3))).toBeUndefined();
    expect(contactOpenness(slide, 1, 0, ball(0, -1, 0, 0.3))).toBeUndefined();
    expect(contactOpenness(slide, 1, 0.9, crate)).toBeUndefined();
    expect(contactOpenness(slide, 0.1, 0, ball(-0.5, 0.3, 0, 0.1))).toBeUndefined();
  });
});

describe('drawing poses', () => {
  it('turns a hinged leaf about its hinge, the way it swings', () => {
    const shut = leafPose(door(), 0);
    expect(shut.position).toEqual({ x: -0.6, y: 0, z: 0 });
    expect(shut.centre).toEqual({ x: 0.6, y: 1.1, z: 0 });
    expect(shut.size).toEqual(SIZE);
    expect(shut.rotation.w).toBeCloseTo(1);
    const open = leafPose(door(), 1).rotation;
    expect(open.y).toBeCloseTo(-Math.SQRT1_2);
    expect(leafPose(door({ swing: 'back' }), 1).rotation.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('tips a trapdoor up about its hinge', () => {
    const hatch = door({ kind: 'trapdoor', size: { x: 1, y: 2, z: 0.1 } });
    const pose = leafPose(hatch, 1);
    expect(pose.position).toEqual({ x: -0.5, y: 0, z: 0 });
    expect(pose.rotation.z).toBeCloseTo(Math.SQRT1_2);
    expect(pose.size).toEqual({ x: 1, y: 0.1, z: 2 });
  });

  it('raises a portcullis and slides a sliding leaf, turned with the doorway', () => {
    const gate = leafPose(door({ kind: 'portcullis', yaw: 180 }), 0.5);
    expect(gate.position).toEqual({ x: 0, y: 1.1, z: 0 });
    expect(gate.rotation.y).toBeCloseTo(1);
    expect(leafPose(door({ kind: 'sliding' }), 0.5).position.x).toBeCloseTo(-0.6);
  });
});
