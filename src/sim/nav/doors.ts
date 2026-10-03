// Doors on the navmesh (mw-e11.4). The bake marks the polygons in each doorway with the door's spawn
// id; a path query asks a NavDoorLookup how each door stands right now and treats its polygons as:
//
// - open (open, opening past its stops, broken or gone): walkable by anyone;
// - closed (closed, closing, or held by something in its way, but not locked or stuck): walkable by
//   agents that open doors (`open-doors`, content NavLink kind `door`), at a small extra cost;
// - locked (locked, jammed or frozen shut): walkable by nobody.
//
// The lookup reads the mechanisms' live state on every query, so unlocking and opening a door is
// what the next path request sees (AC-2); routes already walking replan when a door changes
// (./navigation.ts).

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { doorStatus, type DoorStatus } from '../mechanisms/system';

/** How a door stands for navigation (see the file header). */
export type NavDoorState = 'open' | 'closed' | 'locked';

/** Door spawn id → how it stands. */
export type NavDoorLookup = (door: string) => NavDoorState;

/** Every door counts as closed: the query's default when it is given no lookup. */
export const ALL_DOORS_CLOSED: NavDoorLookup = () => 'closed';

/** A mechanism door status as navigation sees it; no status (the door is gone) is open. */
export function navDoorState(status: DoorStatus | undefined): NavDoorState {
  switch (status) {
    case undefined:
    case 'open':
    case 'broken':
      return 'open';
    case 'locked':
    case 'jammed':
      return 'locked';
    default:
      return 'closed';
  }
}

/**
 * Door states read live from `world`: `doors` maps a door's spawn id to its entity (a loaded scene's
 * spawns). A spawn id it does not know counts as open (no door stands there any more).
 */
export function worldNavDoors(
  world: World<never>,
  doors: ReadonlyMap<string, EntityId>,
): NavDoorLookup {
  return (door) => {
    const entity = doors.get(door);
    return navDoorState(
      entity === undefined || !world.isAlive(entity) ? undefined : doorStatus(world, entity),
    );
  };
}
