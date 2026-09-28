import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readContentSources } from './fs-sources.ts';
import {
  ContentLoadError,
  jsonPointer,
  loadContent,
  type ContentIssue,
  type ContentSchemas,
  type ContentSource,
} from './loader.ts';
import { contentTypes } from './registry.ts';
import { ContentRef, contentId, ref } from './schema.ts';

const schemas = {
  creature: z.strictObject({ id: contentId, hp: z.number() }),
  spell: z.strictObject({
    id: contentId,
    summons: z.array(ref('creature')).default([]),
    upgrade: ref('spell').optional(),
  }),
};

/** Asymmetric matcher typed as the string it stands for. */
const matching = (pattern: RegExp): string => expect.stringMatching(pattern) as string;

const file = (path: string, json: unknown): ContentSource => ({ path, text: JSON.stringify(json) });

/** The issues `loadContent` throws for `sources` (fails the test if it doesn't throw). */
function issuesOf(
  sources: readonly ContentSource[],
  registry: ContentSchemas = schemas,
): readonly ContentIssue[] {
  try {
    loadContent(registry, sources);
  } catch (error) {
    if (error instanceof ContentLoadError) return error.issues;
    throw error;
  }
  throw new Error('expected loadContent to throw');
}

const valid = [
  file('data/creature/rat.json', { id: 'rat', hp: 3 }),
  file('data/creature/bat.json', { id: 'bat', hp: 2 }),
  file('data/spell/call-rats.json', { id: 'call-rats', summons: ['rat', 'rat'] }),
  file('data/spell/call-bats.json', { id: 'call-bats', summons: ['bat'], upgrade: 'call-rats' }),
];

describe('loadContent', () => {
  it('AC-1: reports a missing field and two wrong types in one run, with file and JSON pointer', () => {
    const issues = issuesOf(readContentSources('src/content/fixtures/malformed'), contentTypes);
    const file = 'src/content/fixtures/malformed/testprop/bad-lamp.json';
    expect(issues).toEqual([
      { file, pointer: '/name', message: matching(/expected string/) },
      { file, pointer: '/mass', message: matching(/expected number/) },
      { file, pointer: '/flammable', message: matching(/expected boolean/) },
    ]);
  });

  it('AC-1: errors in several files are all reported, nested paths as JSON pointers', () => {
    const issues = issuesOf([
      file('data/creature/rat.json', { id: 'rat' }),
      file('data/spell/x.json', { id: 'x', summons: ['rat', 7] }),
    ]);
    expect(issues.map((i) => `${i.file}#${i.pointer}`)).toEqual([
      'data/creature/rat.json#/hp',
      'data/spell/x.json#/summons/1',
    ]);
  });

  it('AC-2: the same id in two files fails naming both files', () => {
    const issues = issuesOf([
      file('data/creature/rat.json', { id: 'rat', hp: 3 }),
      file('data/creature/rat-copy.json', { id: 'rat', hp: 4 }),
    ]);
    expect(issues).toEqual([
      {
        file: 'data/creature/rat.json',
        pointer: '/id',
        message: 'duplicate id creature:rat: already defined in data/creature/rat-copy.json',
      },
    ]);
  });

  it('AC-2: the same id in two different types is not a duplicate', () => {
    const catalogue = loadContent(schemas, [
      file('data/creature/rat.json', { id: 'rat', hp: 3 }),
      file('data/spell/rat.json', { id: 'rat' }),
    ]);
    expect(catalogue.get('creature', 'rat').hp).toBe(3);
    expect(catalogue.get('spell', 'rat').summons).toEqual([]);
  });

  it('AC-3: a reference to a missing entry fails naming the source entry and the missing target', () => {
    const issues = issuesOf([
      file('data/creature/rat.json', { id: 'rat', hp: 3 }),
      file('data/spell/call-archers.json', {
        id: 'call-archers',
        summons: ['rat', 'goblin-archer'],
      }),
    ]);
    expect(issues).toEqual([
      {
        file: 'data/spell/call-archers.json',
        pointer: '/summons/1',
        message: 'spell:call-archers references missing creature:goblin-archer',
      },
    ]);
  });

  it('AC-4: the content hash does not depend on file order, file names or key order', () => {
    const a = loadContent(schemas, valid);
    const b = loadContent(schemas, [...valid].reverse());
    const renamed = valid.map((source, i) => ({
      ...source,
      path: source.path.replace(/[^/]+$/, `${String(i)}.json`),
    }));
    const reordered = [
      { path: 'data/creature/rat.json', text: '{"hp":3,"id":"rat"}' },
      ...valid.slice(1),
    ];
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(b.hash).toBe(a.hash);
    expect(loadContent(schemas, renamed).hash).toBe(a.hash);
    expect(loadContent(schemas, reordered).hash).toBe(a.hash);
  });

  it('AC-4: any change to a value changes the content hash', () => {
    const changed = [file('data/creature/rat.json', { id: 'rat', hp: 4 }), ...valid.slice(1)];
    expect(loadContent(schemas, changed).hash).not.toBe(loadContent(schemas, valid).hash);
  });

  it('builds an id-indexed catalogue sorted by id with resolvable references', () => {
    const catalogue = loadContent(schemas, valid);
    expect(catalogue.all('creature').map((c) => c.id)).toEqual(['bat', 'rat']);
    expect(catalogue.all('spell').map((s) => s.id)).toEqual(['call-bats', 'call-rats']);
    const callBats = catalogue.get('spell', 'call-bats');
    expect(callBats.upgrade).toEqual(new ContentRef('spell', 'call-rats'));
    expect(catalogue.resolve(new ContentRef('creature', 'bat')).hp).toBe(2);
    expect(catalogue.has('creature', 'rat')).toBe(true);
    expect(catalogue.has('creature', 'cat')).toBe(false);
    expect(() => catalogue.get('creature', 'cat')).toThrow(
      new RangeError('no creature entry "cat"'),
    );
  });

  it('returns an empty list for a registered type with no entries (and for unknown types)', () => {
    const catalogue = loadContent(schemas, []);
    expect(catalogue.all('creature')).toEqual([]);
    expect(catalogue.all('nope' as 'creature')).toEqual([]);
  });

  it('deep-freezes the catalogue and every entry', () => {
    const catalogue = loadContent(schemas, valid);
    const spell = catalogue.get('spell', 'call-rats');
    expect(Object.isFrozen(catalogue)).toBe(true);
    expect(Object.isFrozen(catalogue.all('spell'))).toBe(true);
    expect(Object.isFrozen(spell)).toBe(true);
    expect(Object.isFrozen(spell.summons)).toBe(true);
    expect(() => {
      (spell as { id: string }).id = 'hacked';
    }).toThrow(TypeError);
  });

  it('ignores a top-level $schema key (editor hint), but not other unknown keys', () => {
    const catalogue = loadContent(schemas, [
      file('data/creature/rat.json', { $schema: '../creature.schema.json', id: 'rat', hp: 3 }),
    ]);
    expect(catalogue.get('creature', 'rat')).toEqual({ id: 'rat', hp: 3 });
    const issues = issuesOf([file('data/creature/rat.json', { id: 'rat', hp: 3, speed: 1 })]);
    expect(issues).toEqual([
      { file: 'data/creature/rat.json', pointer: '', message: matching(/speed/) },
    ]);
  });

  it('reports files whose JSON is not an object as schema errors', () => {
    const issues = issuesOf([
      { path: 'data/creature/a.json', text: 'null' },
      { path: 'data/creature/b.json', text: '[]' },
      { path: 'data/creature/c.json', text: '42' },
    ]);
    expect(issues.map((i) => [i.file, i.pointer])).toEqual([
      ['data/creature/a.json', ''],
      ['data/creature/b.json', ''],
      ['data/creature/c.json', ''],
    ]);
  });

  it('reports invalid JSON and unknown type folders alongside other problems', () => {
    const issues = issuesOf([
      { path: 'data/creature/broken.json', text: '{ "id": ' },
      file('data/lorem/ipsum.json', { id: 'ipsum' }),
      file('loose.json', { id: 'loose' }),
    ]);
    expect(issues).toEqual([
      {
        file: 'data/creature/broken.json',
        pointer: '',
        message: matching(/^invalid JSON: /),
      },
      {
        file: 'data/lorem/ipsum.json',
        pointer: '',
        message: 'unknown content type "lorem" (folder name); known types: creature, spell',
      },
      {
        file: 'loose.json',
        pointer: '',
        message: 'unknown content type "" (folder name); known types: creature, spell',
      },
    ]);
  });

  it('formats every issue into the error message', () => {
    expect(() => loadContent(schemas, [file('data/creature/rat.json', { id: 'rat' })])).toThrow(
      /^Content failed to load \(1 problem\(s\)\):\n {2}data\/creature\/rat\.json#\/hp: /,
    );
  });
});

describe('jsonPointer', () => {
  it('escapes ~ and / per RFC 6901', () => {
    expect(jsonPointer([])).toBe('');
    expect(jsonPointer(['a/b', 0, 'c~d'])).toBe('/a~1b/0/c~0d');
  });

  it('escapes keys the same way when locating references', () => {
    const issues = issuesOf([file('data/spell/x.json', { id: 'x', by: { 'a/b': 'ghost' } })], {
      ...schemas,
      spell: z.strictObject({ id: contentId, by: z.record(z.string(), ref('creature')) }),
    });
    expect(issues[0]?.pointer).toBe('/by/a~1b');
  });
});
