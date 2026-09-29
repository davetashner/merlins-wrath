// Every scenario a golden replay may name (mw-e02.7): the sim's own (src/sim/replay/scenarios) plus
// the ones that need game content, such as the character controller and action timeline goldens.
// The vitest helper (expectReplay) and pnpm replay:* resolve replay files against this registry.

import { replayScenarios, type ReplayScenario } from '@sim/index';
import { actionTimelineScenario } from './action-timeline-scenario';
import { characterGoldens, characterScenario } from './character-scenarios';

export const goldenScenarios: Readonly<Record<string, ReplayScenario<unknown>>> = {
  ...replayScenarios,
  ...Object.fromEntries(characterGoldens.map((golden) => [golden.name, characterScenario(golden)])),
  [actionTimelineScenario.name]: actionTimelineScenario,
};
