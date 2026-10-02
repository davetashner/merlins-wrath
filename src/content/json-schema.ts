// JSON Schema export (mw-e00.18) so editors autocomplete and flag content JSON as it is typed. Each
// content file can start with `"$schema": "../<type>.schema.json"`; the generated schemas live next
// to the type folders (src/content/data/<type>.schema.json) and are refreshed with
// `pnpm content:schemas` (a unit test fails when they are stale). A content type whose entry is a
// discriminated union (items, mw-e17.2) becomes a top-level `oneOf`; each option then allows the
// `$schema` hint, since every option is strict, and nested objects all options share are written once
// in `$defs`.

import { z } from 'zod';

type JsonObject = Record<string, unknown>;

const SCHEMA_HINT = { type: 'string', description: 'Editor hint only; ignored by the loader.' };

/** `node` with `$schema` allowed as its first property. */
const withHint = (node: JsonObject): JsonObject => ({
  ...node,
  properties: { $schema: SCHEMA_HINT, ...(node['properties'] as JsonObject | undefined) },
});

/** An option's properties (zod writes `properties` for every object, even an empty one). */
const propertiesOf = (node: JsonObject): Record<string, JsonObject> =>
  node['properties'] as Record<string, JsonObject>;

/**
 * The object- and list-valued properties every union option declares with the same schema (an item’s world
 * properties, flags…), moved to `$defs` under their property name and referenced from each option,
 * so the file lists them once instead of once per option.
 */
function hoistShared(options: readonly JsonObject[]): { oneOf: JsonObject[]; $defs: JsonObject } {
  const defs: Record<string, JsonObject> = {};
  for (const [key, node] of options
    .slice(0, 1)
    .flatMap((first) => Object.entries(propertiesOf(first)))) {
    const text = JSON.stringify(node);
    const shared = options.every((option) => JSON.stringify(propertiesOf(option)[key]) === text);
    if ((node['type'] === 'object' || node['type'] === 'array') && shared) defs[key] = node;
  }
  const oneOf = options.map((option) => ({
    ...option,
    properties: Object.fromEntries(
      Object.entries(propertiesOf(option)).map(([key, node]) => [
        key,
        Object.hasOwn(defs, key) ? { $ref: `#/$defs/${key}` } : node,
      ]),
    ),
  }));
  return { oneOf: oneOf.map(withHint), $defs: defs };
}

/** JSON Schema (draft 2020-12) for the JSON input of one content type's schema. */
export function contentJsonSchema(schema: z.ZodType): JsonObject {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonObject;
  const options = json['oneOf'] as JsonObject[] | undefined;
  if (options === undefined) return withHint(json);
  const { oneOf, $defs } = hoistShared(options);
  return { ...json, oneOf, $defs: { ...(json['$defs'] as JsonObject | undefined), ...$defs } };
}
