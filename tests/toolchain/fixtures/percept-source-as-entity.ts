// mw-e11.5 AC-6: agent code holding a percept tries to read the perceived player's transform from the
// world. A percept's source is an opaque key, not an entity id, so this must not compile (TS2345).
import type { ComponentType } from '@sim/core/component';
import type { World } from '@sim/core/world';
import type { Percept } from '@sim/perception/percept';

declare const world: World<never>;
declare const percept: Percept;
/** Stands in for the player's transform (CharacterController, PlacementComponent). */
declare const Transform: ComponentType<{ readonly x: number; readonly z: number }>;

export const body = world.get(percept.source, Transform);
