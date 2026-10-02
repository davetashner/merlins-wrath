// The parry timing goldens (mw-e04.12 AC-7): the sandbox's attacker dummy swings once at a knight who
// parries it, pressed so that the swing's first sweep lands on the parry's first window tick (move
// tick 4: parried), on its last (tick 13: parried), or with the parry pressed one tick late, so the
// sweep lands on its last startup tick (tick 3: struck). Everything runs through the shipped moves:
// the action timeline (both), stamina and the knight's parry binding (ability 3), the dummy's swing
// opened by the melee strikes and swept against the knight's hurtbox, the damage model with the parry
// rules (installParry: deflection, the Parried stun, counter-hits) and the hit-stop table's freezes.
// Each variant is a golden (tests/replays/parry-*.json, a state hash on every tick) and
// tests/integration/parry-replay.test.ts replays each 100 times.
//
// After an intended timing or move-tuning change: `pnpm replay:rebless`; after changing this script:
// `pnpm replay:record parry-first-tick --every 1 --no-states --force` (and the other two).

import { loadGameContent } from '@content/game-content';
import { compileHitStop, compileSocketTracks, HIT_STOP_ID } from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionButton,
  actionFrame,
  actionTimelineSystem,
  actionVector,
  DAMAGE_COMPONENTS,
  DamageModel,
  giveActionInput,
  giveActionTimeline,
  giveCombatant,
  giveFacing,
  giveHitboxes,
  giveHurtboxes,
  giveStamina,
  HIT_VOLUME_COMPONENTS,
  HitStopComponent,
  hitVolumeSystem,
  IDLE_ACTION_FRAME,
  installHitStop,
  installMeleeStrikes,
  installParry,
  KNIGHT_PARRY,
  MELEE_COMPONENTS,
  noAllies,
  PlacementComponent,
  placeEntity,
  requestMove,
  StaminaComponent,
  staminaSystem,
  World,
  type ActionFrame,
  type EntityId,
  type ReplayScenario,
  type System,
} from '@sim/index';
import { actionFrameCommand } from './action-frame-command';
import { shippedMoveTable } from './action-timeline-scenario';
import { DUMMY_SWING, FIRST_SWEEP_TICK, SWING_TICK } from './dodge-timing-scenario';

/** The knight's parry window, move ticks (shield-parry: its active ticks). */
export const PARRY_WINDOW = { first: 4, last: 13 } as const;

/**
 * Parry presses: the swing's first sweep lands on the window's first tick, its last tick, or — the
 * parry pressed one tick late — on the tick before the window opens.
 */
export const PARRY_PRESS = {
  firstTick: FIRST_SWEEP_TICK - PARRY_WINDOW.first,
  lastTick: FIRST_SWEEP_TICK - PARRY_WINDOW.last,
  oneLate: FIRST_SWEEP_TICK - PARRY_WINDOW.first + 1,
} as const;

/** Each golden's length in ticks: the swing, the parry, the stun and some quiet after. */
export const PARRY_TIMING_TICKS = 180;

/** A frame with the parry button (ability 3) pressed. */
export function parryFrame(): ActionFrame {
  return actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) => actionButton(b === 'ability3', b === 'ability3', false),
  });
}

/** The dummy's metronome: it asks for its swing on SWING_TICK (run before the timeline). */
function metronome(dummy: EntityId): System<ActionFrame> {
  return {
    name: 'parry-timing-metronome',
    run: ({ world }) => {
      if (world.tick === SWING_TICK) requestMove(world, dummy, DUMMY_SWING);
    },
  };
}

/**
 * A parry timing world: the knight (entity 1: stamina, timeline, the parry on ability 3, hurtbox,
 * health, poise) and the dummy (entity 2: timeline, hitboxes, hurtbox, health) 1.2 m in front of it,
 * facing it.
 */
export function createParryTimingWorld({
  seed,
  hz,
}: {
  readonly seed: number;
  readonly hz: number;
}): World<ActionFrame> {
  const content = loadGameContent();
  const moves = shippedMoveTable();
  const world = new World<ActionFrame>({ seed, hz }).register(
    StaminaComponent,
    ...ACTION_TIMELINE_COMPONENTS,
    ...MELEE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
    HitStopComponent,
  );
  const torso = {
    id: 'torso',
    socket: 'root',
    region: 'torso',
    armored: false,
    multiplier: 1,
    shape: {
      kind: 'capsule',
      from: { x: 0, y: 0.4, z: 0 },
      to: { x: 0, y: 1.4, z: 0 },
      radius: 0.4,
    },
  } as const;
  const knight = world.spawn();
  placeEntity(world, knight, { x: 0, y: 0, z: 0 }, 0.4);
  giveHurtboxes(world, knight, { boxes: [torso] });
  giveCombatant(world, knight, { health: 100, poise: 50, player: true });
  giveStamina(world, knight);
  giveActionTimeline(world, knight);
  giveActionInput(world, knight, { ability3: KNIGHT_PARRY });
  giveFacing(world, knight, { x: 0, y: 0, z: -1 });

  const dummy = world.spawn();
  placeEntity(world, dummy, { x: 0, y: 0, z: -1.2 }, 0.4);
  giveFacing(world, dummy, { x: 0, y: 0, z: 1 });
  giveActionTimeline(world, dummy);
  giveHitboxes(world, dummy);
  giveHurtboxes(world, dummy, { facing: { x: 0, y: 0, z: 1 }, boxes: [torso] });
  giveCombatant(world, dummy, { health: 1000 });

  const damage = new DamageModel();
  const hitStop = compileHitStop(content.get('hit-stop', HIT_STOP_ID));
  world
    .addSystem(staminaSystem())
    .addSystem(metronome(dummy))
    .addSystem(actionTimelineSystem({ moves }))
    .addSystem(hitVolumeSystem({ isAlly: noAllies }));
  installMeleeStrikes(world, {
    moves,
    tracks: compileSocketTracks(content.all('socket-track')),
    damage,
  });
  installHitStop(world, { moves, table: hitStop });
  installParry(world, { moves, damage, hitStop });
  return world;
}

/** The ActionFrames of a golden: idle but for the parry press on `pressTick`. */
export function parryTimingLog(pressTick: number): ActionFrame[] {
  return Array.from({ length: PARRY_TIMING_TICKS }, (_, tick) =>
    tick === pressTick ? parryFrame() : IDLE_ACTION_FRAME,
  );
}

/** One variant's replay scenario. */
export function parryTimingScenario(name: string, pressTick: number): ReplayScenario<ActionFrame> {
  let log: readonly ActionFrame[] | undefined;
  return {
    name,
    usesContent: true,
    command: actionFrameCommand,
    ticks: PARRY_TIMING_TICKS,
    create: createParryTimingWorld,
    drive: ({ tick }) => {
      log ??= parryTimingLog(pressTick);
      const frame = log[tick];
      return frame === undefined ? [] : [frame];
    },
  };
}

/** The swing lands on the parry's first window tick: parried. */
export const parryFirstTickScenario = parryTimingScenario(
  'parry-first-tick',
  PARRY_PRESS.firstTick,
);

/** The swing lands on the parry's last window tick: parried. */
export const parryLastTickScenario = parryTimingScenario('parry-last-tick', PARRY_PRESS.lastTick);

/** The parry pressed one tick late: the swing lands on its last startup tick and strikes. */
export const parryOneLateScenario = parryTimingScenario('parry-one-tick-late', PARRY_PRESS.oneLate);
