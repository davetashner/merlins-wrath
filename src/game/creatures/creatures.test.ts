import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import { prepareTestbedCombat } from '@game/combat/index';
import {
  box,
  FactionMemberComponent,
  hashWorld,
  RapierPhysics,
  World,
  type SceneCreatures,
  type SceneSpawnPlacement,
} from '@sim/index';
import { loadDevContent } from '@content/dev-content';
import { RenderSync } from '@game/loop/index';
import {
  bindCreatures,
  creatureReadout,
  prepareCreatures,
  sceneCreatureErrors,
  startCreatures,
  viewCentrePoint,
  type CreatureLook,
} from './index';

describe('game creatures (mw-e12.4)', () => {
  it('with no creature in content, starting creatures leaves the world exactly as it was', () => {
    const content = loadGameContent();
    const combat = prepareTestbedCombat(content);
    const creatures = prepareCreatures(content, combat);
    expect(creatures.table.size).toBe(0);
    expect(creatures.spawners.size).toBe(0);
    const world = new World<never>({ seed: 1 });
    const before = hashWorld(world);
    expect(startCreatures(world, creatures, combat, [])).toEqual({ entities: [], errors: [] });
    expect(world.isRegistered(FactionMemberComponent)).toBe(false);
    expect(hashWorld(world)).toBe(before);
  });

  it('formats failed scene spawns for the browser console', () => {
    const result: SceneCreatures = {
      entities: [],
      errors: [
        { point: 'nest', error: { kind: 'unknown-creature', creature: 'wyvern' } },
        { point: 'gate', error: { kind: 'unknown-faction', creature: 'guard', faction: 'elves' } },
      ],
    };
    expect(sceneCreatureErrors(result)).toEqual([
      'creature spawn "nest": unknown creature "wyvern"',
      'creature spawn "gate": creature "guard": unknown faction "elves"',
    ]);
  });

  it('at-cursor: the view centre meets the floor below a camera looking down, and nothing above', () => {
    const physics = new RapierPhysics(RAPIER);
    physics.add(box({ x: -10, y: -1, z: -10 }, { x: 10, y: 0, z: 10 }));
    physics.step(0);
    // Pitched 90° down: rotating −z about +x by −90° points it at −y.
    const s = Math.SQRT1_2;
    const down = { x: -s, y: 0, z: 0, w: s };
    const point = viewCentrePoint(physics, { position: { x: 2, y: 5, z: 3 }, quaternion: down });
    expect(point?.x).toBeCloseTo(2, 6);
    expect(point?.y).toBeCloseTo(0, 6);
    expect(point?.z).toBeCloseTo(3, 6);
    const up = { x: s, y: 0, z: 0, w: s };
    expect(viewCentrePoint(physics, { position: { x: 2, y: 5, z: 3 }, quaternion: up })).toBe(
      undefined,
    );
  });

  it('binds a proxy once per creature and reads out how many are drawn and in view', () => {
    const content = loadDevContent();
    const combat = prepareTestbedCombat(content);
    const creatures = prepareCreatures(content, combat);
    const world = new World<never>({ seed: 1 });
    const sync = new RenderSync(world);
    const nothing = (): undefined => undefined;
    const looks: CreatureLook[] = [];
    const bind = () =>
      bindCreatures(world, sync, (_entity, look) => {
        looks.push(look);
        return { object: look, read: nothing, apply: nothing, dispose: nothing };
      });
    // Not installed yet: nothing to bind or read.
    expect(bind()).toBe(0);
    expect(creatureReadout(world, () => true)).toEqual({
      count: 0,
      drawn: 0,
      inView: 0,
      kinds: {},
    });
    const spawn = (id: string, creature: string, x: number): SceneSpawnPlacement => ({
      id,
      position: { x, y: 0, z: 0 },
      yaw: 0,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      prop: undefined,
      tags: [],
      creature,
    });
    const result = startCreatures(world, creatures, combat, [
      spawn('a', 'fixture-guard', 0),
      spawn('b', 'fixture-hound', 5),
      spawn('c', 'fixture-hound', -5),
    ]);
    const [guard, hound] = result.entities;
    expect(creatureReadout(world, (id) => sync.has(id))).toEqual({
      count: 3,
      drawn: 0,
      inView: 0,
      kinds: { 'fixture-guard': 1, 'fixture-hound': 2 },
    });
    expect(bind()).toBe(3);
    expect(bind()).toBe(0); // already bound
    expect(looks.map((l) => [l.id, l.armed, l.nav.height])).toEqual([
      ['fixture-guard', true, 1.8],
      ['fixture-hound', false, 0.9],
      ['fixture-hound', false, 0.9],
    ]);
    // In view: x within ±1 of the stand-in projection, i.e. only the guard at x = 0.
    const project = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: 0, z: 0 });
    expect(creatureReadout(world, (id) => sync.has(id), project)).toMatchObject({
      drawn: 3,
      inView: 1,
    });
    expect(guard).toBeDefined();
    expect(hound).toBeDefined();
  });
});
