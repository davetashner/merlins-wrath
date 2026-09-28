// The element rule framework (mw-e03.5). Fire, water, ice, electricity and gas are not scripted
// against object types: each element is a handful of rules that read and write only world properties
// (src/sim/properties) and the element field (src/sim/field), so a rope burns because it is flammable
// and hot, never because someone wrote "fireball + rope". A lint rule keeps it that way: code under
// src/sim/elements may not compare strings against ids (eslint/layers.js).
//
// Rules run in fixed phases, once per tick, after stimuli resolve and before the field diffuses:
//   exchange   – entities and the field trade quantities (an object warms up in hot air)
//   transition – threshold state changes (extinguish, evaporate, ignite; later freeze and melt)
//   sustain    – ongoing states act (burning uses fuel, heats its flames, gives off smoke)
//   settle     – end states (burnt out: charred or destroyed)
// Within a phase, rules run in registration order. Like systems, a rule set is code, not state:
// build it the same way on every run and replays reproduce every transition. Later element beads
// plug in by adding rules to a phase rather than editing existing rules.

import type { System, World } from '../core/world';
import type { ElementField } from '../field/grid';
import { elementFieldOf } from '../field/install';

/** The rule phases, in the order they run each tick. */
export const ELEMENT_PHASES = ['exchange', 'transition', 'sustain', 'settle'] as const;

/** A rule phase. */
export type ElementPhase = (typeof ELEMENT_PHASES)[number];

/** What a rule receives each tick. */
export interface ElementRuleContext {
  readonly world: World<never>;
  /** The world's element field. */
  readonly field: ElementField;
  /** The tick being simulated. */
  readonly tick: number;
  /** Tick rate, Hz. */
  readonly hz: number;
}

/** One element rule. It may read and write world properties and the element field, nothing else. */
export interface ElementRule {
  /** Unique within a rule set, e.g. `fire.ignite`. */
  readonly id: string;
  readonly phase: ElementPhase;
  run(ctx: ElementRuleContext): void;
}

const RULE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** An ordered set of element rules (see the file header for phases and order). */
export class ElementRuleSet {
  private readonly byPhase: ElementRule[][] = ELEMENT_PHASES.map(() => []);
  private readonly ids = new Set<string>();

  constructor(rules: readonly ElementRule[] = []) {
    this.add(...rules);
  }

  /**
   * Adds rules after those already in their phases. Throws a RangeError for a malformed or duplicate
   * id or an unknown phase, adding none of the rules.
   */
  add(...rules: ElementRule[]): this {
    const seen = new Set(this.ids);
    const placed = rules.map((rule): [ElementRule[], ElementRule] => {
      if (!RULE_ID_PATTERN.test(rule.id)) {
        throw new RangeError(`element rule id "${rule.id}" must be dotted kebab-case`);
      }
      if (seen.has(rule.id)) throw new RangeError(`duplicate element rule "${rule.id}"`);
      seen.add(rule.id);
      const phase = this.byPhase[ELEMENT_PHASES.indexOf(rule.phase)];
      if (phase === undefined) throw new RangeError(`unknown element phase "${rule.phase}"`);
      return [phase, rule];
    });
    for (const [phase, rule] of placed) {
      phase.push(rule);
      this.ids.add(rule.id);
    }
    return this;
  }

  /** Every rule in the order it runs. */
  get rules(): readonly ElementRule[] {
    return this.byPhase.flat();
  }

  /** Runs every rule once, in order, against `world` and its element field. */
  run(world: World<never>): void {
    const ctx: ElementRuleContext = {
      world,
      field: elementFieldOf(world),
      tick: world.tick,
      hz: world.clock.hz,
    };
    for (const phase of this.byPhase) for (const rule of phase) rule.run(ctx);
  }
}

/**
 * The system that runs `rules` once per tick. Add it after `stimulusSystem` (so this tick's stimuli
 * have changed properties and the field) and before `elementFieldSystem` (so what the rules put into
 * the field diffuses this tick). Needs an installed element field.
 */
export function elementRulesSystem<TInput>(rules: ElementRuleSet): System<TInput> {
  return {
    name: 'element-rules',
    run: ({ world }) => {
      rules.run(world);
    },
  };
}
