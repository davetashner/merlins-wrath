// World facts in the running game (mw-e27.2): every world declares the content fact registry, and
// the build decides what an undeclared write does. Dev and test builds throw, so a typo'd fact key
// fails at the line that wrote it; production logs a warning and drops the write, so one stray key
// never crashes a player's game.

import type { GameContent } from '@content/index';
import {
  declareFacts,
  type FactStore,
  type UndeclaredFactError,
  type UndeclaredFactPolicy,
} from '@sim/index';

/** The undeclared-fact policy for a dev/test (`throw`) or production (`ignore` + `warn`) build. */
export function undeclaredFactPolicy(
  dev: boolean,
  warn: (error: UndeclaredFactError) => void = (error) => {
    console.warn(error.message);
  },
): UndeclaredFactPolicy {
  return dev ? { mode: 'throw' } : { mode: 'ignore', warn };
}

/**
 * Declares every registry fact on a world's fact store (`world.facts`) with the build's policy for
 * undeclared writes. Call once per world, before any system runs.
 */
export function installFactRegistry(
  store: FactStore,
  content: GameContent,
  dev: boolean = import.meta.env.DEV,
): FactStore {
  return declareFacts(store, content.all('fact'), undeclaredFactPolicy(dev));
}
