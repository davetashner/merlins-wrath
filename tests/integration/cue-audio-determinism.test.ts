// mw-e28.3 AC-3: audio never feeds back into the sim. A 60 s combat run (the frozen fixture-guard
// striking a player over and over, both with materials) is played twice from the same seed: once
// bare, once with the audio cue bridge attached to the world's event bus, resolving the real combat
// cue sheet (content) and playing through a real AudioEngine on a fake AudioContext that follows the
// sim's entities. The state hash must match on every tick. Cross-layer, so it lives outside src/.

import { describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@audio/fake-context';
import { AudioEngine, SoundRegistry } from '@audio/index';
import { compileAttacks, compileMoves, loadGameContent, materialPresets } from '@content/index';
import { markExercised } from '@content/testing';
import { loadFixtureContent } from '@content/test-fixtures';
import { AudioCueBridge, soundVariantCount, worldCueLookups } from '@game/cues/index';
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
} from '@sim/index';

const fixtures = loadFixtureContent();
const game = loadGameContent();
const attacks = compileAttacks(fixtures.all('attack'), compileMoves(fixtures.all('move')));
const guardDef = fixtures.get('creature', 'fixture-guard');
const presets = materialPresets(game.all('material'));
const combatSheet = game.get('cue-sheet', 'combat');

const HZ = 60;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const TICKS = 60 * HZ; // 60 s

/** Every cue the combat sheet can play in this fight, so the engine starts real voices. */
const SOUNDS = [
  'sfx-blade-impact-flesh',
  'sfx-blunt-impact-flesh',
  'sfx-combat-critical',
  'sfx-combat-stagger',
  'sfx-combat-death-flesh',
  'sfx-telegraph-fixture-guard-strike-windup',
].map((id) => ({
  id,
  variants: [`${id}-01`, `${id}-02`, `${id}-03`, `${id}-04`] as [string, ...string[]],
  bus: 'combat' as const,
  spatial: true,
}));

async function run(audio: boolean) {
  const world = registerWorldProperties(
    new World<never>({ seed: 28, hz: HZ }).register(
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
  addMaterialProperties(world, player, presets, { material: 'flesh' });
  world.addSystem({
    name: 'guard-ai',
    run: ({ world: w }) => {
      if (canStartAttack(w, guard, attack, { distance: 1.2 }).ok) {
        startAttack(w, guard, attack, { x: 0, y: 0, z: 1 });
      }
    },
  });

  let engine: AudioEngine | undefined;
  let ctx: FakeAudioContext | undefined;
  const played: string[] = [];
  if (audio) {
    const registry = new SoundRegistry().register(SOUNDS);
    ctx = new FakeAudioContext();
    const context = ctx;
    engine = new AudioEngine({
      registry,
      createContext: () => context,
      fetchBytes: () => Promise.resolve(new ArrayBuffer(1)),
      resolveUrl: (id, ext) => `/a/${id}.${ext}`,
      format: 'ogg',
      now: () => (world.tick * 1000) / HZ,
      warn: () => undefined,
      // The engine reads entity positions from the sim (read-only), as it does in the game.
      entityPosition: (entity) => placementOf(world, entity),
    });
    const sink = engine;
    const bridge = new AudioCueBridge({
      sheets: [combatSheet],
      player: {
        play: (cue, options) => {
          played.push(cue);
          return sink.play(cue, options);
        },
      },
      now: () => (world.tick * 1000) / HZ,
      lookups: worldCueLookups(world, game.all('material')),
      variantCount: soundVariantCount(registry),
    });
    bridge.attach(world.events);
    await engine.unlock();
  }

  const hashes: string[] = [];
  for (let tick = 0; tick < TICKS; tick++) {
    world.step();
    engine?.update();
    hashes.push(hashWorld(world));
    // Once a second let asset loads resolve so queued cues start voices (both runs do the same).
    if (tick % HZ === 0) await settle();
  }
  return { hashes, played, engine, ctx };
}

describe('cue sheets never influence the sim', () => {
  it(
    'AC-3: a 60 s combat run with audio enabled and disabled has identical state hashes every tick',
    { timeout: 60_000 },
    async ({ task }) => {
      markExercised(task, 'cue-sheet', 'combat');
      const silent = await run(false);
      const loud = await run(true);
      // Audio really ran: the combat sheet resolved hits, staggers and telegraphs into cues.
      // Each hit is two packets: the 18 slash (blade × flesh), then the 4 blunt knock.
      expect(loud.played).toContain('sfx-blade-impact-flesh');
      expect(loud.played).toContain('sfx-blunt-impact-flesh');
      expect(loud.played).toContain('sfx-combat-stagger');
      expect(loud.played).toContain('sfx-telegraph-fixture-guard-strike-windup');
      expect(loud.ctx?.sources.length).toBeGreaterThan(0);
      expect(silent.hashes).toHaveLength(TICKS);
      const firstDiff = silent.hashes.findIndex((hash, i) => hash !== loud.hashes[i]);
      expect(firstDiff).toBe(-1);
    },
  );
});
