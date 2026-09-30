// mw-e28.16 AC-1 (carried over from mw-e28.4 AC-2): a parry must ring out above everything. The
// combat sandbox through the game's own wiring (createGameWorld: Rapier, the scene, the sandbox rules,
// the knight, startTestbedCombat with parry and riposte) parries the attacker dummy's swing while the
// audio engine is saturated with 48 voices. The real combat cue sheet resolves the parry through the
// audio cue bridge into a real AudioEngine on a fake AudioContext with the game's sound manifest: the
// parry's cue plays (it is never the voice stolen or refused) and exactly one lower-priority voice is
// dropped to make room. Cross-layer, so it lives outside src/.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@audio/fake-context';
import { AudioEngine, gameSoundRegistry } from '@audio/index';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { AudioCueBridge, soundVariantCount, worldCueLookups } from '@game/cues/index';
import { ActionSampler } from '@game/input/index';
import { HitParried, teleportCommand, type ParryInfo } from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The priority the combat sheet gives the parry. */
const PARRY_PRIORITY = 100;

describe('parry audio (mw-e28.16)', () => {
  it('AC-1: a successful parry during a 48-voice saturation plays its cue (not stolen) and drops a lower-priority voice', async ({
    task,
  }) => {
    markExercised(task, 'cue-sheet', 'combat');
    const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'combat-sandbox' });
    const { world } = game;
    const registry = gameSoundRegistry();
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({
      registry,
      createContext: () => ctx,
      fetchBytes: () => Promise.resolve(new ArrayBuffer(1)),
      resolveUrl: (id, ext) => `/a/${id}.${ext}`,
      format: 'ogg',
      now: () => (world.tick * 1000) / 60,
      warn: () => undefined,
    });
    const played: { cue: string; priority: number | undefined }[] = [];
    const bridge = new AudioCueBridge({
      sheets: [content.get('cue-sheet', 'combat')],
      player: {
        play: (cue, options) => {
          played.push({ cue, priority: options.priority });
          return engine.play(cue, options);
        },
      },
      now: () => (world.tick * 1000) / 60,
      lookups: worldCueLookups(world, content.all('material'), { moves: content.all('move') }),
      variantCount: soundVariantCount(registry),
    });
    bridge.attach(world.events);
    const parries: ParryInfo[] = [];
    world.events.on(HitParried, (e) => parries.push(e));

    // 48 voices of ambience-level combat noise (priority 60), 5–30 m away.
    for (let i = 0; i < 48; i++) {
      engine.play('sfx-blade-impact', { position: { x: 5 + (i % 26), y: 0, z: 0 }, priority: 60 });
    }
    await settle();
    expect(engine.stats().voices).toBe(48);
    const background = [...ctx.sources];
    expect(ctx.playing).toHaveLength(48);

    // The knight a step in front of the attacker dummy (at (2, 0, 1)); its swing lands on tick 18.
    const sampler = new ActionSampler();
    const step = () => {
      world.step([sampler.sample()]);
    };
    step();
    world.step([teleportCommand(game.player, { x: 2, y: 0, z: 0 })]);
    while (world.tick < 12) step();
    sampler.down('Digit3'); // parry: window 16–25
    step();
    sampler.up('Digit3');
    while (world.tick < 19) step();
    await settle();

    expect(parries.map((p) => [p.tick, p.entity])).toEqual([[18, game.player]]);
    // The ring plays once (the deflected hit's own impact is the same cue on the parrier: de-duped).
    const rings = played.filter((p) => p.cue === 'sfx-knight-parry-metal');
    expect(rings).toEqual([{ cue: 'sfx-knight-parry-metal', priority: PARRY_PRIORITY }]);
    const ring = ctx.sources.find((s) => !background.includes(s) && s.stoppedAt === undefined);
    expect(ring?.startedAt).toBeDefined();
    expect(engine.stats().voices).toBe(48);
    // Exactly one of the 48 lower-priority voices was dropped to make room; the rest still play.
    expect(background.filter((s) => s.stoppedAt !== undefined)).toHaveLength(1);
    expect(ctx.playing).toHaveLength(48);
  });
});
