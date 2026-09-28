import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { installElementField } from '../field/install';
import {
  ELEMENT_PHASES,
  ElementRuleSet,
  elementRulesSystem,
  type ElementPhase,
  type ElementRule,
  type ElementRuleContext,
} from './rules';

/** A rule that records its id into `log` when it runs. */
const rule = (id: string, phase: ElementPhase, log: string[]): ElementRule => ({
  id,
  phase,
  run: () => log.push(id),
});

describe('ElementRuleSet', () => {
  it('runs phases in order (exchange, transition, sustain, settle), rules by registration within one', () => {
    const log: string[] = [];
    const rules = new ElementRuleSet([
      rule('water.settle', 'settle', log),
      rule('fire.burn', 'sustain', log),
      rule('b.second', 'transition', log),
    ]).add(rule('a.first', 'transition', log), rule('heat.exchange', 'exchange', log));
    expect(ELEMENT_PHASES).toEqual(['exchange', 'transition', 'sustain', 'settle']);
    expect(rules.rules.map((r) => r.id)).toEqual([
      'heat.exchange',
      'b.second',
      'a.first',
      'fire.burn',
      'water.settle',
    ]);
    const world = installElementField(new World<never>({ seed: 1 }));
    world.addSystem(elementRulesSystem(rules));
    world.step();
    world.step();
    expect(log).toEqual([...rules.rules.map((r) => r.id), ...rules.rules.map((r) => r.id)]);
  });

  it('gives rules the world, its field, the tick and the tick rate', () => {
    const seen: ElementRuleContext[] = [];
    const world = installElementField(new World<never>({ seed: 1, hz: 30 }));
    const rules = new ElementRuleSet([
      { id: 'probe', phase: 'sustain', run: (ctx) => seen.push(ctx) },
    ]);
    world.step();
    rules.run(world);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ world, tick: 1, hz: 30 });
    expect(seen[0]?.field.chunkCount).toBe(0);
  });

  it('rejects duplicate or malformed ids and unknown phases, adding none of the batch', () => {
    const log: string[] = [];
    const rules = new ElementRuleSet([rule('fire.ignite', 'transition', log)]);
    expect(() =>
      rules.add(rule('ok.one', 'settle', log), rule('fire.ignite', 'settle', log)),
    ).toThrow(/duplicate element rule "fire.ignite"/);
    expect(() => rules.add(rule('x', 'settle', log), rule('x', 'sustain', log))).toThrow(
      /duplicate/,
    );
    expect(() => rules.add(rule('Fire.Ignite', 'settle', log))).toThrow(/dotted kebab-case/);
    expect(() => rules.add(rule('fire.', 'settle', log))).toThrow(/dotted kebab-case/);
    expect(() => rules.add(rule('fire.later', 'later' as ElementPhase, log))).toThrow(
      /unknown element phase "later"/,
    );
    expect(rules.rules.map((r) => r.id)).toEqual(['fire.ignite']);
  });

  it('needs an element field in the world', () => {
    const world = new World<never>({ seed: 1 });
    expect(() => {
      new ElementRuleSet().run(world);
    }).toThrow(/element.field/);
  });
});
