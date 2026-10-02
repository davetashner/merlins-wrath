// Capability-unlock progression (mw-e19.3, ADR-0004): the rule engine every class channel (books,
// trainers, schematics, tricks, deeds) plugs into. An unlock definition says how a capability is
// learned: the capabilities it builds on (prerequisites), the world-fact conditions that must hold
// (requirements), the channels that may teach it, and optionally the capability it replaces. A
// replacing unlock subsumes its predecessor (ADR-0004: Telekinesis still pulls levers like Mage
// Hand), so the predecessor's `learned` grant is handed over to the new capability in one call and
// the predecessor still counts as known for prerequisites and re-learning.
//
// `learn` checks everything first and only then changes state, so a refusal changes nothing and a
// learn either happens whole or not at all. Refusals carry every reason at once ("why can't I learn
// this"), in a fixed order: channel, prerequisites (definition order), requirements, then extra
// rules. Extra rules are the hook for checks owned elsewhere: the cross-class simple rule
// (mw-e19.16) plugs in there. Learned capabilities are granted with the permanent `learned` source
// and live on the actor's capability set (src/sim/progression/capabilities.ts), which saves carry.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import {
  compileCondition,
  type CompiledCondition,
  type Condition,
  type ConditionExplanation,
} from '../facts/conditions';
import { capabilitySources, hasCapability, type CapabilityRegistry } from './capabilities';

/** The in-world channels that teach capabilities (ADR-0004, "Per-class unlock channels"). */
export const UNLOCK_CHANNELS = ['book', 'trainer', 'schematic', 'trick', 'deed'] as const;

/** A kind of teaching channel, e.g. `book`. */
export type UnlockChannel = (typeof UNLOCK_CHANNELS)[number];

/** A teaching channel instance: its kind and what taught it, e.g. `book:vesperine-hours`. */
export const LEARN_CHANNEL_PATTERN = /^(book|trainer|schematic|trick|deed):[a-z0-9][a-z0-9._/-]*$/;

/** The source a learned capability is granted with (ADR-0004: permanent). */
export const LEARNED_SOURCE = 'learned';

/** How one capability is learned. */
export interface UnlockDef {
  /** The capability this unlock grants. */
  readonly capability: string;
  /** Capabilities the learner must already know (held, or subsumed by one held). */
  readonly prerequisites: readonly string[];
  /** World-fact conditions that must hold when learning; absent = none. */
  readonly requirements?: Condition;
  /** The channel kinds that may teach it (at least one). */
  readonly channels: readonly UnlockChannel[];
  /** A capability this one replaces and subsumes; its `learned` grant moves to this one. */
  readonly replaces?: string;
}

/** A reason a capability cannot be learned (yet). */
export type LearnRefusal =
  /** No unlock definition: nothing teaches this capability. */
  | { readonly reason: 'not-learnable' }
  /** The channel's kind is not one the definition allows. */
  | {
      readonly reason: 'wrong-channel';
      readonly channel: string;
      readonly allowed: readonly UnlockChannel[];
    }
  /** A prerequisite the learner does not know. */
  | { readonly reason: 'missing-prerequisite'; readonly capability: string }
  /** The requirements condition does not hold; the explanation says which part fails. */
  | { readonly reason: 'requirement-unmet'; readonly explanation: ConditionExplanation }
  /** An extra rule (LearnRule) refused, e.g. the cross-class rule; `key` is its text key. */
  | { readonly reason: 'rule'; readonly rule: string; readonly key: string };

/** What an extra learn rule sees. */
export interface LearnAttempt {
  readonly world: World;
  readonly actor: EntityId;
  readonly unlock: UnlockDef;
  /** The teaching channel, e.g. `book:vesperine-hours`. */
  readonly channel: string;
}

/**
 * An extra check on learning (the hook for rules owned by other beads, e.g. mw-e19.16's cross-class
 * rule). Returns a refusal, or undefined to allow. Must be deterministic and must not change state.
 */
export type LearnRule = (attempt: LearnAttempt) => LearnRefusal | undefined;

/** The outcome of checking or performing a learn. */
export type LearnResult =
  /** `learn`: granted. `check`: would be granted. `replaced` is the subsumed capability, if any. */
  | {
      readonly status: 'learned';
      readonly capability: string;
      readonly channel: string;
      readonly replaced?: string;
    }
  /** Already known (learned, a class grant, or subsumed by a known capability): a no-op. */
  | { readonly status: 'already-known'; readonly capability: string }
  /** Not learnable now, with every reason. Nothing changed. */
  | {
      readonly status: 'refused';
      readonly capability: string;
      readonly refusals: readonly LearnRefusal[];
    };

/** An actor learned a capability through a channel. */
export interface CapabilityLearned {
  readonly tick: number;
  readonly actor: EntityId;
  readonly capability: string;
  /** The teaching channel, e.g. `book:vesperine-hours`. */
  readonly channel: string;
  /** The capability it replaced (its `learned` grant was revoked in the same call), if any. */
  readonly replaced?: string;
}

/** An actor learned a capability (once per learn; never for an already-known one). */
export const progressionLearned = defineEvent<CapabilityLearned>('progression.learned');

/** One line per refusal, e.g. `missing-prerequisite: spell.ember` (logs, debug tools, tests). */
export function refusalText(refusal: LearnRefusal): string {
  switch (refusal.reason) {
    case 'not-learnable':
      return 'not-learnable';
    case 'wrong-channel':
      return `wrong-channel: ${refusal.channel} (taught by ${refusal.allowed.join(', ')})`;
    case 'missing-prerequisite':
      return `missing-prerequisite: ${refusal.capability}`;
    case 'requirement-unmet':
      return `requirement-unmet: ${refusal.explanation.text}`;
    case 'rule':
      return `${refusal.rule}: ${refusal.key}`;
  }
}

/** Item and effect sources: they come and go with the item, so they don't make a capability known. */
const TRANSIENT_SOURCE = /^(?:equipment|tool|temporary):/;

interface Compiled {
  readonly def: UnlockDef;
  readonly requirements: CompiledCondition | undefined;
}

/** The unlock definitions and the learn API over a capability registry. */
export class UnlockBook {
  readonly #registry: CapabilityRegistry;
  readonly #unlocks: ReadonlyMap<string, Compiled>;
  /** Capability → the capabilities that (transitively) replace it, sorted. */
  readonly #subsumers: ReadonlyMap<string, readonly string[]>;
  readonly #rules: readonly LearnRule[];

  /**
   * @param registry grants and revokes go through it.
   * @param unlocks one definition per capability (content checks them at load: mw-e19.3 AC-6).
   * @param rules extra checks run after the built-in ones, in order.
   * @throws RangeError for a duplicate definition, an undeclared capability, a definition without
   *   channels or one replacing itself.
   * @throws ConditionError for a malformed requirements condition.
   */
  constructor(
    registry: CapabilityRegistry,
    unlocks: Iterable<UnlockDef>,
    rules: readonly LearnRule[] = [],
  ) {
    this.#registry = registry;
    this.#rules = rules;
    const byCapability = new Map<string, Compiled>();
    for (const def of unlocks) {
      const { capability, prerequisites, replaces } = def;
      if (byCapability.has(capability)) {
        throw new RangeError(`unlock for "${capability}" is defined twice`);
      }
      for (const id of [
        capability,
        ...prerequisites,
        ...(replaces === undefined ? [] : [replaces]),
      ])
        if (!registry.isDefined(id)) {
          throw new RangeError(`unlock for "${capability}" names undeclared capability "${id}"`);
        }
      if (def.channels.length === 0) {
        throw new RangeError(`unlock for "${capability}" has no channel`);
      }
      if (replaces === capability) {
        throw new RangeError(`unlock for "${capability}" replaces itself`);
      }
      const requirements =
        def.requirements === undefined ? undefined : compileCondition(def.requirements);
      byCapability.set(capability, { def, requirements });
    }
    this.#unlocks = byCapability;
    this.#subsumers = subsumersOf([...byCapability.values()].map(({ def }) => def));
  }

  /** The unlock definition for `capability`, if anything teaches it. */
  unlockFor(capability: string): UnlockDef | undefined {
    return this.#unlocks.get(capability)?.def;
  }

  /**
   * Whether `actor` knows `capability`: a permanent source grants it (class, learned, a deed…), or
   * it is subsumed by a capability the actor knows. An item or effect grant alone does not count.
   */
  knows(world: World, actor: EntityId, capability: string): boolean {
    return [capability, ...(this.#subsumers.get(capability) ?? [])].some((id) =>
      capabilitySources(world, actor, id).some((source) => !TRANSIENT_SOURCE.test(source)),
    );
  }

  /**
   * What learning `capability` through `channel` would do, without doing it: the "why can't I learn
   * this" answer for UI and dialogue.
   * @throws RangeError for a malformed channel (e.g. `book` without what book).
   */
  check(world: World, actor: EntityId, capability: string, channel: string): LearnResult {
    if (!LEARN_CHANNEL_PATTERN.test(channel)) {
      throw new RangeError(`"${channel}" is not a learn channel, e.g. "book:vesperine-hours"`);
    }
    const compiled = this.#unlocks.get(capability);
    if (compiled === undefined) {
      return { status: 'refused', capability, refusals: [{ reason: 'not-learnable' }] };
    }
    if (this.knows(world, actor, capability)) return { status: 'already-known', capability };
    const { def, requirements } = compiled;
    const refusals: LearnRefusal[] = [];
    const kind = channel.slice(0, channel.indexOf(':')) as UnlockChannel;
    if (!def.channels.includes(kind)) {
      refusals.push({ reason: 'wrong-channel', channel, allowed: def.channels });
    }
    for (const prerequisite of def.prerequisites) {
      if (!this.#holds(world, actor, prerequisite)) {
        refusals.push({ reason: 'missing-prerequisite', capability: prerequisite });
      }
    }
    if (requirements !== undefined && !requirements.evaluate(world.facts)) {
      refusals.push({
        reason: 'requirement-unmet',
        explanation: requirements.explain(world.facts),
      });
    }
    for (const rule of this.#rules) {
      const refusal = rule({ world, actor, unlock: def, channel });
      if (refusal !== undefined) refusals.push(refusal);
    }
    if (refusals.length > 0) return { status: 'refused', capability, refusals };
    return {
      status: 'learned',
      capability,
      channel,
      ...(def.replaces !== undefined && { replaced: def.replaces }),
    };
  }

  /**
   * Learns `capability` through `channel` (e.g. `book:vesperine-hours`): when `check` allows it, the
   * capability is granted with source `learned`, a replaced capability's `learned` grant is revoked
   * in the same call, and `progression.learned` is emitted with the channel. Otherwise nothing
   * changes and the result says why (or that it is already known).
   * @throws RangeError for a malformed channel, or an actor without a capability set.
   */
  learn(world: World, actor: EntityId, capability: string, channel: string): LearnResult {
    const result = this.check(world, actor, capability, channel);
    if (result.status !== 'learned') return result;
    // Grant before revoking, so the actor never holds neither; events are queued until the flush.
    this.#registry.grant(world, actor, capability, LEARNED_SOURCE);
    if (result.replaced !== undefined) {
      this.#registry.revoke(world, actor, result.replaced, LEARNED_SOURCE);
    }
    world.events.emit(progressionLearned, {
      tick: world.tick,
      actor,
      capability,
      channel,
      ...(result.replaced !== undefined && { replaced: result.replaced }),
    });
    return result;
  }

  /** A prerequisite holds while any source grants it or a capability that subsumes it. */
  #holds(world: World, actor: EntityId, capability: string): boolean {
    return [capability, ...(this.#subsumers.get(capability) ?? [])].some((id) =>
      hasCapability(world, actor, id),
    );
  }
}

/** Capability → every capability that replaces it directly or through a chain of replacements. */
function subsumersOf(defs: readonly UnlockDef[]): ReadonlyMap<string, readonly string[]> {
  const replacedBy = new Map<string, string[]>();
  for (const { capability, replaces } of defs) {
    if (replaces !== undefined)
      replacedBy.set(replaces, [...(replacedBy.get(replaces) ?? []), capability]);
  }
  const result = new Map<string, readonly string[]>();
  for (const [start, direct] of replacedBy) {
    const seen = new Set<string>();
    const stack = [...direct];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      // A replacement cycle is a content error (AC-6); the visited set keeps this finite anyway.
      if (next === start || seen.has(next)) continue;
      seen.add(next);
      stack.push(...(replacedBy.get(next) ?? []));
    }
    result.set(start, [...seen].sort());
  }
  return result;
}
