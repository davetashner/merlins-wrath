// The shield bash (mw-e04.14) through the melee wiring: block + attack bashes (or kicks without a
// shield), and the bash's hits interrupt interruptible windups and break shieldless guards.
import type { MoveTable, RuntimeMove, RuntimeShield } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { IDENTITY_POSE } from '../../geom';
import {
  actionButton,
  actionFrame,
  actionVector,
  type ActionFrame,
  type ButtonAction,
} from '../../input/action-frame';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../damage/components';
import { DamageApplied, type DamageResult } from '../damage/events';
import { DamageModel } from '../damage/model';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  type Hurtbox,
  type SocketTrack,
} from '../hits/components';
import { hitVolumeSystem, noAllies } from '../hits/system';
import { giveHitReactions, HitReactionComponent } from '../reactions/components';
import { HitReaction, type HitReactionInfo } from '../reactions/events';
import { installHitReactions } from '../reactions/reactions';
import { giveStamina, StaminaComponent, staminaOf, staminaSystem } from '../stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionInput,
  giveActionTimeline,
} from '../timeline/components';
import {
  ActionEnded,
  ActionStarted,
  type ActionEndInfo,
  type ActionStartInfo,
} from '../timeline/events';
import { actionOf, actionTimelineSystem, requestMove } from '../timeline/timeline';
import { bashRedirect, firstRedirect } from './bash';
import { giveFacing, giveGuard, guardOf, MELEE_COMPONENTS, setBlockHeld } from './components';
import { GuardBroken, type GuardBreak } from './events';
import { facingSystem, keepFacing } from './facing';
import { blockSystem, GUARD_BREAK_STAGGER_TICKS, shieldGuard } from './guard';
import { installMeleeStrikes } from './strikes';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

interface MoveSpec {
  readonly id: string;
  readonly frames: readonly [number, number, number];
  readonly cost?: number;
  readonly damage?: RuntimeMove['damage'];
  readonly hitbox?: RuntimeMove['hitbox'];
  readonly interruptible?: boolean;
  readonly hyperarmor?: RuntimeMove['hyperarmor'];
}

/** A RuntimeMove as compileMove builds it. */
function move(spec: MoveSpec): RuntimeMove {
  const [startup, active, recovery] = spec.frames;
  const hitbox = spec.hitbox ?? null;
  return Object.freeze({
    id: spec.id,
    verb: 'attack',
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: spec.cost ?? 0,
    cancelWindows: [],
    damage: spec.damage ?? null,
    hitbox,
    parryable: false,
    blockable: hitbox !== null,
    unblockable: false,
    interruptible: spec.interruptible ?? false,
    hyperarmor: spec.hyperarmor ?? null,
    iframes: null,
    telegraphTick: 0,
    hitStop: hitbox === null ? null : 'light',
    chainNext: null,
    charge: null,
    presentation: { anim: `anim-${spec.id}` },
    motion: null,
  } satisfies RuntimeMove);
}

const template = (blunt: number, poise: number, tags: readonly string[] = []) => ({
  amounts: { blunt },
  poiseDamage: poise,
  staminaDamage: 30,
  impulse: v3(0, 0, 150),
  impactForce: 1200,
  tags,
});

// src/content/data/move/shield-bash.json and kick.json (mw-e04.14, mw-e04.18).
const BASH = move({
  id: 'bash',
  frames: [14, 4, 20],
  cost: 18,
  damage: template(5, 45, ['interrupt', 'guard-crush']),
  hitbox: {
    track: 'still',
    shape: { kind: 'box', center: v3(-0.2, 1.1, 0.6), halfExtents: { x: 0.35, y: 0.45, z: 0.2 } },
    reach: 'close',
    swing: 'thrust',
  },
});
const KICK = move({
  id: 'kick',
  frames: [10, 3, 16],
  cost: 8,
  damage: template(3, 20),
  hitbox: {
    track: 'still',
    shape: { kind: 'sphere', center: v3(0, 0.5, 0.8), radius: 0.25 },
    reach: 'close',
    swing: 'thrust',
  },
});
const LIGHT = move({ id: 'light', frames: [12, 4, 18], cost: 12 });
// A spell windup the bash can interrupt, and a chop it cannot: armoured for their whole startup.
const ARMOUR = { from: 0, to: 29, poiseCap: 100 };
const CAST = move({ id: 'cast', frames: [30, 5, 20], interruptible: true, hyperarmor: ARMOUR });
const CHOP = move({ id: 'chop', frames: [30, 5, 20], hyperarmor: ARMOUR });
const MOVES: MoveTable = new Map([BASH, KICK, LIGHT, CAST, CHOP].map((m) => [m.id, m]));
const TRACKS = new Map<string, SocketTrack>([['still', { id: 'still', keys: [IDENTITY_POSE] }]]);

const SHIELD: RuntimeShield = Object.freeze({
  id: 'wood-shield',
  kind: 'shield',
  absorption: Object.freeze({ slash: 85, pierce: 85, blunt: 85, fire: 30 }),
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
});
/** A shieldless guard: a blade raised against the blow. */
const BLADE: RuntimeShield = Object.freeze({ ...SHIELD, id: 'blade', kind: 'weapon' });

const torso: Hurtbox = {
  id: 'torso',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'capsule', from: v3(0, 0.4, 0), to: v3(0, 1.4, 0), radius: 0.4 },
};

const frame = (pressed: readonly ButtonAction[], held: readonly ButtonAction[] = []) =>
  actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (b) =>
      actionButton(pressed.includes(b), pressed.includes(b) || held.includes(b), false),
  });

/** Block + attack: the bash chord. */
const BLOCK_ATTACK = frame(['primaryAttack'], ['secondaryAttack']);
const BLOCKING = frame([], ['secondaryAttack']);

function setup(options: { shield?: boolean } = {}) {
  const world = new World<ActionFrame>({ seed: 1 }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    StaminaComponent,
    ...MELEE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
    HitReactionComponent,
  );
  const damage = new DamageModel();
  damage.register(shieldGuard());
  world
    .addSystem(staminaSystem())
    .addSystem(blockSystem({ moves: MOVES }))
    .addSystem(
      actionTimelineSystem({
        moves: MOVES,
        redirect: bashRedirect({ bash: 'bash', fallback: 'kick' }),
      }),
    )
    .addSystem(facingSystem({ moves: MOVES, desired: keepFacing }))
    .addSystem(hitVolumeSystem({ isAlly: noAllies }));
  installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage });
  installHitReactions(world, { moves: MOVES, damage });
  const knight = world.spawn();
  placeEntity(world, knight, v3(0, 0, 0), 0.35);
  giveActionTimeline(world, knight);
  giveStamina(world, knight);
  giveFacing(world, knight);
  if (options.shield ?? true) giveGuard(world, knight, SHIELD);
  giveHitboxes(world, knight);
  giveActionInput(world, knight, { primaryAttack: 'light' }, [
    { held: 'secondaryAttack', press: 'primaryAttack', move: 'bash' },
  ]);
  // A foe a step ahead, facing the knight.
  const foe = world.spawn();
  placeEntity(world, foe, v3(0, 0, 1), 0.4);
  giveHurtboxes(world, foe, { boxes: [torso] });
  giveCombatant(world, foe, { health: 200, poise: 60 });
  giveActionTimeline(world, foe);
  giveFacing(world, foe, v3(0, 0, -1));
  giveHitReactions(world, foe);
  const started: ActionStartInfo[] = [];
  const ended: ActionEndInfo[] = [];
  const reactions: HitReactionInfo[] = [];
  const applied: DamageResult[] = [];
  const breaks: GuardBreak[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(ActionEnded, (e) => ended.push(e));
  world.events.on(HitReaction, (e) => reactions.push(e));
  world.events.on(DamageApplied, (e) => applied.push(e));
  world.events.on(GuardBroken, (e) => breaks.push(e));
  const steps = (n: number, f?: ActionFrame) => {
    for (let i = 0; i < n; i++) world.step(f === undefined ? [] : [f]);
  };
  return { world, knight, foe, started, ended, reactions, applied, breaks, steps };
}

const startedBy = (s: ReturnType<typeof setup>, entity: EntityId) =>
  s.started.filter((e) => e.entity === entity).map((e) => e.move);

describe('shield bash: the input (mw-e04.14)', () => {
  it('attack while blocking bashes: the shield drops for the bash; attack alone swings', () => {
    const s = setup();
    s.steps(10, BLOCKING);
    expect(guardOf(s.world, s.knight)?.raisedAt).not.toBeNull();
    s.steps(1, BLOCK_ATTACK);
    s.steps(1, BLOCKING);
    expect(actionOf(s.world, s.knight)?.move).toBe('bash');
    expect(guardOf(s.world, s.knight)?.raisedAt).toBeNull();
    s.steps(60);
    s.steps(1, frame(['primaryAttack']));
    expect(startedBy(s, s.knight)).toEqual(['bash', 'light']);
  });

  it('AC-4: with no shield equipped, block + attack executes the kick instead', () => {
    const s = setup({ shield: false });
    s.steps(5, BLOCKING);
    s.steps(1, BLOCK_ATTACK);
    expect(startedBy(s, s.knight)).toEqual(['kick']);
    expect(staminaOf(s.world, s.knight)?.current).toBe(100 - 8);
    s.steps(12);
    // The kick connects on its first active tick (move tick 10): 3 blunt.
    expect(s.applied.map((r) => [r.target, r.total])).toEqual([[s.foe, 3]]);
  });

  it('AC-5: with 10 stamina, the bash still executes (the last-action rule) and leaves 0', () => {
    const s = setup();
    s.steps(10, BLOCKING);
    const pool = staminaOf(s.world, s.knight) ?? expect.fail('no pool');
    s.world.set(s.knight, StaminaComponent, { ...pool, current: 10, regenResumesAt: 1000 });
    s.steps(1, BLOCK_ATTACK);
    expect(startedBy(s, s.knight)).toEqual(['bash']);
    expect(staminaOf(s.world, s.knight)?.current).toBe(0);
  });

  it('the redirect only replaces the bash, and only for a fighter with no guard', () => {
    const s = setup({ shield: false });
    const redirect = bashRedirect({ bash: 'bash', fallback: 'kick' });
    expect(redirect(s.world, s.knight, 'bash', BASH)).toBe('kick');
    expect(redirect(s.world, s.knight, 'light', LIGHT)).toBeUndefined();
    giveGuard(s.world, s.knight, SHIELD);
    expect(redirect(s.world, s.knight, 'bash', BASH)).toBeUndefined();
  });

  it('firstRedirect asks each redirect in order and skips missing ones', () => {
    const s = setup();
    const never = () => undefined;
    const always = () => 'kick';
    expect(firstRedirect(undefined, never, always)(s.world, s.knight, 'light', LIGHT)).toBe('kick');
    expect(firstRedirect(never, undefined)(s.world, s.knight, 'light', LIGHT)).toBeUndefined();
  });
});

describe('shield bash: what it does to a foe (mw-e04.14)', () => {
  /** Bashes while the foe starts `foeMove` on the same tick; returns the bash's tick. */
  function bashInto(s: ReturnType<typeof setup>, foeMove: string): number {
    s.steps(10, BLOCKING);
    const at = s.world.tick;
    requestMove(s.world, s.foe, foeMove);
    s.steps(1, BLOCK_ATTACK);
    s.steps(20);
    return at;
  }

  it('AC-1: a foe in an interruptible windup has its move cancelled when the bash connects, and flinches', () => {
    const s = setup();
    const at = bashInto(s, 'cast');
    const hit = s.applied.find((r) => r.target === s.foe) ?? expect.fail('no hit');
    expect(hit.tick).toBe(at + 14); // the bash's first active tick
    expect(hit.packet.tags).toEqual(expect.arrayContaining(['interrupt', 'guard-crush']));
    expect(s.ended.filter((e) => e.entity === s.foe)).toEqual([
      { tick: at + 14, entity: s.foe, move: 'cast', reason: 'interrupted', moveTick: 14 },
    ]);
    expect(s.reactions.find((r) => r.entity === s.foe)).toMatchObject({
      reaction: 'flinch',
      interrupted: true,
    });
  });

  it('AC-1: a windup not flagged interruptible shrugs the bash off behind its hyperarmor', () => {
    const s = setup();
    bashInto(s, 'chop');
    expect(s.applied.filter((r) => r.target === s.foe)).toHaveLength(1);
    expect(s.ended.filter((e) => e.entity === s.foe)).toEqual([]);
    expect(actionOf(s.world, s.foe)?.move).toBe('chop');
    expect(s.reactions.find((r) => r.entity === s.foe)).toMatchObject({
      reaction: 'none',
      suppressed: 'hyperarmor',
    });
  });

  /** Raises a guard for the foe and bashes into it; returns the bash's tick. */
  function bashGuard(s: ReturnType<typeof setup>, guard: RuntimeShield): number {
    giveGuard(s.world, s.foe, guard);
    setBlockHeld(s.world, s.foe, true);
    s.steps(10, BLOCKING);
    const at = s.world.tick;
    s.steps(1, BLOCK_ATTACK);
    s.steps(20);
    return at;
  }

  it('AC-2: a shieldless foe blocking is Guard Broken for 60 ticks when the bash connects', () => {
    const s = setup();
    const at = bashGuard(s, BLADE);
    const T = at + 14;
    expect(s.breaks).toEqual([
      { tick: T, entity: s.foe, instigator: s.knight, source: s.knight, staggerTicks: 60 },
    ]);
    expect(GUARD_BREAK_STAGGER_TICKS).toBe(60);
    expect(guardOf(s.world, s.foe)?.raisedAt).toBeNull();
    const hit = s.applied.find((r) => r.target === s.foe) ?? expect.fail('no hit');
    expect(hit.tags).toEqual(expect.arrayContaining(['blocked', 'guard-break']));
    expect(hit.total).toBe(5); // nothing absorbed
    expect(healthOf(s.world, s.foe)?.current).toBe(195);
    expect(s.reactions.find((r) => r.entity === s.foe)).toMatchObject({
      reaction: 'stagger',
      ticks: 60,
    });
    // Its timeline is locked from the break: 60 − 20 ticks are left after the 20 stepped since.
    expect(s.world.get(s.foe, ActionTimelineComponent)?.lockTicks).toBe(
      60 - (s.world.tick - T - 1),
    );
  });

  it('a foe behind a real shield blocks the bash like any blow: no guard break', () => {
    const s = setup();
    bashGuard(s, SHIELD);
    expect(s.breaks).toEqual([]);
    const hit = s.applied.find((r) => r.target === s.foe) ?? expect.fail('no hit');
    expect(hit.tags).toContain('blocked');
    expect(hit.tags).not.toContain('guard-break');
    expect(guardOf(s.world, s.foe)?.raisedAt).not.toBeNull();
  });

  it('a shieldless guard still blocks hits that do not crush guards', () => {
    const s = setup({ shield: false });
    giveGuard(s.world, s.foe, BLADE);
    setBlockHeld(s.world, s.foe, true);
    s.steps(10);
    s.steps(1, BLOCK_ATTACK); // no shield: the kick, which carries no guard-crush tag
    s.steps(15);
    expect(s.breaks).toEqual([]);
    expect(s.applied.find((r) => r.target === s.foe)?.tags).toContain('blocked');
  });
});
