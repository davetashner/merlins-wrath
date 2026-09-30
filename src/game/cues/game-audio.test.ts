import { describe, expect, it, vi } from 'vitest';
import { cueRuleSchema } from '@content/index';
import { addProperties, Died, registerWorldProperties, World, type EntityId } from '@sim/index';
import { attachGameAudio, soundPositions, type GameAudioEngine } from './game-audio.ts';

function setup() {
  const world = registerWorldProperties(new World({ seed: 1 }));
  let state = 'suspended';
  const play = vi.fn<(cue: string, options: unknown) => null>(() => null);
  const engine: GameAudioEngine = {
    get context() {
      return state === 'none' ? undefined : { state };
    },
    play,
  };
  const onPlay = vi.fn();
  const detach = attachGameAudio({
    world,
    engine,
    registry: {
      get: (id) => (id === 'sfx-combat-death-bone' ? { variants: ['a', 'b'] } : undefined),
    },
    sheets: [{ rules: [cueRuleSchema.parse({ event: 'Died', cue: 'sfx-combat-death-{target}' })] }],
    materials: [
      { id: 'bone', impactSound: 'sfx-impact-bone' },
      { id: 'generic', impactSound: 'sfx-impact-stone' },
    ],
    now: () => 0,
    onPlay,
  });
  const skeleton = world.spawn();
  addProperties(world, skeleton, { material: 'bone' });
  const die = (target: EntityId) => {
    world.events.emit(Died, { tick: world.tick, target, killer: null, source: null, tags: [] });
    world.step();
  };
  return {
    world,
    skeleton,
    play,
    onPlay,
    detach,
    die,
    setState: (s: string) => {
      state = s;
    },
  };
}

describe('game audio wiring (mw-e28.2)', () => {
  it('plays nothing before the first gesture lets the context run (autoplay policy)', () => {
    const { skeleton, play, onPlay, die, setState } = setup();
    die(skeleton);
    setState('none');
    die(skeleton);
    expect(play).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('once running, sim events play their cue sheet sounds through the engine, by material', () => {
    const { world, skeleton, play, onPlay, detach, die, setState } = setup();
    setState('running');
    die(skeleton);
    expect(play).toHaveBeenCalledOnce();
    expect(play.mock.calls[0]?.[0]).toBe('sfx-combat-death-bone');
    const options = play.mock.calls[0]?.[1] as { entity: number; variant: number };
    expect(options.entity).toBe(skeleton);
    expect([0, 1]).toContain(options.variant);
    expect(onPlay).toHaveBeenCalledWith('sfx-combat-death-bone', options);
    const plain = world.spawn();
    die(plain);
    expect(play.mock.calls[1]?.[0]).toBe('sfx-combat-death-stone');
    detach();
    die(world.spawn());
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('works without an onPlay probe', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const play = vi.fn(() => null);
    attachGameAudio({
      world,
      engine: { context: { state: 'running' }, play },
      registry: { get: () => undefined },
      sheets: [{ rules: [cueRuleSchema.parse({ event: 'Died', cue: 'sfx-death' })] }],
      materials: [],
      now: () => 0,
    });
    world.events.emit(Died, {
      tick: 0,
      target: world.spawn(),
      killer: null,
      source: null,
      tags: [],
    });
    world.step();
    expect(play).toHaveBeenCalledWith('sfx-death', expect.any(Object));
  });

  it('soundPositions asks each transform reader in turn', () => {
    const world = new World({ seed: 1 });
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    const position = soundPositions(world, [
      (_, entity) => (entity === 1 ? { position: { x: 1, y: 0, z: 0 }, rotation } : undefined),
      (_, entity) => (entity === 2 ? { position: { x: 2, y: 0, z: 0 }, rotation } : undefined),
    ]);
    expect(position(1)).toEqual({ x: 1, y: 0, z: 0 });
    expect(position(2)).toEqual({ x: 2, y: 0, z: 0 });
    expect(position(3)).toBeUndefined();
  });
});
