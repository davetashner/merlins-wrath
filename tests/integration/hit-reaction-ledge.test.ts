// mw-e04.7 AC-5: a knockback hit shoves a creature off a ledge in the greybox testbed. The testbed is
// loaded as the game loads it (the sim's Rapier physics, the scene loader, the player's controller
// querying RapierCollisionWorld); a creature stands on the arena's 2 m platform 0.5 m from its edge
// as a character on the same controller, and a knockback hit toward the edge goes through the damage
// model, the reaction rules and physics: it is launched over the edge, falls the 2 m and lands on the
// arena floor, where the environmental fall-damage rules (mw-e04.19, installed by the game's own
// wiring since mw-e04.34) price the impacts: the launch is blamed on the hit's instigator, and a 2 m
// drop is below the shipped rules' 4 m safe height.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  creatureSchema,
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  HIT_REACTION_DEFAULTS,
  loadGameContent,
  type CreatureDefInput,
  type EnvironmentDamageTuning,
  type Frozen,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  CharacterController,
  CharacterImpacted,
  combatantFromCreature,
  DamageApplied,
  DEFAULT_REACTION_PROFILE,
  giveActionTimeline,
  giveCombatant,
  giveHitReactions,
  healthOf,
  HitReaction,
  reactionOf,
  reactionProfileFromCreature,
  SKIN,
  spawnCharacter,
  type CharacterImpactInfo,
  type CharacterState,
  type DamageResult,
  type EntityId,
  type HitReactionInfo,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

/** The arena platform at [6, 0, 29] scaled [1, 2, 1]: x 5…7, z 28…30, top at y = 2. */
const LEDGE = { edgeX: 7, top: 2, z: 29 };

const creature = creatureSchema.parse({
  id: 'ledge-goblin',
  family: 'rootcellar-goblin',
  stats: { health: 60, poise: 20, mass: 40, size: 'small' },
  senses: {
    sight: {
      nearRange: 8,
      farRange: 20,
      primaryHalfAngle: 35,
      peripheralHalfAngle: 60,
      verticalHalfAngle: 40,
      darkVision: 0.2,
      detectionSpeed: 1,
    },
  },
  locomotion: {
    agent: { radius: 0.3, height: 1.2 },
    modes: {
      walk: {
        speeds: { sneak: 1, walk: 1.5, run: 4 },
        stepHeight: 0.3,
        maxSlope: 45,
        jumpHeight: 0.5,
        maxDrop: 2.5,
        wadeDepth: 0.8,
      },
    },
  },
} satisfies CreatureDefInput);

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const content = loadGameContent();
const RULES = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);

function shove(rules: Frozen<EnvironmentDamageTuning> = RULES) {
  // The testbed's combat (mw-e04.6) registers the action timeline, stamina, damage and hit-volume
  // components, and installs hit reactions on the game's damage model with the character and
  // physics-object pushers (mw-e04.31).
  const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, environment: rules });
  const { world } = game;
  const { damage } = game.combat;
  const knight = world.spawn();
  const goblin: EntityId = spawnCharacter(world, {
    x: LEDGE.edgeX - 0.5,
    y: LEDGE.top + SKIN,
    z: LEDGE.z,
  });
  giveCombatant(world, goblin, combatantFromCreature(creature));
  giveActionTimeline(world, goblin);
  giveHitReactions(world, goblin, reactionProfileFromCreature(creature));
  const reactions: HitReactionInfo[] = [];
  world.events.on(HitReaction, (e) => reactions.push(e));
  const impacts: CharacterImpactInfo[] = [];
  world.events.on(CharacterImpacted, (e) => {
    if (e.entity === goblin) impacts.push(e);
  });
  const hits: DamageResult[] = [];
  world.events.on(DamageApplied, (e) => {
    if (e.target === goblin) hits.push(e);
  });
  const trace: CharacterState[] = [];
  const step = () => {
    world.step([]);
    trace.push(must(world.get(goblin, CharacterController)));
  };
  for (let i = 0; i < 10; i++) step(); // settle on the platform
  damage.apply(world, goblin, {
    amounts: { blunt: 5 },
    poiseDamage: 5,
    impulse: { x: 320, y: 0, z: 0 }, // towards the edge, just over the 300 N·s threshold
    direction: { x: 1, y: 0, z: 0 },
    instigator: knight,
  });
  for (let i = 0; i < 90; i++) step();
  return { world, goblin, knight, reactions, trace, impacts, hits };
}

describe('hit reactions in the greybox testbed (mw-e04.7)', () => {
  it('a creature’s profile comes from its CreatureDef, and content’s defaults are the sim’s', () => {
    expect(creature.reactions).toEqual({ ...HIT_REACTION_DEFAULTS, replace: {} });
    const { knockbackImpulse, knockdownImpulse, launchSpeed } = DEFAULT_REACTION_PROFILE;
    expect({ knockbackImpulse, knockdownImpulse, launchSpeed }).toEqual(HIT_REACTION_DEFAULTS);
  });

  it('AC-5: a knockback toward the ledge 0.5 m away pushes the creature off, and it falls to the floor below', () => {
    const { world, goblin, reactions, trace } = shove();
    const settled = must(trace[9]);
    expect(settled.grounded).toBe(true);
    expect(settled.position.y).toBeCloseTo(LEDGE.top + SKIN, 3);
    expect(reactions.map((r) => [r.reaction, r.displaced])).toEqual([['knockback', true]]);
    // Off the edge, airborne for the drop, and landed on the arena floor below.
    const airborne = trace.slice(10).filter((s) => !s.grounded).length;
    expect(airborne).toBeGreaterThan(20);
    const landed = must(trace.at(-1));
    expect(landed.grounded).toBe(true);
    expect(landed.position.x).toBeGreaterThan(LEDGE.edgeX);
    expect(landed.position.y).toBeCloseTo(SKIN, 3);
    // The fall the fall-damage rules read: the 2 m drop from the ledge top.
    const lowest = Math.min(...trace.slice(10).map((s) => s.velocity.y));
    expect(lowest).toBeLessThan(-5);
    expect(reactionOf(world, goblin)).toBeUndefined();
  });

  it('AC-5: the environmental fall-damage rules price the impacts: all below the 4 m safe height', ({
    task,
  }) => {
    markExercised(task, 'environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
    const { world, goblin, knight, impacts, hits } = shove();
    // Launched by the knight's blow, it clips the arena wall beyond the ledge (losing its horizontal
    // speed), then lands on the floor: the drop from the ledge top plus the launch's rise.
    const launch = { source: knight, stagger: true };
    expect(impacts.map((i) => [i.kind, i.launch])).toEqual([
      ['wall', launch],
      ['ground', launch],
    ]);
    expect(impacts[0]?.height).toBeLessThan(RULES.fall.safeHeight);
    expect(impacts[1]?.height).toBeGreaterThan(2);
    expect(impacts[1]?.height).toBeLessThan(2.3);
    // Only the blow itself hurt: both impacts were safe.
    expect(hits.map((h) => h.tags)).toEqual([[]]);
    expect(healthOf(world, goblin)?.current).toBe(55);
  });

  it('AC-5: with a harsher curve the same impacts hurt, blamed on the knight who shoved it', () => {
    const harsh = { ...RULES, fall: { safeHeight: 1, lethalHeight: 3, deepWater: 1.5 } };
    const { goblin, knight, impacts, hits } = shove(harsh);
    const falls = hits.filter((h) => h.tags.includes('fall'));
    expect(falls).toHaveLength(2);
    // The first is the wall it clips (tagged `wall` too, mw-e04.34), the second the landing.
    expect(falls.map((h) => h.tags)).toEqual([
      ['environment', 'fall', 'wall'],
      ['environment', 'fall'],
    ]);
    falls.forEach((fall, i) => {
      expect(fall.target).toBe(goblin);
      expect(fall.packet.instigator).toBe(knight);
      expect(fall.total).toBeCloseTo((60 * ((impacts[i]?.height ?? 0) - 1)) / 2, 1);
    });
  });

  it('AC-5: the same shove replays to the same final state', () => {
    const a = shove();
    const b = shove();
    expect(a.trace).toEqual(b.trace);
  });
});
