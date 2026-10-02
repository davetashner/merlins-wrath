import type { CreatureTable, RuntimeCreature } from '@content/index';
import { describe, expect, it } from 'vitest';
import { ATTACK_COMPONENTS, AttackerComponent } from '../combat/attacks/components';
import {
  giveCombatant,
  HealthComponent,
  PoiseComponent,
  ResistancesComponent,
} from '../combat/damage/components';
import { HurtboxComponent } from '../combat/hits/components';
import { CombatFacingComponent } from '../combat/melee/components';
import { HitReactionComponent } from '../combat/reactions/components';
import { World } from '../core/world';
import { despawnCreaturesCommand, spawnCommand } from '../debug/commands';
import { installDebugCommands } from '../debug/system';
import { FactionMemberComponent, factionOf, installFactions } from '../factions/runtime';
import { buildFactionTable, PLAYER_FACTION, UNALIGNED_FACTION } from '../factions/table';
import type { SceneSpawnPlacement } from '../scene/layout';
import { hashWorld } from '../snapshot';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { TargetableComponent } from '../targeting/components';
import { CreatureComponent, CreatureNavComponent, CreatureSensesComponent } from './components';
import {
  creatureEntities,
  creatureLockProfile,
  creatureSpawners,
  creaturesInstalled,
  despawnAllCreatures,
  despawnCreature,
  facingFromYaw,
  isCreature,
  registerCreatureComponents,
  respawnCreature,
  spawnCreature,
  spawnErrorMessage,
  spawnSceneCreatures,
  type CreatureSpawnOptions,
} from './spawn';

type Def = RuntimeCreature['def'];

/** A grey-box creature as compileCreature would give it (only the fields spawning reads). */
function creature(
  id: string,
  overrides: Partial<Record<keyof Def, unknown>> = {},
): RuntimeCreature {
  const def = {
    id,
    stats: { health: 60, poise: 20, mass: 35, size: 'small' },
    attacks: [],
    resistances: { fire: 1.5 },
    poiseRegen: { delayTicks: 120, percentPerSecond: 25 },
    reactions: { knockbackImpulse: 300, knockdownImpulse: 900, launchSpeed: 2, replace: {} },
    disposition: {},
    behaviour: { profile: `${id}-profile`, tuning: { patience: 3 } },
    needs: {
      sleep: { ratePerMinute: 1, threshold: 80 },
      hunger: { ratePerMinute: 2, threshold: 50 },
    },
    ...overrides,
  } as unknown as Def;
  return Object.freeze({
    id,
    def,
    senses: Object.freeze({ sight: { range: 20 } }) as unknown as RuntimeCreature['senses'],
    nav: Object.freeze({ mask: 1, radius: 0.4, height: 0.9 }) as unknown as RuntimeCreature['nav'],
  });
}

const hound = creature('hound');
const guard = creature('guard', {
  attacks: [{ id: 'strike' }],
  faction: { id: 'goblins' },
  disposition: { towardPlayer: 'wary' },
});
/** Height below twice its radius: its hurtbox is a sphere-like capsule. */
const pup = creature('pup');
const tinyPup: RuntimeCreature = Object.freeze({
  ...pup,
  nav: Object.freeze({ ...pup.nav, radius: 0.3, height: 0.4 }),
});
const lost = creature('lost', { faction: { id: 'nobody' } });

const creatures: CreatureTable = new Map([
  [hound.id, hound],
  [guard.id, guard],
  [tinyPup.id, tinyPup],
  [lost.id, lost],
]);

const factions = buildFactionTable([
  {
    id: UNALIGNED_FACTION,
    towardPlayer: 'hostile',
    towardMembers: 'neutral',
    towardOthers: 'neutral',
    relations: [],
  },
  {
    id: 'goblins',
    towardPlayer: 'hostile',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
  {
    id: 'bandits',
    towardPlayer: 'hostile',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
]);

const options: CreatureSpawnOptions = { creatures, factions };

function world(seed = 7, extras: { attacks?: boolean; lockOn?: boolean } = {}) {
  const w = installFactions(registerCreatureComponents(new World<unknown>({ seed })));
  if (extras.attacks === true) w.register(...ATTACK_COMPONENTS);
  if (extras.lockOn === true) w.register(TargetableComponent);
  return w;
}

const origin = { x: 1, y: 0, z: 2 };

function spawned(w: World<never>, request: Parameters<typeof spawnCreature>[2]) {
  const result = spawnCreature(w, options, request);
  if (!result.ok) throw new Error(spawnErrorMessage(result.error));
  return result.entity;
}

describe('creature spawner (mw-e12.4)', () => {
  it('AC-1: the same creature spawned in two fresh worlds with the same seed hashes identically', () => {
    const hashes = [1, 2].map(() => {
      const w = world(42, { attacks: true, lockOn: true });
      spawned(w, { creature: 'guard', at: origin, facing: { x: 1, y: 0, z: 1 } });
      w.step();
      return hashWorld(w);
    });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('builds placement, facing, hurtbox, combatant, reactions, faction and creature state', () => {
    const w = world();
    const entity = spawned(w, { creature: 'hound', at: origin, facing: { x: 0, y: 5, z: -2 } });
    expect(w.get(entity, PlacementComponent)).toEqual({ ...origin, radius: 0.4 });
    expect(w.get(entity, CombatFacingComponent)?.facing).toEqual({ x: 0, y: 0, z: -1 });
    const hurtboxes = w.get(entity, HurtboxComponent);
    expect(hurtboxes?.facing).toEqual({ x: 0, y: 0, z: -1 });
    expect(hurtboxes?.boxes[0]?.shape).toEqual({
      kind: 'capsule',
      from: { x: 0, y: 0.4, z: 0 },
      to: { x: 0, y: 0.5, z: 0 },
      radius: 0.4,
    });
    expect(w.get(entity, HealthComponent)).toEqual({ max: 60, current: 60 });
    expect(w.get(entity, PoiseComponent)?.max).toBe(20);
    expect(w.get(entity, ResistancesComponent)?.multipliers).toEqual({ fire: 1.5 });
    expect(w.get(entity, HitReactionComponent)?.profile.mass).toBe(35);
    expect(w.get(entity, FactionMemberComponent)).toEqual({
      faction: UNALIGNED_FACTION,
      toward: {},
    });
    expect(w.get(entity, CreatureComponent)).toEqual({
      origin: { creature: 'hound', at: origin, facing: { x: 0, y: 0, z: -1 } },
      behaviour: 'hound-profile',
      tuning: { patience: 3 },
      needs: { hunger: 0, sleep: 0 },
    });
    expect(w.get(entity, CreatureSensesComponent)).toBe(hound.senses);
    expect(w.get(entity, CreatureNavComponent)).toBe(hound.nav);
    // Not an attacker (no attacks) nor lockable (no lock-on in this world).
    expect(w.isRegistered(AttackerComponent)).toBe(false);
    expect(isCreature(w, entity)).toBe(true);
  });

  it('faces +z without a facing or with one that has no horizontal part', () => {
    const w = world();
    const a = spawned(w, { creature: 'hound', at: origin });
    const b = spawned(w, { creature: 'hound', at: origin, facing: { x: 0, y: -1, z: 0 } });
    for (const entity of [a, b]) {
      expect(w.get(entity, CombatFacingComponent)?.facing).toEqual({ x: 0, y: 0, z: 1 });
    }
  });

  it('a creature with attacks is an idle attacker, and a lock-on target where the world has lock-on', () => {
    const w = world(7, { attacks: true, lockOn: true });
    const g = spawned(w, { creature: 'guard', at: origin });
    const h = spawned(w, { creature: 'hound', at: origin });
    expect(w.get(g, AttackerComponent)).toEqual({ current: null, readyAt: {} });
    expect(w.has(h, AttackerComponent)).toBe(false);
    expect(w.get(h, TargetableComponent)).toEqual({
      points: [
        { x: 0, y: 0.54, z: 0 },
        { x: 0, y: 0.81, z: 0 },
        { x: 0, y: 0.225, z: 0 },
      ],
      priority: 0,
    });
    expect(creatureLockProfile(1.8).points.map((p) => p.id)).toEqual(['chest', 'head', 'base']);
  });

  it('joins its definition faction with its disposition toward the player', () => {
    const w = world();
    const g = spawned(w, { creature: 'guard', at: origin });
    expect(w.get(g, FactionMemberComponent)).toEqual({
      faction: 'goblins',
      toward: { [PLAYER_FACTION]: 'wary' },
    });
  });

  it('AC-4: a faction override replaces the definition default', () => {
    const w = world();
    const g = spawned(w, { creature: 'guard', at: origin, faction: 'bandits' });
    expect(factionOf(w, g)).toBe('bandits');
    expect(w.get(g, CreatureComponent)?.origin.faction).toBe('bandits');
  });

  it('keeps the hurtbox a capsule from its radius up for a creature shorter than it is wide', () => {
    const w = world();
    const entity = spawned(w, { creature: 'pup', at: origin });
    const shape = w.get(entity, HurtboxComponent)?.boxes[0]?.shape;
    expect(shape).toMatchObject({ from: { y: 0.3 }, to: { y: 0.3 }, radius: 0.3 });
  });

  it('AC-2: an unknown creature id creates nothing and returns a typed SpawnError', () => {
    const w = world();
    const before = w.entityCount;
    const result = spawnCreature(w, options, { creature: 'wyvern', at: origin });
    expect(result).toEqual({ ok: false, error: { kind: 'unknown-creature', creature: 'wyvern' } });
    expect(w.entityCount).toBe(before);
    if (!result.ok) expect(spawnErrorMessage(result.error)).toBe('unknown creature "wyvern"');
  });

  it('an unknown faction (override or definition) creates nothing and returns a SpawnError', () => {
    const w = world();
    const before = w.entityCount;
    const override = spawnCreature(w, options, { creature: 'hound', at: origin, faction: 'elves' });
    const own = spawnCreature(w, options, { creature: 'lost', at: origin });
    expect(override).toEqual({
      ok: false,
      error: { kind: 'unknown-faction', creature: 'hound', faction: 'elves' },
    });
    expect(own).toMatchObject({ ok: false, error: { faction: 'nobody' } });
    expect(w.entityCount).toBe(before);
    if (!override.ok) {
      expect(spawnErrorMessage(override.error)).toBe('creature "hound": unknown faction "elves"');
    }
  });

  it('despawns one creature, or all of them, and leaves other entities alone', () => {
    const w = world();
    const a = spawned(w, { creature: 'hound', at: origin });
    const b = spawned(w, { creature: 'hound', at: origin });
    const c = spawned(w, { creature: 'guard', at: origin });
    const rock = w.spawn();
    expect(despawnCreature(w, a)).toBe(true);
    expect(despawnCreature(w, a)).toBe(false); // gone
    expect(despawnCreature(w, rock)).toBe(false); // not a creature
    expect(creatureEntities(w)).toEqual([b, c]);
    expect(despawnAllCreatures(w)).toBe(2);
    expect(creatureEntities(w)).toEqual([]);
    expect(w.isAlive(rock)).toBe(true);
  });

  it('respawns a creature fresh from its origin under a new id', () => {
    const w = world();
    const patrol = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ];
    const g = spawned(w, {
      creature: 'guard',
      at: origin,
      facing: { x: 1, y: 0, z: 0 },
      point: 'gate',
      faction: 'bandits',
      patrol,
    });
    w.set(g, HealthComponent, { max: 100, current: 10 });
    const again = respawnCreature(w, options, g);
    if (!again.ok) throw new Error('respawn failed');
    expect(again.entity).not.toBe(g);
    expect(w.isAlive(g)).toBe(false);
    expect(w.get(again.entity, HealthComponent)?.current).toBe(60);
    expect(w.get(again.entity, CreatureComponent)?.origin).toEqual({
      creature: 'guard',
      at: origin,
      facing: { x: 1, y: 0, z: 0 },
      point: 'gate',
      faction: 'bandits',
      patrol,
    });
    const rock = w.spawn();
    const refused = respawnCreature(w, options, rock);
    expect(refused).toEqual({ ok: false, error: { kind: 'not-a-creature', entity: rock } });
    if (!refused.ok) {
      expect(spawnErrorMessage(refused.error)).toBe(`entity ${String(rock)} is not a creature`);
    }
  });

  it('without creatures installed nothing is a creature and there is nothing to despawn', () => {
    const w = new World<never>({ seed: 1 });
    const rock = w.spawn();
    expect(creaturesInstalled(w)).toBe(false);
    expect(isCreature(w, rock)).toBe(false);
    expect(creatureEntities(w)).toEqual([]);
    expect(despawnAllCreatures(w)).toBe(0);
    // Registering twice is harmless.
    registerCreatureComponents(registerCreatureComponents(w));
    expect(creaturesInstalled(w)).toBe(true);
  });

  it('AC-4: scene spawns place their creature facing the yaw, with faction override and patrol', () => {
    const w = world();
    const spawn = (over: Partial<SceneSpawnPlacement>): SceneSpawnPlacement => ({
      id: 'marker',
      position: origin,
      yaw: 0,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      prop: undefined,
      tags: [],
      ...over,
    });
    const route = [{ x: 3, y: 0, z: 3 }];
    const result = spawnSceneCreatures(w, options, [
      spawn({ id: 'start' }), // no creature: a marker
      spawn({ id: 'den', creature: 'hound', yaw: 90 }),
      spawn({ id: 'gate', creature: 'guard', yaw: 180, faction: 'bandits', patrol: route }),
      spawn({ id: 'nest', creature: 'wyvern' }),
    ]);
    expect(result.errors).toEqual([
      { point: 'nest', error: { kind: 'unknown-creature', creature: 'wyvern' } },
    ]);
    const [den, gate] = result.entities;
    if (den === undefined || gate === undefined) throw new Error('missing creatures');
    expect(w.get(den, CreatureComponent)?.origin).toEqual({
      creature: 'hound',
      at: origin,
      facing: { x: 1, y: 0, z: 0 },
      point: 'den',
    });
    expect(factionOf(w, gate)).toBe('bandits');
    expect(w.get(gate, CreatureComponent)?.origin).toMatchObject({
      facing: { x: 0, y: 0, z: -1 },
      patrol: route,
    });
    expect(facingFromYaw(270)).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('the debug console spawns creatures by id, facing the player, and `despawn all` removes them', () => {
    const w = world(3, { attacks: true });
    installDebugCommands(w, { spawners: creatureSpawners(options) });
    const player = w.spawn();
    giveCombatant(w, player, { health: 100, player: true });
    placeEntity(w, player, { x: 0, y: 0, z: -5 });
    w.step([spawnCommand('hound', 3, { x: 0, y: 0, z: 0 })]);
    const hounds = creatureEntities(w);
    expect(hounds).toHaveLength(3);
    expect(hounds.map((id) => w.get(id, PlacementComponent)?.x)).toEqual([0, 1, 2]);
    expect(w.get(hounds[0] ?? 0, CombatFacingComponent)?.facing).toEqual({ x: 0, y: 0, z: -1 });
    // Standing on the player: no direction to face, so +z.
    w.step([spawnCommand('guard', 1, { x: 0, y: 0, z: -5 })]);
    expect(creatureEntities(w)).toHaveLength(4);
    // A creature whose faction the table lacks is skipped, not thrown.
    w.step([spawnCommand('lost', 1, origin)]);
    expect(creatureEntities(w)).toHaveLength(4);
    w.step([despawnCreaturesCommand()]);
    expect(creatureEntities(w)).toEqual([]);
    expect(w.isAlive(player)).toBe(true);
  });

  it('console spawners refuse (skip) when the world has no creatures installed', () => {
    const w = new World<unknown>({ seed: 1 });
    installDebugCommands(w, { spawners: creatureSpawners(options) });
    const before = w.entityCount;
    w.step([spawnCommand('hound', 1, origin), despawnCreaturesCommand()]);
    expect(w.entityCount).toBe(before);
  });
});
