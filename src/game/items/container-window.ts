// The container window and pickup toasts in the game (mw-e18.4): the glue between the sim's
// containers and world items (src/sim/loot/containers.ts, src/sim/items/world-items.ts), content's
// items, and the UI's container window (src/ui/container-window.ts) and pickup toasts
// (src/ui/pickup-toasts.ts).
//
// - `LootViews` derives the window's model from a container's pack (stack names and icons from item
//   data, the container's name from its scene spawn id) and a toast's from a pickup: gold as gold, a
//   unique artifact as a discovery with its flavour text (item data's `description`).
// - `ContainerWindowController` opens the window when the player's Interact searches a container
//   (`container.searched`), after the step that did it. Take, Take gold and Take All go to the sim as
//   `loot.containerAction` commands, so the window never changes sim state and looting is in the
//   replay; the open window refreshes after every step whose contents changed, says why a take was
//   refused, and closes if its container is gone.
// - `PickupNotifier` turns the player's pickups (a world item taken, `item.pickedUp`; anything taken
//   from a container, `container.taken`) into toasts on the draw clock.
// - `startContainerUi` wires both into a running game and publishes `#app[data-container-window]`
//   (open/closed) and `#app[data-pickups]` (the visible toasts) for the e2e.

import type { GameContent, ItemEntry } from '@content/index';
import {
  ContainerComponent,
  containerActionCommand,
  containerActionDone,
  containerSearched,
  containerTaken,
  inventoryOf,
  itemPickedUp,
  SceneSpawnComponent,
  type ContainerAction,
  type ContainerActionCommand,
  type ContainerRefusal,
  type EntityId,
  type World,
} from '@sim/index';
import {
  openContainerWindow,
  PickupToasts,
  type ContainerWindow,
  type ContainerWindowModel,
  type Pickup,
  type ToastView,
  type UiRoot,
} from '@ui/index';
import { itemLabel } from '../classes';
import { ICON_KIND, itemName } from './inventory-screen';

/** The content loot views read. */
export type LootContent = Pick<GameContent, 'all'>;

/** Whether `item` gets a discovery toast: a unique artifact. */
export const isDiscovery = (item: Pick<ItemEntry, 'category' | 'flags'>): boolean =>
  item.category === 'artifact' && item.flags.unique;

/** The item id containers report gold under. */
const GOLD = 'gold';

/** Derives the container window's and the pickup toasts' view models. */
export class LootViews {
  readonly #items: ReadonlyMap<string, ItemEntry>;

  constructor(content: LootContent) {
    this.#items = new Map(content.all('item').map((item) => [item.id, item]));
  }

  /** The window's model for container `entity` (empty when it has no pack). */
  windowModel(world: World<never>, entity: EntityId): ContainerWindowModel {
    const pack = inventoryOf(world, entity);
    const spawn = world.get(entity, SceneSpawnComponent)?.id;
    return {
      title: spawn === undefined ? 'Container' : itemLabel(spawn),
      gold: pack?.gold ?? 0,
      items: (pack?.items ?? []).map(({ instanceId, defId, count }) => {
        const item = this.#items.get(defId);
        return {
          id: instanceId,
          name: item === undefined ? itemLabel(defId) : itemName(item),
          icon: item === undefined ? 'misc' : ICON_KIND[item.category],
          count,
        };
      }),
    };
  }

  /** The toast for `count` units of `defId` picked up. */
  pickup(defId: string, count: number): Pickup {
    const item = this.#items.get(defId);
    if (defId === GOLD || item?.category === 'currency') {
      return { key: GOLD, name: 'Gold', icon: 'currency', count, gold: true };
    }
    if (item === undefined) return { key: defId, name: itemLabel(defId), icon: 'misc', count };
    return {
      key: defId,
      name: itemName(item),
      icon: ICON_KIND[item.category],
      count,
      ...(isDiscovery(item) && { discovery: item.description ?? '' }),
    };
  }
}

const REFUSALS: Readonly<Partial<Record<ContainerRefusal, string>>> = Object.freeze({
  'unique-held': 'You already carry one of those.',
  'stack-limit': 'You can’t carry any more of that.',
  locked: 'It’s locked.',
});

/** The status line for a refused take. */
export function takeRefusalText(reason: ContainerRefusal): string {
  return REFUSALS[reason] ?? 'That didn’t work.';
}

export interface ContainerWindowControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly views: LootViews;
  /** Queues a sim command for the next step. */
  readonly submit: (command: ContainerActionCommand) => void;
  /** The window opened or closed. */
  readonly onChange?: (open: boolean) => void;
}

/** Opens, refreshes and closes the container window for the player. Call `afterStep` each step. */
export class ContainerWindowController {
  readonly #options: ContainerWindowControllerOptions;
  readonly #offs: (() => void)[];
  #pending: EntityId | undefined;
  #entity: EntityId | undefined;
  #window: ContainerWindow | undefined;
  #shown = '';

  constructor(options: ContainerWindowControllerOptions) {
    this.#options = options;
    const { world, player } = options;
    this.#offs = [
      world.events.on(containerSearched, ({ actor, entity }) => {
        if (actor === player) this.#pending = entity;
      }),
      world.events.on(containerActionDone, ({ actor, ok, reason }) => {
        if (actor !== player || ok || reason === undefined) return;
        this.#window?.say(takeRefusalText(reason));
      }),
    ];
  }

  /** The open window, if any. */
  get window(): ContainerWindow | undefined {
    return this.#window;
  }

  /** The container whose window is open. */
  get entity(): EntityId | undefined {
    return this.#entity;
  }

  /** Opens a searched container's window, or refreshes (or closes) the open one. */
  afterStep(): void {
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined && this.#window === undefined) this.#open(pending);
    const { world, views } = this.#options;
    const entity = this.#entity;
    const window = this.#window;
    if (entity === undefined || window === undefined) return;
    if (!world.has(entity, ContainerComponent)) {
      window.close();
      return;
    }
    const model = views.windowModel(world, entity);
    const json = JSON.stringify(model);
    if (json === this.#shown) return;
    this.#shown = json;
    window.update(model);
  }

  /** Closes the window. */
  close(): void {
    this.#window?.close();
  }

  /** Stops listening and closes the window. */
  dispose(): void {
    for (const off of this.#offs) off();
    this.close();
  }

  #open(entity: EntityId): void {
    const { ui, world, player, views, submit, onChange } = this.#options;
    if (ui.top !== undefined || !world.has(entity, ContainerComponent)) return;
    const act = (action: ContainerAction): void => {
      submit(containerActionCommand(player, entity, action));
    };
    const model = views.windowModel(world, entity);
    this.#shown = JSON.stringify(model);
    this.#entity = entity;
    this.#window = openContainerWindow(ui, {
      model,
      onTake: (id) => {
        act({ op: 'take', instanceId: id });
      },
      onTakeGold: () => {
        act({ op: 'take-gold' });
      },
      onTakeAll: () => {
        act({ op: 'take-all' });
      },
      onClose: () => {
        this.#window = undefined;
        this.#entity = undefined;
        onChange?.(false);
      },
    });
    onChange?.(true);
  }
}

/** Turns the player's pickups into toasts. */
export class PickupNotifier {
  readonly #offs: (() => void)[];

  /** `now`: the draw clock, ms (the toasts' `frame` must get the same clock). */
  constructor(
    world: World<never>,
    player: EntityId,
    views: LootViews,
    toasts: PickupToasts,
    now: () => number,
  ) {
    const show = (defId: string, count: number): void => {
      toasts.push(views.pickup(defId, count), now());
    };
    this.#offs = [
      world.events.on(itemPickedUp, ({ actor, defId, count }) => {
        if (actor === player) show(defId, count);
      }),
      world.events.on(containerTaken, ({ actor, moved }) => {
        if (actor !== player) return;
        for (const { item, count } of moved) show(item, count);
      }),
    ];
  }

  /** Stops listening. */
  dispose(): void {
    for (const off of this.#offs) off();
  }
}

export interface ContainerUiOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly content: LootContent;
  readonly player: EntityId;
  /** Queues a sim command for the next step. */
  readonly submit: (command: ContainerActionCommand) => void;
  /** The HUD scale setting (accessibility.hudScale) at start. */
  readonly hudScale: number;
  /** The draw clock, ms. */
  readonly now: () => number;
  /** Publishes a readout for the e2e: `containerWindow` (open/closed), `pickups` (JSON). */
  readonly publish?: (key: 'containerWindow' | 'pickups', value: string) => void;
}

/** The container window and pickup toasts in a running game. */
export interface ContainerUi {
  readonly controller: ContainerWindowController;
  readonly toasts: PickupToasts;
  /** Call after every sim step. */
  afterStep(): void;
  /** Call every drawn frame with the draw clock: expires toasts. */
  frame(nowMs: number): void;
  /** Applies a new HUD scale to the toasts. */
  setHudScale(scale: number): void;
}

/** What the e2e reads of a toast. */
const readout = (toasts: readonly ToastView[]): string =>
  JSON.stringify(toasts.map(({ text, count, discovery }) => ({ text, count, discovery })));

/** Puts the pickup toasts in the HUD and readies the container window for the player. */
export function startContainerUi(options: ContainerUiOptions): ContainerUi {
  const { ui, world, player, submit, publish, now } = options;
  const views = new LootViews(options.content);
  const controller = new ContainerWindowController({
    ui,
    world,
    player,
    views,
    submit,
    onChange: (open) => publish?.('containerWindow', open ? 'open' : 'closed'),
  });
  const toasts = new PickupToasts({ scale: options.hudScale });
  ui.hud.append(toasts.element);
  new PickupNotifier(world, player, views, toasts, now);
  let published = '[]';
  const publishToasts = (): void => {
    const json = readout(toasts.visible);
    if (json !== published) publish?.('pickups', (published = json));
  };
  publish?.('containerWindow', 'closed');
  publish?.('pickups', published);
  return {
    controller,
    toasts,
    afterStep: () => {
      controller.afterStep();
      publishToasts();
    },
    frame: (nowMs) => {
      toasts.frame(nowMs);
      publishToasts();
    },
    setHudScale: (scale) => {
      toasts.setScale(scale);
    },
  };
}
