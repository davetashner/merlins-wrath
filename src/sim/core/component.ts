// Typed component definitions and their dense storage (mw-e00.15). A component is plain data keyed by
// a stable name; the name is what snapshots and saves use, so it must never change once shipped.
// Storage is a dense id/value pair of arrays plus an id → slot index. Queries need ascending entity
// id order for determinism, so a store tracks whether its dense order is still sorted and re-sorts
// before a query or snapshot next reads it (lazily, so a run of structural changes sorts it once).

/** `items[index]` for an index known to be in range (noUncheckedIndexedAccess can't see it). */
function at<T>(items: readonly T[], index: number): T {
  return items[index] as T;
}

/** A stable, never-reused entity id (positive integer). */
export type EntityId = number;

/**
 * A component type: a name plus the hook that turns values into snapshot data and back. Create one
 * with `defineComponent`; the type parameter is the value type systems read and write.
 */
export interface ComponentType<T> {
  readonly name: string;
  /** Snapshot hook: a value → detached, structured-cloneable data (consumed by state hash and saves). */
  serialize(value: T): unknown;
  /** Restore hook: data from `serialize` → a fresh value. */
  deserialize(data: unknown): T;
}

export interface ComponentOptions<T> {
  /** Defaults to `structuredClone`, which suits plain-data components. */
  readonly serialize?: (value: T) => unknown;
  /** Defaults to `structuredClone`; supply one to validate or rebuild richer values. */
  readonly deserialize?: (data: unknown) => T;
}

/** Types defined with the default (clone) snapshot hook; see `usesDefaultSerialize`. */
const defaultSerialized = new WeakSet<ComponentType<unknown>>();

/**
 * Whether `type` snapshots with the default `structuredClone` hook. The world skips that copy for
 * read-only snapshots (`World.snapshot({ shared: true })`), where cloning is pure cost.
 */
export function usesDefaultSerialize(type: ComponentType<unknown>): boolean {
  return defaultSerialized.has(type);
}

/**
 * Defines a component type. Values should be plain data; the default snapshot hooks deep-copy them
 * with `structuredClone` so a snapshot never aliases live state.
 */
export function defineComponent<T>(
  name: string,
  options: ComponentOptions<T> = {},
): ComponentType<T> {
  if (name === '') throw new RangeError('component name must not be empty');
  const serialize = options.serialize ?? ((value: T): unknown => structuredClone(value));
  // Snapshot data came from serialize() of a T, so cloning it back yields a T.
  const deserialize = options.deserialize ?? ((data: unknown): T => structuredClone(data) as T);
  const type: ComponentType<T> = { name, serialize, deserialize };
  if (options.serialize === undefined) defaultSerialized.add(type);
  return type;
}

/** Dense storage for one component type. Internal to the world. */
export class ComponentStore<T> {
  readonly ids: EntityId[] = [];
  readonly values: T[] = [];
  private readonly slots = new Map<EntityId, number>();
  private sorted = true;

  constructor(readonly type: ComponentType<T>) {}

  get size(): number {
    return this.ids.length;
  }

  has(id: EntityId): boolean {
    return this.slots.has(id);
  }

  /** Dense slot of `id`, or undefined when absent. Valid until the next structural change or sort. */
  slot(id: EntityId): number | undefined {
    return this.slots.get(id);
  }

  get(id: EntityId): T | undefined {
    const slot = this.slots.get(id);
    return slot === undefined ? undefined : this.values[slot];
  }

  /** Inserts or replaces. Returns true when the entity gained the component (a structural change). */
  put(id: EntityId, value: T): boolean {
    const slot = this.slots.get(id);
    if (slot !== undefined) {
      this.values[slot] = value;
      return false;
    }
    const last = this.ids[this.ids.length - 1];
    if (last !== undefined && id < last) this.sorted = false;
    this.slots.set(id, this.ids.length);
    this.ids.push(id);
    this.values.push(value);
    return true;
  }

  /** Swap-removes. Returns true when the entity had the component. */
  delete(id: EntityId): boolean {
    const slot = this.slots.get(id);
    if (slot === undefined) return false;
    const lastSlot = this.ids.length - 1; // ≥ slot ≥ 0: `id` is stored
    this.slots.delete(id);
    if (slot !== lastSlot) {
      const lastId = at(this.ids, lastSlot);
      this.ids[slot] = lastId;
      this.values[slot] = at(this.values, lastSlot);
      this.slots.set(lastId, slot);
      this.sorted = false;
    }
    this.ids.length = lastSlot;
    this.values.length = lastSlot;
    return true;
  }

  /** Restores ascending id order in the dense arrays (no-op when already sorted). */
  sort(): void {
    if (this.sorted) return;
    const order = this.ids.map((id, slot) => ({ id, value: at(this.values, slot) }));
    order.sort((a, b) => a.id - b.id);
    order.forEach(({ id, value }, slot) => {
      this.ids[slot] = id;
      this.values[slot] = value;
      this.slots.set(id, slot);
    });
    this.sorted = true;
  }

  clear(): void {
    this.ids.length = 0;
    this.values.length = 0;
    this.slots.clear();
    this.sorted = true;
  }
}
