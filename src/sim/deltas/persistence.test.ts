// Level deltas (mw-e27.3): capture against an authored baseline, re-apply to a fresh baseline in
// another world (whose entity ids differ), on the real deterministic Rapier build.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import type { BreakableProfile } from '../breakables/components';
import { addSceneBreakables } from '../breakables/scene';
import { installBreakables } from '../breakables/system';
import { HealthComponent } from '../combat/damage/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CreatureComponent, type Creature } from '../creatures/components';
import { FactionMemberComponent } from '../factions/runtime';
import { InteractableComponent } from '../interaction/system';
import { InventoryComponent, type InventoryState } from '../inventory/inventory';
import {
  itemDropped,
  WorldItemComponent,
  WorldItems,
  type WorldItemDef,
} from '../items/world-items';
import {
  DoorComponent,
  LockComponent,
  SwitchComponent,
  type DoorProfile,
} from '../mechanisms/components';
import { installMechanisms, makeDoor, makeSwitch } from '../mechanisms/system';
import {
  installPhysicsObjects,
  PhysicsColliderComponent,
  PhysicsObjectComponent,
  teleportPhysicsObject,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import type { ColliderHandle } from '../physics/static-colliders';
import {
  addProperties,
  getProperty,
  readProperty,
  registerWorldProperties,
  WorldProperties,
} from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import type { KitLookup, KitPieceSpec, SceneSpec } from '../scene/layout';
import { loadScene, registerSceneComponents, type LoadedScene } from '../scene/loader';
import { addScenePhysics, type PropBody } from '../scene/physics';
import { hashWorld } from '../snapshot';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  DEFAULT_PERSISTENCE,
  propertyPersistence,
  type PersistenceDeclaration,
} from './declarations';
import {
  markPersistent,
  persistDroppedItems,
  PersistentSpawnComponent,
  registerPersistence,
  sceneAuthoredEntities,
  spawnedId,
  worldItemSpawner,
  WorldPersistence,
  type LevelBaseline,
  type LevelDeltas,
} from './persistence';

const KIT: readonly KitPieceSpec[] = [
  {
    id: 'floor',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [2, 0.2, 2], offset: [0, -0.1, 0], collider: true }],
  },
  {
    id: 'wall',
    purpose: 'blocking',
    parts: [{ shape: 'box', size: [2, 3, 0.4], offset: [0, 1.5, 0], collider: true }],
  },
];
const kit: KitLookup = (id) => KIT.find((piece) => piece.id === id);

const LEVEL = 'delta-room';
const SCENE: SceneSpec = {
  id: LEVEL,
  grid: 1,
  placements: [
    { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [10, 1, 10] },
    {
      piece: { id: 'wall' },
      at: [0, 0, 6],
      yaw: 0,
      scale: [1, 1, 1],
      properties: { hp: 50 },
      breakable: { profile: { id: 'old-wall' } },
    },
  ],
  spawns: [
    { id: 'player-start', at: [0, 0, -4], yaw: 0, tags: ['player-start'] },
    { id: 'crate', at: [-3, 0, 0], yaw: 0, prop: { id: 'crate' }, tags: [] },
    { id: 'chest', at: [3, 0, 0], yaw: 0, tags: [] },
    { id: 'door', at: [0, 0, -6], yaw: 0, tags: [] },
    { id: 'lever', at: [2, 0, -6], yaw: 0, tags: [] },
    { id: 'guard', at: [-6, 0, 3], yaw: 0, tags: [] },
  ],
};

const OLD_WALL: BreakableProfile = {
  id: 'old-wall',
  resistances: {},
  debris: { count: 0, size: 0.3 },
  breakLoudness: 85,
};
const MATERIALS: MaterialPresets = new Map([
  ['stone', { density: 2600, friction: 0.6, hp: 400 }],
  ['wood', { density: 700, friction: 0.5, flammable: true, fuel: 30 }],
  ['charred', { density: 300, friction: 0.8, flammable: false }],
]);
const PROPS = new Map<string, PropBody>([
  ['crate', { size: { x: 1, y: 1, z: 1 }, material: 'wood', weight: 20 }],
]);
const WOODEN_DOOR: DoorProfile = {
  id: 'wooden-door',
  kind: 'hinged',
  size: { x: 1.2, y: 2.2, z: 0.1 },
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: false, sound: true },
  loudness: 50,
};
const KEY: WorldItemDef = {
  id: 'rusted-key',
  category: 'key',
  stackable: false,
  weightClass: 'light',
  flags: { unique: false, questItem: false, noDrop: false },
};
const ARROW: WorldItemDef = {
  id: 'arrow',
  category: 'ammo',
  stackable: true,
  maxStack: 50,
  weightClass: 'light',
  flags: { unique: false, questItem: false, noDrop: false },
};
const items = new WorldItems([KEY, ARROW]);

const CHEST: InventoryState = {
  gold: 25,
  nextInstanceId: 3,
  items: [
    { instanceId: 1, defId: 'rusted-key', count: 1, flags: {} },
    { instanceId: 2, defId: 'arrow', count: 12, flags: { ownerId: 'miller' } },
  ],
};

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** A world with physics objects, stimuli, breakables, mechanisms and the actor components. */
function makeWorld(junk = 0) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 9, physics }))),
  );
  installPhysicsObjects(world);
  world.addSystem(stimulusSystem());
  installBreakables(world, { debrisBudget: 0 });
  installMechanisms(world, { colliders: physics });
  world.register(
    InventoryComponent,
    HealthComponent,
    FactionMemberComponent,
    CreatureComponent,
    WorldItemComponent,
    InteractableComponent,
  );
  registerPersistence(world);
  // Entities spawned before the level, so its entity ids differ from another world's.
  for (let i = 0; i < junk; i++) world.spawn();
  return { world, physics };
}

const creature = (point?: string): Creature => ({
  origin: {
    creature: 'hound',
    at: { x: -6, y: 0, z: 3 },
    facing: { x: 0, y: 0, z: 1 },
    ...(point !== undefined && { point }),
  },
  behaviour: 'guard',
  tuning: {},
  needs: {},
});

/** Spawns the level from data: scene, physics, breakables, door, lever, chest, guard. */
function spawnLevel(world: World<never>, physics: RapierPhysics) {
  const loaded = loadScene(world, SCENE, kit, physics);
  addScenePhysics(world, loaded, { props: (id) => PROPS.get(id), materials: MATERIALS });
  addSceneBreakables(world, loaded, (id) => (id === OLD_WALL.id ? OLD_WALL : undefined));
  const spawn = (id: string): EntityId => must(loaded.spawns.find((s) => s.spawn.id === id)).entity;
  world.add(spawn('chest'), InventoryComponent, CHEST);
  makeDoor(world, spawn('door'), WOODEN_DOOR, {
    origin: { x: 0, y: 0, z: -6 },
    lock: { id: 'tower', tier: 1, pickTier: 1, sealed: false, tags: [], hint: 'Locked.' },
  });
  makeSwitch(world, spawn('lever'), 'lever');
  const guard = world.spawn();
  world.add(guard, CreatureComponent, creature('guard'));
  world.add(guard, HealthComponent, Object.freeze({ max: 40, current: 40 }));
  world.add(guard, FactionMemberComponent, { faction: 'bandits', toward: {} });
  // Creatures from elsewhere are not part of the level.
  world.add(world.spawn(), CreatureComponent, creature());
  world.add(world.spawn(), CreatureComponent, creature('other-level-point'));
  return { loaded, spawn, guard };
}

interface Visit {
  readonly world: World<never>;
  readonly physics: RapierPhysics;
  readonly loaded: LoadedScene;
  readonly spawn: (id: string) => EntityId;
  readonly guard: EntityId;
  readonly baseline: LevelBaseline;
}

/** A fresh world with the level spawned and its baseline taken. */
function visit(persistence: WorldPersistence, junk = 0): Visit {
  const { world, physics } = makeWorld(junk);
  const level = spawnLevel(world, physics);
  const baseline = persistence.baseline(world, LEVEL, sceneAuthoredEntities(world, level.loaded));
  return { world, physics, baseline, ...level };
}

const settle = (world: World<never>, ticks = 240): void => {
  for (let i = 0; i < ticks; i++) world.step();
};

describe('level deltas: capture', () => {
  it('AC-1: a crate moved 5 m and at rest records one transform delta; a 1 mm nudge records none', () => {
    const persistence = new WorldPersistence();
    const nudged = visit(persistence);
    const crate = nudged.spawn('crate');
    const start = must(nudged.world.get(crate, PhysicsObjectComponent)).position;
    teleportPhysicsObject(nudged.world, crate, { ...start, x: start.x + 0.001 });
    expect(persistence.capture(nudged.world, nudged.baseline).entities).toEqual([]);

    const moved = visit(persistence);
    const box = moved.spawn('crate');
    teleportPhysicsObject(moved.world, box, { ...start, x: start.x + 5 });
    settle(moved.world);
    const deltas = persistence.capture(moved.world, moved.baseline);
    expect(deltas.entities).toHaveLength(1);
    const [delta] = deltas.entities;
    expect(delta?.id).toBe('spawn:crate');
    expect(Object.keys(must(delta?.aspects))).toEqual(['transform']);
    const pose = must(moved.world.get(box, PhysicsObjectComponent));
    expect(delta?.aspects?.['transform']).toEqual({
      position: pose.position,
      rotation: pose.rotation,
    });
    expect(Math.abs(pose.position.x - (start.x + 5))).toBeLessThan(0.05);
  });

  it('records no pose while a moved crate is still moving, and records a turn in place', () => {
    const persistence = new WorldPersistence();
    const falling = visit(persistence);
    const crate = falling.spawn('crate');
    const start = must(falling.world.get(crate, PhysicsObjectComponent)).position;
    teleportPhysicsObject(falling.world, crate, { ...start, y: start.y + 4 });
    settle(falling.world, 10);
    expect(persistence.capture(falling.world, falling.baseline).entities).toEqual([]);

    const turned = visit(persistence);
    const box = turned.spawn('crate');
    const half = Math.SQRT1_2;
    const rotation = { x: 0, y: half, z: 0, w: half };
    must(DEFAULT_PERSISTENCE.find((d) => d.key === 'transform')).apply(turned.world, box, {
      position: start,
      rotation,
    });
    const [delta] = persistence.capture(turned.world, turned.baseline).entities;
    expect(delta?.aspects?.['transform']).toEqual({ position: start, rotation });
  });

  it('records a gone entity as destroyed, changed properties, mechanisms, pack and actor', () => {
    const persistence = new WorldPersistence();
    const { world, baseline, spawn, guard } = visit(persistence);
    const crate = spawn('crate');
    addProperties(world, crate, { material: 'charred', wetness: 1, liftable: true });
    world.remove(crate, PhysicsObjectComponent);
    world.destroy(spawn('player-start'));
    world.set(spawn('door'), DoorComponent, {
      ...must(world.get(spawn('door'), DoorComponent)),
      openness: 1,
      target: 1,
    });
    world.set(spawn('door'), LockComponent, {
      ...must(world.get(spawn('door'), LockComponent)),
      locked: false,
    });
    world.set(spawn('lever'), SwitchComponent, {
      ...must(world.get(spawn('lever'), SwitchComponent)),
      position: 1,
    });
    world.set(guard, HealthComponent, Object.freeze({ max: 40, current: 0 }));
    world.set(guard, FactionMemberComponent, { faction: 'bandits', toward: { player: 'ally' } });
    const deltas = persistence.capture(world, baseline);
    expect(deltas.level).toBe(LEVEL);
    expect(deltas.entities).toEqual([
      { id: 'spawn:player-start', destroyed: true },
      // Wetness is transient; the body went, so the pose did too.
      { id: 'spawn:crate', aspects: { properties: { material: 'charred', liftable: true } } },
      {
        id: 'spawn:door',
        aspects: {
          door: { openness: 1, target: 1, jammed: false, broken: false },
          lock: { locked: false },
        },
      },
      { id: 'spawn:lever', aspects: { switch: { position: 1 } } },
      {
        id: 'creature:guard',
        aspects: {
          'actor.life': { current: 0 },
          'actor.disposition': { faction: 'bandits', toward: { player: 'ally' } },
        },
      },
    ]);
    expect(deltas.spawned).toEqual([]);
  });

  it('is identical for identical play, and leaves the world untouched', () => {
    const persistence = new WorldPersistence();
    const play = (junk: number) => {
      const level = visit(persistence, junk);
      teleportPhysicsObject(level.world, level.spawn('crate'), { x: 2, y: 0.5, z: -2 });
      settle(level.world, 60);
      const hash = hashWorld(level.world);
      const deltas = persistence.capture(level.world, level.baseline);
      expect(hashWorld(level.world)).toBe(hash);
      return deltas;
    };
    expect(play(0)).toEqual(play(0));
  });

  it('records a property the entity lost as null, and honours its own transient list', () => {
    const persistence = new WorldPersistence({ declarations: [propertyPersistence(['material'])] });
    const { world, baseline, spawn } = visit(persistence);
    const crate = spawn('crate');
    addProperties(world, crate, { material: 'charred', wetness: 0.5 });
    world.remove(crate, WorldProperties.flammable);
    expect(persistence.capture(world, baseline).entities).toEqual([
      { id: 'spawn:crate', aspects: { properties: { flammable: null, wetness: 0.5 } } },
    ]);
  });

  it('rejects two authored entities with one id, two declarations with one key and two spawners of one kind', () => {
    const persistence = new WorldPersistence();
    const { world } = makeWorld();
    const a = world.spawn();
    expect(() =>
      persistence.baseline(world, LEVEL, [
        ['spawn:a', a],
        ['spawn:a', world.spawn()],
      ]),
    ).toThrow(/two entities with id "spawn:a"/);
    const [first] = DEFAULT_PERSISTENCE;
    expect(() => new WorldPersistence({ declarations: [must(first), must(first)] })).toThrow(
      /share a key/,
    );
    const spawner = worldItemSpawner(items);
    expect(() => new WorldPersistence({ spawners: [spawner, spawner] })).toThrow(/share a kind/);
  });

  it('gives authored entities stable ids: pieces, spawns and their creatures', () => {
    const { world, physics } = makeWorld();
    const { loaded, guard } = spawnLevel(world, physics);
    expect(sceneAuthoredEntities(world, loaded)).toEqual([
      ['piece:0', loaded.pieces[0]],
      ['piece:1', loaded.pieces[1]],
      ...loaded.spawns.map(({ entity, spawn }) => [`spawn:${spawn.id}`, entity]),
      ['creature:guard', guard],
    ]);
    // Without creatures installed, there are none to list.
    const bare = registerSceneComponents(
      new World<never>({ seed: 1, physics: new RapierPhysics(RAPIER) }),
    );
    const scene = loadScene(bare, SCENE, kit, must(bare.physics));
    expect(sceneAuthoredEntities(bare, scene)).toHaveLength(8);
  });
});

describe('level deltas: apply', () => {
  it('AC-1: re-applied to a fresh baseline, the crate rests where it was left', () => {
    const persistence = new WorldPersistence();
    const first = visit(persistence);
    const crate = first.spawn('crate');
    teleportPhysicsObject(first.world, crate, { x: 2, y: 0.5, z: -2 });
    settle(first.world);
    const deltas = persistence.capture(first.world, first.baseline);
    const pose = must(first.world.get(crate, PhysicsObjectComponent));

    const second = visit(persistence, 17);
    const box = second.spawn('crate');
    expect(box).not.toBe(crate);
    const report = persistence.apply(second.world, second.baseline, deltas);
    expect(report.skipped).toEqual([]);
    expect(report.applied).toBe(1);
    const restored = must(second.world.get(box, PhysicsObjectComponent));
    expect(restored.position).toEqual(pose.position);
    expect(restored.rotation).toEqual(pose.rotation);
    const body = second.physics.poseOf(restored.body as ColliderHandle);
    expect(body.position.x).toBeCloseTo(pose.position.x, 6);
    expect(body.position.z).toBeCloseTo(pose.position.z, 6);
    // Nothing new to record: the level is as it was left.
    expect(persistence.capture(second.world, second.baseline)).toEqual(deltas);
  });

  it('AC-2: a broken wall and a looted chest stay broken (no collider) and empty on a fresh baseline', () => {
    const persistence = new WorldPersistence();
    const first = visit(persistence);
    const wall = must(first.loaded.pieces[1]);
    const colliders = must(first.world.get(wall, PhysicsColliderComponent)).colliders;
    applyStimulus(first.world, {
      shape: { kind: 'contact', target: wall },
      element: 'blunt',
      intensity: 500,
    });
    first.world.step();
    expect(first.world.isAlive(wall)).toBe(false);
    expect(colliders.every((c) => !first.physics.has(c as ColliderHandle))).toBe(true);
    const looted: InventoryState = { gold: 0, nextInstanceId: 3, items: [] };
    first.world.set(first.spawn('chest'), InventoryComponent, looted);
    const deltas = persistence.capture(first.world, first.baseline);
    expect(deltas.entities).toEqual([
      { id: 'piece:1', destroyed: true },
      { id: 'spawn:chest', aspects: { container: looted } },
    ]);

    const second = visit(persistence, 5);
    const freshWall = must(second.loaded.pieces[1]);
    const freshColliders = must(second.world.get(freshWall, PhysicsColliderComponent)).colliders;
    expect(freshColliders.every((c) => second.physics.has(c as ColliderHandle))).toBe(true);
    expect(second.world.get(second.spawn('chest'), InventoryComponent)).toEqual(CHEST);
    const report = persistence.apply(second.world, second.baseline, deltas);
    expect(report).toEqual({ applied: 2, skipped: [], spawned: new Map() });
    expect(second.world.isAlive(freshWall)).toBe(false);
    expect(freshColliders.some((c) => second.physics.has(c as ColliderHandle))).toBe(false);
    expect(second.world.get(second.spawn('chest'), InventoryComponent)).toEqual(looted);
    // The applied delta is detached from the record it came from.
    expect(second.world.get(second.spawn('chest'), InventoryComponent)).not.toBe(
      deltas.entities[1]?.aspects?.['container'],
    );
  });

  it('AC-3: a persistent dropped item comes back at the same position with the same item id', () => {
    const persistence = new WorldPersistence({ spawners: [worldItemSpawner(items)] });
    const first = visit(persistence);
    const dropped = items.spawn(first.world, {
      defId: 'arrow',
      count: 7,
      flags: { stolen: true },
      position: { x: 1, y: 2, z: 1 },
    });
    expect(markPersistent(first.world, dropped, 'item', LEVEL)).toBe(spawnedId(dropped));
    // Not marked: it stays out of the level's deltas.
    items.spawn(first.world, { defId: 'rusted-key', position: { x: -1, y: 0.1, z: 1 } });
    settle(first.world, 120);
    const deltas = persistence.capture(first.world, first.baseline);
    const at = must(first.world.get(dropped, PhysicsObjectComponent));
    expect(deltas.entities).toEqual([]);
    expect(deltas.spawned).toEqual([
      {
        id: `spawned:${String(dropped)}`,
        kind: 'item',
        data: {
          defId: 'arrow',
          count: 7,
          flags: { stolen: true },
          position: at.position,
          rotation: at.rotation,
        },
      },
    ]);

    const second = visit(persistence, 40);
    const report = persistence.apply(second.world, second.baseline, deltas);
    const back = must(report.spawned.get(spawnedId(dropped)));
    expect(report.applied).toBe(1);
    expect(second.world.get(back, PhysicsObjectComponent)?.position).toEqual(at.position);
    expect(second.world.get(back, PhysicsObjectComponent)?.rotation).toEqual(at.rotation);
    expect(second.world.get(back, WorldItemComponent)).toMatchObject({
      defId: 'arrow',
      count: 7,
      flags: { stolen: true },
    });
    // It keeps its first id, so leaving again records the same entity.
    expect(second.world.get(back, PersistentSpawnComponent)).toEqual({
      id: spawnedId(dropped),
      kind: 'item',
      level: LEVEL,
    });
    expect(persistence.capture(second.world, second.baseline).spawned[0]?.id).toBe(
      spawnedId(dropped),
    );
  });

  it('AC-4: a delta for an id the baseline no longer has is skipped with a warning; loading continues', () => {
    const warnings: string[] = [];
    const persistence = new WorldPersistence({ warn: (m) => warnings.push(m) });
    const { world, baseline, spawn } = visit(persistence);
    const deltas: LevelDeltas = {
      level: LEVEL,
      entities: [
        { id: 'spawn:removed-barrel', destroyed: true },
        { id: 'spawn:chest', aspects: { container: { gold: 0, nextInstanceId: 3, items: [] } } },
        { id: 'piece:99', aspects: { properties: { burning: true } } },
        { id: 'spawn:player-start', destroyed: true },
      ],
      spawned: [],
    };
    const report = persistence.apply(world, baseline, deltas);
    expect(report.applied).toBe(2);
    expect(report.skipped).toEqual([
      {
        id: 'spawn:removed-barrel',
        reason: 'unknown-entity',
        message: 'level "delta-room" has no entity "spawn:removed-barrel"; its changes are dropped',
      },
      {
        id: 'piece:99',
        reason: 'unknown-entity',
        message: 'level "delta-room" has no entity "piece:99"; its changes are dropped',
      },
    ]);
    expect(warnings).toEqual(report.skipped.map((s) => s.message));
    expect(world.get(spawn('chest'), InventoryComponent)?.gold).toBe(0);
    expect(world.isAlive(spawn('player-start'))).toBe(false);
    // An entity already gone when the delta arrives is skipped the same way, without a logger.
    const quiet = new WorldPersistence();
    const again = quiet.apply(world, baseline, {
      level: LEVEL,
      entities: [{ id: 'spawn:player-start', destroyed: true }],
      spawned: [],
    });
    expect(again.skipped.map((s) => s.reason)).toEqual(['unknown-entity']);
    world.step(); // the first tick runs on the patched level
  });

  it('re-applies mechanisms, properties, actor life and disposition', () => {
    const persistence = new WorldPersistence();
    const first = visit(persistence);
    const { world } = first;
    const door = first.spawn('door');
    world.set(door, DoorComponent, {
      ...must(world.get(door, DoorComponent)),
      openness: 1,
      target: 1,
      broken: true,
    });
    world.set(door, LockComponent, { ...must(world.get(door, LockComponent)), locked: false });
    world.set(first.spawn('lever'), SwitchComponent, {
      ...must(world.get(first.spawn('lever'), SwitchComponent)),
      position: 1,
    });
    const wall = must(first.loaded.pieces[0]);
    addProperties(world, wall, { material: 'charred', friction: 0.9 });
    addProperties(world, first.spawn('crate'), { weight: 35, friction: 0.1 });
    world.set(first.guard, HealthComponent, Object.freeze({ max: 40, current: 0 }));
    world.set(first.guard, FactionMemberComponent, {
      faction: 'villagers',
      toward: { player: 'ally', bandits: 'hostile' },
    });
    const deltas = persistence.capture(world, first.baseline);

    const second = visit(persistence, 3);
    const w = second.world;
    expect(persistence.apply(w, second.baseline, deltas).skipped).toEqual([]);
    expect(w.get(second.spawn('door'), DoorComponent)).toMatchObject({
      openness: 1,
      target: 1,
      broken: true,
      blockedBy: null,
    });
    expect(w.get(second.spawn('door'), LockComponent)?.locked).toBe(false);
    expect(w.get(second.spawn('lever'), SwitchComponent)?.position).toBe(1);
    const floor = must(second.loaded.pieces[0]);
    expect(getProperty(w, floor, 'material')).toBe('charred');
    const crate = second.spawn('crate');
    expect(readProperty(w, crate, 'weight')).toBe(35);
    const body = must(w.get(crate, PhysicsObjectComponent)).body as ColliderHandle;
    w.step();
    expect(second.physics.motionOf(body).mass).toBeCloseTo(35, 4);
    expect(w.get(second.guard, HealthComponent)).toEqual({ max: 40, current: 0 });
    expect(w.get(second.guard, FactionMemberComponent)).toEqual({
      faction: 'villagers',
      toward: { bandits: 'hostile', player: 'ally' },
    });
    // The door's collider follows its broken state on the first tick.
    expect(w.get(second.spawn('door'), DoorComponent)?.collider).toBeNull();
    expect(persistence.capture(w, second.baseline).entities).toEqual(deltas.entities);
  });

  it('removes a property recorded as null', () => {
    const persistence = new WorldPersistence();
    const { world, baseline, spawn } = visit(persistence);
    persistence.apply(world, baseline, {
      level: LEVEL,
      entities: [
        { id: 'spawn:crate', aspects: { properties: { flammable: null, hideable: null } } },
      ],
      spawned: [],
    });
    expect(getProperty(world, spawn('crate'), 'flammable')).toBeUndefined();
    // An entity with neither a body nor colliders just takes the properties.
    persistence.apply(world, baseline, {
      level: LEVEL,
      entities: [{ id: 'spawn:player-start', aspects: { properties: { hideable: true } } }],
      spawned: [],
    });
    expect(getProperty(world, spawn('player-start'), 'hideable')).toBe(true);
  });

  it('skips unknown aspects, aspects that no longer apply and data a declaration rejects', () => {
    const warnings: string[] = [];
    const persistence = new WorldPersistence({ warn: (m) => warnings.push(m) });
    const { world, baseline, spawn } = visit(persistence);
    const report = persistence.apply(world, baseline, {
      level: LEVEL,
      entities: [
        { id: 'spawn:chest', aspects: { 'ai.state': { mood: 'calm' }, door: { openness: 1 } } },
        { id: 'spawn:player-start', aspects: { transform: { position: {}, rotation: {} } } },
        { id: 'spawn:crate', aspects: { properties: { glitter: 3 } } },
        { id: 'spawn:lever', aspects: { properties: { hp: -5 } } },
        { id: 'spawn:door', aspects: { lock: { locked: false } } },
      ],
      spawned: [],
    });
    expect(report.applied).toBe(1);
    expect(report.skipped.map(({ id, reason, part }) => [id, reason, part])).toEqual([
      ['spawn:chest', 'unknown-aspect', 'ai.state'],
      ['spawn:chest', 'not-applicable', 'door'],
      ['spawn:player-start', 'not-applicable', 'transform'],
      ['spawn:crate', 'invalid', 'properties'],
      ['spawn:lever', 'invalid', 'properties'],
    ]);
    expect(warnings[3]).toMatch(/"properties" rejected: unknown world property "glitter"/);
    expect(world.get(spawn('door'), LockComponent)?.locked).toBe(false);
  });

  it('lets errors that are not data errors through', () => {
    const broken: PersistenceDeclaration = {
      key: 'broken',
      capture: () => undefined,
      diff: () => undefined,
      apply: () => {
        throw new TypeError('bug');
      },
    };
    const persistence = new WorldPersistence({ declarations: [broken] });
    const { world } = makeWorld();
    const entity = world.spawn();
    const baseline = persistence.baseline(world, LEVEL, [['spawn:x', entity]]);
    expect(baseline.states.get('spawn:x')).toEqual({});
    expect(() =>
      persistence.apply(world, baseline, {
        level: LEVEL,
        entities: [{ id: 'spawn:x', aspects: { broken: 1 } }, { id: 'spawn:x' }],
        spawned: [],
      }),
    ).toThrow(TypeError);
    expect(
      persistence.apply(world, baseline, {
        level: LEVEL,
        entities: [{ id: 'spawn:x' }],
        spawned: [],
      }),
    ).toEqual({ applied: 0, skipped: [], spawned: new Map() });
  });

  it('skips spawned entities without a spawner or that cannot be re-created', () => {
    const warnings: string[] = [];
    const persistence = new WorldPersistence({
      spawners: [worldItemSpawner(items)],
      warn: (m) => warnings.push(m),
    });
    const { world, baseline } = visit(persistence);
    const report = persistence.apply(world, baseline, {
      level: LEVEL,
      entities: [],
      spawned: [
        { id: 'spawned:4', kind: 'debris', data: {} },
        {
          id: 'spawned:5',
          kind: 'item',
          data: {
            defId: 'retired-lantern',
            count: 1,
            flags: {},
            position: { x: 0, y: 1, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
    });
    expect(report.applied).toBe(0);
    expect(report.skipped).toEqual([
      {
        id: 'spawned:4',
        reason: 'unknown-kind',
        part: 'debris',
        message: 'level "delta-room": no spawner for "debris"; "spawned:4" dropped',
      },
      {
        id: 'spawned:5',
        reason: 'spawn-failed',
        part: 'item',
        message: 'level "delta-room": "spawned:5" (item) could not be re-created',
      },
    ]);
    expect(warnings).toHaveLength(2);
  });
});

describe('level deltas: persistent runtime entities', () => {
  it('captures only marked entities of this level that their spawner can capture', () => {
    const persistence = new WorldPersistence({ spawners: [worldItemSpawner(items)] });
    const { world, baseline } = visit(persistence);
    const elsewhere = items.spawn(world, { defId: 'arrow', position: { x: 0, y: 1, z: 0 } });
    markPersistent(world, elsewhere, 'item', 'other-level');
    const unknown = world.spawn();
    markPersistent(world, unknown, 'statue', LEVEL);
    const bodiless = world.spawn();
    markPersistent(world, bodiless, 'item', LEVEL);
    expect(persistence.capture(world, baseline).spawned).toEqual([]);
  });

  it('captures none when the world never registered persistence', () => {
    const persistence = new WorldPersistence();
    const world = new World<never>({ seed: 1 });
    const entity = world.spawn();
    const baseline = persistence.baseline(world, LEVEL, [['spawn:x', entity]]);
    // A hand-made baseline without states reads as an empty one.
    const handMade: LevelBaseline = { ...baseline, states: new Map() };
    expect(persistence.capture(world, handMade).entities).toEqual([]);
    expect(persistence.capture(world, baseline)).toEqual({
      level: LEVEL,
      entities: [],
      spawned: [],
    });
    expect(
      persistence
        .apply(world, baseline, {
          level: LEVEL,
          entities: [{ id: 'spawn:x', aspects: { door: {}, transform: {} } }],
          spawned: [],
        })
        .skipped.map((s) => s.reason),
    ).toEqual(['not-applicable', 'not-applicable']);
  });

  it('marks dropped items persistent in the current level, and none while there is no level', () => {
    const { world } = makeWorld();
    let level: string | undefined = LEVEL;
    const off = persistDroppedItems(world, () => level);
    const drop = (entity: EntityId) => {
      world.events.emit(itemDropped, {
        tick: world.tick,
        actor: 1,
        entity,
        defId: 'arrow',
        count: 1,
        flags: {},
        thrown: false,
        position: { x: 0, y: 0, z: 0 },
      });
      world.step();
    };
    const first = world.spawn();
    drop(first);
    expect(world.get(first, PersistentSpawnComponent)).toEqual({
      id: spawnedId(first),
      kind: 'item',
      level: LEVEL,
    });
    level = undefined;
    const second = world.spawn();
    drop(second);
    expect(world.has(second, PersistentSpawnComponent)).toBe(false);
    off();
    level = LEVEL;
    const third = world.spawn();
    drop(third);
    expect(world.has(third, PersistentSpawnComponent)).toBe(false);
  });
});
