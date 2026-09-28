import { describe, expect, it } from 'vitest';
import { contentJsonSchema } from './json-schema.ts';
import { CONTENT_ID_PATTERN } from './schema.ts';
import { testPropSchema } from './types/testprop.ts';

describe('contentJsonSchema', () => {
  const json = contentJsonSchema(testPropSchema) as {
    properties: Record<string, { type?: string; pattern?: string }>;
    required: string[];
    additionalProperties: boolean;
  };

  it('describes the JSON input: references are id strings, defaulted fields optional', () => {
    expect(json.properties['breaksInto']).toMatchObject({
      type: 'string',
      pattern: CONTENT_ID_PATTERN.source,
    });
    expect(json.required).toEqual(['id', 'name', 'mass', 'flammable']);
    expect(json.additionalProperties).toBe(false);
  });

  it('allows the $schema editor hint even though the entry schema is strict', () => {
    expect(json.properties['$schema']).toMatchObject({ type: 'string' });
  });
});
