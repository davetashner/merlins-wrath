// Contract between layers (mw-e27.2): world facts are declared as content (src/content/types/fact.ts,
// checked at load by src/content/fact-checks.ts) and stored by the sim (src/sim/facts). Content may
// import the sim only as types, so this runtime check lives outside src/: both sides share the key
// and template syntax and the value types, every registry fact declares on a world's fact store, and
// every fact a shipped signal graph writes is declared.

import { describe, expect, it } from 'vitest';
import * as content from '@content/index';
import { describeContent } from '@content/testing';
import {
  declareFacts,
  FACT_KEY_PATTERN,
  FACT_TEMPLATE_PATTERN,
  FACT_TYPES,
  factSpecFromDef,
  factTemplateOf,
  World,
} from '@sim/index';

const game = content.loadGameContent();

const SAMPLE_KEYS = [
  'horn.fate',
  'entity:mine/chest-3.looted',
  'entity:mine/chest-3.lid.open',
  'entity:*.looted',
  'entity:*',
  'Horn.fate',
  'horn..fate',
  'entity:mine.looted',
];

describe('fact contract', () => {
  it('content and sim share the key syntax, the template syntax and the value types', () => {
    expect(content.FACT_KEY_PATTERN.source).toBe(FACT_KEY_PATTERN.source);
    expect(content.FACT_TEMPLATE_PATTERN.source).toBe(FACT_TEMPLATE_PATTERN.source);
    expect(content.FACT_VALUE_TYPES).toEqual(FACT_TYPES);
    expect(SAMPLE_KEYS.map(content.factTemplateOf)).toEqual(SAMPLE_KEYS.map(factTemplateOf));
  });

  it('the whole registry declares on one world, in strict mode', () => {
    const world = new World({ seed: 1 });
    declareFacts(world.facts, game.all('fact'), { mode: 'throw' });
    const keys = game.all('fact').flatMap((g) => g.facts.map((f) => f.key));
    expect(keys.every((key) => world.facts.spec(key) !== undefined)).toBe(true);
  });

  describeContent('fact', 'declares on the sim fact store with its type and default', (group) => {
    const world = new World({ seed: 1 });
    declareFacts(world.facts, [group], { mode: 'throw' });
    for (const def of group.facts) {
      expect(world.facts.spec(def.key)).toEqual(factSpecFromDef(def));
      const concrete = def.key.replace('entity:*.', 'entity:level/entity.');
      expect(world.facts.get(concrete)).toBe(def.default ?? undefined);
    }
  });

  describeContent(
    'signal-graph',
    'AC-2: every fact the graph writes is declared in the registry',
    (graph) => {
      const world = new World({ seed: 1 });
      declareFacts(world.facts, game.all('fact'), { mode: 'throw' });
      for (const node of graph.nodes) {
        if (node.kind === 'receiver' && node.receiver === 'fact') {
          expect(world.facts.isDeclared(node.key ?? '')).toBe(true);
        }
      }
    },
  );
});
