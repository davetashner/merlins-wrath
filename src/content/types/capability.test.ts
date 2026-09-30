import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { capabilitySchema, type CapabilityGroupInput } from './capability.ts';

const group = (id: string, ids: readonly string[]): CapabilityGroupInput => ({
  id,
  name: 'Test',
  notes: 'Test.',
  capabilities: ids.map((cap) => ({ id: cap, name: cap, description: 'Test.' })),
});

const problems = (value: unknown) =>
  (capabilitySchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

function loadIssues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('capability schema (mw-e15.1)', () => {
  it('accepts every capability family', () => {
    const ids = ['verb.climb.ledge', 'spell.ember', 'arrow.rope', 'tool.lockpick'];
    const all = [...ids, 'trick.shadow-step', 'technique.shield-charge', 'sense.detect-magic'];
    expect(problems(group('test', all))).toEqual([]);
  });

  it('rejects malformed ids and ids declared twice in a file', () => {
    expect(problems(group('test', ['frost', 'spell.frost', 'spell.frost', 'Spell.x']))).toEqual([
      'capabilities.0.id: must be a capability id, e.g. "spell.mage-hand"',
      'capabilities.3.id: must be a capability id, e.g. "spell.mage-hand"',
      'capabilities.2.id: "spell.frost" is declared twice in this file',
    ]);
  });

  it('rejects an id declared in two files, naming the first', () => {
    const extra = {
      path: 'src/content/data/capability/zz-test.json',
      text: JSON.stringify(group('zz-test', ['spell.mage-hand'])),
    };
    expect(loadIssues([extra])).toEqual([
      'src/content/data/capability/zz-test.json#/capabilities/0/id: capability "spell.mage-hand" is already declared in src/content/data/capability/spells.json',
    ]);
  });
});

describe('the shipped capabilities', () => {
  describeContent('capability', 'parses and round-trips', (entry) => {
    expect(capabilitySchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  });
});
