// The dodge timing goldens (mw-e04.8 AC-5): the sandbox's attacker dummy swings once at a knight who
// rolls through it, pressed so that the roll's last i-frame (move tick 14) meets the dummy's first
// sweep ("on time", dodged), or one tick earlier so the i-frames end a tick before the swing lands
// ("early", hit). Everything runs through the shipped moves: the action timeline (both), the dodge
// rules and stamina (knight), the move's hit volume swept against the knight's hurtbox with the
// timeline's i-frames, and the damage model. Each variant is a golden (tests/replays/dodge-*.json, a
// state hash on every tick) and tests/integration/dodge-replay.test.ts replays each 100 times.
//
// After an intended timing or move-tuning change: `pnpm replay:rebless`; after changing this script:
// `pnpm replay:record dodge-on-time --every 1 --no-states --force` (and dodge-early).

import { loadGameContent } from '@content/game-content';
import {
  compileSocketTracks,
  type DamageTemplate,
  type MoveTable,
  type RuntimeMove,
  type SocketTrackTable,
} from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionButton,
  actionFrame,
  actionOf,
  actionTimelineSystem,
  actionVector,
  DAMAGE_COMPONENTS,
  DamageModel,
  DodgeComponent,
  dodgeInputSystem,
  dodgeMotionSystem,
  giveActionInput,
  giveActionTimeline,
  giveCombatant,
  giveDodge,
  giveHitboxes,
  giveHurtboxes,
  giveStamina,
  HIT_VOLUME_COMPONENTS,
  HitboxHit,
  hitboxFromMove,
  hitPacket,
  hitVolumeSystem,
  IDLE_ACTION_FRAME,
  iframeRule,
  KNIGHT_DODGE,
  moveTrack,
  noAllies,
  openHitbox,
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

/** The dummy's move (18 startup ticks: its first sweep is 18 ticks after it starts). */
export const DUMMY_SWING = 'training-dummy-swing';

/** The tick the dummy starts its swing: the hit volume first sweeps on tick 48. */
export const SWING_TICK = 30;

/** The tick of the dummy's first sweep (its move's first active tick). */
export const FIRST_SWEEP_TICK = SWING_TICK + 18;

/** Roll presses: on time puts the roll's last i-frame (move tick 14) on the first sweep. */
export const DODGE_PRESS = { onTime: FIRST_SWEEP_TICK - 14, early: FIRST_SWEEP_TICK - 15 } as const;

/** Each golden's length in ticks: the swing, the roll and some quiet after. */
export const DODGE_TIMING_TICKS = 120;

/** A frame with dodge pressed and forward held (a roll, not a backstep). */
export function rollFrame(): ActionFrame {
  return actionFrame({
    move: actionVector(0, 1),
    look: actionVector(0, 0),
    buttons: (b) => actionButton(b === 'dodge', b === 'dodge', false),
  });
}

/** The dummy's swing from `moves`, with its damage template. Throws when it is missing or cannot hit. */
export function dummySwing(moves: MoveTable): RuntimeMove & { readonly damage: DamageTemplate } {
  const swing = moves.get(DUMMY_SWING);
  if (swing?.damage == null) throw new Error(`move "${DUMMY_SWING}" is missing or cannot hit`);
  return { ...swing, damage: swing.damage };
}

/** The dummy's metronome: it asks for its swing on SWING_TICK (run before the timeline). */
function metronome(dummy: EntityId): System<ActionFrame> {
  return {
    name: 'dodge-timing-metronome',
    run: ({ world }) => {
      if (world.tick === SWING_TICK) requestMove(world, dummy, DUMMY_SWING);
    },
  };
}

let shippedTracks: SocketTrackTable | undefined;

/**
 * Opens the swing's hit volume on the move's first active tick (run after the timeline); it sweeps
 * along the move's authored socket track (mw-e04.26).
 */
function swingHitbox(swing: RuntimeMove, dummy: EntityId): System<ActionFrame> {
  shippedTracks ??= compileSocketTracks(loadGameContent().all('socket-track'));
  const track = moveTrack(swing, shippedTracks);
  return {
    name: 'dodge-timing-hitbox',
    run: ({ world }) => {
      const current = actionOf(world, dummy);
      if (current?.move === swing.id && current.tick === swing.activeFrom) {
        openHitbox(world, dummy, hitboxFromMove(swing, track, { x: 0, y: 0, z: 1 }));
      }
    },
  };
}

/**
 * A dodge timing world: the knight (entity 1: dodge, stamina, timeline, hurtbox, health, poise) and
 * the dummy (entity 2) 1.2 m in front of it, facing it, its blade crossing the knight's torso.
 */
export function createDodgeTimingWorld({
  seed,
  hz,
}: {
  readonly seed: number;
  readonly hz: number;
}): World<ActionFrame> {
  const moves = shippedMoveTable();
  const swing = dummySwing(moves);
  const world = new World<ActionFrame>({ seed, hz }).register(
    StaminaComponent,
    ...ACTION_TIMELINE_COMPONENTS,
    DodgeComponent,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  const knight = world.spawn();
  placeEntity(world, knight, { x: 0, y: 0, z: 0 }, 0.4);
  giveHurtboxes(world, knight, {
    boxes: [
      {
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
      },
    ],
  });
  giveCombatant(world, knight, { health: 100, poise: 50, player: true });
  giveStamina(world, knight);
  giveActionTimeline(world, knight);
  giveActionInput(world, knight, {});
  giveDodge(world, knight, KNIGHT_DODGE);

  const dummy = world.spawn();
  placeEntity(world, dummy, { x: 0, y: 0, z: -1.2 }, 0.4);
  giveActionTimeline(world, dummy);
  giveHitboxes(world, dummy);

  // Only the dummy's swing ever hits: its damage template applies through the damage model.
  const damage = new DamageModel();
  world.events.on(HitboxHit, (hit) => {
    damage.apply(world, hit.target, hitPacket(hit, swing.damage));
  });
  world
    .addSystem(staminaSystem())
    .addSystem(metronome(dummy))
    .addSystem(dodgeInputSystem())
    .addSystem(actionTimelineSystem({ moves }))
    .addSystem(dodgeMotionSystem({ moves }))
    .addSystem(swingHitbox(swing, dummy))
    .addSystem(hitVolumeSystem({ isAlly: noAllies, invulnerable: iframeRule(moves) }));
  return world;
}

/** The ActionFrames of a golden: idle but for the roll press on `pressTick`. */
export function dodgeTimingLog(pressTick: number): ActionFrame[] {
  return Array.from({ length: DODGE_TIMING_TICKS }, (_, tick) =>
    tick === pressTick ? rollFrame() : IDLE_ACTION_FRAME,
  );
}

/** One variant's replay scenario. */
export function dodgeTimingScenario(name: string, pressTick: number): ReplayScenario<ActionFrame> {
  let log: readonly ActionFrame[] | undefined;
  return {
    name,
    usesContent: true,
    command: actionFrameCommand,
    ticks: DODGE_TIMING_TICKS,
    create: createDodgeTimingWorld,
    drive: ({ tick }) => {
      log ??= dodgeTimingLog(pressTick);
      const frame = log[tick];
      return frame === undefined ? [] : [frame];
    },
  };
}

/** The roll pressed so its last i-frame meets the swing: dodged. */
export const dodgeOnTimeScenario = dodgeTimingScenario('dodge-on-time', DODGE_PRESS.onTime);

/** The roll pressed one tick early: its i-frames end the tick before the swing lands, which hits. */
export const dodgeEarlyScenario = dodgeTimingScenario('dodge-early', DODGE_PRESS.early);
