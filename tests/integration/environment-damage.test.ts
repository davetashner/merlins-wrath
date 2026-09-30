// mw-e04.19 AC-3: a chandelier dropped onto a creature when someone cuts its rope, with the shipped
// environmental damage rules (src/content/data/environment-damage/default.json) on the sim's Rapier
// physics. The rope and the suspension rule that drops a `suspended` object when its support goes
// are not built yet (e03 suspended objects); a stand-in here drops the chandelier as a physics object
// when its `suspended` property is cleared, which is where that rule will hook in. The blame comes
// from the property change's source, whoever cleared it.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  loadGameContent,
  PLAYER_CONTROLLER_ID,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  addPhysicsObject,
  addProperties,
  box,
  CharacterController,
  characterControllerSystem,
  DAMAGE_COMPONENTS,
  DamageApplied,
  DamageModel,
  giveCombatant,
  healthOf,
  installEnvironmentDamage,
  installPhysicsObjects,
  installStimuli,
  propertyChanged,
  RapierCollisionWorld,
  RapierPhysics,
  registerWorldProperties,
  setProperty,
  SKIN,
  spawnCharacter,
  World,
  type DamageResult,
} from '@sim/index';

const content = loadGameContent();
const rules = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
const tuning = content.get('controller', PLAYER_CONTROLLER_ID);
const GRAVITY = 9.81;
const RADIUS = 0.5;

function chandelierDrop() {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 7, physics })));
  installPhysicsObjects(world);
  world.register(CharacterController, ...DAMAGE_COMPONENTS);
  physics.add(box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }));
  world.addSystem(
    characterControllerSystem({
      collision: new RapierCollisionWorld(physics),
      tuning,
      input: () => undefined,
    }),
  );
  const damage = new DamageModel();
  installEnvironmentDamage(world, { damage, tuning: rules, capsule: tuning.capsule });
  const troll = spawnCharacter(world, { x: 0, y: SKIN, z: 0 });
  giveCombatant(world, troll, { health: 400 });
  const thief = world.spawn();
  // The chandelier's bottom hangs 5 m above the troll's head.
  const head = SKIN + tuning.capsule.height;
  const centre = { x: 0, y: head + 5 + RADIUS, z: 0 };
  const chandelier = world.spawn();
  addProperties(world, chandelier, { weight: 40, suspended: true });
  // Stand-in for the suspension rule: a suspended object let go falls as a physics object.
  world.events.on(propertyChanged, (change) => {
    if (change.key === 'suspended' && !change.new) {
      addPhysicsObject(world, change.entity, {
        shape: { kind: 'sphere', radius: RADIUS },
        position: centre,
      });
    }
  });
  const hits: DamageResult[] = [];
  world.events.on(DamageApplied, (r) => hits.push(r));
  for (let i = 0; i < 10; i++) world.step();
  setProperty(world, chandelier, 'suspended', false, { source: thief }); // the thief cuts the rope
  for (let i = 0; i < 120; i++) world.step();
  return { world, troll, thief, chandelier, hits };
}

describe('crushing damage (mw-e04.19)', () => {
  it('AC-3: a 40 kg chandelier dropped 5 m onto a creature deals blunt damage blamed on whoever cut its rope', ({
    task,
  }) => {
    markExercised(task, 'environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
    const { world, troll, thief, chandelier, hits } = chandelierDrop();
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(hit?.packet).toMatchObject({
      instigator: thief,
      source: chandelier,
      tags: ['crush', 'environment'],
    });
    // It strikes after falling 5 m: about √(2·9.81·5) = 9.9 m/s, so ½·40·9.9² / 20 ≈ 98 blunt.
    const expected = (0.5 * 40 * 2 * GRAVITY * 5) / rules.kinetic.joulesPerPoint;
    expect(hit?.amounts.blunt).toBeGreaterThan(expected - 2);
    expect(hit?.amounts.blunt).toBeLessThan(expected + 5);
    expect(hit?.packet.direction?.y).toBeLessThan(-0.99);
    expect(healthOf(world, troll)?.current).toBe(400 - (hit?.total ?? 0));
  });

  it('AC-3: the drop replays to the same state', () => {
    const a = chandelierDrop();
    const b = chandelierDrop();
    expect(a.world.snapshot()).toEqual(b.world.snapshot());
  });
});
