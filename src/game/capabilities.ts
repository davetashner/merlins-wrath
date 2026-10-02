// The capability registry in the running game (mw-e19.2): every world's registry declares the content
// capability ids (src/content/data/capability/), and the build decides what a grant or revoke of an
// undeclared id does. Dev and test builds throw, so a typo'd id fails at the line that granted it;
// production logs a warning and changes nothing, so one stray id never crashes a player's game.
// The unlock book (mw-e19.3) is the learn API over that registry, built from the content's unlock
// definitions (src/content/data/unlock/); class channels (mw-e19.7–mw-e19.11) call its `learn`.

import type { GameContent } from '@content/index';
import {
  CapabilityRegistry,
  UnlockBook,
  type LearnRule,
  type UnknownCapabilityError,
  type UnknownCapabilityPolicy,
  type UnlockDef,
} from '@sim/index';

/** The undeclared-capability policy for a dev/test (`throw`) or production (`ignore` + `warn`) build. */
export function unknownCapabilityPolicy(
  dev: boolean,
  warn: (error: UnknownCapabilityError) => void = (error) => {
    console.warn(error.message);
  },
): UnknownCapabilityPolicy {
  return dev ? { mode: 'throw' } : { mode: 'ignore', warn };
}

/** A registry of every capability the content declares, with the build's policy for the rest. */
export function createCapabilityRegistry(
  content: GameContent,
  dev: boolean = import.meta.env.DEV,
): CapabilityRegistry {
  const ids = content.all('capability').flatMap((group) => group.capabilities.map(({ id }) => id));
  return new CapabilityRegistry(ids, unknownCapabilityPolicy(dev));
}

/** The content's unlock definitions, in file order. */
export function unlockDefs(content: GameContent): readonly UnlockDef[] {
  return content.all('unlock').flatMap((group) =>
    group.unlocks.map(({ capability, prerequisites, requirements, channels, replaces }) => ({
      capability,
      prerequisites,
      channels,
      ...(requirements !== undefined && { requirements }),
      ...(replaces !== undefined && { replaces }),
    })),
  );
}

/**
 * The learn API over `registry` with every unlock the content defines. `rules` are extra learn
 * checks, e.g. the cross-class rule (mw-e19.16).
 */
export function createUnlockBook(
  content: GameContent,
  registry: CapabilityRegistry,
  rules: readonly LearnRule[] = [],
): UnlockBook {
  return new UnlockBook(registry, unlockDefs(content), rules);
}
