// The knight through the player (mw-e04.6): installPlayer with sword and shield, driven by
// ActionFrames the way the game drives it.
import type {
  ControllerTuning,
  Frozen,
  MoveTable,
  RuntimeMove,
  RuntimeShield,
} from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../combat/damage/components';
import { DamageModel } from '../combat/damage/model';
import {
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  liveHitboxes,
  type SocketTrack,
} from '../combat/hits/components';
import { hitVolumeSystem, noAllies } from '../combat/hits/system';
import { facingOf, guardOf } from '../combat/melee/components';
import { shieldGuard } from '../combat/melee/guard';
import { installMeleeStrikes } from '../combat/melee/strikes';
import { staminaOf } from '../combat/stamina';
import { ActionStarted, type ActionStartInfo } from '../combat/timeline/events';
import { World } from '../core/world';
import { IDENTITY_POSE } from '../geom';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import { atan2 } from '../math';
import type { SceneSpawnPlacement } from '../scene/layout';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import {
  installPlayer,
  KNIGHT_LIGHT_ATTACK,
  PlayerLook,
  restrainMovement,
  type PlayerMeleeOptions,
} from './player';

const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

/** A player start at the origin facing −z (scene yaw 180): look yaw 0. */
const START: SceneSpawnPlacement = {
  id: 'player-start',
  position: { x: 0, y: 0, z: 0 },
  yaw: 180,
  rotation: { x: 0, y: 1, z: 0, w: 0 },
  prop: undefined,
  tags: ['player-start'],
};

const WOOD: RuntimeShield = {
  id: 'wood-shield',
  absorption: { slash: 85, pierce: 85, blunt: 85, fire: 30 },
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
};

function light(
  id: string,
  frames: [number, number, number],
  cost: number,
  slash: number,
  next: string | null,
): RuntimeMove {
  const [startup, active, recovery] = frames;
  return {
    id,
    verb: 'attack',
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: cost,
    cancelWindows: [],
    damage: {
      amounts: { slash },
      poiseDamage: 15,
      staminaDamage: 12,
      impulse: { x: 0, y: 0, z: 0 },
      impactForce: 0,
      tags: [],
    },
    hitbox: {
      track: 'still',
      shape: {
        kind: 'capsule',
        from: { x: 0.35, y: 1.2, z: 0.35 },
        to: { x: 0.35, y: 1.2, z: 1.45 },
        radius: 0.08,
      },
      reach: 'medium',
      swing: 'horizontal',
    },
    parryable: true,
    blockable: true,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    chainNext: next,
    charge: null,
    presentation: { anim: `anim-${id}` },
    motion: null,
  };
}

const MOVES: MoveTable = new Map(
  [
    light('sword-light-1', [12, 4, 18], 12, 20, 'sword-light-2'),
    light('sword-light-2', [10, 4, 20], 14, 22, 'sword-light-3'),
    light('sword-light-3', [16, 5, 26], 18, 30, null),
    light('poke', [2, 2, 2], 0, 1, null),
  ].map((m) => [m.id, m]),
);
const TRACKS = new Map<string, SocketTrack>([['still', { id: 'still', keys: [IDENTITY_POSE] }]]);

function frame(
  pressed: readonly ButtonAction[] = [],
  held: readonly ButtonAction[] = [],
  move: [number, number] = [0, 0],
) {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (b) =>
      actionButton(pressed.includes(b), pressed.includes(b) || held.includes(b), false),
  });
}

function knight(melee: Partial<PlayerMeleeOptions> = {}) {
  const collision = new FakeCollisionWorld([
    box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }), // floor, top at y = 0
  ]);
  const world = new World<ActionFrame>({ seed: 5 }).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  const player = installPlayer(world, {
    spawns: [START],
    collision,
    tuning: TUNING,
    combat: { moves: MOVES, melee: { shield: WOOD, ...melee } },
  });
  world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
  const damage = new DamageModel();
  damage.register(shieldGuard());
  installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage });
  const dummy = world.spawn();
  placeEntity(world, dummy, { x: 0, y: 0, z: -1 }, 0.4);
  giveHurtboxes(world, dummy, {
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
  giveCombatant(world, dummy, { health: 200 });
  world.step([IDLE_ACTION_FRAME]); // settle onto the floor
  const started: ActionStartInfo[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  const run = (ticks: number, input: ActionFrame = IDLE_ACTION_FRAME) => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const state = () => {
    const value = world.get(player, CharacterController);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  const speed = () => Math.sqrt(state().velocity.x ** 2 + state().velocity.z ** 2);
  return { world, player, dummy, started, run, state, speed };
}

describe('the knight player (mw-e04.6)', () => {
  it('AC-1: the attack button runs the light chain and restarts it after the third hit', () => {
    const k = knight();
    k.run(1, frame(['primaryAttack'])); // L1, 34 ticks
    k.run(29);
    k.run(1, frame(['primaryAttack'])); // buffered: L2 from its 34th tick
    k.run(33);
    k.run(1, frame(['primaryAttack'])); // L3
    k.run(50);
    k.run(1, frame(['primaryAttack'])); // chain over: L1
    expect(k.started.map((e) => e.move)).toEqual([
      'sword-light-1',
      'sword-light-2',
      'sword-light-3',
      'sword-light-1',
    ]);
    expect(KNIGHT_LIGHT_ATTACK).toBe('sword-light-1');
  });

  it('the chain’s three hits take 20 + 22 + 30 from a dummy 1 m ahead', () => {
    const k = knight();
    k.run(1, frame(['primaryAttack']));
    k.run(29);
    k.run(1, frame(['primaryAttack']));
    k.run(33);
    k.run(1, frame(['primaryAttack']));
    k.run(60);
    expect(healthOf(k.world, k.dummy)?.current).toBe(200 - 72);
  });

  it('a custom light attack binds instead', () => {
    const k = knight({ lightAttack: 'poke' });
    k.run(1, frame(['primaryAttack']));
    expect(k.started.map((e) => e.move)).toEqual(['poke']);
  });

  it('the block button raises the shield; behind it the knight walks at half speed and cannot sprint', () => {
    const k = knight();
    k.run(30, frame([], ['secondaryAttack', 'sprint'], [0, 1]));
    expect(guardOf(k.world, k.player)?.raisedAt).not.toBeNull();
    expect(staminaOf(k.world, k.player)?.blocking).toBe(true);
    expect(k.speed()).toBeCloseTo(2.5, 9);
    k.run(30, frame([], [], [0, 1]));
    expect(k.speed()).toBeCloseTo(5, 9);
  });

  it('a swing plants the knight: it stops walking and cannot jump until the move ends', () => {
    const k = knight();
    k.run(30, frame([], [], [0, 1]));
    k.run(1, frame(['primaryAttack'], [], [0, 1]));
    k.run(15, frame(['jump'], [], [0, 1]));
    expect(k.speed()).toBe(0);
    expect(k.state().grounded).toBe(true);
    k.run(40, frame([], [], [0, 1]));
    expect(k.speed()).toBeCloseTo(5, 9);
  });

  it('it faces where it looks, keeps its placement at its feet and swings that way', () => {
    const k = knight();
    expect(facingOf(k.world, k.player)).toEqual({ x: 0, y: 0, z: -1 });
    k.run(20, frame([], [], [0, 1]));
    const at = k.world.get(k.player, PlacementComponent);
    expect(at?.z).toBeCloseTo(k.state().position.z, 12);
    expect(at?.radius).toBe(0.35);
    const look = k.world.get(k.player, PlayerLook);
    if (look === undefined) throw new Error('no look');
    k.world.set(k.player, PlayerLook, { ...look, yaw: -Math.PI / 2 }); // looking +x
    k.run(1);
    expect(facingOf(k.world, k.player).x).toBeCloseTo(1, 12);
  });

  it('with a lock-on target it faces the target, and turns toward it at 6° a tick in startup', () => {
    let locked = false;
    const k = knight({ target: (_w, e) => (locked ? e + 1 : undefined) }); // the dummy is spawned next
    k.run(1);
    expect(facingOf(k.world, k.player).z).toBeCloseTo(-1, 12);
    placeEntity(k.world, k.dummy, { x: 5, y: 0, z: 0 });
    locked = true;
    k.run(1, frame(['primaryAttack']));
    k.run(11);
    const f = facingOf(k.world, k.player);
    // 11 startup ticks after the start tick itself (which already turned 6°): 72° from −z toward +x.
    expect(atan2(f.x, -f.z) * (180 / Math.PI)).toBeCloseTo(72, 6);
    expect(liveHitboxes(k.world, k.player)).toEqual([]);
  });

  it('restrainMovement leaves full-speed input untouched and a destroyed player unplaced', () => {
    const input = frame(['jump'], ['sprint'], [0, 1]);
    expect(restrainMovement(input, 1)).toBe(input);
    expect(restrainMovement(input, 0.5)).toMatchObject({
      move: { x: 0, y: 0.5 },
      sprint: { pressed: false, held: false },
      jump: { pressed: true },
    });
    const k = knight();
    k.world.destroy(k.player);
    expect(() => {
      k.run(2);
    }).not.toThrow();
  });
});
