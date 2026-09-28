import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  entityFactKey,
  factChanged,
  FactDeclarationError,
  FactKeyError,
  FactTypeError,
  isFactKey,
  type FactChange,
  type FactSpec,
} from './store';

/** A world with a recorder of every delivered factChanged event. */
function recorded(): { world: World; changes: FactChange[] } {
  const world = new World({ seed: 3 });
  const changes: FactChange[] = [];
  world.events.on(factChanged, (change) => changes.push(change));
  return { world, changes };
}

describe('fact store', () => {
  it('AC-1: set on an empty store is read back and fires one factChanged with old undefined', () => {
    const { world, changes } = recorded();
    expect(world.facts.set('door.cellar.opened', true)).toBe(true);
    expect(world.facts.get('door.cellar.opened')).toBe(true);
    expect(world.facts.has('door.cellar.opened')).toBe(true);
    world.events.flush();
    expect(changes).toEqual([
      { key: 'door.cellar.opened', old: undefined, new: true, source: null, tick: 0 },
    ]);
  });

  it('writes of an unchanged value do nothing; changes carry old, new, source and tick', () => {
    const { world, changes } = recorded();
    world.facts.set('bell.rung', false);
    expect(world.facts.set('bell.rung', false)).toBe(false);
    world.step();
    world.facts.set('bell.rung', true, { source: 7 });
    world.events.flush();
    expect(changes).toEqual([
      { key: 'bell.rung', old: undefined, new: false, source: null, tick: 0 },
      { key: 'bell.rung', old: false, new: true, source: 7, tick: 1 },
    ]);
  });

  it('AC-2: a transaction that sets 3 facts and then throws changes nothing and emits nothing', () => {
    const { world, changes } = recorded();
    world.facts.set('a.one', 1);
    world.events.flush();
    changes.length = 0;
    const boom = new Error('boom');
    expect(() =>
      world.facts.transaction(() => {
        world.facts.set('a.one', 2);
        world.facts.set('a.two', true);
        world.facts.set('a.three', 'miller');
        expect(world.facts.get('a.two')).toBe(true); // visible inside the batch
        throw boom;
      }),
    ).toThrow(boom);
    world.events.flush();
    expect(world.facts.entries()).toEqual([['a.one', 1]]);
    expect(changes).toEqual([]);
    expect(world.facts.size).toBe(1);
  });

  it('a committed transaction emits one event per net change, attributed to the last write', () => {
    const { world, changes } = recorded();
    world.facts.set('keep.same', 1);
    world.facts.set('flip.back', true);
    world.events.flush();
    changes.length = 0;
    const result = world.facts.transaction(() => {
      world.facts.set('new.fact', 1, { source: 1 });
      world.facts.set('new.fact', 2, { source: 2 });
      world.facts.set('flip.back', false);
      world.facts.set('flip.back', true); // back where it started: no event
      world.facts.increment('keep.same', 0);
      world.events.flush();
      expect(changes).toEqual([]); // held until commit
      return 'done';
    });
    expect(result).toBe('done');
    world.events.flush();
    expect(changes).toEqual([{ key: 'new.fact', old: undefined, new: 2, source: 2, tick: 0 }]);
  });

  it('a throwing inner transaction undoes only its own writes', () => {
    const { world, changes } = recorded();
    world.facts.transaction(() => {
      world.facts.set('outer.fact', true);
      expect(() =>
        world.facts.transaction(() => {
          world.facts.set('inner.fact', true);
          world.facts.set('outer.fact', false);
          throw new Error('inner');
        }),
      ).toThrow('inner');
      world.facts.transaction(() => world.facts.set('nested.ok', 1));
    });
    world.events.flush();
    expect(world.facts.snapshot()).toEqual({ 'nested.ok': 1, 'outer.fact': true });
    expect(changes.map((c) => c.key)).toEqual(['outer.fact', 'nested.ok']);
  });

  it('AC-3: facts inserted in different orders hash, snapshot and iterate identically', () => {
    const entries: [string, boolean | number | string][] = [
      ['quest.missing-miller.stage', 2],
      ['entity:mine/chest-3.looted', true],
      ['bell.rung-by', 'player'],
      ['z.last', false],
    ];
    const a = new World({ seed: 1 });
    const b = new World({ seed: 1 });
    for (const [key, value] of entries) a.facts.set(key, value);
    for (const [key, value] of [...entries].reverse()) b.facts.set(key, value);
    expect(a.facts.hash()).toBe(b.facts.hash());
    expect(a.facts.hash()).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.keys(a.facts.snapshot())).toEqual(Object.keys(b.facts.snapshot()));
    expect(a.facts.entries().map(([key]) => key)).toEqual([
      'bell.rung-by',
      'entity:mine/chest-3.looted',
      'quest.missing-miller.stage',
      'z.last',
    ]);
    expect(a.facts.entries('entity:mine/')).toEqual([['entity:mine/chest-3.looted', true]]);
    b.facts.set('z.last', true);
    expect(b.facts.hash()).not.toBe(a.facts.hash());
  });

  it('AC-4: a value of the wrong type throws FactTypeError and leaves the fact unchanged', () => {
    const { world, changes } = recorded();
    world.facts.set('door.cellar.opened', true);
    const write = () => world.facts.set('door.cellar.opened', 'open');
    expect(write).toThrow(FactTypeError);
    expect(write).toThrow('fact "door.cellar.opened" takes type bool, got "open"');
    expect(world.facts.get('door.cellar.opened')).toBe(true);
    expect(world.facts.typeOf('door.cellar.opened')).toBe('bool');
    world.events.flush();
    expect(changes).toHaveLength(1);
  });

  it('infers bool, int and id from the first value and rejects values no type takes', () => {
    const facts = new World({ seed: 1 }).facts;
    facts.set('a.bool', false);
    facts.set('a.int', -0);
    facts.set('a.id', 'miller');
    expect([facts.typeOf('a.bool'), facts.typeOf('a.int'), facts.typeOf('a.id')]).toEqual([
      'bool',
      'int',
      'id',
    ]);
    expect(Object.is(facts.get('a.int'), 0)).toBe(true); // -0 folded
    expect(facts.typeOf('never.set')).toBeUndefined();
    for (const bad of [1.5, Number.NaN, 2 ** 53, '', null, {}]) {
      expect(() => facts.set('a.new', bad as never)).toThrow(
        'takes a boolean, a safe integer or a non-empty string',
      );
    }
    expect(() => facts.set('a.int', 'x')).toThrow('got "x"');
    expect(() => facts.set('a.id', 3)).toThrow('got number 3');
  });

  it('rejects malformed keys', () => {
    const facts = new World({ seed: 1 }).facts;
    for (const key of [
      '',
      'Door.open',
      'door..open',
      'door.open.',
      'entity:mine.x',
      'a_b',
      'x y',
    ]) {
      expect(isFactKey(key)).toBe(false);
      expect(() => facts.set(key, true)).toThrow(FactKeyError);
    }
    expect(isFactKey('entity:mine/chest-3.looted')).toBe(true);
    expect(entityFactKey('mine', 'chest-3', 'looted')).toBe('entity:mine/chest-3.looted');
    expect(() => entityFactKey('Mine', 'chest', 'looted')).toThrow(FactKeyError);
    expect(new FactKeyError('x.Y')).toMatchObject({ key: 'x.Y', name: 'FactKeyError' });
  });

  it('declared facts enforce their type and read their default until set', () => {
    const facts = new World({ seed: 1 }).facts;
    facts
      .declare('miller.fate', {
        type: 'enum',
        values: ['missing', 'found', 'dead'],
        default: 'missing',
      })
      .declare('bell.last-rung', { type: 'tick' })
      .declare('guards.alerted', { type: 'int', default: 2 })
      .declare('thief.name', { type: 'id' })
      .declare('gate.open', { type: 'bool', default: false });
    expect(facts.get('miller.fate')).toBe('missing');
    expect(facts.has('miller.fate')).toBe(false);
    expect(facts.get('gate.open')).toBe(false);
    expect(facts.spec('miller.fate')).toEqual({
      type: 'enum',
      values: ['missing', 'found', 'dead'],
      default: 'missing',
    });
    expect(Object.isFrozen(facts.spec('miller.fate'))).toBe(true);
    expect(facts.typeOf('bell.last-rung')).toBe('tick');
    facts.set('miller.fate', 'found');
    expect(() => facts.set('miller.fate', 'eaten')).toThrow('takes type enum');
    expect(() => facts.set('bell.last-rung', -1)).toThrow('takes type tick');
    expect(() => facts.set('thief.name', '')).toThrow('takes type id');
    expect(facts.increment('guards.alerted')).toBe(3);
    expect(facts.get('miller.fate')).toBe('found');
  });

  it('rejects bad declarations', () => {
    const facts = new World({ seed: 1 }).facts;
    facts.declare('a.flag', { type: 'bool' });
    facts.set('a.count', 4);
    const cases: [string, FactSpec, string][] = [
      ['a.flag', { type: 'bool' }, 'is already declared'],
      ['a.odd', { type: 'float' } as unknown as FactSpec, 'unknown type "float"'],
      ['a.e1', { type: 'enum', values: [] }, 'enum values must be'],
      ['a.e2', { type: 'enum', values: ['x', 'x'] }, 'enum values must be'],
      ['a.e3', { type: 'enum', values: [''] }, 'enum values must be'],
      ['a.e4', { type: 'enum', values: ['x'], default: 'y' }, 'default "y" is not of type enum'],
      ['a.t', { type: 'tick', default: -1 }, 'is not of type tick'],
    ];
    for (const [key, spec, message] of cases) {
      expect(() => facts.declare(key, spec)).toThrow(FactDeclarationError);
      expect(() => facts.declare(key, spec)).toThrow(message);
    }
    expect(() => facts.declare('a.count', { type: 'bool' })).toThrow(FactTypeError);
    facts.declare('a.count', { type: 'int' }); // compatible with the value it holds
    expect(() => facts.declare('Bad', { type: 'bool' })).toThrow(FactKeyError);
  });

  it('increment counts from the default or 0 and guards its range and type', () => {
    const facts = new World({ seed: 1 }).facts;
    expect(facts.increment('rats.killed')).toBe(1);
    expect(facts.increment('rats.killed', 4, { source: 3 })).toBe(5);
    expect(facts.increment('rats.killed', -5)).toBe(0);
    expect(() => facts.increment('rats.killed', 0.5)).toThrow('safe integer');
    facts.set('rats.big', Number.MAX_SAFE_INTEGER);
    expect(() => facts.increment('rats.big')).toThrow('would leave the safe integer range');
    facts.set('rats.named', 'bob');
    expect(() => facts.increment('rats.named')).toThrow('takes type id, got number 1');
    facts.declare('rats.fate', { type: 'enum', values: ['alive'] });
    expect(() => facts.increment('rats.fate')).toThrow('takes type enum');
  });

  it('stamp writes the current sim tick', () => {
    const world = new World({ seed: 1 });
    world.facts.declare('bell.last-rung', { type: 'tick' });
    world.step();
    world.step();
    expect(world.facts.stamp('bell.last-rung')).toBe(true);
    expect(world.facts.get('bell.last-rung')).toBe(2);
  });

  it('restore validates every entry before replacing anything', () => {
    const world = new World({ seed: 1 });
    world.facts.declare('gate.open', { type: 'bool' });
    world.facts.set('keep.me', 1);
    expect(() => world.facts.prepareRestore({ 'gate.open': 1 })).toThrow(FactTypeError);
    expect(() => world.facts.prepareRestore({ 'x.y': 1.5 })).toThrow(FactTypeError);
    expect(() => world.facts.prepareRestore({ BAD: true })).toThrow(FactKeyError);
    expect(world.facts.snapshot()).toEqual({ 'keep.me': 1 });
    world.facts.prepareRestore({ 'gate.open': true, 'b.zero': -0 })();
    expect(world.facts.snapshot()).toEqual({ 'b.zero': 0, 'gate.open': true });
    expect(world.facts.spec('gate.open')).toEqual({ type: 'bool' }); // declarations survive
    expect(() => world.facts.transaction(() => world.facts.prepareRestore({}))).toThrow(
      'inside a transaction',
    );
  });
});
