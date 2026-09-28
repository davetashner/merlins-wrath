import { SAVE_FORMAT_VERSION, SAVE_SCHEMA_VERSION, SaveRegistry } from '@game/save/format';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  checkSchemaLock,
  fingerprintSection,
  LOCK_COMMENT,
  matchesLatest,
  parseLock,
  schemaStateOf,
  serializeLock,
  versionChanges,
  type SchemaLock,
  type SchemaState,
} from './schema-lock';

const section = (id: string, version: number, schema: z.ZodType) => ({
  id,
  version,
  schema,
  ...(version > 1 && { migrations: { [version - 1]: (data: unknown) => data } }),
  serialize: () => ({}),
  deserialize: () => undefined,
});

const inventoryV1 = z.strictObject({ items: z.array(z.string()) });
/** The same section with a field added — and the version forgotten. */
const inventoryV1Edited = z.strictObject({ items: z.array(z.string()), gold: z.number() });

function registryWith(...sections: ReturnType<typeof section>[]): SaveRegistry {
  const registry = new SaveRegistry();
  for (const s of sections) registry.register(s);
  return registry;
}

/** A lock whose only revision is `state`, with every fixture directory present. */
function lockOf(...states: SchemaState[]): SchemaLock {
  return { revisions: states.map((state, i) => ({ revision: i + 1, ...state })) };
}

const dirsFor = (lock: SchemaLock): Record<string, number> =>
  Object.fromEntries(lock.revisions.map(({ revision }) => [String(revision), 3]));

describe('fingerprintSection', () => {
  it('is stable, ignores field order and changes when a field is added', () => {
    const a = fingerprintSection({ id: 'x', schema: z.object({ a: z.number(), b: z.string() }) });
    const reordered = fingerprintSection({
      id: 'x',
      schema: z.object({ b: z.string(), a: z.number() }),
    });
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reordered).toBe(a);
    const enums = (values: [string, ...string[]]) =>
      fingerprintSection({ id: 'x', schema: z.enum(values) });
    expect(enums(['c', 'a', 'b'])).toBe(enums(['b', 'c', 'a']));
    expect(fingerprintSection({ id: 'x', schema: inventoryV1 })).not.toBe(
      fingerprintSection({ id: 'x', schema: inventoryV1Edited }),
    );
  });

  it('keeps meaningful array order (tuples) significant', () => {
    const tuple = (schema: z.ZodType) => fingerprintSection({ id: 'x', schema });
    expect(tuple(z.tuple([z.number(), z.string()]))).not.toBe(
      tuple(z.tuple([z.string(), z.number()])),
    );
  });

  it('names the section when its schema has no JSON Schema form', () => {
    expect(() => fingerprintSection({ id: 'odd', schema: z.custom(() => true) })).toThrow(
      /save section "odd" schema cannot be fingerprinted/,
    );
  });
});

describe('schemaStateOf', () => {
  it('records the envelope versions and each section, world first', () => {
    const state = schemaStateOf(registryWith(section('inventory', 2, inventoryV1)));
    expect(state.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(state.saveSchemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(Object.keys(state.sections)).toEqual(['world', 'inventory']);
    expect(state.sections['inventory']?.version).toBe(2);
  });
});

describe('checkSchemaLock', () => {
  const locked = schemaStateOf(registryWith(section('inventory', 1, inventoryV1)));
  const lock = lockOf(locked);

  it('passes when the build matches the newest revision and every revision has fixtures', () => {
    expect(checkSchemaLock(locked, lock, dirsFor(lock))).toEqual([]);
    expect(matchesLatest(locked, lock)).toBe(true);
  });

  it('AC-2: a field added without a version bump fails naming the section and the fix', () => {
    const edited = schemaStateOf(registryWith(section('inventory', 1, inventoryV1Edited)));
    const problems = checkSchemaLock(edited, lock, dirsFor(lock));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('unversioned-change');
    const message = problems[0]?.message ?? '';
    expect(message).toContain('save section "inventory" schema changed');
    expect(message).toContain("Bump the section's version to 2");
    expect(message).toContain('add migrations[1] (v1 → v2)');
    expect(message).toContain('pnpm save:fixture');
    expect(matchesLatest(edited, lock)).toBe(false);
  });

  it('AC-2: reverting to an older version number with a new schema also fails', () => {
    const v2 = schemaStateOf(registryWith(section('inventory', 2, inventoryV1Edited)));
    const history = lockOf(locked, v2);
    const sneaky = schemaStateOf(registryWith(section('inventory', 1, inventoryV1Edited)));
    const kinds = checkSchemaLock(sneaky, history, dirsFor(history)).map((p) => p.kind);
    expect(kinds).toEqual(['unversioned-change', 'version-regressed', 'stale-lock']);
  });

  it('AC-3: a version bump without a new fixture revision fails', () => {
    const bumped = schemaStateOf(registryWith(section('inventory', 2, inventoryV1Edited)));
    const problems = checkSchemaLock(bumped, lock, dirsFor(lock));
    expect(problems.map((p) => p.kind)).toEqual(['stale-lock']);
    expect(problems[0]?.message).toContain('(inventory v1 → v2)');
    expect(problems[0]?.message).toContain('pnpm save:fixture to commit tests/save-fixtures/2/');
  });

  it('AC-3: a newly registered section needs a new fixture revision', () => {
    const added = schemaStateOf(
      registryWith(section('inventory', 1, inventoryV1), section('quests', 1, inventoryV1)),
    );
    const problems = checkSchemaLock(added, lock, dirsFor(lock));
    expect(problems.map((p) => p.kind)).toEqual(['stale-lock']);
    expect(problems[0]?.message).toContain('(quests added at v1)');
  });

  it('AC-3: a revision recorded in the lock without its fixture directory fails', () => {
    const bumped = schemaStateOf(registryWith(section('inventory', 2, inventoryV1Edited)));
    const history = lockOf(locked, bumped);
    const problems = checkSchemaLock(bumped, history, { '1': 3 });
    expect(problems.map((p) => p.kind)).toEqual(['fixtures-missing']);
    expect(problems[0]?.message).toContain('tests/save-fixtures/2/ has no fixtures');
    expect(checkSchemaLock(bumped, history, { '1': 3, '2': 0 })).toHaveLength(1);
  });

  it('fails for an empty lock, stray fixture directories and misnumbered revisions', () => {
    expect(checkSchemaLock(locked, { revisions: [] }, {}).map((p) => p.kind)).toEqual([
      'stale-lock',
    ]);
    expect(checkSchemaLock(locked, lock, { '1': 3, '9': 1 }).map((p) => p.message)).toEqual([
      expect.stringContaining('tests/save-fixtures/9/ is not a revision'),
    ]);
    const misnumbered: SchemaLock = { revisions: [{ revision: 2, ...locked }] };
    expect(checkSchemaLock(locked, misnumbered, { '2': 1 }).map((p) => p.kind)).toEqual([
      'revision-order',
    ]);
  });

  it('reports lowered format, envelope and section versions', () => {
    const lowered: SchemaState = {
      formatVersion: 1,
      saveSchemaVersion: 1,
      sections: { world: { version: 1, fingerprint: 'sha256:0' } },
    };
    const newer = lockOf({
      formatVersion: 2,
      saveSchemaVersion: 3,
      sections: { world: { version: 2, fingerprint: 'sha256:1' } },
    });
    const messages = checkSchemaLock(lowered, newer, dirsFor(newer))
      .filter((p) => p.kind === 'version-regressed')
      .map((p) => p.message);
    expect(messages).toEqual([
      'save format is at version 1 but revision 1 locked version 2; versions never go down.',
      'save envelope is at version 1 but revision 1 locked version 3; versions never go down.',
      'save section "world" is at version 1 but revision 1 locked version 2; versions never go down.',
    ]);
  });
});

describe('versionChanges', () => {
  it('lists format, envelope, added, bumped and removed sections', () => {
    const from: SchemaState = {
      formatVersion: 1,
      saveSchemaVersion: 1,
      sections: {
        world: { version: 1, fingerprint: 'a' },
        quests: { version: 1, fingerprint: 'b' },
      },
    };
    const to: SchemaState = {
      formatVersion: 2,
      saveSchemaVersion: 2,
      sections: {
        world: { version: 2, fingerprint: 'c' },
        inventory: { version: 1, fingerprint: 'd' },
        facts: { version: 1, fingerprint: 'e' },
      },
    };
    expect(versionChanges(from, to)).toEqual([
      'format v1 → v2',
      'envelope v1 → v2',
      'facts added at v1',
      'inventory added at v1',
      'world v1 → v2',
      'quests removed',
    ]);
    expect(versionChanges(from, from)).toEqual([]);
    expect(matchesLatest(to, { revisions: [] })).toBe(false);
  });
});

describe('lock file', () => {
  it('round-trips through its stable text form with sorted sections and the comment', () => {
    const lock = lockOf(schemaStateOf(registryWith(section('inventory', 1, inventoryV1))));
    const text = serializeLock(lock);
    expect(text.endsWith('\n')).toBe(true);
    const data = JSON.parse(text) as { $comment: string; revisions: { sections: object }[] };
    expect(data.$comment).toBe(LOCK_COMMENT);
    expect(Object.keys(data.revisions[0]?.sections ?? {})).toEqual(['inventory', 'world']);
    expect(parseLock(data)).toEqual(lock);
  });

  it('rejects malformed locks with the issues', () => {
    expect(() => parseLock({ revisions: [{ revision: 0 }] })).toThrow(
      /save schema lock is malformed: revisions\.0\.revision/,
    );
    expect(() => parseLock([])).toThrow(/\(root\)/);
  });
});
