// Every scenario a golden replay may name (mw-e02.7): the sim's own (src/sim/replay/scenarios) plus
// the ones that need game content, such as the character controller, action timeline and dodge
// timing goldens.
// The vitest helper (expectReplay) and pnpm replay:* resolve replay files against this registry.

import { replayScenarios, type ReplayScenario } from '@sim/index';
import { actionTimelineScenario } from './action-timeline-scenario';
import { characterGoldens, characterScenario } from './character-scenarios';
import { dodgeEarlyScenario, dodgeOnTimeScenario } from './dodge-timing-scenario';

export const goldenScenarios: Readonly<Record<string, ReplayScenario<unknown>>> = {
  ...replayScenarios,
  ...Object.fromEntries(characterGoldens.map((golden) => [golden.name, characterScenario(golden)])),
  [actionTimelineScenario.name]: actionTimelineScenario,
  [dodgeOnTimeScenario.name]: dodgeOnTimeScenario,
  [dodgeEarlyScenario.name]: dodgeEarlyScenario,
};
