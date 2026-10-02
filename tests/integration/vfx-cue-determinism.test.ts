// mw-e29.3 AC-3: VFX never feed back into the sim. A 60 s combat run (the frozen fixture-guard
// striking an iron-clad player over and over) is played twice from the same seed: once bare, once
// with the VFX cue bridge attached to the world's event bus, resolving the real VFX cue sheets
// (content) and spawning through a real VfxSystem that follows the sim's entities and is stepped
// every tick. The state hash must match on every tick. Cross-layer, so it lives outside src/.

import { describe, expect, it } from 'vitest';
import { compileAttacks, compileMoves, loadGameContent, materialPresets } from '@content/index';
import { markExercised } from '@content/testing';
import { loadFixtureContent } from '@content/test-fixtures';
import { VfxCueBridge, worldCueLookups } from '@game/cues/index';
import { VfxSystem } from '@game/vfx/index';
import {
  addMaterialProperties,
  ATTACK_COMPONENTS,
  canStartAttack,
  combatantFromCreature,
  DAMAGE_COMPONENTS,
  DamageModel,
  giveAttacker,
  giveCombatant,
  hashWorld,
  installAttacks,
  PlacementComponent,
  placeEntity,
  placementOf,
  registerWorldProperties,
  startAttack,
  World,
  type EntityId,
} from '@sim/index';

const fixtures = loadFixtureContent();
const game = loadGameContent();
const attacks = compileAttacks(fixtures.all('attack'), compileMoves(fixtures.all('move')));
const guardDef = fixtures.get('creature', 'fixture-guard');
const presets = materialPresets(game.all('material'));

const HZ = 60;
const TICKS = 60 * HZ; // 60 s

function run(withVfx: boolean) {
  const world = registerWorldProperties(
    new World<never>({ seed: 29, hz: HZ }).register(
      ...DAMAGE_COMPONENTS,
      ...ATTACK_COMPONENTS,
      PlacementComponent,
    ),
  );
  installAttacks(world, { attacks, damage: new DamageModel() });
  const [ref] = guardDef.attacks;
  const attack = attacks.get(ref?.id ?? '');
  if (attack === undefined) throw new Error('fixture-guard has no attack');

  const guard = world.spawn();
  giveCombatant(world, guard, combatantFromCreature(guardDef));
  giveAttacker(world, guard);
  placeEntity(world, guard, { x: 0, y: 0, z: 0 }, 0.35);
  addMaterialProperties(world, guard, presets, { material: 'iron' });
  const player = world.spawn();
  giveCombatant(world, player, { health: 1000, poise: 30, player: true });
  placeEntity(world, player, { x: 0, y: 1.2, z: 1.2 }, 0.4);
  addMaterialProperties(world, player, presets, { material: 'iron' });
  world.addSystem({
    name: 'guard-ai',
    run: ({ world: w }) => {
      if (canStartAttack(w, guard, attack, { distance: 1.2 }).ok) {
        startAttack(w, guard, attack, { x: 0, y: 0, z: 1 });
      }
    },
  });

  const spawned: string[] = [];
  let vfx: VfxSystem | undefined;
  if (withVfx) {
    // The runtime reads entity positions from the sim (read-only), as it does in the game.
    const locate = (entity: EntityId) => {
      const position = world.isAlive(entity) ? placementOf(world, entity) : undefined;
      return position && { position };
    };
    const system = new VfxSystem({ effects: game.all('vfx-effect'), anchors: locate, dev: false });
    vfx = system;
    const bridge = new VfxCueBridge({
      sheets: game.all('vfx-cue-sheet'),
      vfx: {
        spawn: (effect, options) => {
          spawned.push(effect);
          return system.spawn(effect, options);
        },
        stop: (handle) => {
          system.stop(handle);
        },
        alive: (handle) => system.alive(handle),
        has: (effect) => system.has(effect),
      },
      now: () => (world.tick * 1000) / HZ,
      locate,
      lookups: worldCueLookups(world, game.all('material')),
      dev: false,
    });
    bridge.attach(world.events);
  }

  const hashes: string[] = [];
  let particles = 0;
  for (let tick = 0; tick < TICKS; tick++) {
    world.step();
    vfx?.update(1 / HZ, { x: 0, y: 1.6, z: 4 });
    particles = Math.max(particles, vfx?.stats().particles ?? 0);
    hashes.push(hashWorld(world));
  }
  return { hashes, spawned, particles };
}

describe('VFX cue sheets never influence the sim', () => {
  it(
    'AC-3: a 60 s combat replay with VFX on and off has identical sim state hashes every tick',
    { timeout: 60_000 },
    ({ task }) => {
      markExercised(task, 'vfx-cue-sheet', 'combat');
      markExercised(task, 'vfx-effect', 'vfx-impact-sparks');
      const off = run(false);
      const on = run(true);
      // VFX really ran: iron on iron throws sparks, and particles flew.
      expect(on.spawned).toContain('vfx-impact-sparks');
      expect(on.particles).toBeGreaterThan(0);
      expect(off.hashes).toHaveLength(TICKS);
      const firstDiff = off.hashes.findIndex((hash, i) => hash !== on.hashes[i]);
      expect(firstDiff).toBe(-1);
    },
  );
});
