// mw-e09.3: the shipped noise tuning and the mechanism room's acoustics, loaded like game content,
// drive the sim's noise propagation with the room's real doors. DEFAULT_NOISE_TUNING (for code
// without content) must match the shipped table exactly.
import { loadGameContent, materialPresets, STEALTH_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { startMechanisms } from '@game/mechanisms/index';
import {
  DEFAULT_NOISE_TUNING,
  distanceGainDb,
  emitNoise,
  InMemoryColliderSink,
  INTERACTION_COMPONENTS,
  installNoisePropagation,
  installStimuli,
  loadScene,
  NoiseListenerComponent,
  noiseHeard,
  openDoor,
  placeEntity,
  registerSceneComponents,
  registerWorldProperties,
  soundGraphFromScene,
  stimulusSystem,
  World,
  type EntityId,
  type KitLookup,
  type NoiseHeard,
} from '@sim/index';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();
const tuning = content.get('stealth', STEALTH_ID).noise;
const kit: KitLookup = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);
const v = (x: number, y: number, z: number) => ({ x, y, z });
const dist = (a: { x: number; y: number; z: number }, b: typeof a) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function mechanismRoom() {
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 9 }))),
  );
  world.register(...INTERACTION_COMPONENTS);
  world.addSystem(stimulusSystem());
  const colliders = new InMemoryColliderSink();
  const scene = content.get('scene', 'mechanism-room');
  const loaded = loadScene(world, scene, kit, colliders);
  startMechanisms(world, loaded, {
    content,
    materials: materialPresets(content.all('material')),
    colliders,
    occluders: new InMemoryColliderSink(),
  });
  installNoisePropagation(world, {
    graph: soundGraphFromScene(scene, loaded),
    tuning,
    doorMaterial: (profile) => content.get('door', profile).material.id,
  });
  const guard = world.spawn();
  const ear = v(0, 1, -2);
  placeEntity(world, guard, ear, 0.4);
  world.add(guard, NoiseListenerComponent, { thresholdDb: 0, range: 40 });
  const heard: NoiseHeard[] = [];
  world.events.on(noiseHeard, (e) => {
    if (e.noise.kind === 'pot') heard.push(e);
  });
  const pot = (at: { x: number; y: number; z: number }) => {
    heard.length = 0;
    emitNoise(world, { position: at, loudness: 60, kind: 'pot' });
    world.events.flush();
    return heard[0];
  };
  const spawn = (id: string): EntityId =>
    loaded.spawns.find((s) => s.spawn.id === id)?.entity ?? -1;
  return { world, ear, pot, spawn };
}

describe('shipped noise propagation (mw-e09.3)', () => {
  it('the sim default mirrors the shipped table, whose materials all exist', ({ task }) => {
    markExercised(task, 'stealth', STEALTH_ID);
    expect(DEFAULT_NOISE_TUNING).toEqual(tuning);
    for (const { material } of [...tuning.doors.materials, ...tuning.partitions.materials]) {
      expect(content.has('material', material), material).toBe(true);
    }
  });

  it('AC-2/AC-3: the mechanism room’s shut wooden door muffles the west closet by 20 dB, heard at the doorway', ({
    task,
  }) => {
    markExercised(task, 'scene', 'mechanism-room');
    markExercised(task, 'door', 'wooden-door');
    const { world, ear, pot, spawn } = mechanismRoom();
    const at = v(-6, 1, 0);
    const doorway = v(-5, 1, 0);
    const shut = pot(at);
    expect(shut).toMatchObject({ via: 'west-doorway', perceived: doorway, occlusion: 20 });
    expect(shut?.level).toBeCloseTo(60 + distanceGainDb(1 + dist(doorway, ear)) - 20, 6);
    openDoor(world, spawn('west-door'));
    for (let i = 0; i < 120; i++) world.step();
    expect(pot(at)?.level).toBeCloseTo((shut?.level ?? 0) + 20, 6);
  });

  it('the locked iron door takes its material’s 25 dB; the portcullis grille passes sound', ({
    task,
  }) => {
    markExercised(task, 'door', 'iron-door');
    markExercised(task, 'door', 'portcullis');
    const { pot } = mechanismRoom();
    expect(pot(v(0, 1, -6))).toMatchObject({ via: 'south-doorway', occlusion: 25 });
    expect(pot(v(0, 1, 10))).toMatchObject({ via: 'north-doorway', occlusion: 0 });
  });
});
