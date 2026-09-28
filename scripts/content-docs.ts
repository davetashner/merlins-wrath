// Writes (or with --check, verifies) a field reference per content type (mw-e12.1):
// docs/content/<type>-schema.md, a table of every field with its type, default and description,
// generated from the type's JSON Schema (itself generated from the zod schema), so the docs can never
// drift from what the loader accepts. It also writes docs/design/materials.md (mw-e03.2), the table of
// every material preset and its values, generated from the data so designers and the owner review the
// numbers the game actually loads. Run through scripts/content-docs-cli.ts (`pnpm content:docs`);
// a unit test fails when the committed docs are stale.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readContentSources } from '../src/content/fs-sources.ts';
import { contentJsonSchema } from '../src/content/json-schema.ts';
import { loadContent } from '../src/content/loader.ts';
import { contentTypes, type GameEntry } from '../src/content/registry.ts';
import { CONTENT_ID_PATTERN } from '../src/content/schema.ts';
import { materialPropertiesSchema } from '../src/content/types/material.ts';

/** The subset of JSON Schema that zod emits for content schemas. */
export interface JsonSchemaNode {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly default?: unknown;
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly minItems?: number;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly items?: JsonSchemaNode;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly propertyNames?: JsonSchemaNode;
  readonly additionalProperties?: JsonSchemaNode | boolean;
  readonly 'x-contentRef'?: string;
}

/** One row of the field table. */
interface Row {
  readonly field: string;
  readonly type: string;
  readonly default: string;
  readonly description: string;
}

const code = (value: unknown): string => `\`${JSON.stringify(value)}\``;

/** `integer 0–100`, `number ≥ 0`, `integer > 0`… (zod's ±MAX_SAFE_INTEGER int bounds are omitted). */
function numberType(node: JsonSchemaNode): string {
  const max = node.maximum === Number.MAX_SAFE_INTEGER ? undefined : node.maximum;
  const min = node.minimum === -Number.MAX_SAFE_INTEGER ? undefined : node.minimum;
  if (min !== undefined && max !== undefined)
    return `${String(node.type)} ${String(min)}–${String(max)}`;
  const bounds = [
    node.exclusiveMinimum === undefined ? undefined : `> ${String(node.exclusiveMinimum)}`,
    min === undefined ? undefined : `≥ ${String(min)}`,
    max === undefined ? undefined : `≤ ${String(max)}`,
  ].filter((b) => b !== undefined);
  return [node.type, ...bounds].join(' ');
}

/** Human-readable type of a JSON Schema node, e.g. `ref → attack`, `number 0–3`, `list of id`. */
export function typeOf(node: JsonSchemaNode): string {
  if (node['x-contentRef'] !== undefined) return `ref → ${node['x-contentRef']}`;
  if (node.anyOf !== undefined) return node.anyOf.map(typeOf).join(' or ');
  if (node.enum !== undefined) return node.enum.map(code).join(' \\| ');
  if (node.const !== undefined) return code(node.const);
  if (typeof node.type !== 'string') return node.type?.join(' or ') ?? 'any';
  if (node.type === 'number' || node.type === 'integer') return numberType(node);
  if (node.type === 'string') return node.pattern === CONTENT_ID_PATTERN.source ? 'id' : 'string';
  if (node.type === 'array' && node.items !== undefined) {
    const min = node.minItems === undefined ? '' : ` (at least ${String(node.minItems)})`;
    return `list of ${typeOf(node.items)}${min}`;
  }
  if (node.propertyNames !== undefined && typeof node.additionalProperties === 'object') {
    return `map of ${typeOf(node.propertyNames)} → ${typeOf(node.additionalProperties)}`;
  }
  return node.type;
}

/** Rows for every property of `node` (and of nested objects), with dotted field paths. */
export function fieldRows(node: JsonSchemaNode, prefix = ''): Row[] {
  const required = new Set(node.required);
  return Object.entries(node.properties ?? {}).flatMap(([key, child]) => {
    if (prefix === '' && key === '$schema') return [];
    const field = `${prefix}${key}`;
    const row: Row = {
      field,
      type: typeOf(child),
      default:
        child.default !== undefined ? code(child.default) : required.has(key) ? 'required' : '—',
      description: child.description ?? '',
    };
    return [row, ...nestedRows(child, field)];
  });
}

/** Rows for the objects nested in `node`: its own properties, array items, map values, union options. */
function nestedRows(node: JsonSchemaNode, field: string): Row[] {
  if (node.properties !== undefined) return fieldRows(node, `${field}.`);
  if (node.items !== undefined) return nestedRows(node.items, `${field}[]`);
  if (typeof node.additionalProperties === 'object') {
    return nestedRows(node.additionalProperties, `${field}.<key>`);
  }
  return (node.anyOf ?? []).flatMap((option) => nestedRows(option, field));
}

const cell = (text: string): string => text.replaceAll('\n', ' ');

/** The Markdown field reference for content type `type`. */
export function renderDoc(type: string, schema: JsonSchemaNode): string {
  const rows = fieldRows(schema).map(
    (r) => `| \`${r.field}\` | ${r.type} | ${r.default} | ${cell(r.description)} |`,
  );
  return [
    `# \`${type}\` content schema`,
    '',
    `<!-- Generated by pnpm content:docs from the "${type}" schema in src/content/registry.ts; do not edit. -->`,
    '',
    `One JSON file per entry in \`src/content/data/${type}/\`. Fields marked "required" must be present;`,
    'every other field takes the default shown when omitted ("—" = stays absent).',
    '',
    '| Field | Type | Default | Description |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

/** Where the materials table is written, repo-relative. */
export const MATERIALS_DOC = 'docs/design/materials.md';

const valueCell = (value: number | boolean | object | undefined): string =>
  value === undefined ? '—' : typeof value === 'object' ? code(value) : String(value);

/** The Markdown table of every material preset (rows) and every property any preset sets. */
export function renderMaterialsDoc(materials: readonly GameEntry<'material'>[]): string {
  const used = Object.keys(materialPropertiesSchema.shape).filter((key) =>
    materials.some((m) => Object.hasOwn(m.properties, key)),
  );
  const values = (m: GameEntry<'material'>) =>
    used.map((key) =>
      valueCell((m.properties as Readonly<Record<string, number | boolean | object>>)[key]),
    );
  const rows = materials.map((m) =>
    [`\`${m.id}\``, String(m.footstepLoudness), `\`${m.impactSound}\``, ...values(m)].join(' | '),
  );
  const header = ['Material', 'Footsteps (dB)', 'Impact sound', ...used.map((k) => `\`${k}\``)];
  return [
    '# Material presets',
    '',
    '<!-- Generated by pnpm content:docs from src/content/data/material/*.json; do not edit. -->',
    '',
    "Every material preset and the world-property values it gives objects made of it. An object's",
    'own value overrides its preset, and "—" means the preset leaves the property at its global',
    'default (src/sim/properties/spec.ts). Units: temperatures °C, `fuel` seconds, `density` kg/m³,',
    '`fragile` J; footsteps are a loudness offset relative to stone. Field meanings:',
    '[material schema](../content/material-schema.md).',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row} |`),
    '',
    '## Why these values',
    '',
    ...materials.flatMap((m) => [`- **${m.name}** (\`${m.id}\`): ${m.notes}`]),
    '',
  ].join('\n');
}

/** The game's material presets, read from src/content/data. */
function gameMaterials(): readonly GameEntry<'material'>[] {
  const root = resolve(import.meta.dirname, '../src/content/data');
  return loadContent(contentTypes, readContentSources(root, 'src/content/data')).all('material');
}

/** Repo-relative path of each generated doc → its expected contents. */
export function expectedDocs(): Map<string, string> {
  return new Map([
    ...Object.entries(contentTypes).map(([type, schema]): [string, string] => [
      `docs/content/${type}-schema.md`,
      renderDoc(type, contentJsonSchema(schema) as JsonSchemaNode),
    ]),
    [MATERIALS_DOC, renderMaterialsDoc(gameMaterials())],
  ]);
}

const read = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

/** Writes every doc, or with `--check` returns 1 listing the stale ones. Returns the exit code. */
export function main(argv: readonly string[], root: string = process.cwd()): number {
  const check = argv.includes('--check');
  let stale = 0;
  for (const [path, text] of expectedDocs()) {
    const target = resolve(root, path);
    if (read(target) === text) continue;
    if (check) {
      console.log(`::error title=Content docs::${path} is stale; run pnpm content:docs.`);
      stale++;
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      console.log(`wrote ${path}`);
    }
  }
  return stale > 0 ? 1 : 0;
}
