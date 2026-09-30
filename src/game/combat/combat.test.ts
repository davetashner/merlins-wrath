import { describe, expect, it } from 'vitest';
import { KNIGHT_SHIELD_ID, loadGameContent } from '@content/index';
import {
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  PlacementComponent,
  World,
  type SceneSpawnPlacement,
} from '@sim/index';
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
    const w = world();
    const dummies = startTestbedCombat(w, combat, [
      spawn('d1', [TRAINING_DUMMY_TAG]),
      spawn('x', []),
      spawn('d2', [TRAINING_DUMMY_TAG], 3),
    ]);
    expect(dummies).toHaveLength(2);
    w.step();
    expect(dummies.map((d) => dummyReadout(w, d)?.health)).toEqual([200, 200]);
  });
});
