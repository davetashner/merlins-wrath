// Mechanisms glue (mw-e03.18): the grey-box mechanism room loaded headless from the game's content.
import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets } from '@content/index';
import {
  INTERACTION_COMPONENTS,
  InMemoryColliderSink,
  installSignals,
  installStimuli,
  loadScene,
  registerSceneComponents,
  registerWorldProperties,
  SceneSpawnComponent,
  signalSystem,
  stimulusSystem,
  useSwitch,
  World,
  type EntityId,
  type KitLookup,
} from '@sim/index';
import {
  doorLeafLooks,
  doorProfiles,
  hasMechanisms,
  lockSpecs,
  MechanismWatch,
  readDoorLeaf,
  startMechanisms,
} from './index';

const content = loadGameContent();
const kit: KitLookup = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);

function room(preSignals = false) {
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 9 }))),
  );
  world.register(...INTERACTION_COMPONENTS);
  world.addSystem(stimulusSystem());
  if (preSignals) {
    installSignals(world);
    world.addSystem(signalSystem());
  }
  const colliders = new InMemoryColliderSink();
  const occluders = new InMemoryColliderSink();
  const loaded = loadScene(world, content.get('scene', 'mechanism-room'), kit, colliders);
  const made = startMechanisms(world, loaded, {
    content,
    materials: materialPresets(content.all('material')),
    colliders,
    occluders,
  });
  const spawn = (id: string): EntityId => {
    const found = loaded.spawns.find((s) => s.spawn.id === id);
    if (found === undefined) throw new Error(`no spawn ${id}`);
    return found.entity;
  };
  return { world, loaded, made, spawn, occluders };
}

describe('mechanisms in the game (mw-e03.18)', () => {
  it('turns content doors and locks into sim lookups', () => {
    expect(doorProfiles(content)('portcullis')).toMatchObject({
      kind: 'portcullis',
      size: { x: 1.2, y: 2.2, z: 0.1 },
      manual: false,
      crush: 2000,
    });
    expect(doorProfiles(content)('no-such-door')).toBeUndefined();
    expect(lockSpecs(content)('slice-exit')).toEqual({
      id: 'slice-exit',
      tier: 2,
      pickTier: 2,
      sealed: false,
      tags: [],
      hint: 'Locked.',
    });
    expect(lockSpecs(content)('no-such-lock')).toBeUndefined();
  });

  it('knows which scenes have mechanisms', () => {
    const { loaded } = room();
    expect(hasMechanisms(loaded.layout)).toBe(true);
    const testbed = loadScene(
      registerSceneComponents(new World<never>({ seed: 1 })),
      content.get('scene', 'weak-wall-room'),
      kit,
      new InMemoryColliderSink(),
    );
    expect(hasMechanisms(testbed.layout)).toBe(false);
    expect(
      hasMechanisms({ ...testbed.layout, signals: [{ graph: 'mechanism-room', bindings: {} }] }),
    ).toBe(true);
  });

  it('starts the room: doors of every kind, its switches, and the lever raises the portcullis', () => {
    const { world, made, spawn, occluders } = room();
    expect(made.doors).toHaveLength(5);
    expect(made.switches).toHaveLength(3);
    const watch = new MechanismWatch(world, made);
    expect(watch.readout()).toEqual({
      doors: {
        'north-gate': { status: 'closed', openness: 0 },
        'west-door': { status: 'closed', openness: 0 },
        'south-door': { status: 'locked', openness: 0 },
        'east-door': { status: 'closed', openness: 0 },
        trapdoor: { status: 'closed', openness: 0 },
      },
      switches: { 'north-lever': 0, 'east-button': 0, 'floor-crank': 0 },
    });
    world.step();
    // Closed doors that shut out light occlude it; the grille does not.
    expect(occluders.count()).toBe(4);
    useSwitch(world, spawn('north-lever'));
    for (let i = 0; i < 125; i++) world.step();
    expect(watch.readout().doors['north-gate']).toEqual({ status: 'open', openness: 1 });
    expect(watch.broken(spawn('north-gate'))).toBe(false);
  });

  it('describes each leaf for drawing and follows its pose', () => {
    const { world, made, spawn } = room(true);
    const looks = doorLeafLooks(world, made, content);
    expect(looks.map((l) => l.material)).toEqual(['iron', 'wood', 'iron', 'stone', 'wood']);
    expect(looks[0]).toMatchObject({
      size: { x: 1.2, y: 2.2, z: 0.1 },
      centre: { x: 0, y: 1.1, z: 0 },
    });
    const gate = spawn('north-gate');
    expect(readDoorLeaf(world, gate)?.position).toEqual({ x: 0, y: 0, z: 5 });
    expect(readDoorLeaf(world, spawn('player-start'))).toBeUndefined();
    // A door that is gone is left out of both.
    world.destroy(gate);
    expect(doorLeafLooks(world, made, content)).toHaveLength(4);
    expect(Object.keys(new MechanismWatch(world, made).readout().doors)).not.toContain(
      'north-gate',
    );
    // Unknown profiles draw as generic; unnamed entities report by id.
    const odd = world.spawn();
    expect(
      doorLeafLooks(
        world,
        { doors: [spawn('west-door')], switches: [], graphs: [] },
        {
          ...content,
          has: () => false,
          all: content.all.bind(content),
          get: content.get.bind(content),
        },
      )[0]?.material,
    ).toBe('generic');
    world.remove(spawn('east-button'), SceneSpawnComponent);
    const watch = new MechanismWatch(world, {
      doors: [],
      switches: [spawn('east-button'), odd],
      graphs: [],
    });
    expect(watch.readout().switches).toEqual({ [String(spawn('east-button'))]: 0 });
  });
});
