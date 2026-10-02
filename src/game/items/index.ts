// World items in the game (mw-e17.7): the glue between content items, the sim's world items
// (src/sim/items) and the renderer.
//
// - `prepareWorldItems` builds the sim's world-item rules over content's items and materials.
// - `startWorldItems` installs them in a world after the player (so the drop and throw buttons act on
//   this tick's position), gives the player an inventory and turns the scene's item spawns into
//   world items.
// - `bindWorldItems` gives every world item without one a placeholder box the size of its body, by
//   category (call after each step); render sync drops it when the item is picked up.
// - `ItemWatch` keeps what the e2e reads (#app[data-items]): the player's pack, the world items
//   lying about, and counts of takes, drops and refusals.

import { toPropertyInit, type GameContent, materialPresets, type ItemEntry } from '@content/index';
import {
  addInventory,
  addSceneItems,
  installWorldItems,
  inventoryOf,
  itemDropped,
  itemDropRefused,
  itemPickedUp,
  itemPickupRefused,
  PhysicsObjectComponent,
  WorldItemComponent,
  WorldItems,
  type EntityId,
  type ItemInstanceFlags,
  type ItemSpawnEntity,
  type Vec3,
  type World,
  type WorldItemDef,
} from '@sim/index';
import type { RenderSync, SceneBinding } from '../loop/render-sync';

/** The sim's view of a content item: its world properties with the material as an id. */
export function worldItemDef(item: ItemEntry): WorldItemDef {
  const { worldProperties, ...rest } = item;
  return worldProperties === undefined
    ? rest
    : { ...rest, worldProperties: toPropertyInit(worldProperties) };
}

/** World-item rules over every content item, with content's material presets. */
export function prepareWorldItems(content: Pick<GameContent, 'all'>): WorldItems {
  return new WorldItems(content.all('item').map(worldItemDef), {
    materials: materialPresets(content.all('material')),
  });
}

/**
 * Installs world items in `world` (after the player's systems), gives `player` an inventory when
 * there is one, and makes the scene's item spawns world items. Call once, between steps, after
 * physics objects and the player's interaction are installed. Returns the placed items.
 */
export function startWorldItems<T>(
  world: World<T>,
  items: WorldItems,
  spawns: readonly ItemSpawnEntity[],
  player: EntityId | undefined,
): EntityId[] {
  const sim = world as unknown as World<never>;
  installWorldItems(world, items);
  if (player !== undefined && inventoryOf(sim, player) === undefined) addInventory(sim, player);
  return addSceneItems(sim, items, spawns);
}

/**
 * Binds an object to every world item not bound yet (call after each sim step); `create` builds one
 * for a box of `size` metres of item category `category`. Returns how many it bound.
 */
export function bindWorldItems<TObject>(
  world: World<never>,
  sync: RenderSync,
  items: WorldItems,
  create: (entity: EntityId, size: Vec3, category: string) => SceneBinding<TObject>,
): number {
  let bound = 0;
  world.query(WorldItemComponent, PhysicsObjectComponent).forEach((entity, item, body) => {
    if (sync.has(entity) || body.shape.kind !== 'box') return;
    const { x, y, z } = body.shape.halfExtents;
    const size = { x: 2 * x, y: 2 * y, z: 2 * z };
    sync.bind(entity, create(entity, size, items.def(item.defId).category));
    bound += 1;
  });
  return bound;
}

/** One stack, as the readout reports it. */
export interface ItemStackReadout {
  readonly item: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
}

/** What the e2e reads: the player's pack, the world items and what happened so far. */
export interface ItemReadout {
  readonly pack: readonly ItemStackReadout[];
  readonly world: readonly ItemStackReadout[];
  readonly taken: number;
  readonly dropped: number;
  readonly thrown: number;
  /** Refusals so far, oldest first (e.g. "drop:no-drop", "pick-up:stack-limit"). */
  readonly refused: readonly string[];
}

/** Counts takes, drops, throws and refusals from the moment it is made. */
export class ItemWatch {
  private taken = 0;
  private dropped = 0;
  private thrown = 0;
  private readonly refused: string[] = [];
  private readonly offs: (() => void)[];
  /** Bumped by every take, drop, throw and refusal: publish the readout only when it moves. */
  version = 0;

  constructor(
    private readonly world: World<never>,
    private readonly player: EntityId | undefined,
  ) {
    this.offs = [
      world.events.on(itemPickedUp, () => {
        this.taken += 1;
        this.version += 1;
      }),
      world.events.on(itemDropped, ({ thrown }) => {
        if (thrown) this.thrown += 1;
        else this.dropped += 1;
        this.version += 1;
      }),
      world.events.on(itemPickupRefused, ({ reason }) => {
        this.refused.push(`pick-up:${reason}`);
        this.version += 1;
      }),
      world.events.on(itemDropRefused, ({ reason, thrown }) => {
        this.refused.push(`${thrown ? 'throw' : 'drop'}:${reason}`);
        this.version += 1;
      }),
    ];
  }

  /** The readout now. */
  readout(): ItemReadout {
    const pack =
      this.player === undefined ? [] : (inventoryOf(this.world, this.player)?.items ?? []);
    const world: ItemStackReadout[] = [];
    this.world.query(WorldItemComponent).forEach((_entity, { defId, count, flags }) => {
      world.push({ item: defId, count, flags });
    });
    return {
      pack: pack.map(({ defId, count, flags }) => ({ item: defId, count, flags })),
      world,
      taken: this.taken,
      dropped: this.dropped,
      thrown: this.thrown,
      refused: [...this.refused],
    };
  }

  /** Stops listening. */
  dispose(): void {
    for (const off of this.offs) off();
  }
}
