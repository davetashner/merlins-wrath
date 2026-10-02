import { z } from 'zod';
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

describe('contentJsonSchema of a discriminated union (mw-e17.2)', () => {
  const shared = z.strictObject({ a: z.number() });
  const list = z.array(z.number());
  const union = z.discriminatedUnion('kind', [
    z.strictObject({ id: z.string(), kind: z.literal('a'), shared, own: shared, list }),
    z.strictObject({
      id: z.string(),
      kind: z.literal('b'),
      shared,
      own: z.strictObject({ b: z.number() }),
      list,
    }),
  ]);
  const json = contentJsonSchema(union) as {
    properties?: unknown;
    oneOf: { properties: Record<string, unknown>; additionalProperties: boolean }[];
    $defs: Record<string, unknown>;
  };

  it('allows the $schema editor hint in every (strict) option, not at the top level', () => {
    expect(json.properties).toBeUndefined();
    expect(json.oneOf).toHaveLength(2);
    for (const option of json.oneOf) {
      expect(option.properties['$schema']).toMatchObject({ type: 'string' });
      expect(option.additionalProperties).toBe(false);
    }
    expect(Object.keys(json.oneOf[1]?.properties ?? {})).toEqual([
      '$schema',
      'id',
      'kind',
      'shared',
      'own',
      'list',
    ]);
  });

  it('writes a nested object or list every option shares once, in $defs', () => {
    expect(Object.keys(json.$defs)).toEqual(['shared', 'list']);
    expect(json.$defs['shared']).toMatchObject({ type: 'object', required: ['a'] });
    for (const option of json.oneOf) {
      expect(option.properties['shared']).toEqual({ $ref: '#/$defs/shared' });
      expect(option.properties['list']).toEqual({ $ref: '#/$defs/list' });
      expect(option.properties['own']).toMatchObject({ type: 'object' });
    }
  });
});
