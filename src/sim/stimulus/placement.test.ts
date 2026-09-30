import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  boundingSphereOf,
  PlacementCentreComponent,
  PlacementComponent,
  placeEntity,
  placementOf,
  setPlacementCentre,
  validatePlacement,
} from './placement';

const world = () =>
  new World<string>({ seed: 1 }).register(PlacementComponent, PlacementCentreComponent);

describe('placement', () => {
  it('validates untyped placements', () => {
    expect(validatePlacement({ x: 1, y: 2, z: 3, radius: 0 })).toBeUndefined();
    expect(validatePlacement(null)).toMatch(/must be an object/);
    expect(validatePlacement(3)).toMatch(/must be an object/);
    expect(validatePlacement({ x: 1, y: 2, z: '3', radius: 0 })).toMatch(/placement.z/);
    expect(validatePlacement({ x: Number.NaN, y: 2, z: 3, radius: 0 })).toMatch(/placement.x/);
    expect(validatePlacement({ x: 1, y: Infinity, z: 3, radius: 0 })).toMatch(/placement.y/);
    expect(validatePlacement({ x: 1, y: 2, z: 3 })).toMatch(/placement.radius must be a finite/);
    expect(validatePlacement({ x: 1, y: 2, z: 3, radius: -1 })).toMatch(/radius must be ≥ 0/);
  });

  it('places, moves and reads an entity, frozen', () => {
    const w = world();
    const id = w.spawn();
    expect(placementOf(w, id)).toBeUndefined();
    placeEntity(w, id, { x: 1, y: 2, z: 3 });
    expect(placementOf(w, id)).toEqual({ x: 1, y: 2, z: 3, radius: 0 });
    placeEntity(w, id, { x: 4, y: 5, z: 6 }, 0.5);
    expect(placementOf(w, id)).toEqual({ x: 4, y: 5, z: 6, radius: 0.5 });
    expect(Object.isFrozen(placementOf(w, id))).toBe(true);
    expect(() => {
      placeEntity(w, id, { x: 0, y: 0, z: 0 }, -1);
    }).toThrow(RangeError);
  });

  it('round-trips through a snapshot and rejects invalid saved data', () => {
    const w = world();
    placeEntity(w, w.spawn(), { x: 1, y: 2, z: 3 }, 1);
    const copy = world();
    copy.restore(w.snapshot());
    expect(copy.snapshot()).toEqual(w.snapshot());
    const bad = { ...w.snapshot(), components: { 'spatial.placement': [[1, { x: 1 }]] } };
    expect(() => {
      copy.restore(bad as never);
    }).toThrow(/placement.y/);
  });
});

describe('placement centre (mw-e04.34)', () => {
  it('moves the sphere stimuli reach off a frame-origin placement, validated and frozen', () => {
    const w = world();
    const feet = { x: 1, y: 2, z: 3, radius: 0.35 };
    const id = w.spawn();
    expect(boundingSphereOf(w, id, feet)).toBe(feet);
    setPlacementCentre(w, id, { x: 0, y: 0.9, z: 0 }, 0.9);
    expect(boundingSphereOf(w, id, feet)).toEqual({ x: 1, y: 2.9, z: 3, radius: 0.9 });
    setPlacementCentre(w, id, { x: 0, y: 0.5, z: 0 }, 0.5);
    expect(w.get(id, PlacementCentreComponent)).toEqual({
      offset: { x: 0, y: 0.5, z: 0 },
      radius: 0.5,
    });
    expect(Object.isFrozen(w.get(id, PlacementCentreComponent)?.offset)).toBe(true);
    expect(() => {
      setPlacementCentre(w, id, { x: 0, y: Number.NaN, z: 0 }, 1);
    }).toThrow(/centre.y/);
    expect(() => {
      setPlacementCentre(w, id, { x: 0, y: 0, z: 0 }, -1);
    }).toThrow(/radius must be ≥ 0/);
  });

  it('round-trips through a snapshot and rejects invalid saved data', () => {
    const w = world();
    setPlacementCentre(w, w.spawn(), { x: 0, y: 0.9, z: 0 }, 0.9);
    const copy = world();
    copy.restore(w.snapshot());
    expect(copy.snapshot()).toEqual(w.snapshot());
    for (const value of [null, { radius: 1 }, { offset: { x: 1, y: 1, z: 1 } }]) {
      const bad = { ...w.snapshot(), components: { 'spatial.centre': [[1, value]] } };
      expect(() => {
        copy.restore(bad as never);
      }).toThrow(/centre\./);
    }
  });
});
