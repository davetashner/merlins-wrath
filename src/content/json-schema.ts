// JSON Schema export (mw-e00.18) so editors autocomplete and flag content JSON as it is typed. Each
// content file can start with `"$schema": "../<type>.schema.json"`; the generated schemas live next
// to the type folders (src/content/data/<type>.schema.json) and are refreshed with
// `pnpm content:schemas` (a unit test fails when they are stale).

import { z } from 'zod';

/** JSON Schema (draft 2020-12) for the JSON input of one content type's schema. */
export function contentJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return {
    ...json,
    properties: {
      $schema: { type: 'string', description: 'Editor hint only; ignored by the loader.' },
      ...json.properties,
    },
  };
}
