// Stances (mw-e12.8): the one vocabulary for how a creature or faction regards another, shared by
// perception, alerts, combat targeting and dialogue. Five stances form a ladder from ally to hostile
// that play moves along one step at a time (killing a goblin in front of its kin worsens the clan
// by one step; goodwill improves it). Prey and predator sit off the ladder: they describe a food
// chain, not a grudge. A hunter that is wronged turns hostile; a creature that flees a predator
// keeps fleeing however it is treated, and kindness only calms either to wary.
//
// The same list is the content enum (src/content/types/creature.ts `STANCES`); the contract test in
// tests/contracts/factions.test.ts keeps the two identical.

/** Every stance, from warmest to coldest, then the food-chain pair. */
export const STANCES = [
  'ally',
  'friendly',
  'neutral',
  'wary',
  'hostile',
  'prey',
  'predator',
] as const;

/** How one side regards the other. `prey`: it hunts them; `predator`: it fears and flees them. */
export type Stance = (typeof STANCES)[number];

/** Whether `value` is a stance name. */
export function isStance(value: unknown): value is Stance {
  return typeof value === 'string' && (STANCES as readonly string[]).includes(value);
}

/** One step colder on the ladder; off-ladder stances as documented on `worsenStance`. */
const COLDER: Readonly<Record<Stance, Stance>> = {
  ally: 'friendly',
  friendly: 'neutral',
  neutral: 'wary',
  wary: 'hostile',
  hostile: 'hostile',
  prey: 'hostile',
  predator: 'predator',
};

/** One step warmer on the ladder; off-ladder stances as documented on `improveStance`. */
const WARMER: Readonly<Record<Stance, Stance>> = {
  ally: 'ally',
  friendly: 'ally',
  neutral: 'friendly',
  wary: 'neutral',
  hostile: 'wary',
  prey: 'wary',
  predator: 'wary',
};

/**
 * One step colder: ally → friendly → neutral → wary → hostile (hostile stays). A hunter (`prey`)
 * that is wronged turns hostile; a creature that sees the other as its `predator` stays so.
 */
export function worsenStance(stance: Stance): Stance {
  return COLDER[stance];
}

/**
 * One step warmer: hostile → wary → neutral → friendly → ally (ally stays). Kindness calms a hunter
 * or a frightened creature to wary.
 */
export function improveStance(stance: Stance): Stance {
  return WARMER[stance];
}

/** The stance the other side takes in a mutual relation: prey ↔ predator, anything else unchanged. */
export function mirrorStance(stance: Stance): Stance {
  if (stance === 'prey') return 'predator';
  if (stance === 'predator') return 'prey';
  return stance;
}

/** Ally or friendly: it shares alerts with them and never targets them. */
export function isFriendlyStance(stance: Stance): boolean {
  return stance === 'ally' || stance === 'friendly';
}

/** Hostile or prey: it will attack them on sight. */
export function isAggressiveStance(stance: Stance): boolean {
  return stance === 'hostile' || stance === 'prey';
}
