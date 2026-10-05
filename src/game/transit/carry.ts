// What an area transition carries over (mw-e01.11), made and applied with the save sections' own
// serialize and deserialize so it never drifts from what a save holds:
//
// - the world facts (quest and kill facts, merchants' "first opening" top-ups, the day clock: time is
//   two facts, src/sim/rest/day-clock.ts), the level deltas of every visited level, with the area just
//   left captured now (mw-e27.3: a chest opened stays open when the player comes back), and the
//   merchants' stock, gold and buyback;
// - the player's pack with its crowns, equipment and quick slots, and the components that make the
//   character: health, class, supporting stats and capabilities.
//
// Entity ids belong to a scene's world, so nothing is keyed by one: the player's records are lifted
// off the old player and put onto the new one. Creatures never travel: a creature in pursuit stays in
// the area it was in, which unloads with it (AI state is not persisted, so it is as authored when the
// player returns).

import {
  CapabilitiesComponent,
  captureInventories,
  EquipmentComponent,
  HealthComponent,
  InventoryComponent,
  PlayerClassComponent,
  pruneUnknownItems,
  QuickSlotsComponent,
  StatsComponent,
  type ComponentType,
  type EntityId,
  type World,
} from '@sim/index';
import type { SaveRegistry } from '../save/format';
import type { TransitCarry } from './payload';

/** Save sections whose data crosses as it is saved. */
export const CARRIED_SECTIONS: readonly string[] = ['world-facts', 'level-deltas', 'merchants'];

/** The player components that cross, by name. */
export const CARRIED_PLAYER_COMPONENTS: readonly ComponentType<unknown>[] = [
  HealthComponent,
  PlayerClassComponent,
  StatsComponent,
  CapabilitiesComponent,
] as readonly ComponentType<unknown>[];

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Reads the carry out of `world`, whose current area is still loaded. Call between sim steps: it
 * captures the area's level deltas.
 */
export function captureCarry(
  world: World<never>,
  player: EntityId,
  registry: SaveRegistry,
): TransitCarry {
  const sections: Record<string, unknown> = {};
  for (const section of registry.sections) {
    if (CARRIED_SECTIONS.includes(section.id))
      sections[section.id] = plain(section.serialize(world));
  }
  const mine = captureInventories(world).actors.find((actor) => actor.entity === player);
  const components: Record<string, unknown> = {};
  for (const type of CARRIED_PLAYER_COMPONENTS) {
    if (!world.isRegistered(type)) continue;
    const value = world.get(player, type);
    if (value !== undefined) components[type.name] = plain(type.serialize(value));
  }
  return {
    sections,
    player: {
      ...(mine?.inventory !== undefined && { inventory: plain(mine.inventory) }),
      ...(mine?.equipment !== undefined && { equipment: plain(mine.equipment) }),
      ...(mine?.quickSlots !== undefined && { quickSlots: plain(mine.quickSlots) }),
      components,
    },
  };
}

export interface ApplyCarryOptions {
  readonly registry: SaveRegistry;
  /** Whether an item definition still exists; unknown items are dropped with a warning. */
  readonly knownItem?: (defId: string) => boolean;
  readonly warn?: (message: string) => void;
}

/**
 * Puts the carried facts, level deltas and merchants into a freshly built world, before its scene's
 * entities are set up from them (the level deltas wait for the area to be entered).
 */
export function applyCarriedWorld(
  world: World<never>,
  carry: TransitCarry,
  options: ApplyCarryOptions,
): void {
  const warn = options.warn ?? (() => undefined);
  for (const section of options.registry.sections) {
    if (!CARRIED_SECTIONS.includes(section.id)) continue;
    const data = carry.sections[section.id];
    if (data === undefined) continue;
    const parsed = section.schema.safeParse(data);
    if (!parsed.success) {
      warn(`area transition: the carried "${section.id}" data is damaged and was dropped`);
      continue;
    }
    section.deserialize(world, parsed.data, { warn, worldFacts: undefined });
  }
}

/** Puts a part on `entity`, replacing the one it has. */
function put(world: World<never>, entity: EntityId, type: ComponentType<unknown>, value: unknown) {
  if (!world.isRegistered(type)) world.register(type);
  if (world.has(entity, type)) world.set(entity, type, value);
  else world.add(entity, type, value);
}

/**
 * Puts the carried character onto the new `player`: pack and crowns, equipment, quick slots, health,
 * class, stats and capabilities. Call after the scene's systems have given the player their
 * components (world items, consumables) and before the first step.
 */
export function applyCarriedPlayer(
  world: World<never>,
  player: EntityId,
  carry: TransitCarry,
  options: ApplyCarryOptions,
): void {
  const warn = options.warn ?? (() => undefined);
  const { inventory, equipment, quickSlots, components } = carry.player;
  const record = {
    entity: player,
    ...(inventory !== undefined && { inventory }),
    ...(equipment !== undefined && { equipment }),
    ...(quickSlots !== undefined && { quickSlots }),
  };
  const data = { actors: [record] } as unknown as Parameters<typeof pruneUnknownItems>[0];
  const known = options.knownItem;
  const pruned = known === undefined ? { data, dropped: [] } : pruneUnknownItems(data, known);
  for (const item of pruned.dropped) {
    warn(`area transition: dropped item "${item.defId}" from the player's ${item.where}`);
  }
  const kept = pruned.data.actors[0];
  if (kept?.inventory !== undefined) put(world, player, InventoryComponent, kept.inventory);
  if (kept?.equipment !== undefined) put(world, player, EquipmentComponent, kept.equipment);
  if (kept?.quickSlots !== undefined) put(world, player, QuickSlotsComponent, kept.quickSlots);
  for (const type of CARRIED_PLAYER_COMPONENTS) {
    const value = components[type.name];
    if (value !== undefined) put(world, player, type, type.deserialize(value));
  }
}

/** The class the carried character had, if it had chosen one. */
export function carriedClassId(carry: TransitCarry): string | undefined {
  const value = carry.player.components[PlayerClassComponent.name] as
    { readonly classId?: unknown } | undefined;
  return typeof value?.classId === 'string' ? value.classId : undefined;
}
