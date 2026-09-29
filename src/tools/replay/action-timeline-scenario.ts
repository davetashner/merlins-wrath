// The action timeline golden replay (mw-e04.4 AC-6): the knight's shipped light chain and dodge roll
// driven through the action timeline by ActionFrames, with the stamina pool paying for each move.
// Its golden (tests/replays/action-timeline.json, a state hash on every tick) replays on every CI run,
// and tests/integration/action-timeline-replay.test.ts replays it 100 times.
//
// The input log is a 3-hit light chain (each follow-up buffered before the previous hit's recovery
// ends) and a dodge buffered in light 3's recovery, cancelling it when its dodge window opens.
//
// Lives in tools, not src/sim/replay/scenarios, because it reads the moves from game content, which
// the sim may import only as types. After an intended timeline or move-tuning change:
// `pnpm replay:rebless`; after changing the script below: `pnpm replay:record action-timeline --every
// 1 --no-states --force`.

import { loadGameContent } from '@content/game-content';
import { compileMoves, type MoveTable } from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionButton,
  actionFrame,
  actionTimelineSystem,
  actionVector,
  giveActionInput,
  giveActionTimeline,
  giveStamina,
  IDLE_ACTION_FRAME,
  StaminaComponent,
  staminaSystem,
  World,
  type ActionFrame,
  type ButtonAction,
  type ReplayScenario,
} from '@sim/index';
import { actionFrameCommand } from './action-frame-command';

/**
 * The buttons the golden binds. The light chain is the primary attack; the dodge sits on Ability 1
 * only for this recording — the knight's real dodge binding belongs to the dodge bead (e04.8).
 */
export const ACTION_TIMELINE_BINDINGS: Readonly<Partial<Record<ButtonAction, string>>> = {
  primaryAttack: 'sword-light-1',
  ability1: 'dodge-roll',
};

/** `[ticks, button pressed on the first of them]` stretches of the script; the rest are idle. */
export const ACTION_TIMELINE_SCRIPT: readonly (readonly [number, ButtonAction | null])[] = [
  [10, null],
  [28, 'primaryAttack'], // tick 10: light 1 (12/4/18, ends on 44)
  [34, 'primaryAttack'], // tick 38, 6 ticks before light 1 ends: light 2 on 44 (ends on 78)
  [31, 'primaryAttack'], // tick 72: light 3 on 78 (16/5/26; dodge window from 105)
  [97, 'ability1'], // tick 103, in light 3's recovery: the roll cancels it on 105
];

/** The script's length in ticks. */
export const ACTION_TIMELINE_TICKS = ACTION_TIMELINE_SCRIPT.reduce(
  (sum, [ticks]) => sum + ticks,
  0,
);

/** A frame with `button` pressed this tick (and nothing else). */
export function pressFrame(button: ButtonAction): ActionFrame {
  return actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) => actionButton(b === button, b === button, false),
  });
}

/** The ActionFrames the script expands to, one per tick. */
export function actionTimelineLog(): ActionFrame[] {
  return ACTION_TIMELINE_SCRIPT.flatMap(([ticks, button]) =>
    Array.from({ length: ticks }, (_, i) =>
      i === 0 && button !== null ? pressFrame(button) : IDLE_ACTION_FRAME,
    ),
  );
}

let shippedMoves: MoveTable | undefined;

/** The shipped move table (loaded once). */
export function shippedMoveTable(): MoveTable {
  shippedMoves ??= compileMoves(loadGameContent().all('move'));
  return shippedMoves;
}

/** A world with one knight: stamina, an action timeline and the golden's bindings. */
export function createActionTimelineWorld({
  seed,
  hz,
}: {
  readonly seed: number;
  readonly hz: number;
}): World<ActionFrame> {
  const world = new World<ActionFrame>({ seed, hz }).register(
    StaminaComponent,
    ...ACTION_TIMELINE_COMPONENTS,
  );
  world.addSystem(staminaSystem()).addSystem(actionTimelineSystem({ moves: shippedMoveTable() }));
  const knight = world.spawn();
  giveStamina(world, knight);
  giveActionTimeline(world, knight);
  giveActionInput(world, knight, ACTION_TIMELINE_BINDINGS);
  return world;
}

let log: readonly ActionFrame[] | undefined;

/** The replay scenario. */
export const actionTimelineScenario: ReplayScenario<ActionFrame> = {
  name: 'action-timeline',
  usesContent: true,
  command: actionFrameCommand,
  ticks: ACTION_TIMELINE_TICKS,
  create: createActionTimelineWorld,
  drive: ({ tick }) => {
    log ??= actionTimelineLog();
    const frame = log[tick];
    return frame === undefined ? [] : [frame];
  },
};
