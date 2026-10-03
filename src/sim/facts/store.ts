// World facts (mw-e27.1): the one typed store every system reads and writes persistent world state
// through — doors opened, characters helped, creatures befriended, treasures stolen. Quests,
// dialogue, puzzles, endings and level variants all read the same facts (story bible §4.4–§4.5, §9).
//
// A fact is a namespaced key (`quest.missing-miller.stage`, or entity-scoped
// `entity:<levelId>/<entityId>.opened`) holding a typed value: bool, int, enum, id (a content id
// string) or tick (a sim tick from the world clock, never wall time). A declared fact (`declare`, fed
// by the content registry in mw-e27.2) has a fixed type and an optional default; an undeclared one
// takes its type from its first value (boolean → bool, integer → int, string → id) and keeps it.
// Writing a value of another type throws a FactTypeError and changes nothing. Entity-scoped facts
// are declared once per fact name as a template (`entity:*.looted` governs every
// `entity:<level>/<entity>.looted`; an exact declaration of one key wins over its template). With
// the default policy an undeclared fact is inferred as above; `setUndeclaredPolicy` makes writes of
// undeclared facts throw (dev/test) or be ignored with a warning (production), mw-e27.2.
//
// Every real change queues exactly one `factChanged` event with `{ old, new, source }`, like
// `propertyChanged`. `transaction` batches writes: nothing is emitted until the outermost
// transaction returns, then one event per fact whose value actually changed; if it throws, every
// write in it is undone and nothing is emitted. The store lives in the World, so facts are part of
// snapshots, state hashes, replays and saves; the snapshot is a plain record in code-unit key order
// and is omitted while no fact is set, so worlds without facts hash as they did before facts existed.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import { encodeCanonical, xxHash32 } from '../snapshot';

/** Every fact value type. */
export const FACT_TYPES = ['bool', 'int', 'enum', 'id', 'tick'] as const;

export type FactType = (typeof FACT_TYPES)[number];

/** A stored fact value: always a primitive, so snapshots stay plain data. */
export type FactValue = boolean | number | string;

/**
 * A fact's declared type, with its default (read by `get` until the fact is first set) and the keys
 * it was saved under before (`renamedFrom`, mw-e27.4): a save holding a former key loads into this
 * one (see `currentKey` and facts/migrate.ts). A template's former keys are templates.
 */
export type FactSpec = (
  | { readonly type: 'bool'; readonly default?: boolean }
  | { readonly type: 'int'; readonly default?: number }
  | {
      readonly type: 'enum';
      /** The allowed values; non-empty and unique. */
      readonly values: readonly string[];
      readonly default?: string;
    }
  | { readonly type: 'id'; readonly default?: string }
  | { readonly type: 'tick'; readonly default?: number }
) & { readonly renamedFrom?: readonly string[] };

/** Why `FactStore.restoreProblem` would refuse a fact: not declared (under a strict policy) or invalid. */
export type FactRestoreProblem = 'undeclared' | 'invalid';

/** Plain-data fact state: key → value, keys in code-unit order. */
export type FactSnapshot = Readonly<Record<string, FactValue>>;

/** One fact value change, delivered by the world's event bus at the next phase boundary. */
export interface FactChange {
  readonly key: string;
  /** The stored value before the change; undefined when the fact had never been set. */
  readonly old: FactValue | undefined;
  readonly new: FactValue;
  /** Entity whose action caused the change (a signal graph, a stimulus source), or null. */
  readonly source: EntityId | null;
  /** The tick the change was made (for a transaction, the tick it committed). */
  readonly tick: number;
}

/** Fired once for every real fact change (a transaction's net changes, on commit). */
export const factChanged = defineEvent<FactChange>('factChanged');

/** Options for fact writes. */
export interface FactWriteOptions {
  /** Entity to attribute the change to (quests, crime, telemetry). */
  readonly source?: EntityId;
}

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';

/**
 * A well-formed fact key: kebab-case segments joined by `.`, optionally prefixed with
 * `entity:<levelId>/<entityId>.` for entity-scoped facts. The content layer mirrors it (checked by
 * tests/contracts/facts.test.ts).
 */
export const FACT_KEY_PATTERN = new RegExp(
  `^(?:entity:${SEGMENT}/${SEGMENT}\\.)?${SEGMENT}(?:\\.${SEGMENT})*$`,
);

/** A fact template: `entity:*.<fact>` declares `<fact>` for every entity of every level. */
export const FACT_TEMPLATE_PATTERN = new RegExp(`^entity:\\*\\.${SEGMENT}(?:\\.${SEGMENT})*$`);

/** What every template starts with. */
const TEMPLATE_PREFIX = 'entity:*.';

/** Captures the fact name of an entity-scoped key. */
const ENTITY_FACT = new RegExp(`^entity:${SEGMENT}/${SEGMENT}\\.(.+)$`);

/** True for a well-formed fact key (see FACT_KEY_PATTERN). */
export function isFactKey(key: string): boolean {
  return FACT_KEY_PATTERN.test(key);
}

/** True for a fact template such as `entity:*.looted`. */
export function isFactTemplate(key: string): boolean {
  return FACT_TEMPLATE_PATTERN.test(key);
}

/**
 * The template governing an entity-scoped key (`entity:mine/chest-3.looted` → `entity:*.looted`),
 * or undefined for any other string.
 */
export function factTemplateOf(key: string): string | undefined {
  const name = ENTITY_FACT.exec(key)?.[1];
  return name === undefined ? undefined : `entity:*.${name}`;
}

/** Thrown for a malformed fact key. */
export class FactKeyError extends RangeError {
  override readonly name = 'FactKeyError';

  constructor(readonly key: string) {
    super(
      `invalid fact key "${key}": expected kebab-case segments joined by ".", optionally prefixed "entity:<level>/<entity>."`,
    );
  }
}

/** Thrown when a value does not match a fact's type; the stored value is left unchanged. */
export class FactTypeError extends TypeError {
  override readonly name = 'FactTypeError';

  constructor(
    readonly key: string,
    /** The type the fact holds, or `new` for an undeclared, unset fact. */
    readonly expected: FactType | 'new',
    readonly value: unknown,
  ) {
    const wanted =
      expected === 'new' ? 'a boolean, a safe integer or a non-empty string' : `type ${expected}`;
    super(`fact "${key}" takes ${wanted}, got ${describe(value)}`);
  }
}

/** Thrown, under the `throw` policy, when code writes a fact that was never declared. */
export class UndeclaredFactError extends Error {
  override readonly name = 'UndeclaredFactError';

  constructor(readonly key: string) {
    super(`fact "${key}" is not declared: add it (or its entity:* template) to the fact registry`);
  }
}

/**
 * What happens when code writes a fact that is not declared, exactly or by template:
 * - `infer` (default): the fact takes its type from its first value (mw-e27.1).
 * - `throw`: the write throws an UndeclaredFactError (dev and test builds).
 * - `ignore`: the write is dropped and `warn` is called with the error (production builds).
 */
export type UndeclaredFactPolicy =
  | { readonly mode: 'infer' }
  | { readonly mode: 'throw' }
  | { readonly mode: 'ignore'; readonly warn: (error: UndeclaredFactError) => void };

/** Thrown for a malformed or repeated fact declaration. */
export class FactDeclarationError extends Error {
  override readonly name = 'FactDeclarationError';

  constructor(
    readonly key: string,
    message: string,
  ) {
    super(`fact "${key}": ${message}`);
  }
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : `${typeof value} ${String(value)}`;
}

/** Builds an entity-scoped fact key, e.g. `entity:mine/chest-3.looted`. */
export function entityFactKey(level: string, entity: string, fact: string): string {
  const key = `entity:${level}/${entity}.${fact}`;
  if (!isFactKey(key)) throw new FactKeyError(key);
  return key;
}

function checkKey(key: string): void {
  if (!isFactKey(key)) throw new FactKeyError(key);
}

/** The type an undeclared fact takes from its first value, or undefined for an invalid value. */
function inferType(value: unknown): FactType | undefined {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return value === '' ? undefined : 'id';
  return Number.isSafeInteger(value) ? 'int' : undefined;
}

function accepts(spec: FactSpec, value: unknown): boolean {
  switch (spec.type) {
    case 'bool':
      return typeof value === 'boolean';
    case 'int':
      return Number.isSafeInteger(value);
    case 'tick':
      return Number.isSafeInteger(value) && (value as number) >= 0;
    case 'id':
      return typeof value === 'string' && value !== '';
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
  }
}

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
const known = <T>(value: T | undefined): T => value as T;

/** `-0` would encode differently from `0`; facts are integers, so fold it. */
const normalize = (value: FactValue): FactValue => (value === 0 ? 0 : value);

/** What the store needs from its world. */
export interface FactStoreHooks {
  /** Queues a change event. */
  emit(change: FactChange): void;
  /** The current sim tick. */
  tick(): number;
}

interface JournalEntry {
  readonly key: string;
  readonly old: FactValue | undefined;
  readonly source: EntityId | null;
}

/** The world's fact store; reach it as `world.facts`. */
export class FactStore {
  private values = new Map<string, FactValue>();
  private readonly specs = new Map<string, FactSpec>();
  private policy: UndeclaredFactPolicy = { mode: 'infer' };
  /** Former key (or template) → the declared key (or template) it was renamed to. */
  private readonly formerKeys = new Map<string, string>();
  /** Writes of the open transaction, oldest first; null outside a transaction. */
  private journal: JournalEntry[] | null = null;
  /** Keys in code-unit order; null when a key was added or removed since it was built. */
  private order: string[] | null = [];

  constructor(private readonly hooks: FactStoreHooks) {}

  /** Number of facts that have been set (defaults alone don't count). */
  get size(): number {
    return this.values.size;
  }

  /**
   * Declares a fact's type and default. `key` is a fact key or an `entity:*.<fact>` template, which
   * governs every entity-scoped key with that fact name that has no exact declaration of its own.
   * Declarations are configuration, not state: they are not in snapshots and survive `restore`,
   * like registered component types.
   * @throws FactKeyError for a malformed key; FactDeclarationError for a repeated declaration, an
   *   unknown type, bad enum values or a default of the wrong type; FactTypeError when the fact (for
   *   a template: a set fact it governs) already holds a value of another type.
   */
  declare(key: string, spec: FactSpec): this {
    const template = isFactTemplate(key);
    if (!template) checkKey(key);
    if (this.specs.has(key)) throw new FactDeclarationError(key, 'is already declared');
    if (!(FACT_TYPES as readonly string[]).includes(spec.type)) {
      throw new FactDeclarationError(key, `unknown type "${spec.type}"`);
    }
    if (spec.type === 'enum') {
      const { values } = spec;
      if (values.length === 0 || new Set(values).size !== values.length || values.includes('')) {
        throw new FactDeclarationError(key, 'enum values must be non-empty, unique strings');
      }
    }
    if (spec.default !== undefined && !accepts(spec, spec.default)) {
      throw new FactDeclarationError(
        key,
        `default ${describe(spec.default)} is not of type ${spec.type}`,
      );
    }
    const { renamedFrom: former = [], ...typed } = spec;
    this.checkRenames(key, template, former);
    for (const [held, current] of this.values) {
      const governed = template
        ? factTemplateOf(held) === key && !this.specs.has(held)
        : held === key;
      if (governed && !accepts(spec, current)) throw new FactTypeError(held, spec.type, current);
    }
    const copy =
      typed.type === 'enum' ? { ...typed, values: Object.freeze([...typed.values]) } : typed;
    const renames = former.length > 0 ? { renamedFrom: Object.freeze([...former]) } : {};
    this.specs.set(key, Object.freeze({ ...copy, ...renames }));
    for (const old of former) this.formerKeys.set(old, key);
    return this;
  }

  /**
   * The key a fact saved under `key` holds now: the declared key that lists it in `renamedFrom`
   * (for an entity-scoped key, the same entity's fact under the renamed template), else `key`
   * itself. A key declared exactly is never renamed.
   */
  currentKey(key: string): string {
    if (this.specs.has(key)) return key;
    const exact = this.formerKeys.get(key);
    if (exact !== undefined) return exact;
    const template = factTemplateOf(key);
    const renamed = template === undefined ? undefined : this.formerKeys.get(template);
    if (template === undefined || renamed === undefined) return key;
    const prefix = key.slice(0, key.length - template.length + TEMPLATE_PREFIX.length);
    return prefix + renamed.slice(TEMPLATE_PREFIX.length);
  }

  /**
   * Whether `restore` would take `value` for `key`, and why not: `invalid` for a malformed key or a
   * value its declared (or, undeclared, inferable) type rejects; `undeclared` for an undeclared fact
   * under the `throw` or `ignore` policy, so a fact removed from the registry leaves saves on load.
   */
  restoreProblem(key: string, value: unknown): FactRestoreProblem | undefined {
    if (!isFactKey(key)) return 'invalid';
    const spec = this.spec(key);
    if (spec !== undefined) return accepts(spec, value) ? undefined : 'invalid';
    if (this.policy.mode !== 'infer') return 'undeclared';
    return inferType(value) === undefined ? 'invalid' : undefined;
  }

  /** The declaration governing `key` (its own, else its entity template's), if any. */
  spec(key: string): FactSpec | undefined {
    return this.specs.get(key) ?? this.specs.get(factTemplateOf(key) ?? key);
  }

  /** True when `key` is declared, exactly or by an entity template. */
  isDeclared(key: string): boolean {
    return this.spec(key) !== undefined;
  }

  /**
   * Sets what writes of undeclared facts do (see UndeclaredFactPolicy). Like declarations, the
   * policy is configuration: not in snapshots, kept by `restore`. Restoring a snapshot is not a
   * write, so saves holding facts the registry no longer declares still load (migrations: mw-e27.4).
   */
  setUndeclaredPolicy(policy: UndeclaredFactPolicy): this {
    this.policy = policy;
    return this;
  }

  /** The type `key` holds: declared, or taken from its value; undefined for an unknown fact. */
  typeOf(key: string): FactType | undefined {
    const current = this.values.get(key);
    return this.spec(key)?.type ?? (current === undefined ? undefined : inferType(current));
  }

  /** True once `key` has been set (a declared default alone does not count). */
  has(key: string): boolean {
    return this.values.has(key);
  }

  /** The value of `key`: the stored value, else its declared default, else undefined. */
  get(key: string): FactValue | undefined {
    return this.values.get(key) ?? this.spec(key)?.default;
  }

  /**
   * Writes a fact now. Returns true and queues one `factChanged` (at transaction commit, inside a
   * transaction) when the value changes; writing the value it already holds does nothing.
   * An undeclared fact is handled by the undeclared policy: under `ignore` the write is dropped
   * (returns false) after a warning.
   * @throws FactKeyError for a malformed key; FactTypeError for a value of the wrong type (the stored
   *   value is unchanged); UndeclaredFactError for an undeclared fact under the `throw` policy.
   */
  set(key: string, value: FactValue, options: FactWriteOptions = {}): boolean {
    checkKey(key);
    const spec = this.spec(key);
    if (spec === undefined && !this.admitUndeclared(key)) return false;
    const current = this.values.get(key);
    const type = this.typeOf(key);
    const valid =
      type === undefined
        ? inferType(value) !== undefined
        : accepts(spec ?? ({ type } as FactSpec), value);
    if (!valid) throw new FactTypeError(key, type ?? 'new', value);
    const next = normalize(value);
    if (next === current) return false;
    this.write(key, next, current, options.source ?? null);
    return true;
  }

  /**
   * Adds `by` (default 1) to an integer fact, starting from its default or 0, and returns the value
   * it then holds (unchanged when an undeclared write is ignored).
   * @throws RangeError when `by` or the result is not a safe integer; FactTypeError for a
   *   non-integer fact.
   */
  increment(key: string, by = 1, options: FactWriteOptions = {}): number {
    if (!Number.isSafeInteger(by)) {
      throw new RangeError(`fact increment must be a safe integer, got ${String(by)}`);
    }
    const base = this.get(key) ?? 0;
    if (typeof base !== 'number') throw new FactTypeError(key, known(this.typeOf(key)), by);
    const next = base + by;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`fact "${key}" would leave the safe integer range`);
    }
    return this.set(key, next, options) ? next : base;
  }

  /** Sets a tick fact to the current sim tick (e.g. "when the bell last rang"). */
  stamp(key: string, options: FactWriteOptions = {}): boolean {
    return this.set(key, this.hooks.tick(), options);
  }

  /** Set facts whose key starts with `prefix` (all by default), in code-unit key order. */
  entries(prefix = ''): (readonly [string, FactValue])[] {
    const result: (readonly [string, FactValue])[] = [];
    for (const key of this.sortedKeys()) {
      if (key.startsWith(prefix)) result.push([key, known(this.values.get(key))]);
    }
    return result;
  }

  /**
   * Runs `fn` as one batch. Writes apply immediately (reads inside see them), but events are held
   * until the outermost transaction returns, then one is emitted per fact whose value differs from
   * before the batch, attributed to the last write's source. If `fn` throws, every write it made is
   * undone, nothing is emitted and the error is rethrown; an inner transaction that throws undoes
   * only its own writes.
   */
  transaction<T>(fn: () => T): T {
    const outer = this.journal === null;
    const journal = this.journal ?? [];
    const mark = journal.length;
    this.journal = journal;
    try {
      const result = fn();
      if (outer) {
        this.journal = null;
        this.commit(journal);
      }
      return result;
    } catch (error) {
      this.undo(journal, mark);
      if (outer) this.journal = null;
      throw error;
    }
  }

  /** Plain-data state: set facts in code-unit key order (a fresh object). */
  snapshot(): FactSnapshot {
    const snapshot: Record<string, FactValue> = {};
    for (const key of this.sortedKeys()) snapshot[key] = known(this.values.get(key));
    return snapshot;
  }

  /** A stable content hash of the set facts (8 hex digits); independent of insertion order. */
  hash(): string {
    return xxHash32(encodeCanonical(this.snapshot())).toString(16).padStart(8, '0');
  }

  /**
   * Validates a snapshot and returns a function that replaces all facts with it. `World.restore`
   * validates everything before changing anything, hence the split. Declarations are kept.
   * @throws FactKeyError / FactTypeError for invalid entries; Error inside a transaction.
   */
  prepareRestore(snapshot: FactSnapshot = {}): () => void {
    if (this.journal !== null) throw new Error('facts cannot be restored inside a transaction');
    const values = new Map<string, FactValue>();
    for (const [key, value] of Object.entries(snapshot)) {
      checkKey(key);
      const spec = this.spec(key);
      if (spec === undefined ? inferType(value) === undefined : !accepts(spec, value)) {
        throw new FactTypeError(key, spec?.type ?? 'new', value);
      }
      values.set(key, normalize(value));
    }
    return () => {
      this.values = values;
      this.order = null;
    };
  }

  /** Rejects a `renamedFrom` list that is malformed or overlaps another declaration. */
  private checkRenames(key: string, template: boolean, former: readonly string[]): void {
    if (this.formerKeys.has(key)) {
      throw new FactDeclarationError(
        key,
        `is a former key of "${String(this.formerKeys.get(key))}"`,
      );
    }
    for (const old of former) {
      const problem =
        old === '' || old === key
          ? 'must be a non-empty string other than the key'
          : isFactTemplate(old) !== template
            ? template
              ? 'must be a template, as the key is'
              : 'must not be a template'
            : this.specs.has(old)
              ? 'is still declared'
              : this.formerKeys.has(old) || former.indexOf(old) !== former.lastIndexOf(old)
                ? 'is claimed twice'
                : undefined;
      if (problem !== undefined) {
        throw new FactDeclarationError(key, `renamedFrom "${old}" ${problem}`);
      }
    }
  }

  /** Applies the undeclared policy to a write of `key`: true to go ahead, false to drop it. */
  private admitUndeclared(key: string): boolean {
    const { policy } = this;
    if (policy.mode === 'infer') return true;
    const error = new UndeclaredFactError(key);
    if (policy.mode === 'throw') throw error;
    policy.warn(error);
    return false;
  }

  private write(
    key: string,
    value: FactValue,
    old: FactValue | undefined,
    source: EntityId | null,
  ): void {
    if (old === undefined) this.order = null;
    this.values.set(key, value);
    if (this.journal === null) {
      this.hooks.emit({ key, old, new: value, source, tick: this.hooks.tick() });
    } else {
      this.journal.push({ key, old, source });
    }
  }

  private commit(journal: readonly JournalEntry[]): void {
    const touched = new Map<string, { old: FactValue | undefined; source: EntityId | null }>();
    for (const { key, old, source } of journal) {
      const first = touched.get(key);
      touched.set(key, { old: first === undefined ? old : first.old, source });
    }
    const tick = this.hooks.tick();
    for (const [key, { old, source }] of touched) {
      const value = known(this.values.get(key)); // written in this batch, never removed
      if (value !== old) this.hooks.emit({ key, old, new: value, source, tick });
    }
  }

  private undo(journal: JournalEntry[], mark: number): void {
    for (let i = journal.length - 1; i >= mark; i--) {
      const { key, old } = known(journal[i]);
      if (old === undefined) {
        this.values.delete(key);
        this.order = null;
      } else {
        this.values.set(key, old);
      }
    }
    journal.length = mark;
  }

  private sortedKeys(): readonly string[] {
    this.order ??= [...this.values.keys()].sort();
    return this.order;
  }
}
