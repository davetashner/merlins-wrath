// The capability registry in the running game (mw-e19.2): every world's registry declares the content
// capability ids (src/content/data/capability/), and the build decides what a grant or revoke of an
// undeclared id does. Dev and test builds throw, so a typo'd id fails at the line that granted it;
// production logs a warning and changes nothing, so one stray id never crashes a player's game.

import type { GameContent } from '@content/index';
import {
  CapabilityRegistry,
  type UnknownCapabilityError,
  type UnknownCapabilityPolicy,
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
