// mw-e04.7 AC-5: a knockback hit shoves a creature off a ledge in the greybox testbed. The testbed is
// loaded as the game loads it (the sim's Rapier physics, the scene loader, the player's controller
// querying RapierCollisionWorld); a creature stands on the arena's 2 m platform 0.5 m from its edge
// as a character on the same controller, and a knockback hit toward the edge goes through the damage
// model, the reaction rules and physics: it is launched over the edge, falls the 2 m and lands on the
// arena floor. Fall damage is e04.19's (not built yet): this test pins the fall it will read.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { creatureSchema, HIT_REACTION_DEFAULTS, type CreatureDefInput } from '@content/index';
import {
  CharacterController,
  combatantFromCreature,
  DAMAGE_COMPONENTS,
  DamageModel,
  DEFAULT_REACTION_PROFILE,
  giveActionTimeline,
  giveCombatant,
  giveHitReactions,
  HitReaction,
  HitReactionComponent,
  HIT_VOLUME_COMPONENTS,
  installHitReactions,
  pushCharacter,
  reactionOf,
  reactionProfileFromCreature,
  SKIN,
  spawnCharacter,
  type CharacterState,
  type EntityId,
  type HitReactionInfo,
} from '@sim/index';
import { createTestbedWorld } from '@tools/replay/testbed-player-scenario';

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

function shove() {
  const world = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
  // The testbed's player already registers the action timeline and stamina components.
  world.register(...DAMAGE_COMPONENTS);
  world.register(HitReactionComponent, ...HIT_VOLUME_COMPONENTS);
  const damage = new DamageModel();
  installHitReactions(world, { moves: new Map(), damage, pushers: [pushCharacter] });
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
  });
  for (let i = 0; i < 90; i++) step();
  return { world, goblin, reactions, trace };
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
    // The fall e04.19's fall-damage rule will read: the 2 m drop from the ledge top.
    const lowest = Math.min(...trace.slice(10).map((s) => s.velocity.y));
    expect(lowest).toBeLessThan(-5);
    expect(reactionOf(world, goblin)).toBeUndefined();
  });

  it('AC-5: the same shove replays to the same final state', () => {
    const a = shove();
    const b = shove();
    expect(a.trace).toEqual(b.trace);
  });
});
