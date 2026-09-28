// Registered replay scenarios (mw-e00.17), keyed by the name stored in replay files. A feature that
// ships golden replays adds its scenario here.

import type { ReplayScenario } from '../scenario';
import { coreScenario } from './core';

/** Every scenario a replay file may name. */
export const replayScenarios: Readonly<Record<string, ReplayScenario<unknown>>> = {
  [coreScenario.name]: coreScenario,
};
