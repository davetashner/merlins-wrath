// Fact migrations (mw-e27.4): former keys declared with `renamedFrom`, removed facts and values that
// no longer fit, applied to saved facts before they reach the store.
import { describe, expect, it } from 'vitest';
import { migrateFacts } from './migrate';
import { FactDeclarationError, FactStore, type FactSpec } from './store';

const store = (): FactStore => new FactStore({ emit: () => undefined, tick: () => 0 });

describe('renamedFrom declarations', () => {
  it('maps former keys and former templates to the current key', () => {
    const facts = store()
      .declare('door.cellar.open', {
        type: 'bool',
        renamedFrom: ['cellar_door_open', 'cellar.open'],
      })
      .declare('entity:*.emptied', { type: 'bool', renamedFrom: ['entity:*.looted'] })
      .declare('entity:mine/chest-1.looted', { type: 'bool' });
    expect(facts.spec('door.cellar.open')).toEqual({
      type: 'bool',
      renamedFrom: ['cellar_door_open', 'cellar.open'],
    });
    expect(Object.isFrozen(facts.spec('door.cellar.open')?.renamedFrom)).toBe(true);
    expect(
      [
        'cellar_door_open',
        'cellar.open',
        'door.cellar.open',
        'entity:mine/chest-3.looted',
        'entity:mine/chest-1.looted',
        'entity:mine/chest-3.opened',
        'unrelated',
      ].map((key) => facts.currentKey(key)),
    ).toEqual([
      'door.cellar.open',
      'door.cellar.open',
      'door.cellar.open',
      'entity:mine/chest-3.emptied',
      'entity:mine/chest-1.looted',
      'entity:mine/chest-3.opened',
      'unrelated',
    ]);
    expect(store().declare('a', { type: 'int', renamedFrom: [] }).spec('a')).toEqual({
      type: 'int',
    });
  });

  it('rejects former keys that are malformed or ambiguous', () => {
    const errorOf = (declare: (facts: FactStore) => void): string => {
      try {
        declare(store().declare('taken', { type: 'bool', renamedFrom: ['old.taken'] }));
      } catch (error) {
        expect(error).toBeInstanceOf(FactDeclarationError);
        return (error as Error).message;
      }
      return 'declared';
    };
    const spec = (renamedFrom: string[]): FactSpec => ({ type: 'bool', renamedFrom });
    expect(
      [
        (f: FactStore) => f.declare('a', spec([''])),
        (f: FactStore) => f.declare('a', spec(['a'])),
        (f: FactStore) => f.declare('a', spec(['entity:*.a'])),
        (f: FactStore) => f.declare('entity:*.a', spec(['old-a'])),
        (f: FactStore) => f.declare('a', spec(['taken'])),
        (f: FactStore) => f.declare('a', spec(['old.taken'])),
        (f: FactStore) => f.declare('a', spec(['x', 'x'])),
        (f: FactStore) => f.declare('old.taken', { type: 'bool' }),
        (f: FactStore) => f.declare('a', spec(['b'])).declare('b', { type: 'int' }),
      ].map(errorOf),
    ).toEqual([
      'fact "a": renamedFrom "" must be a non-empty string other than the key',
      'fact "a": renamedFrom "a" must be a non-empty string other than the key',
      'fact "a": renamedFrom "entity:*.a" must not be a template',
      'fact "entity:*.a": renamedFrom "old-a" must be a template, as the key is',
      'fact "a": renamedFrom "taken" is still declared',
      'fact "a": renamedFrom "old.taken" is claimed twice',
      'fact "a": renamedFrom "x" is claimed twice',
      'fact "old.taken": is a former key of "taken"',
      'fact "b": is a former key of "a"',
    ]);
  });
});

describe('restoreProblem', () => {
  it('accepts what a restore takes and says why it would refuse the rest', () => {
    const facts = store().declare('gate.open', { type: 'bool' });
    expect(facts.restoreProblem('gate.open', true)).toBeUndefined();
    expect(facts.restoreProblem('gate.open', 3)).toBe('invalid');
    expect(facts.restoreProblem('Bad Key', true)).toBe('invalid');
    expect(facts.restoreProblem('loose.fact', 'x')).toBeUndefined();
    expect(facts.restoreProblem('loose.fact', '')).toBe('invalid');
    facts.setUndeclaredPolicy({ mode: 'throw' });
    expect(facts.restoreProblem('loose.fact', 'x')).toBe('undeclared');
    expect(facts.restoreProblem('gate.open', false)).toBeUndefined();
  });
});

describe('migrateFacts', () => {
  it('renames former keys, keeps current ones and drops what no longer fits', () => {
    const facts = store()
      .declare('door.cellar.open', { type: 'bool', renamedFrom: ['cellar_door_open'] })
      .declare('bell.rung', { type: 'int', renamedFrom: ['bell_rings', 'bells'] })
      .declare('horn.fate', { type: 'enum', values: ['alive', 'dead'] })
      .setUndeclaredPolicy({ mode: 'ignore', warn: () => undefined });
    const migration = migrateFacts(facts, {
      cellar_door_open: true,
      'bell.rung': 4,
      bell_rings: 2,
      bells: 9,
      'horn.fate': 'missing',
      'removed.fact': 1,
    });
    expect(migration).toEqual({
      facts: { 'door.cellar.open': true, 'bell.rung': 4 },
      renamed: [{ from: 'cellar_door_open', to: 'door.cellar.open' }],
      dropped: [
        { key: 'bell_rings', value: 2, reason: 'superseded' },
        { key: 'bells', value: 9, reason: 'superseded' },
        { key: 'horn.fate', value: 'missing', reason: 'invalid' },
        { key: 'removed.fact', value: 1, reason: 'undeclared' },
      ],
    });
    expect(Object.keys(migration.facts)).toEqual(['bell.rung', 'door.cellar.open']);
    // The migrated facts restore cleanly, and migrating them again changes nothing.
    facts.prepareRestore(migration.facts)();
    expect(migrateFacts(facts, facts.snapshot())).toEqual({
      facts: migration.facts,
      renamed: [],
      dropped: [],
    });
  });
});
