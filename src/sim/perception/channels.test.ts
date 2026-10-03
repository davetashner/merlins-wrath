// The special-sense channel registry and the presence handler (mw-e11.5).
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../stimulus/shapes';
import {
  defaultSenseChannels,
  presenceSense,
  SenseChannelRegistry,
  type SenseTarget,
  type SpecialSense,
  type SpecialSenseContext,
} from './channels';
import { entitySource } from './percept';
import { DEFAULT_PERCEPTION_TUNING as TUNING } from './tuning';

const EYE: Vec3 = { x: 0, y: 1.6, z: 0 };

const target = (entity: number, x: number, speed = 0): SenseTarget => ({
  source: entitySource(entity),
  feet: { x, y: 0, z: 0 },
  centre: { x, y: 1.6, z: 0 },
  speed,
});

const LIFE: SpecialSense = {
  range: 10,
  minStrength: 0.2,
  requiresLineOfSight: false,
  requiresMovement: false,
};

function context(sense: SpecialSense, targets: readonly SenseTarget[], los = 1) {
  const rays: Vec3[] = [];
  const ctx: SpecialSenseContext = {
    channel: 'life-sense',
    sense,
    eye: EYE,
    targets,
    lineOfSight: (_, to) => {
      rays.push(to);
      return los;
    },
    tuning: TUNING,
  };
  return { ctx, rays };
}

describe('special senses (mw-e11.5)', () => {
  it('registers one handler per channel and refuses a second', () => {
    const registry = defaultSenseChannels();
    expect(registry.channels).toEqual(['life-sense', 'tremor']);
    expect(registry.handler('magic-sense')).toBeUndefined();
    expect(() => registry.register('tremor', () => [])).toThrow(
      'special sense channel "tremor" already has a handler',
    );
    const custom = new SenseChannelRegistry().register('magic-sense', () => []);
    expect(custom.channels).toEqual(['magic-sense']);
    expect(custom.handler('magic-sense')?.(context(LIFE, []).ctx)).toEqual([]);
  });

  it('senses living targets within range through walls, fainter with distance', () => {
    const { ctx, rays } = context(LIFE, [target(1, 2), target(2, 9), target(3, 12)], 0);
    expect(presenceSense()(ctx)).toEqual([
      {
        source: 'entity:1',
        kind: 'sensed-life',
        sense: 'life-sense',
        position: { x: 2, y: 0, z: 0 },
        strength: 0.8,
        certainty: 0.8,
      },
    ]); // 9 m is 0.1, under minStrength; 12 m is out of range
    expect(rays).toEqual([]); // walls do not block it, so no sight lines are traced
  });

  it('needs a clear sight line or movement when the profile says so', () => {
    const seeing: SpecialSense = { ...LIFE, requiresLineOfSight: true };
    const blocked = context(seeing, [target(1, 2)], 0);
    expect(presenceSense()(blocked.ctx)).toEqual([]);
    expect(blocked.rays).toEqual([{ x: 2, y: 1.6, z: 0 }]);
    const half = context(seeing, [target(1, 2)], 0.5);
    expect(presenceSense()(half.ctx)[0]?.strength).toBeCloseTo(0.4, 9);

    const tremor: SpecialSense = { ...LIFE, requiresMovement: true };
    const moving = context(tremor, [target(1, 2, 0.1), target(2, 3, 1.5)]);
    expect(presenceSense('seen-anomaly')(moving.ctx).map((p) => [p.source, p.kind])).toEqual([
      ['entity:2', 'seen-anomaly'],
    ]);
  });

  it('a sense of zero range feels only what is at the eye', () => {
    const touch: SpecialSense = { ...LIFE, range: 0, minStrength: 0 };
    const here: SenseTarget = { ...target(1, 0), centre: EYE };
    expect(presenceSense()(context(touch, [here, target(2, 1)]).ctx)).toMatchObject([
      { source: 'entity:1', strength: 1 },
    ]);
  });
});
