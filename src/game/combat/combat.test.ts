import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { KNIGHT_SHIELD_ID, loadGameContent } from '@content/index';
import {
  BlameComponent,
  CharacterController,
  DAMAGE_COMPONENTS,
  EnvironmentContactsComponent,
  RapierPhysics,
  DEFAULT_REACTION_PROFILE,
  giveCombatant,
  healthOf,
  HitReactionComponent,
  HurtboxComponent,
  PlayerCombatantComponent,
  poiseOf,
  HIT_VOLUME_COMPONENTS,
  PlacementComponent,
  World,
  type SceneSpawnPlacement,
} from '@sim/index';
import { installGamePhysics } from '../physics-objects';
import { prepareTestbedCombat, startTestbedCombat } from './testbed-combat';
import {
  dummyReadout,
  readDummyTransform,
  spawnTrainingDummy,
  TRAINING_DUMMY,
  TRAINING_DUMMY_TAG,
  trainingDummySpawns,
} from './training-dummy';

const spawn = (id: string, tags: string[], z = 0): SceneSpawnPlacement => ({
  id,
  position: { x: 1, y: 0, z },
  yaw: 0,
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  prop: undefined,
  tags,
});

const world = () =>
  new World<never>({ seed: 1 }).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );

describe('training dummy (mw-e04.6)', () => {
  it('picks the tagged spawns and spawns a torso-only dummy with health at the feet', () => {
    const spawns = [spawn('a', ['player-start']), spawn('b', [TRAINING_DUMMY_TAG], 2)];
    expect(trainingDummySpawns(spawns).map((s) => s.id)).toEqual(['b']);
    const w = world();
    const [target] = trainingDummySpawns(spawns);
    if (target === undefined) throw new Error('no dummy spawn');
    const dummy = spawnTrainingDummy(w, target);
    expect(dummyReadout(w, dummy)).toEqual({ health: 200, max: 200 });
    expect(TRAINING_DUMMY.health).toBe(200);
    expect(readDummyTransform(w, dummy)).toEqual({
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    w.destroy(dummy);
    w.step();
    expect(dummyReadout(w, dummy)).toBeUndefined();
    expect(readDummyTransform(w, dummy)).toBeUndefined();
  });

  it('the testbed combat: moves, tracks and the wood shield from content; systems and dummies', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    expect(combat.moves.get('sword-light-1')?.chainNext).toBe('sword-light-2');
    expect(combat.tracks.has('knight-sword-arc-light-1')).toBe(true);
    expect(combat.melee.shield.id).toBe(KNIGHT_SHIELD_ID);
    expect(combat.damage.modifiers().map((m) => [m.name, m.stage])).toEqual([
      ['shield-block', 'guard'],
    ]);
    expect(combat.sandbox.tuning.id).toBe('combat-sandbox');
    expect([...combat.spawners.keys()]).toEqual(['dummy', 'attacker-dummy']);
    expect(combat.moves.has('training-dummy-swing:parryable:unblockable')).toBe(true);
    const w = world();
    const { dummies, sandboxDummies } = startTestbedCombat(w, combat, [
      spawn('d1', [TRAINING_DUMMY_TAG]),
      spawn('x', []),
      spawn('d2', [TRAINING_DUMMY_TAG], 3),
    ]);
    expect(dummies).toHaveLength(2);
    expect(sandboxDummies).toEqual([]);
    // Hit reactions joined the damage model (mw-e04.7, mw-e04.31).
    expect(combat.damage.modifiers().map((m) => m.name)).toEqual([
      'wake-up-iframes',
      'hyperarmor',
      'shield-block',
    ]);
    w.step();
    expect(dummies.map((d) => dummyReadout(w, d)?.health)).toEqual([200, 200]);
  });

  it('arms the player: health, poise, a hurtbox and hit reactions, unless it is a combatant already (mw-e04.31)', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    const w = world();
    const knight = w.spawn();
    startTestbedCombat(w, combat, [], knight);
    const again = world();
    const other = again.spawn();
    giveCombatant(again, other, { health: 5 });
    again.step();
    startTestbedCombat(again, prepareTestbedCombat(loadGameContent()), [], other);
    w.step();
    again.step();
    expect(healthOf(w, knight)).toEqual({ max: 100, current: 100 });
    expect(poiseOf(w, knight)?.max).toBe(30);
    expect(w.has(knight, PlayerCombatantComponent)).toBe(true);
    expect(w.get(knight, HurtboxComponent)?.boxes.map((b) => b.region)).toEqual(['torso']);
    expect(w.get(knight, HitReactionComponent)?.profile).toEqual(DEFAULT_REACTION_PROFILE);
    // Already a combatant: left as it was.
    expect(healthOf(again, other)).toEqual({ max: 5, current: 5 });
    expect(again.has(other, HurtboxComponent)).toBe(false);
  });

  it('mw-e04.34: a physics world without a player still gets the world-as-weapon rules', () => {
    const combat = prepareTestbedCombat(loadGameContent());
    const w = new World<never>({ seed: 1, physics: new RapierPhysics(RAPIER) });
    w.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    installGamePhysics(w);
    startTestbedCombat(w, combat, []);
    expect(w.isRegistered(CharacterController)).toBe(true);
    expect(w.isRegistered(BlameComponent)).toBe(true);
    expect(w.query(EnvironmentContactsComponent).ids()).toHaveLength(1);
    w.step();
    // A bare combat world (no physics objects) gets none of it.
    const bare = world();
    startTestbedCombat(bare, prepareTestbedCombat(loadGameContent()), []);
    expect(bare.isRegistered(BlameComponent)).toBe(false);
  });
});
