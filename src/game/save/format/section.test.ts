// Section definitions, the per-section migration runner and post-migration validation.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MissingMigrationError,
  SaveFromNewerBuildError,
  SaveMigrationError,
  SaveSectionInvalidError,
} from './errors';
import { defineSaveSection, migrateSection, validateSection, type SaveSection } from './section';

const base: SaveSection<{ n: number }> = {
  id: 'counter',
  version: 3,
  schema: z.object({ n: z.number() }),
  serialize: () => ({ n: 0 }),
  deserialize: () => undefined,
};

describe('defineSaveSection', () => {
  it('returns a frozen copy of a valid definition', () => {
    const section = defineSaveSection({ ...base, migrations: { 1: (d) => d, 2: (d) => d } });
    expect(Object.isFrozen(section)).toBe(true);
    expect(section.id).toBe('counter');
  });

  it.each(['world-facts', 'inventory.quick-slots', 'q2'])('accepts id %s', (id) => {
    expect(defineSaveSection({ ...base, id }).id).toBe(id);
  });

  it.each(['', 'Inventory', '2x', 'a..b', 'a-', 'a b'])('rejects id %j', (id) => {
    expect(() => defineSaveSection({ ...base, id })).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, NaN])('rejects version %s', (version) => {
    expect(() => defineSaveSection({ ...base, version })).toThrow(/positive integer/);
  });

  it.each(['0', '3', '1.5', 'x'])('rejects migration key %s for a v3 section', (key) => {
    const migrations = { [key]: (d: unknown) => d } as Record<number, (d: unknown) => unknown>;
    expect(() => defineSaveSection({ ...base, migrations })).toThrow(/in \[1, 2\]/);
  });
});

describe('migrateSection', () => {
  it('AC-2: runs migrations 1→2 then 2→3 in order', () => {
    const calls: string[] = [];
    const section = {
      ...base,
      migrations: {
        2: (d: unknown) => {
          calls.push('2→3');
          return { n: (d as { count: number }).count };
        },
        1: (d: unknown) => {
          calls.push('1→2');
          return { count: (d as { value: number }).value * 10 };
        },
      },
    };
    const result = migrateSection(section, { version: 1, data: { value: 4 } });
    expect(calls).toEqual(['1→2', '2→3']);
    expect(result).toEqual({ ok: true, data: { n: 40 } });
    expect(result.ok && validateSection(section, result.data)).toEqual({
      ok: true,
      data: { n: 40 },
    });
  });

  it('passes current-version data through untouched, with or without migrations', () => {
    const data = { n: 1 };
    expect(migrateSection(base, { version: 3, data })).toEqual({ ok: true, data });
  });

  it('AC-5: reports the missing step (v1 data, only 2→3 registered) before running any step', () => {
    let ran = false;
    const section = {
      ...base,
      migrations: {
        2: (d: unknown) => {
          ran = true;
          return d;
        },
      },
    };
    const result = migrateSection(section, { version: 1, data: {} });
    expect(ran).toBe(false);
    expect(result.ok).toBe(false);
    const error = !result.ok && result.error;
    expect(error).toBeInstanceOf(MissingMigrationError);
    expect(error).toMatchObject({ section: 'counter', from: 1, to: 2 });
  });

  it('refuses data from a newer section version', () => {
    const result = migrateSection(base, { version: 4, data: {} });
    const error = !result.ok && result.error;
    expect(error).toBeInstanceOf(SaveFromNewerBuildError);
    expect(error).toMatchObject({ part: 'section', section: 'counter', found: 4, supported: 3 });
  });

  it('names the step whose migration threw', () => {
    const boom = new Error('boom');
    const section = {
      ...base,
      migrations: {
        1: (d: unknown) => d,
        2: () => {
          throw boom;
        },
      },
    };
    const result = migrateSection(section, { version: 1, data: {} });
    const error = !result.ok && result.error;
    expect(error).toBeInstanceOf(SaveMigrationError);
    expect(error).toMatchObject({ section: 'counter', from: 2, to: 3, cause: boom });
  });
});

describe('validateSection', () => {
  it("returns the schema's output", () => {
    const section = { ...base, schema: z.object({ n: z.number().default(7) }) };
    expect(validateSection(section, {})).toEqual({ ok: true, data: { n: 7 } });
  });

  it('lists schema issues with their paths', () => {
    const result = validateSection(base, { n: 'x' });
    const error = !result.ok && result.error;
    expect(error).toBeInstanceOf(SaveSectionInvalidError);
    expect(error).toMatchObject({ section: 'counter', version: 3 });
    expect((error as SaveSectionInvalidError).issues[0]).toMatch(/^n: /);
  });

  it('labels issues on the data itself as (root)', () => {
    const result = validateSection(base, null);
    expect(result.ok ? undefined : result.error).toMatchObject({
      issues: [expect.stringMatching(/^\(root\): /)],
    });
  });
});
