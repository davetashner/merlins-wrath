import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { contentJsonSchema } from '../src/content/json-schema.ts';
import { contentId, ref } from '../src/content/schema.ts';
import { loadGameContent } from '../src/content/game-content.ts';
import { materialSchema } from '../src/content/types/material.ts';
import {
  expectedDocs,
  fieldRows,
  main,
  MATERIALS_DOC,
  renderDoc,
  renderMaterialsDoc,
  typeOf,
  type JsonSchemaNode,
} from './content-docs.ts';

const docPath = 'docs/content/creature-schema.md';
const jsonSchema = (schema: z.ZodType): JsonSchemaNode => contentJsonSchema(schema);

describe('content-docs', () => {
  const cwd = process.cwd();
  const argv = process.argv;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'content-docs-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('AC-6: the committed field references are up to date (run pnpm content:docs if this fails)', () => {
    expect(main(['--check'], cwd)).toBe(0);
  });

  it('AC-6: the creature reference lists every field with its type and default', () => {
    const doc = expectedDocs().get(docPath) ?? '';
    for (const row of [
      '| `id` | id | required |',
      '| `stats.health` | integer > 0 | required |',
      '| `senses` | ref → sense or object | required |',
      '| `senses.base` | ref → sense | — |',
      '| `senses.sight.farRange` | number ≥ 0 | — |',
      '| `locomotion` | ref → locomotion or object | required |',
      '| `locomotion.modes.climb.maxGrade` | integer 1–3 | — |',
      '| `attacks` | list of ref → attack | `[]` |',
      '| `faction` | id | `"unaligned"` |',
      '| `personality.greed` | number 0–1 | `0.5` |',
      '| `needs.<key>.threshold` | number 0–100 | required |',
      '| `loot` | id | — |',
      '| `presentation.mesh` | id | `"placeholder-capsule"` |',
    ]) {
      expect(doc).toContain(row);
    }
    const documented = [...doc.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]);
    expect(documented).toHaveLength(112);
  });

  it('writes one doc per content type, creating docs/content, then --check passes', () => {
    expect(main([], dir)).toBe(0);
    expect(console.log).toHaveBeenCalledWith(`wrote ${docPath}`);
    expect(readFileSync(join(dir, docPath), 'utf8')).toBe(expectedDocs().get(docPath));
    expect(main(['--check'], dir)).toBe(0);
  });

  it('--check fails listing missing or stale docs without writing them', () => {
    expect(main(['--check'], dir)).toBe(1);
    main([], dir);
    writeFileSync(join(dir, docPath), 'old\n');
    expect(main(['--check'], dir)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      `::error title=Content docs::${docPath} is stale; run pnpm content:docs.`,
    );
    expect(readFileSync(join(dir, docPath), 'utf8')).toBe('old\n');
  });

  it('the CLI sets the process exit code from main', async () => {
    process.chdir(dir);
    process.argv = ['node', 'content-docs-cli.ts', '--check'];
    await import('./content-docs-cli.ts');
    expect(process.exitCode).toBe(1);
  });
});

describe('typeOf', () => {
  it('names refs, unions, enums, constants, bounded numbers, ids, lists and maps', () => {
    const t = (schema: z.ZodType) => typeOf(jsonSchema(schema));
    expect(t(ref('attack'))).toBe('ref → attack');
    expect(t(z.union([z.string(), z.boolean()]))).toBe('string or boolean');
    expect(t(z.enum(['a', 'b']))).toBe('`"a"` \\| `"b"`');
    expect(t(z.literal(2))).toBe('`2`');
    expect(t(z.int())).toBe('integer');
    expect(t(z.number())).toBe('number');
    expect(t(z.number().positive().max(5))).toBe('number > 0 ≤ 5');
    expect(t(z.number().max(5))).toBe('number ≤ 5');
    expect(t(z.int().min(1).max(3))).toBe('integer 1–3');
    expect(t(contentId)).toBe('id');
    expect(t(z.string().regex(/x/))).toBe('string');
    expect(t(z.array(z.string()).min(2))).toBe('list of string (at least 2)');
    expect(t(z.record(z.string(), z.number()))).toBe('map of string → number');
    expect(t(z.object({}))).toBe('object');
    expect(t(z.any())).toBe('any');
  });

  it('names a discriminated union (oneOf) like a union, listing each option type once', () => {
    const t = (schema: z.ZodType) => typeOf(jsonSchema(schema));
    const tagged = z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('a') }),
      z.strictObject({ kind: z.literal('b') }),
    ]);
    expect(t(tagged)).toBe('object');
    expect(t(z.union([z.string(), z.string().min(2), z.boolean()]))).toBe('string or boolean');
  });
});

describe('fieldRows / renderDoc', () => {
  const schema = jsonSchema(
    z.strictObject({
      id: contentId,
      plain: z.string().optional(),
      list: z.array(z.strictObject({ a: z.number().describe('multi\nline') })),
      either: z.union([ref('x'), z.strictObject({ b: z.boolean() })]),
    }),
  );

  it('skips $schema, recurses into lists, maps and union options, and marks required fields', () => {
    expect(fieldRows(schema).map((r) => [r.field, r.default])).toEqual([
      ['id', 'required'],
      ['plain', '—'],
      ['list', 'required'],
      ['list[].a', 'required'],
      ['either', 'required'],
      ['either.b', 'required'],
    ]);
  });

  it('recurses into discriminated union options, rendering shared fields once', () => {
    const tagged = jsonSchema(
      z.strictObject({
        node: z.discriminatedUnion('kind', [
          z.strictObject({ id: contentId, kind: z.literal('a'), x: z.number() }),
          z.strictObject({ id: contentId, kind: z.literal('b') }),
        ]),
      }),
    );
    expect(fieldRows(tagged).map((r) => r.field)).toEqual([
      'node',
      'node.id',
      'node.kind',
      'node.x',
      'node.id',
      'node.kind',
    ]);
    const lines = renderDoc('thing', tagged)
      .split('\n')
      .filter((l) => l.startsWith('| `node.id`'));
    expect(lines).toEqual(['| `node.id` | id | required |  |']);
  });

  it('has no rows for a schema without properties', () => {
    expect(fieldRows({ type: 'string' })).toEqual([]);
  });

  it('renders a Markdown table with one line per field', () => {
    const doc = renderDoc('thing', schema);
    expect(doc).toMatch(/^# `thing` content schema\n/);
    expect(doc).toContain('| `list[].a` | number | required | multi line |');
    expect(doc.endsWith('|\n')).toBe(true);
  });
});

describe('renderMaterialsDoc', () => {
  it('AC-4: docs/design/materials.md lists every material and every property value', () => {
    const doc = expectedDocs().get(MATERIALS_DOC) ?? '';
    const materials = loadGameContent().all('material');
    expect(materials.length).toBeGreaterThan(0);
    const lines = doc.split('\n');
    const header = lines.find((line) => line.startsWith('| Material |')) ?? '';
    const columns = header.split(' | ').map((c) => c.replace(/^\| |`| \|$/g, ''));
    const missing = materials.flatMap((m) => {
      const row = lines.find((line) => line.startsWith(`| \`${m.id}\` |`));
      if (row === undefined) return [`${m.id}: no row`];
      const cells = row.replace(/ \|$/, '').split(' | ');
      return [
        ...Object.entries(m.properties)
          .filter(([key, value]) => cells[columns.indexOf(key)] !== JSON.stringify(value))
          .map(([key]) => `${m.id}.${key}`),
        ...(doc.includes(m.notes) ? [] : [`${m.id}: notes`]),
      ];
    });
    expect(missing).toEqual([]);
  });

  it('shows record values as JSON and unset ones as —', () => {
    const material = (id: string, properties: object) =>
      materialSchema.parse({
        id,
        name: id,
        notes: `${id} notes`,
        footstepLoudness: -1,
        impactSound: 'sfx-impact-glass',
        properties,
      });
    const doc = renderMaterialsDoc([
      material('lamp-glass', { lightEmitter: { intensity: 10, radius: 2 } }),
      material('plain', {}),
    ]);
    expect(doc).toContain('| Material | Footsteps (dB) | Impact sound | `lightEmitter` |');
    expect(doc).toContain(
      '| `lamp-glass` | -1 | `sfx-impact-glass` | `{"intensity":10,"radius":2}` |',
    );
    expect(doc).toContain('| `plain` | -1 | `sfx-impact-glass` | — |');
    expect(doc).toContain('- **plain** (`plain`): plain notes');
  });
});
