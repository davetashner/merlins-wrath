// Breakable components (mw-e03.11): what makes an entity breakable, the debris a break leaves and the
// props it spills. A breakable's hit points and impact threshold are world properties (`hp`,
// `fragile`, and `frozen` for the shatter multiplier), so materials and placements set them like any
// other property; the component holds only what is specific to breaking: how much of each kind of hit
// the structure shrugs off, the debris it leaves, how loud it breaks, what it holds and the passage
// it reveals.

import { defineComponent, type EntityId } from '../core/component';
import type { BreakType } from '../properties/spec';

/** Share of each kind of hit the structure ignores, 0 (none) … 1 (immune); a kind left out is 0. */
export type BreakResistances = Readonly<Partial<Record<BreakType, number>>>;

/** The debris a break leaves: `count` cubes of `size` metres made of the broken thing's material. */
export interface BreakDebris {
  readonly count: number;
  readonly size: number;
}

/** A breakable profile (content `breakable`, e.g. an old wall, a barricade, pottery). */
export interface BreakableProfile {
  readonly id: string;
  readonly resistances: BreakResistances;
  readonly debris: BreakDebris;
  /** Noise of the break 1 m away, dB. */
  readonly breakLoudness: number;
}

/** Profile id → profile, or undefined when there is none. */
export type BreakableProfileLookup = (id: string) => BreakableProfile | undefined;

/** A breakable entity (`breakables.breakable`; a snapshot and save key, never renamed). */
export interface Breakable {
  readonly profile: string;
  readonly resistances: BreakResistances;
  readonly debris: BreakDebris;
  readonly breakLoudness: number;
  /** Prop ids spilled when it breaks, in order. */
  readonly contents: readonly string[];
  /** Passage id a `passageRevealed` names when it breaks (a wall hiding a route), or null. */
  readonly reveals: string | null;
}

export const BreakableComponent = defineComponent<Breakable>('breakables.breakable');

/** A piece of debris (`breakables.debris`): the tick it was made and what it came from. */
export interface Debris {
  readonly spawned: number;
  readonly from: EntityId;
}

export const DebrisComponent = defineComponent<Debris>('breakables.debris');

/** A prop a break spilled (`breakables.spilled`), so the game can draw it. */
export interface Spilled {
  readonly prop: string;
  readonly from: EntityId;
}

export const SpilledComponent = defineComponent<Spilled>('breakables.spilled');

/** Every live piece of debris, oldest first (`breakables.debris-ledger`, on one entity). */
export interface DebrisLedger {
  readonly live: readonly { readonly entity: EntityId; readonly spawned: number }[];
}

export const DebrisLedgerComponent = defineComponent<DebrisLedger>('breakables.debris-ledger');

/** Every component the breakables layer uses. */
export const BREAKABLE_COMPONENTS = [
  BreakableComponent,
  DebrisComponent,
  SpilledComponent,
  DebrisLedgerComponent,
] as const;
