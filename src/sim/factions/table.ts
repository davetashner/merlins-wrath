// The base faction table (mw-e12.8): the stances content declares, before play changes anything. It
// is built once from the `faction` content entries (see `factionSpecFromDef`), validated as a whole
// (the content loader checks each file and its refs; only the table can see that two factions
// disagree about a mutual relation) and then only read. It is not world state: what play changes
// lives in the world (runtime.ts), so saves hold only the changes and pick up retuned content.
//
// Lookup order for `base(from, to)`: the faction's own members → `towardMembers`; the player →
// `towardPlayer`; a relation `from` declares; the mirror of a `mutual` relation `to` declares toward
// `from`; otherwise `towardOthers`. The player's own row is always neutral: the player has no AI.

import type { GameEntry } from '@content/index';
import { mirrorStance, type Stance } from './stance';

/** The player's id in the table: `relation(creature, player)` reads the creature's `towardPlayer`. */
export const PLAYER_FACTION = 'player';

/** Faction a creature belongs to when its definition names none (a content entry). */
export const UNALIGNED_FACTION = 'unaligned';

/** One declared relation of a faction toward another. */
export interface FactionRelationSpec {
  readonly faction: string;
  readonly stance: Stance;
  /** The other faction takes the mirrored stance unless it declares its own. */
  readonly mutual: boolean;
}

/** One faction as the table needs it (plain data; see `factionSpecFromDef`). */
export interface FactionSpec {
  readonly id: string;
  readonly towardPlayer: Stance;
  readonly towardMembers: Stance;
  readonly towardOthers: Stance;
  readonly relations: readonly FactionRelationSpec[];
}

/** The validated base stances; read-only. */
export interface FactionTable {
  /** Faction ids, ascending (the player not included). */
  readonly ids: readonly string[];
  /** Whether `id` is a faction or the player. */
  has(id: string): boolean;
  /** The declared stance of `from` toward `to` (faction ids or `PLAYER_FACTION`). */
  base(from: string, to: string): Stance;
}

/** The table's specs contradict each other; `issues` lists every problem. */
export class FactionTableError extends Error {
  override readonly name = 'FactionTableError';

  constructor(readonly issues: readonly string[]) {
    super(`invalid faction table:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
  }
}

/** The table spec of a loaded `faction` content entry (refs become plain ids). */
export function factionSpecFromDef(def: GameEntry<'faction'>): FactionSpec {
  return {
    id: def.id,
    towardPlayer: def.towardPlayer,
    towardMembers: def.towardMembers,
    towardOthers: def.towardOthers,
    relations: def.relations.map((r) => ({
      faction: r.faction.id,
      stance: r.stance,
      mutual: r.mutual,
    })),
  };
}

function collectIssues(specs: readonly FactionSpec[]): string[] {
  const issues: string[] = [];
  const byId = new Map<string, FactionSpec>();
  for (const spec of specs) {
    if (spec.id === PLAYER_FACTION) issues.push(`"${PLAYER_FACTION}" is reserved for the player`);
    else if (byId.has(spec.id)) issues.push(`duplicate faction "${spec.id}"`);
    else byId.set(spec.id, spec);
  }
  for (const spec of byId.values()) {
    const seen = new Set<string>();
    for (const { faction, stance, mutual } of spec.relations) {
      const at = `${spec.id} → ${faction}`;
      if (faction === spec.id) issues.push(`${at}: a stance toward itself is towardMembers`);
      else if (seen.has(faction)) issues.push(`${at}: listed twice`);
      else if (!byId.has(faction)) issues.push(`${at}: unknown faction "${faction}"`);
      seen.add(faction);
      const answer = byId.get(faction)?.relations.find((r) => r.faction === spec.id);
      if (mutual && answer !== undefined && answer.stance !== mirrorStance(stance)) {
        issues.push(
          `${at}: mutual ${stance} expects ${faction} → ${spec.id} ${mirrorStance(stance)}, but it declares ${answer.stance}`,
        );
      }
    }
  }
  return issues;
}

/** Builds the base table; throws a FactionTableError listing every problem in `specs`. */
export function buildFactionTable(specs: readonly FactionSpec[]): FactionTable {
  const issues = collectIssues(specs);
  if (issues.length > 0) throw new FactionTableError(issues);

  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  /** `from\u0000to` → stance: declared relations, then mutual mirrors where undeclared. */
  const declared = new Map<string, Stance>();
  const key = (from: string, to: string) => `${from}\u0000${to}`;
  for (const spec of specs) {
    for (const r of spec.relations) declared.set(key(spec.id, r.faction), r.stance);
  }
  for (const spec of specs) {
    for (const r of spec.relations) {
      const back = key(r.faction, spec.id);
      if (r.mutual && !declared.has(back)) declared.set(back, mirrorStance(r.stance));
    }
  }

  const specOf = (id: string): FactionSpec => {
    const spec = byId.get(id);
    if (spec === undefined) throw new RangeError(`unknown faction "${id}"`);
    return spec;
  };
  const table: FactionTable = {
    ids: Object.freeze([...byId.keys()].sort()),
    has: (id) => id === PLAYER_FACTION || byId.has(id),
    base(from, to) {
      if (from === PLAYER_FACTION) {
        if (to !== PLAYER_FACTION) specOf(to);
        return 'neutral';
      }
      const spec = specOf(from);
      if (to === PLAYER_FACTION) return spec.towardPlayer;
      specOf(to);
      if (to === from) return spec.towardMembers;
      return declared.get(key(from, to)) ?? spec.towardOthers;
    },
  };
  return Object.freeze(table);
}
