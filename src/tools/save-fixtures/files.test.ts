import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveRegistry } from '@game/save/format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  checkSaveFixtures,
  generateSaveFixtures,
  listFixtures,
  loadFixtureFile,
  LOCK_PATH,
  readLock,
} from './files';
import type { FixtureWorld } from './fixtures';

const worlds: FixtureWorld[] = [
  { name: 'tiny', description: 'tiny', scenario: 'core', seed: 2, ticks: 5 },
];

/** The game registry plus an `inventory` section at `version` with the given item schema. */
function registry(version = 1, schema: z.ZodType = z.strictObject({ items: z.array(z.string()) })) {
  return new SaveRegistry().register({
    id: 'inventory',
    version,
    schema,
    migrations: Object.fromEntries(
      Array.from({ length: version - 1 }, (_, i) => [i + 1, (data: unknown) => data]),
    ),
    serialize: () => ({ items: [] }),
    deserialize: () => undefined,
  });
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'save-fixtures-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('save fixtures on disk', () => {
  it('starts from an empty lock and no fixture folders', () => {
    expect(readLock(root)).toEqual({ revisions: [] });
    expect(listFixtures(root)).toEqual({});
    expect(checkSaveFixtures(root, registry()).map((p) => p.kind)).toEqual(['stale-lock']);
  });

  it('lists only numbered revision folders and their .json files', () => {
    const dir = join(root, 'tests/save-fixtures');
    mkdirSync(join(dir, '1'), { recursive: true });
    mkdirSync(join(dir, 'notes'));
    writeFileSync(join(dir, '1', 'b.json'), '{}');
    writeFileSync(join(dir, '1', 'a.json'), '{}');
    writeFileSync(join(dir, '1', 'README'), '');
    writeFileSync(join(dir, 'save-schema.lock.json'), '{"revisions":[]}');
    expect(listFixtures(root)).toEqual({
      '1': ['tests/save-fixtures/1/a.json', 'tests/save-fixtures/1/b.json'],
    });
  });

  it('writes revision 1, is then up to date, and refills an emptied newest folder', () => {
    const first = generateSaveFixtures(root, registry(), worlds);
    expect(first).toEqual({
      status: 'written',
      revision: 1,
      files: ['tests/save-fixtures/1/tiny.json'],
    });
    expect(readLock(root).revisions).toHaveLength(1);
    expect(checkSaveFixtures(root, registry())).toEqual([]);
    expect(generateSaveFixtures(root, registry(), worlds)).toEqual({
      status: 'up-to-date',
      revision: 1,
    });
    const lock = readFileSync(join(root, LOCK_PATH), 'utf8');
    rmSync(join(root, 'tests/save-fixtures/1/tiny.json'));
    expect(generateSaveFixtures(root, registry(), worlds)).toMatchObject({ status: 'written' });
    expect(readFileSync(join(root, LOCK_PATH), 'utf8')).toBe(lock);
  });

  it('AC-3: a bumped section gets a new revision; old fixtures still load', () => {
    generateSaveFixtures(root, registry(), worlds);
    expect(checkSaveFixtures(root, registry(2)).map((p) => p.kind)).toEqual(['stale-lock']);
    expect(generateSaveFixtures(root, registry(2), worlds)).toMatchObject({
      status: 'written',
      revision: 2,
    });
    expect(checkSaveFixtures(root, registry(2))).toEqual([]);
    for (const path of Object.values(listFixtures(root)).flat()) {
      expect(loadFixtureFile(root, path, registry(2)).world.tick).toBe(6);
    }
  });

  it('AC-2: refuses to write anything for a schema change without a version bump', () => {
    generateSaveFixtures(root, registry(), worlds);
    const edited = registry(1, z.strictObject({ items: z.array(z.string()), gold: z.number() }));
    const outcome = generateSaveFixtures(root, edited, worlds);
    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' && outcome.problems[0]?.message).toContain(
      'save section "inventory" schema changed',
    );
    expect(Object.keys(listFixtures(root))).toEqual(['1']);
  });

  it('names the file when a fixture or the lock cannot be read', () => {
    const dir = join(root, 'tests/save-fixtures/1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), '{');
    writeFileSync(join(dir, 'odd.json'), '{"name":""}');
    expect(() => loadFixtureFile(root, 'tests/save-fixtures/1/bad.json', registry())).toThrow(
      /^tests\/save-fixtures\/1\/bad\.json: .*cannot read JSON/,
    );
    expect(() => loadFixtureFile(root, 'tests/save-fixtures/1/odd.json', registry())).toThrow(
      /^tests\/save-fixtures\/1\/odd\.json: malformed save fixture/,
    );
    writeFileSync(join(root, LOCK_PATH), 'nope');
    expect(() => readLock(root)).toThrow(/save-schema\.lock\.json: cannot read JSON/);
  });
});
