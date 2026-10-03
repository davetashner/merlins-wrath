// What a nav agent may do on the baked navmesh (mw-e11.4). Agents are content's `NavAgent`
// (`deriveNavAgent`, mw-e12.6): a capability bitfield plus numeric limits. The sim may import
// content only as types, so the bit values are restated here in content's (append-only) order and
// tests/integration/nav-capabilities.test.ts proves these rules agree with content's
// `canTraverseLink` / `canEnterArea` for every link kind, area and profile.

import type { NavAgent, NavCapability } from '@content/index';
import type { NavAreaName, NavLinkKindName } from './format';

/** Content's NAV_CAPABILITIES, in order: bit i is 1 << i. */
const CAPABILITIES = [
  'walk',
  'climb',
  'fly',
  'swim',
  'burrow',
  'wallcrawl',
  'wade',
  'squeeze',
  'open-doors',
] as const satisfies readonly NavCapability[];

const bit = (capability: (typeof CAPABILITIES)[number]): number =>
  1 << CAPABILITIES.indexOf(capability);

/** Capability bits by name (content's NAV_BITS). */
export const NAV_AGENT_BITS = Object.freeze({
  walk: bit('walk'),
  climb: bit('climb'),
  fly: bit('fly'),
  swim: bit('swim'),
  burrow: bit('burrow'),
  wallcrawl: bit('wallcrawl'),
  wade: bit('wade'),
  squeeze: bit('squeeze'),
  openDoors: bit('open-doors'),
});

const B = NAV_AGENT_BITS;

/** Capabilities that let an agent enter each area (any one; content's AREA_REQUIREMENTS). */
const AREA_MASKS: Readonly<Record<NavAreaName, number>> = {
  ground: B.walk | B.wallcrawl | B.fly | B.burrow,
  'water-shallow': B.wade | B.swim | B.fly,
  'water-deep': B.swim | B.fly,
  crawlspace: B.squeeze,
};

/** The agent navigation reads (content's NavAgent). */
export type NavAgentSpec = Pick<
  NavAgent,
  | 'mask'
  | 'jumpHeight'
  | 'maxDrop'
  | 'maxClimbGrade'
  | 'maxAltitude'
  | 'burrowMaterials'
  | 'areaCosts'
>;

const has = (agent: NavAgentSpec, mask: number): boolean => (agent.mask & mask) !== 0;

/** Whether `agent` may enter polygons of `area`. */
export function navCanEnter(agent: NavAgentSpec, area: NavAreaName): boolean {
  return has(agent, AREA_MASKS[area]);
}

/** `agent`'s path-cost multiplier in `area` (1 unless its profile says otherwise). */
export function navAreaCost(agent: NavAgentSpec, area: NavAreaName): number {
  return agent.areaCosts[area] ?? 1;
}

/**
 * Whether `agent` can take an off-mesh link of `kind` whose rise, fall or climb grade is `measure`
 * (content's `canTraverseLink`). Burrow links name a material, which the bake does not make yet, so
 * they are never taken; door links are door polygons on this mesh (see ./doors.ts).
 */
export function navCanTraverse(agent: NavAgentSpec, kind: NavLinkKindName, measure: number) {
  switch (kind) {
    case 'jump':
      return (
        (has(agent, B.walk) && measure <= agent.jumpHeight) ||
        (has(agent, B.fly) && measure <= agent.maxAltitude)
      );
    case 'drop':
      return has(agent, B.fly | B.wallcrawl) || (has(agent, B.walk) && measure <= agent.maxDrop);
    case 'climb':
      return has(agent, B.wallcrawl) || (has(agent, B.climb) && measure <= agent.maxClimbGrade);
    case 'door':
      return has(agent, B.openDoors);
    case 'fly':
      return has(agent, B.fly);
    case 'burrow':
      return false;
  }
}

/**
 * A walker that cannot climb or open doors: what navigation assumes for an entity without a
 * `creature.nav` component. Humanoid limits (0.4 m steps, 0.6 m jumps, 2.5 m drops).
 */
export const DEFAULT_NAV_AGENT: NavAgentSpec = Object.freeze({
  mask: B.walk,
  jumpHeight: 0.6,
  maxDrop: 2.5,
  maxClimbGrade: 0,
  maxAltitude: 0,
  burrowMaterials: Object.freeze([]),
  areaCosts: Object.freeze({ ground: 1 }),
});
