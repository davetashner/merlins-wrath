// Sharing targets in a fight (mw-e11.13): a share reaches allies near the sharer that are already
// fighting or hunting, as a second-hand report — and nobody else.
import type { BehaviourDef, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { compileBehaviours } from '../ai/behaviour';
import { AiTargetShared, BrainComponent } from '../ai/components';
import { recallTarget } from '../ai/awareness';
import { brainOf, giveBrain, installAi } from '../ai/runtime';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { installFactions, joinFaction } from '../factions/runtime';
import { buildFactionTable } from '../factions/table';
import { entitySource } from '../perception/percept';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { DEFAULT_SHARE_RADIUS_M, installTargetSharing, SHARE_STATES } from './target-sharing';

const idle = {
  id: 'idle',
  schemaVersion: 1,
  tuning: {},
  thinkHz: 10,
  inertia: 0.1,
  initial: 'unaware',
  states: {
    unaware: {
      transitions: [],
      timeoutFrom: 'entered',
      postAlert: false,
      activities: ['stand'],
    },
  },
  activities: {
    stand: {
      weight: 1,
      interruptible: true,
      retryAfterS: 2,
      considerations: [],
      steps: [{ do: 'wait', seconds: 100 }],
    },
  },
} as unknown as Frozen<BehaviourDef>;

const factions = buildFactionTable([
  {
    id: 'watch',
    towardPlayer: 'hostile',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [{ faction: 'bandits', stance: 'hostile', mutual: true }],
  },
  {
    id: 'bandits',
    towardPlayer: 'hostile',
    towardMembers: 'ally',
    towardOthers: 'neutral',
    relations: [],
  },
]);

function setup(radius?: number) {
  const world = new World<never>({ seed: 1 });
  world.register(PlacementComponent);
  installFactions(world);
  installAi(world, { behaviours: compileBehaviours([idle]) });
  const off = installTargetSharing(world, { factions, ...(radius !== undefined && { radius }) });
  const creature = (at: Vec3, faction: string | null, state: string): EntityId => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.35);
    if (faction !== null) joinFaction(world, factions, entity, faction);
    giveBrain(world, entity, { behaviour: 'idle' });
    const brain = world.get(entity, BrainComponent);
    if (brain === undefined) throw new Error('no brain');
    brain.state = state as typeof brain.state;
    return entity;
  };
  return { world, creature, off };
}

const thief = entitySource(999);
const share = (world: World<never>, entity: EntityId, position: Vec3, confidence = 1) => {
  world.events.emit(AiTargetShared, {
    tick: world.tick,
    entity,
    source: thief,
    position,
    confidence,
  });
  world.events.flush();
};

describe('sharing targets (mw-e11.13)', () => {
  it('reaches allies within the radius that are fighting, alerted or searching, as a second-hand report', () => {
    const { world, creature } = setup();
    const sharer = creature({ x: 0, y: 0, z: 0 }, 'watch', 'combat');
    const partner = creature({ x: 3, y: 0, z: 0 }, 'watch', 'combat');
    const hunter = creature({ x: 0, y: 0, z: 10 }, 'watch', 'alerted');
    const searcher = creature({ x: -10, y: 0, z: 0 }, 'watch', 'searching');
    const calm = creature({ x: 2, y: 0, z: 0 }, 'watch', 'unaware');
    const distant = creature({ x: 20, y: 0, z: 0 }, 'watch', 'combat');
    const bandit = creature({ x: 1, y: 0, z: 1 }, 'bandits', 'combat');
    const loner = creature({ x: 1, y: 0, z: -1 }, null, 'combat');
    share(world, sharer, { x: 5, y: 0, z: 5 }, 0.8);
    for (const ally of [partner, hunter, searcher]) {
      expect(recallTarget(world, ally)).toMatchObject({
        source: thief,
        origin: 'second-hand',
        lkp: { x: 5, y: 0, z: 5 },
      });
      expect(recallTarget(world, ally)?.confidence).toBeCloseTo(0.8 * 0.7);
      expect(brainOf(world, ally)?.blackboard.lkp).toEqual({ x: 5, y: 0, z: 5 });
    }
    // Not the calm ally (raising the alarm is mw-e11.12's), one out of earshot, a hostile faction's
    // creature, a creature of no faction, or the sharer itself.
    for (const other of [calm, distant, bandit, loner, sharer]) {
      expect(brainOf(world, other)?.memory).toEqual([]);
    }
    expect(SHARE_STATES).toEqual(['combat', 'alerted', 'searching']);
    expect(DEFAULT_SHARE_RADIUS_M).toBe(15);
  });

  it('honours its radius, ignores a sharer without a placement, and uninstalls', () => {
    const { world, creature, off } = setup(2);
    const sharer = creature({ x: 0, y: 0, z: 0 }, 'watch', 'combat');
    const near = creature({ x: 0, y: 1.5, z: 0 }, 'watch', 'combat');
    const far = creature({ x: 0, y: 0, z: 2.5 }, 'watch', 'combat');
    share(world, sharer, { x: 1, y: 0, z: 1 });
    expect(recallTarget(world, near)).toBeDefined();
    expect(recallTarget(world, far)).toBeUndefined();
    const ghost = world.spawn();
    share(world, ghost, { x: 1, y: 0, z: 1 });
    expect(recallTarget(world, far)).toBeUndefined();
    off();
    world.set(far, PlacementComponent, { x: 0, y: 0, z: 1, radius: 0.35 });
    share(world, sharer, { x: 1, y: 0, z: 1 });
    expect(recallTarget(world, far)).toBeUndefined();
  });
});
