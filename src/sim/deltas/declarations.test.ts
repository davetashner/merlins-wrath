// Persistence declarations (mw-e27.3): plain-data equality and the property diff's edge cases.
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { addProperties, getProperty, registerWorldProperties } from '../properties/components';
import { propertyPersistence, samePlain } from './declarations';

describe('persistence declarations', () => {
  it('compares plain data field by field', () => {
    expect(samePlain({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(samePlain(Number.NaN, Number.NaN)).toBe(true);
    expect(samePlain(0, -0)).toBe(false);
    expect(samePlain([1], { 0: 1 })).toBe(false);
    expect(samePlain({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(samePlain({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(samePlain({ a: 1 }, null)).toBe(false);
    expect(samePlain('a', { a: 1 })).toBe(false);
  });

  it('diffs properties against a missing baseline, and copies record values', () => {
    const declaration = propertyPersistence();
    expect(declaration.diff(undefined, { hp: 3 })).toEqual({ hp: 3 });
    expect(declaration.diff({ hp: 3 }, undefined)).toBeUndefined();
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    const entity = world.spawn();
    addProperties(world, entity, { toughness: { blunt: 40 } });
    const state = declaration.capture(world, entity);
    expect(state).toEqual({ toughness: { blunt: 40 } });
    expect(state?.['toughness']).not.toBe(getProperty(world, entity, 'toughness'));
  });

  it('applies properties in a world without physics', () => {
    const declaration = propertyPersistence();
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    const entity = world.spawn();
    expect(declaration.apply(world, entity, { burning: true })).toBe(true);
    expect(getProperty(world, entity, 'burning')).toBe(true);
  });
});
