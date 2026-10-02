// Writes (or with --check, verifies) a field reference per content type (mw-e12.1):
// docs/content/<type>-schema.md, a table of every field with its type, default and description,
// generated from the type's JSON Schema (itself generated from the zod schema), so the docs can never
// drift from what the loader accepts. It also writes docs/design/materials.md (mw-e03.2), the table of
// every material preset and its values, generated from the data so designers and the owner review the
// numbers the game actually loads, and docs/design/world-properties.md (mw-e03.31), the canonical
// world-property vocabulary every epic writes against, generated from the sim's property spec. Run
// through scripts/content-docs-cli.ts (`pnpm content:docs`);
// a unit test fails when the committed docs are stale.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readContentSources } from '../src/content/fs-sources.ts';
import { contentJsonSchema } from '../src/content/json-schema.ts';
import { loadContent } from '../src/content/loader.ts';
import { contentChecks, contentTypes, type GameEntry } from '../src/content/registry.ts';
import { CONTENT_ID_PATTERN } from '../src/content/schema.ts';
import { materialPropertiesSchema } from '../src/content/types/material.ts';
import { WORLD_PROPERTY_SYNONYMS } from '../src/content/world-properties.ts';
import {
  WORLD_PROPERTIES_VERSION,
  WORLD_PROPERTY_KEYS,
  WORLD_PROPERTY_SPECS,
  type AnyPropertySpec,
  type NumberRange,
} from '../src/sim/properties/spec.ts';

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
  readonly exclusiveMaximum?: number;
  readonly minItems?: number;
  readonly anyOf?: readonly JsonSchemaNode[];
  /** Emitted for discriminated unions; documented like anyOf. */
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly items?: JsonSchemaNode;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly propertyNames?: JsonSchemaNode;
  readonly additionalProperties?: JsonSchemaNode | boolean;
  readonly 'x-contentRef'?: string;
  /** A reference to a shared definition, `#/$defs/<name>` (recursive schemas such as conditions). */
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchemaNode>>;
}

/** One row of the field table. */
interface Row {
  readonly field: string;
  readonly type: string;
  readonly default: string;
  readonly description: string;
}

const code = (value: unknown): string => `\`${JSON.stringify(value)}\``;

/** `integer 0–100`, `number ≥ 0`, `integer > 0`, `number > 0 < 90`… (zod's ±MAX_SAFE_INTEGER int bounds are omitted). */
function numberType(node: JsonSchemaNode): string {
  const max = node.maximum === Number.MAX_SAFE_INTEGER ? undefined : node.maximum;
  const min = node.minimum === -Number.MAX_SAFE_INTEGER ? undefined : node.minimum;
  if (min !== undefined && max !== undefined)
    return `${String(node.type)} ${String(min)}–${String(max)}`;
  const bounds = [
    node.exclusiveMinimum === undefined ? undefined : `> ${String(node.exclusiveMinimum)}`,
    min === undefined ? undefined : `≥ ${String(min)}`,
    max === undefined ? undefined : `≤ ${String(max)}`,
    node.exclusiveMaximum === undefined ? undefined : `< ${String(node.exclusiveMaximum)}`,
  ].filter((b) => b !== undefined);
  return [node.type, ...bounds].join(' ');
}

/** Human-readable type of a JSON Schema node, e.g. `ref → attack`, `number 0–3`, `list of id`. */
export function typeOf(node: JsonSchemaNode): string {
  if (node['x-contentRef'] !== undefined) return `ref → ${node['x-contentRef']}`;
  if (node.$ref !== undefined) return `\`${node.$ref.replace('#/$defs/', '')}\``;
  const options = node.anyOf ?? node.oneOf;
  if (options !== undefined) return [...new Set(options.map(typeOf))].join(' or ');
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
  return (node.anyOf ?? node.oneOf ?? []).flatMap((option) => nestedRows(option, field));
}

const cell = (text: string): string => text.replaceAll('\n', ' ');

const TABLE_HEAD = ['| Field | Type | Default | Description |', '| --- | --- | --- | --- |'];

/** Table rows for `node`'s fields; union options repeat shared fields (every node has an `id`), so each row is listed once. */
function tableRows(node: JsonSchemaNode): string[] {
  return [
    ...new Set(
      fieldRows(node).map(
        (r) => `| \`${r.field}\` | ${r.type} | ${r.default} | ${cell(r.description)} |`,
      ),
    ),
  ];
}

/** A section per shared definition (`$defs`): its description, then a field table per union option. */
function renderDefs(defs: Readonly<Record<string, JsonSchemaNode>>): string[] {
  return Object.entries(defs).flatMap(([name, def]) => [
    '',
    `## \`${name}\``,
    '',
    ...(def.description === undefined ? [] : [def.description, '']),
    `A \`${name}\` is exactly one of these objects:`,
    ...(def.anyOf ?? def.oneOf ?? [def]).flatMap((option, i) => [
      '',
      `### ${String(i + 1)}. ${option.description ?? name}`,
      '',
      ...TABLE_HEAD,
      ...tableRows(option),
    ]),
  ]);
}

/** The Markdown field reference for content type `type`. */
export function renderDoc(type: string, schema: JsonSchemaNode): string {
  const rows = tableRows(schema);
  return [
    `# \`${type}\` content schema`,
    '',
    `<!-- Generated by pnpm content:docs from the "${type}" schema in src/content/registry.ts; do not edit. -->`,
    '',
    `One JSON file per entry in \`src/content/data/${type}/\`. Fields marked "required" must be present;`,
    'every other field takes the default shown when omitted ("—" = stays absent).',
    '',
    ...TABLE_HEAD,
    ...rows,
    ...renderDefs(schema.$defs ?? {}),
    '',
  ].join('\n');
}

/** Where the materials table is written, repo-relative. */
export const MATERIALS_DOC = 'docs/design/materials.md';

const valueCell = (value: string | number | boolean | object | undefined): string =>
  value === undefined ? '—' : typeof value === 'object' ? code(value) : String(value);

/** The Markdown table of every material preset (rows) and every property any preset sets. */
export function renderMaterialsDoc(materials: readonly GameEntry<'material'>[]): string {
  const used = Object.keys(materialPropertiesSchema.shape).filter((key) =>
    materials.some((m) => Object.hasOwn(m.properties, key)),
  );
  const values = (m: GameEntry<'material'>) =>
    used.map((key) =>
      valueCell(
        (m.properties as Readonly<Record<string, string | number | boolean | object>>)[key],
      ),
    );
  const burnsTo = ({ burnt }: GameEntry<'material'>) =>
    burnt === undefined ? '—' : `\`${typeof burnt === 'string' ? burnt : burnt.id}\``;
  const rows = materials.map((m) =>
    [
      `\`${m.id}\``,
      String(m.footstepLoudness),
      `\`${m.impactSound}\``,
      burnsTo(m),
      ...values(m),
    ].join(' | '),
  );
  const header = [
    'Material',
    'Footsteps (dB)',
    'Impact sound',
    'Burns to',
    ...used.map((k) => `\`${k}\``),
  ];
  return [
    '# Material presets',
    '',
    '<!-- Generated by pnpm content:docs from src/content/data/material/*.json; do not edit. -->',
    '',
    "Every material preset and the world-property values it gives objects made of it. An object's",
    'own value overrides its preset, and "—" means the preset leaves the property at its global',
    'default (src/sim/properties/spec.ts). Units: temperatures °C, `fuel` seconds, `density` kg/m³,',
    '`fragile` J; footsteps are a loudness offset relative to stone; "Burns to" is what fire leaves',
    'of a flammable material (another material, or `destroyed`). Field meanings:',
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

/** Where the world-property vocabulary is written, repo-relative. */
export const WORLD_PROPERTIES_DOC = 'docs/design/world-properties.md';

const number = (n: number): string => n.toLocaleString('en-US');

/** `0–1`, `-273.15–10,000 °C`, `whole 1–3 grade`. */
function rangeText(range: NumberRange): string {
  const whole = range.integer === true ? 'whole ' : '';
  const unit = range.unit === '' ? '' : ` ${range.unit}`;
  return `${whole}${number(range.min)}–${number(range.max)}${unit}`;
}

/** A property default: numbers with thousands separators, records as JSON. */
function defaultCell(spec: AnyPropertySpec): string {
  switch (spec.type) {
    case 'number':
      return number(spec.default);
    case 'boolean':
      return String(spec.default);
    case 'id':
    case 'enum':
      return spec.default;
    case 'record':
      return code(spec.default);
  }
}

/** The type and allowed values of one property, for the vocabulary table. */
function specValues(spec: AnyPropertySpec): [string, string] {
  switch (spec.type) {
    case 'number':
      return ['number', rangeText(spec)];
    case 'boolean':
      return ['flag', 'true, false'];
    case 'id':
      return ['id', 'kebab-case id'];
    case 'enum':
      return ['one of', spec.values.map((v) => `\`${v}\``).join(', ')];
    case 'record': {
      const fields = Object.entries(spec.fields).map(
        ([name, range]) => `\`${name}\` ${rangeText(range)}`,
      );
      return [spec.partial === true ? 'record (any fields)' : 'record', fields.join('; ')];
    }
  }
}

/**
 * Words other designs used that are not world properties, and what to use instead. Kept here, next
 * to the generated table, so one page answers "which name do I use?".
 */
export const NOT_PROPERTIES: readonly (readonly [string, string])[] = [
  ['buoyant, floats', "derived: `floats(world, entity)` (density below water's 1000 kg/m³)"],
  ['flammable right now', 'derived: `isFlammableNow` (flammable, wetness < 0.5, not frozen)'],
  [
    'breaks under a hit',
    'derived: `breaksUnder(world, entity, type, energy)` (fragile, breakable, toughness)',
  ],
  [
    'revealed, perceivable, targetable',
    'derived: `isRevealed` / `revealedOnly` (not hidden); reveal with `reveal`',
  ],
  ['hangs from', 'derived: `supportOf(world, entity)` (suspended + a live support)'],
  [
    'actor noise multiplier',
    'derived: `actorNoiseMultiplier(world, equipped)` (product of noiseMultiplier, 0.2–3)',
  ],
  ['slippery', '`friction` (ice 0.05); no separate flag'],
  ['weak wall, weakened', '`breakable` with a low blunt/force `toughness`'],
  ['movable, throwable', '`pushable` / `liftable`'],
  [
    'footstep surface (carpet, gravel…)',
    'e09 acoustic surface tags; `surfaceHardness` is only the hardness grade',
  ],
  ['lockable, locked', 'the e03 doors/locks component, not a world property'],
  ['magical, enchanted', 'item data (e17/e18 enchantments), not a world property'],
  [
    'wood, stone (as a tag)',
    '`material` (a preset id); never compare material ids in rules, read the property',
  ],
];

/** The Markdown vocabulary table: every world property with its type, values, default and meaning. */
export function renderWorldPropertiesDoc(): string {
  const rows = WORLD_PROPERTY_KEYS.map((key) => {
    const spec: AnyPropertySpec = WORLD_PROPERTY_SPECS[key];
    const [type, values] = specValues(spec);
    return `| \`${key}\` | ${type} | ${values} | ${defaultCell(spec)} | ${spec.doc} |`;
  });
  const synonyms = Object.entries(WORLD_PROPERTY_SYNONYMS).map(
    ([word, key]) => `| \`${word}\` | \`${key}\` |`,
  );
  return [
    '# World properties',
    '',
    '<!-- Generated by pnpm content:docs from src/sim/properties/spec.ts; do not edit. -->',
    '',
    `The closed, versioned world-property vocabulary (version ${String(WORLD_PROPERTIES_VERSION)}).`,
    'Interactions come from these properties, never from pairs of object types, so spells, arrows,',
    'tools, AI and level data all use exactly these camelCase keys. A property an entity lacks reads',
    'its default. Data files set them under `properties` (src/content/world-properties.ts); material',
    'presets set the material-level ones ([materials](materials.md)). Adding or changing a property',
    'bumps `WORLD_PROPERTIES_VERSION` and the contract test tests/contracts/world-properties.test.ts.',
    'Threshold properties (`fragile`, `unstable`, `shootable`, `chargeActivated`, `lightActivated`)',
    'default to their maximum, which nothing reaches: absent means "never triggers".',
    '',
    '| Property | Type | Values | Default | Meaning |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Rejected spellings',
    '',
    'Data using another spelling of a key (`soft_anchor`, `water-surface`, `Flammable-Gas`: any key',
    'equal to a canonical one ignoring case, `-` and `_`) or one of these synonyms fails validation',
    'with a message naming the canonical key.',
    '',
    '| Written | Use |',
    '| --- | --- |',
    ...synonyms,
    '',
    '## Not world properties',
    '',
    'Terms other designs use that are derived queries (src/sim/properties/derived.ts) or belong to',
    'another system.',
    '',
    '| Term | Use instead |',
    '| --- | --- |',
    ...NOT_PROPERTIES.map(([term, instead]) => `| ${term} | ${instead} |`),
    '',
  ].join('\n');
}

/** The game's material presets, read from src/content/data. */
function gameMaterials(): readonly GameEntry<'material'>[] {
  const root = resolve(import.meta.dirname, '../src/content/data');
  const sources = readContentSources(root, 'src/content/data');
  return loadContent(contentTypes, sources, contentChecks).all('material');
}

/** Repo-relative path of each generated doc → its expected contents. */
export function expectedDocs(): Map<string, string> {
  return new Map([
    ...Object.entries(contentTypes).map(([type, schema]): [string, string] => [
      `docs/content/${type}-schema.md`,
      renderDoc(type, contentJsonSchema(schema) as JsonSchemaNode),
    ]),
    [MATERIALS_DOC, renderMaterialsDoc(gameMaterials())],
    [WORLD_PROPERTIES_DOC, renderWorldPropertiesDoc()],
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
