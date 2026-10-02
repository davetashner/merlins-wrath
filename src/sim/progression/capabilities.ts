// The capability registry (mw-e19.2): one answer to "can this actor do X?" for dialogue, quests,
// puzzles, interaction prompts, equipment and traversal, instead of class checks scattered through
// code. Capabilities are declared as content (src/content/data/capability/); this is the runtime
// half. An actor holds a capability while at least one source grants it (ADR-0004): `class` and the
// learned sources (`learned`, `book:<id>`, `trainer:<id>`, `schematic:<id>`, `trick:<id>`,
// `deed:<id>`) are permanent; `equipment:<id>`, `tool:<id>` and `temporary:<effectId>` last while the
// item is held or the effect runs, and whoever granted them revokes them. Grants are counted by
// distinct source, so the same source granting twice is one grant, and `capability.gained` /
// `capability.lost` fire only when the count goes 0 → 1 / 1 → 0.
//
// State is plain data on the actor (`progression.capabilities`: capability id → its sources, both
// sorted), so world snapshots, saves, replays and the state hash carry it like any component. The
// component is added once (`addCapabilities`, at install, since structural changes during a tick
// are deferred); grants and revokes then replace its value immediately, so several in one tick
// count correctly.
//
// Granting or revoking an id the registry does not declare is a bug in the caller: the `throw`
// policy (dev and test builds) throws UnknownCapabilityError, and the `ignore` policy (production)
// reports it to `warn` and changes nothing, so a stray id never crashes a player's game (the build
// picks the policy in src/game/capabilities.ts). Unlock rules and prerequisites are mw-e19.3.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';

/** A capability holder's grants (`progression.capabilities`; a snapshot and save key, never renamed). */
export interface CapabilityGrants {
  /** Capability id → the sources granting it, sorted; an id with no source is absent. */
  readonly sources: Readonly<Record<string, readonly string[]>>;
}

export const CapabilitiesComponent = defineComponent<CapabilityGrants>('progression.capabilities');

/** One capability gained or lost by an actor. */
export interface CapabilityChange {
  readonly tick: number;
  readonly actor: EntityId;
  readonly capability: string;
  /** The source whose grant (gained) or revoke (lost) made the change. */
  readonly source: string;
}

/** An actor's first source for a capability was granted. */
export const capabilityGained = defineEvent<CapabilityChange>('capability.gained');
/** An actor's last source for a capability was revoked. */
export const capabilityLost = defineEvent<CapabilityChange>('capability.lost');

/**
 * A capability source: `class`, `learned`, or a kind and a reference, e.g. `equipment:lantern`,
 * `book:vesperine-hours`, `temporary:haste-3` (ADR-0004).
 */
export const CAPABILITY_SOURCE_PATTERN =
  /^(?:class|learned|(?:book|trainer|schematic|trick|deed|equipment|tool|temporary):[a-z0-9][a-z0-9._/-]*)$/;

/** Whether `source` names a capability source (see CAPABILITY_SOURCE_PATTERN). */
export function isCapabilitySource(source: string): boolean {
  return CAPABILITY_SOURCE_PATTERN.test(source);
}

/** Thrown, under the `throw` policy, for a grant or revoke of an id the registry does not declare. */
export class UnknownCapabilityError extends Error {
  override readonly name = 'UnknownCapabilityError';

  constructor(readonly capability: string) {
    super(`capability "${capability}" is not declared: add it to src/content/data/capability/`);
  }
}

/**
 * What a grant or revoke of an undeclared capability does:
 * - `throw`: it throws an UnknownCapabilityError (dev and test builds).
 * - `ignore`: nothing changes and `warn` is called with the error (production builds).
 */
export type UnknownCapabilityPolicy =
  | { readonly mode: 'throw' }
  | { readonly mode: 'ignore'; readonly warn: (error: UnknownCapabilityError) => void };

/**
 * Gives `actor` an (empty) capability set. Call once per actor, when it is installed: grants need
 * it in place, and adding it is a structural change, deferred to the end of the tick in a step.
 */
export function addCapabilities(world: World, actor: EntityId): void {
  if (!world.isRegistered(CapabilitiesComponent)) world.register(CapabilitiesComponent);
  world.add(actor, CapabilitiesComponent, { sources: {} });
}

const sourcesIn = (world: World, actor: EntityId): CapabilityGrants['sources'] =>
  world.isRegistered(CapabilitiesComponent)
    ? (world.get(actor, CapabilitiesComponent)?.sources ?? {})
    : {};

/** Whether `actor` has `capability` (any source); false for an actor with no capability set. */
export function hasCapability(world: World, actor: EntityId, capability: string): boolean {
  return Object.hasOwn(sourcesIn(world, actor), capability);
}

/** The sources granting `actor` the `capability`, sorted; empty when it does not have it. */
export function capabilitySources(
  world: World,
  actor: EntityId,
  capability: string,
): readonly string[] {
  // Own keys only: a capability id never reads an inherited Object.prototype member.
  return Object.entries(sourcesIn(world, actor)).find(([id]) => id === capability)?.[1] ?? [];
}

/**
 * Every capability `actor` has, sorted (code-unit order); none for no actor (a character controller
 * running outside a world).
 */
export function capabilitiesOf(world: World, actor: EntityId | undefined): readonly string[] {
  return actor === undefined ? [] : Object.keys(sourcesIn(world, actor)).sort();
}

/** Code-unit order without locale rules. */
const byCodeUnit = (a: string, b: string): number => Number(a > b) - Number(a < b);

/** The declared capabilities and the policy for undeclared ones; grants and revokes go through it. */
export class CapabilityRegistry {
  readonly #ids: ReadonlySet<string>;
  readonly #policy: UnknownCapabilityPolicy;

  /** `ids`: every declared capability id (the content registry's). */
  constructor(ids: Iterable<string>, policy: UnknownCapabilityPolicy = { mode: 'throw' }) {
    this.#ids = new Set(ids);
    this.#policy = policy;
  }

  /** Whether `capability` is declared. */
  isDefined(capability: string): boolean {
    return this.#ids.has(capability);
  }

  /**
   * Grants `capability` to `actor` from `source`. Returns true when the actor gained it (its first
   * source), and then emits `capability.gained`; a further source, or the same one again, emits
   * nothing.
   * @throws UnknownCapabilityError for an undeclared id under the `throw` policy.
   * @throws RangeError for a malformed source, or an actor without a capability set.
   */
  grant(world: World, actor: EntityId, capability: string, source: string): boolean {
    const grants = this.#prepare(world, actor, capability, source);
    if (grants === undefined) return false;
    const held = grants.sources[capability];
    if (held?.includes(source) === true) return false;
    const next = [...(held ?? []), source].sort(byCodeUnit);
    world.set(actor, CapabilitiesComponent, {
      sources: { ...grants.sources, [capability]: next },
    });
    if (held !== undefined) return false;
    world.events.emit(capabilityGained, { tick: world.tick, actor, capability, source });
    return true;
  }

  /**
   * Revokes `source`'s grant of `capability` from `actor`. Returns true when the actor lost it (its
   * last source), and then emits `capability.lost`; a revoke while other sources still grant it, or
   * from a source that never granted it, emits nothing.
   * @throws UnknownCapabilityError for an undeclared id under the `throw` policy.
   * @throws RangeError for a malformed source, or an actor without a capability set.
   */
  revoke(world: World, actor: EntityId, capability: string, source: string): boolean {
    const grants = this.#prepare(world, actor, capability, source);
    const held = grants?.sources[capability];
    if (grants === undefined || held?.includes(source) !== true) return false;
    const rest = held.filter((s) => s !== source);
    const others = Object.entries(grants.sources).filter(([id]) => id !== capability);
    const sources = Object.fromEntries(rest.length > 0 ? [...others, [capability, rest]] : others);
    world.set(actor, CapabilitiesComponent, { sources });
    if (rest.length > 0) return false;
    world.events.emit(capabilityLost, { tick: world.tick, actor, capability, source });
    return true;
  }

  /** The actor's grants, or undefined for an undeclared id under the `ignore` policy. */
  #prepare(
    world: World,
    actor: EntityId,
    capability: string,
    source: string,
  ): CapabilityGrants | undefined {
    if (!isCapabilitySource(source)) {
      throw new RangeError(
        `"${source}" is not a capability source, e.g. "class" or "equipment:lantern"`,
      );
    }
    const grants = world.isRegistered(CapabilitiesComponent)
      ? world.get(actor, CapabilitiesComponent)
      : undefined;
    if (grants === undefined) {
      throw new RangeError(
        `entity ${String(actor)} has no capability set: call addCapabilities when installing it`,
      );
    }
    if (this.#ids.has(capability)) return grants;
    const error = new UnknownCapabilityError(capability);
    if (this.#policy.mode === 'throw') throw error;
    this.#policy.warn(error);
    return undefined;
  }
}
