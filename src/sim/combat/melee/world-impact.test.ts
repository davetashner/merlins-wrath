// A swing's world impact (mw-e03.11): the move's hitbox, at the middle of the swing, strikes the world
// through the stimulus API with one stimulus per kind of hit the move lists.
import type { RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import { World } from '../../core/world';
import { IDENTITY_POSE } from '../../geom';
import { registerWorldProperties } from '../../properties/components';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import { installStimuli, pendingStimuli } from '../../stimulus/stimulus';
import type { SocketTrack } from '../hits/components';
import { strikeWorld } from './strikes';

const FORWARD = { x: 0, y: 0, z: 1 };
const TRACK: SocketTrack = {
  id: 'still',
  keys: [
    IDENTITY_POSE,
    { position: { x: 0, y: 0, z: 0.5 }, rotation: IDENTITY_POSE.rotation },
    { position: { x: 0, y: 0, z: 1 }, rotation: IDENTITY_POSE.rotation },
  ],
};

/** The fields `strikeWorld` reads of a move (a test stand-in for a compiled move). */
const move = (fields: Partial<RuntimeMove>): RuntimeMove =>
  ({
    id: 'smash',
    active: 4,
    hitbox: {
      shape: { kind: 'capsule', from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: 1, z: 1 }, radius: 0.1 },
    },
    ...fields,
  }) as unknown as RuntimeMove;

function setup() {
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1 })));
  const knight = world.spawn();
  placeEntity(world, knight, { x: 2, y: 0, z: 0 });
  return { world, knight };
}

describe('melee world impact (mw-e03.11)', () => {
  it('queues one stimulus per kind of hit, from the hitbox at mid-swing, attributed to the attacker', () => {
    const { world, knight } = setup();
    const smash = move({ worldImpact: { blunt: 150, slash: 0, force: 20 } });
    expect(strikeWorld(world, knight, smash, TRACK, FORWARD)).toBe(2);
    const queued = pendingStimuli(world).map((p) => p.stimulus);
    expect(queued).toEqual([
      {
        shape: {
          kind: 'capsule',
          from: { x: 2, y: 1, z: 1 },
          to: { x: 2, y: 1, z: 2 },
          radius: 0.1,
        },
        element: 'blunt',
        intensity: 150,
        duration: 0,
        source: knight,
        falloff: 'none',
      },
      expect.objectContaining({ element: 'force', intensity: 20, direction: FORWARD }),
    ]);
  });

  it('a box hitbox strikes as its bounding sphere; the last key stands in for a short track', () => {
    const { world, knight } = setup();
    const shove = move({
      active: 9,
      worldImpact: { pierce: 5 },
      hitbox: {
        shape: { kind: 'box', center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.3, y: 0.4, z: 0 } },
      } as RuntimeMove['hitbox'],
    });
    expect(strikeWorld(world, knight, shove, TRACK, FORWARD)).toBe(1);
    expect(pendingStimuli(world)[0]?.stimulus.shape).toEqual({
      kind: 'sphere',
      center: { x: 2, y: 1, z: 1 },
      radius: 0.5,
    });
  });

  it('does nothing without a world impact, a hitbox, a placed attacker or stimuli', () => {
    const { world, knight } = setup();
    expect(strikeWorld(world, knight, move({}), TRACK, FORWARD)).toBe(0);
    const impact = { worldImpact: { blunt: 10 } };
    expect(strikeWorld(world, knight, move({ ...impact, hitbox: null }), TRACK, FORWARD)).toBe(0);
    expect(strikeWorld(world, world.spawn(), move(impact), TRACK, FORWARD)).toBe(0);
    const bare = new World<never>({ seed: 1 }).register(PlacementComponent);
    const loner = bare.spawn();
    placeEntity(bare, loner, { x: 0, y: 0, z: 0 });
    expect(strikeWorld(bare, loner, move(impact), TRACK, FORWARD)).toBe(0);
    expect(pendingStimuli(world)).toEqual([]);
  });
});
