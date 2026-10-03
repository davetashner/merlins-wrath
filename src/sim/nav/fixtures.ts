// A small grey-box level for navigation tests (mw-e11.4), built straight from boxes and a wedge so
// sim tests need no content. Two rooms on one floor, walled in, joined only by a doorway with a
// door ("gate") in the dividing wall at x = 7:
//
//   room A (x 0–7): a 1.5 m platform in the north-west corner, climbable (grade 1, like ivy), with
//                   a ramp up to it along the north wall from the east;
//   room B (x 7–14): a 5 m pillar no agent can get on top of.
//
// Agents: a walker (walk only), a door opener (walks, opens doors) and a climber (also climbs
// grade 1).

import type { Vec3 } from '../stimulus/shapes';
import { bakeNavMesh, type NavBakeInput, type NavBakeSolid } from './bake';
import { DEFAULT_NAV_AGENT, NAV_AGENT_BITS, type NavAgentSpec } from './capabilities';
import { NavMesh } from './mesh';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const block = (min: Vec3, max: Vec3, climbGrade?: number): NavBakeSolid =>
  climbGrade === undefined
    ? { shape: { kind: 'box', min, max } }
    : { shape: { kind: 'box', min, max }, climbGrade };

/** The two-room level (see the file header). */
export const TWO_ROOMS: NavBakeInput = {
  id: 'two-rooms',
  solids: [
    block(v(0, -0.2, 0), v(14, 0, 6)),
    block(v(-0.2, 0, 0), v(0, 3, 6)),
    block(v(14, 0, 0), v(14.2, 3, 6)),
    block(v(-0.2, 0, -0.2), v(14.2, 3, 0)),
    block(v(-0.2, 0, 6), v(14.2, 3, 6.2)),
    block(v(6.9, 0, 0), v(7.1, 3, 2.4)),
    block(v(6.9, 0, 3.6), v(7.1, 3, 6)),
    block(v(0, 0, 2), v(2, 1.5, 6), 1),
    { shape: { kind: 'ramp', min: v(2, 0, 4.5), max: v(6, 1.5, 6), rises: '-x' } },
    block(v(10, 0, 2.5), v(11, 5, 3.5)),
  ],
  doors: [{ id: 'gate', bounds: { min: v(6.97, 0, 2.4), max: v(7.03, 2.2, 3.6) } }],
};

/** The two-room level, baked with the default (humanoid) settings. */
export function twoRooms(): NavMesh {
  return new NavMesh(bakeNavMesh(TWO_ROOMS));
}

/** Walks only. */
export const WALKER: NavAgentSpec = DEFAULT_NAV_AGENT;

/** Walks and opens doors. */
export const OPENER: NavAgentSpec = Object.freeze({
  ...DEFAULT_NAV_AGENT,
  mask: NAV_AGENT_BITS.walk | NAV_AGENT_BITS.openDoors,
});

/** Walks, opens doors and climbs grade 1. */
export const CLIMBER: NavAgentSpec = Object.freeze({
  ...DEFAULT_NAV_AGENT,
  mask: NAV_AGENT_BITS.walk | NAV_AGENT_BITS.openDoors | NAV_AGENT_BITS.climb,
  maxClimbGrade: 1,
});

/** Room A's south-east floor. */
export const IN_A = v(4, 0, 1);
/** Room B's south-east floor. */
export const IN_B = v(12, 0, 1);
/** The top of room A's platform. */
export const ON_PLATFORM = v(1, 1.5, 3.5);
/** The top of room B's pillar. */
export const ON_PILLAR = v(10.5, 5, 3);
