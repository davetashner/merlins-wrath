import { describe, expect, expectTypeOf, it } from 'vitest';
import { World } from '../core/world';
import { Rng } from '../rng';
import { hashWorld } from '../snapshot';
import {
  addProperties,
  assignProperty,
  entitiesWithProperty,
  forEachWithProperty,
  getProperty,
  hasProperty,
  propertyChanged,
  readProperty,
  registerWorldProperties,
  removeProperty,
  setProperty,
  WorldProperties,
  type PropertyChange,
  type WorldPropertyInit,
} from './components';
import { WORLD_PROPERTY_KEYS, type WorldPropertyKey } from './spec';

const world = (seed = 1) => registerWorldProperties(new World<string>({ seed }));

/** A world with one entity holding `init`. */
function withEntity(init: WorldPropertyInit) {
  const w = world();
  const id = w.spawn();
  addProperties(w, id, init);
  return { w, id };
}

function recordChanges(w: World<string>): PropertyChange[] {
  const seen: PropertyChange[] = [];
  w.events.on(propertyChanged, (change) => seen.push(change));
  return seen;
}

describe('world property components', () => {
  it('one component per property, named property.<key>', () => {
    const names = WORLD_PROPERTY_KEYS.map((key) => WorldProperties[key].name);
    expect(names).toEqual(WORLD_PROPERTY_KEYS.map((key) => `property.${key}`));
    expect(Object.isFrozen(WorldProperties)).toBe(true);
    expectTypeOf(WorldProperties.wetness).toEqualTypeOf<
      import('../core/component').ComponentType<number>
    >();
  });

  it('registers every property with a world, once', () => {
    const w = world();
    const id = w.spawn();
    expect(hasProperty(w, id, 'wetness')).toBe(false);
    expect(() => registerWorldProperties(w)).toThrow(/already registered/);
  });

  it('reads stored values, falling back to the default when absent', () => {
    const { w, id } = withEntity({ wetness: 0.3, material: 'dry-wood' });
    expect(getProperty(w, id, 'wetness')).toBe(0.3);
    expect(getProperty(w, id, 'temperature')).toBeUndefined();
    expect(readProperty(w, id, 'temperature')).toBe(20);
    expect(readProperty(w, id, 'material')).toBe('dry-wood');
    expect(hasProperty(w, id, 'material')).toBe(true);
  });

  it('removing a property makes it read its default again', () => {
    const { w, id } = withEntity({ wetness: 0.3 });
    removeProperty(w, id, 'wetness');
    expect(hasProperty(w, id, 'wetness')).toBe(false);
    expect(readProperty(w, id, 'wetness')).toBe(0);
  });

  it('addProperties validates every value first and adds nothing on failure', () => {
    const w = world();
    const id = w.spawn();
    expect(() => {
      addProperties(w, id, { temperature: 50, wetness: 1.4 });
    }).toThrow(new RangeError('wetness must be ≤ 1, got 1.4'));
    expect(hasProperty(w, id, 'temperature')).toBe(false);
    expect(() => {
      addProperties(w, id, { wet: 1 } as unknown as WorldPropertyInit);
    }).toThrow(new RangeError('unknown world property "wet"'));
  });

  it('addProperties during a step lands at the end of the tick, with no events', () => {
    const w = world();
    const id = w.spawn();
    const seen = recordChanges(w);
    const during: boolean[] = [];
    w.addSystem({
      name: 'ignite',
      run: ({ world: self }) => {
        addProperties(self, id, { burning: true });
        during.push(hasProperty(self, id, 'burning'));
      },
    });
    w.step();
    expect(during).toEqual([false]);
    expect(readProperty(w, id, 'burning')).toBe(true);
    expect(seen).toEqual([]);
  });

  it('stores records as frozen copies, never the caller’s object', () => {
    const light = { intensity: 100, radius: 8 };
    const { w, id } = withEntity({ lightEmitter: light });
    const stored = getProperty(w, id, 'lightEmitter');
    expect(stored).toEqual(light);
    expect(stored).not.toBe(light);
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it('AC-2: a changing write fires exactly one propertyChanged with old and new values', () => {
    const { w, id } = withEntity({ wetness: 0.2 });
    const seen = recordChanges(w);
    expect(setProperty(w, id, 'wetness', 0.9)).toBe(true);
    expect(readProperty(w, id, 'wetness')).toBe(0.9); // the value itself is immediate
    expect(seen).toEqual([]); // events are delivered at the next phase boundary
    w.events.flush();
    expect(seen).toEqual([{ entity: id, key: 'wetness', old: 0.2, new: 0.9, source: null }]);
  });

  it('AC-2: writing the value a property already has fires nothing', () => {
    const { w, id } = withEntity({ wetness: 0.2, lightEmitter: { intensity: 5, radius: 2 } });
    const seen = recordChanges(w);
    expect(setProperty(w, id, 'wetness', 0.2)).toBe(false);
    expect(setProperty(w, id, 'lightEmitter', { intensity: 5, radius: 2 })).toBe(false);
    w.events.flush();
    expect(seen).toEqual([]);
  });

  it('mw-e03.31: partial records compare by their fields, including which fields they have', () => {
    const { w, id } = withEntity({ toughness: { blunt: 200 } });
    const seen = recordChanges(w);
    expect(setProperty(w, id, 'toughness', { blunt: 200 })).toBe(false);
    expect(setProperty(w, id, 'toughness', { blunt: 200, slash: 800 })).toBe(true);
    expect(setProperty(w, id, 'toughness', { blunt: 200 })).toBe(true);
    w.events.flush();
    expect(seen.map((change) => change.new)).toEqual([{ blunt: 200, slash: 800 }, { blunt: 200 }]);
  });

  it('AC-2: inside a step, each changing write is delivered once after the writing system', () => {
    const { w, id } = withEntity({ temperature: 20, lightEmitter: { intensity: 5, radius: 2 } });
    const seen = recordChanges(w);
    const source = w.spawn();
    w.addSystem({
      name: 'heat',
      run: ({ world: self }) => {
        setProperty(self, id, 'temperature', 80, { source });
        setProperty(self, id, 'temperature', 80, { source }); // unchanged: no event
        setProperty(self, id, 'lightEmitter', { intensity: 5, radius: 3 });
      },
    });
    w.step();
    expect(seen).toEqual([
      { entity: id, key: 'temperature', old: 20, new: 80, source },
      {
        entity: id,
        key: 'lightEmitter',
        old: { intensity: 5, radius: 2 },
        new: { intensity: 5, radius: 3 },
        source: null,
      },
    ]);
  });

  it('setProperty rejects invalid values and missing properties without changing anything', () => {
    const { w, id } = withEntity({ wetness: 0.2 });
    const seen = recordChanges(w);
    expect(() => setProperty(w, id, 'wetness', 1.4)).toThrow(RangeError);
    expect(() => setProperty(w, id, 'frozen', true)).toThrow(
      `entity ${String(id)} has no "frozen" property to set`,
    );
    w.events.flush();
    expect(seen).toEqual([]);
    expect(readProperty(w, id, 'wetness')).toBe(0.2);
  });

  it('AC-4: entities with a property iterate by ascending id, stable across runs', () => {
    const run = (shuffleSeed: number) => {
      const w = world();
      const ids = Array.from({ length: 1000 }, () => w.spawn());
      // Give the property in random order, and churn some of it, so store order is scrambled.
      const order = Rng.create(shuffleSeed).shuffle(ids);
      for (const id of order) addProperties(w, id, { flammable: true });
      for (const id of order.slice(0, 100)) removeProperty(w, id, 'flammable');
      for (const id of order.slice(0, 50)) addProperties(w, id, { flammable: true });
      const visited: number[] = [];
      forEachWithProperty(w, 'flammable', (id, value) => {
        if (value) visited.push(id);
      });
      return { ids: [...entitiesWithProperty(w, 'flammable')], visited };
    };
    const a = run(1);
    const b = run(2);
    expect(a.ids).toHaveLength(950);
    expect(a.ids).toEqual([...a.ids].sort((x, y) => x - y));
    expect(a.visited).toEqual(a.ids);
    expect(run(1)).toEqual(a);
    // A different creation order leaves a different subset but the same ascending order rule.
    expect(b.ids).toEqual([...b.ids].sort((x, y) => x - y));
  });

  it('snapshots and restores as plain data, and the state hash covers properties', () => {
    const { w, id } = withEntity({
      temperature: -5,
      frozen: true,
      lightEmitter: { intensity: 100, radius: 8 },
      owner: 'briar-glen-guild',
    });
    const snapshot = w.snapshot();
    expect(snapshot.components['property.lightEmitter']).toEqual([
      [id, { intensity: 100, radius: 8 }],
    ]);
    const before = hashWorld(w);
    setProperty(w, id, 'temperature', -6);
    expect(hashWorld(w)).not.toBe(before);

    const copy = world();
    copy.restore(snapshot);
    expect(hashWorld(copy)).toBe(before);
    expect(Object.isFrozen(getProperty(copy, id, 'lightEmitter'))).toBe(true);
  });

  it('restoring an invalid property value fails loudly', () => {
    const { w, id } = withEntity({ wetness: 0.5 });
    const snapshot = w.snapshot();
    const corrupt = {
      ...snapshot,
      components: { ...snapshot.components, 'property.wetness': [[id, 1.4]] as const },
    };
    expect(() => {
      world().restore(corrupt);
    }).toThrow(new RangeError('wetness must be ≤ 1, got 1.4'));
  });

  it('the change payload is typed per key', () => {
    expectTypeOf<Extract<PropertyChange, { key: 'wetness' }>['new']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<PropertyChange, { key: 'owner' }>['old']>().toEqualTypeOf<string>();
    expectTypeOf<PropertyChange['key']>().toEqualTypeOf<WorldPropertyKey>();
  });
});

describe('assignProperty', () => {
  it('sets an existing property at once, with one event and the source', () => {
    const { w, id } = withEntity({ burning: false });
    const seen = recordChanges(w);
    expect(assignProperty(w, id, 'burning', true, { source: 9 })).toBe(true);
    expect(readProperty(w, id, 'burning')).toBe(true);
    expect(assignProperty(w, id, 'burning', true)).toBe(false);
    w.events.flush();
    expect(seen).toEqual([{ entity: id, key: 'burning', old: false, new: true, source: 9 }]);
  });

  it('adds a missing property (deferred during a step) and still reports the change', () => {
    const w = world();
    const id = w.spawn();
    const seen = recordChanges(w);
    w.addSystem({
      name: 'ignite',
      run: ({ world: self }) => {
        assignProperty(self, id, 'burning', true);
        expect(hasProperty(self, id, 'burning')).toBe(false); // lands at the end of the tick
      },
    });
    w.step();
    expect(readProperty(w, id, 'burning')).toBe(true);
    expect(seen).toEqual([{ entity: id, key: 'burning', old: false, new: true, source: null }]);
  });

  it('adds a missing property equal to its default without an event', () => {
    const w = world();
    const id = w.spawn();
    const seen = recordChanges(w);
    expect(assignProperty(w, id, 'wetness', 0)).toBe(false);
    expect(hasProperty(w, id, 'wetness')).toBe(true);
    w.events.flush();
    expect(seen).toEqual([]);
  });
});
