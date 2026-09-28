import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { PlacementComponent, placeEntity, placementOf, validatePlacement } from './placement';

const world = () => new World<string>({ seed: 1 }).register(PlacementComponent);

describe('placement', () => {
  it('validates untyped placements', () => {
    expect(validatePlacement({ x: 1, y: 2, z: 3, radius: 0 })).toBeUndefined();
    expect(validatePlacement(null)).toMatch(/must be an object/);
    expect(validatePlacement(3)).toMatch(/must be an object/);
    expect(validatePlacement({ x: 1, y: 2, z: '3', radius: 0 })).toMatch(/placement.z/);
    expect(validatePlacement({ x: Number.NaN, y: 2, z: 3, radius: 0 })).toMatch(/placement.x/);
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
