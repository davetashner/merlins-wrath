// The VFX cue bridge (mw-e29.3): subscribes to the sim's event bus and turns events into effects by
// resolving VFX cue sheet rules (content type `vfx-cue-sheet`) with the same event bindings and
// matcher as the audio cue bridge, so sound and visuals follow one table of facts and stay in sync.
// Per event it reads anchors, facts and directions (events.ts), picks the most specific rule per
// layer (matcher.ts), fills `{fact}` effect templates, then spawns: on the anchor entity (attached,
// following it) or where it is now, turned to the hit normal or the blow, emitting more for a harder
// hit. A looping effect a rule started stops when one of the rule's `stopOn` events happens to the
// same entity; when its entity is destroyed first, the VFX runtime stops its emission and lets its
// particles finish, so no loop is ever orphaned.
//
// VFX never feeds back into the sim: the bridge only reads payloads and lookups, owns its state and
// catches its own errors so a broken rule can't throw into the sim's event flush. It does nothing per
// frame: all its work happens when an event fires.

import {
  CUE_DEDUPE_MS,
  cueEventSpec,
  vfxCueSheetWarnings,
  type CueEventName,
  type VfxCueRuleDef,
} from '@content/index';
import type { EntityId, Quat, Vec3 } from '@sim/index';
import type { VfxAnchor, VfxHandle, VfxSpawnOptions } from '../vfx/index.ts';
import type { CueEventSource } from './audio-bridge.ts';
import { CUE_EVENT_BINDINGS, type CueAnchor, type CueLookups, type CueReading } from './events.ts';
import { CueRuleSet, interpolateCue } from './matcher.ts';

/** A loaded VFX cue rule as the bridge reads it (content entries are frozen). */
export type VfxCueRule = Omit<VfxCueRuleDef, 'stopOn'> & {
  readonly stopOn: readonly CueEventName[];
};

/** What the bridge spawns through (the VfxSystem satisfies it). */
export interface VfxSpawner {
  spawn(effectId: string, options: VfxSpawnOptions): VfxHandle | null;
  stop(handle: VfxHandle): void;
  alive(handle: VfxHandle): boolean;
  has(effectId: string): boolean;
}

export interface VfxCueBridgeOptions {
  /** Loaded VFX cue sheets; rules keep sheet order, then rule order (the specificity tie-break). */
  readonly sheets: readonly { readonly id: string; readonly rules: readonly VfxCueRule[] }[];
  readonly vfx: VfxSpawner;
  /** Presentation time in ms (sim time or the frame clock), for cooldowns and the de-dupe window. */
  readonly now: () => number;
  /** Where an entity is right now (the VfxSystem's anchor resolver); without it, entities are trusted. */
  readonly locate?: (entity: EntityId) => VfxAnchor | undefined;
  /** Material, facing and arrow lookups for facts and directions. */
  readonly lookups?: CueLookups;
  /**
   * Dev build: rules naming effects that don't exist yet are warned about (AC-4) and still spawn, so
   * the runtime leaves its marker. Otherwise they are skipped quietly. Default: the Vite build mode.
   */
  readonly dev?: boolean;
  readonly warn?: (message: string) => void;
}

/** What one `handle` call spawned, for tests and debug overlays. */
export interface VfxCueSpawn {
  readonly effect: string;
  readonly handle: VfxHandle;
  readonly options: VfxSpawnOptions;
}

const unknown = (): undefined => undefined;
const NO_LOOKUPS: CueLookups = { materialOf: unknown, impactClassOf: unknown };

/** De-dupe and cooldown entries older than this are pruned once the maps grow. */
const PRUNE_AT = 512;

type IndexedRule = VfxCueRule & {
  readonly index: number;
};

/** A looping effect a rule started on an entity, until one of its stop events. */
interface LiveLoop {
  readonly handle: VfxHandle;
  readonly stopOn: readonly string[];
}

/** Spawns VFX cue sheet rules for sim events. One per world. */
export class VfxCueBridge {
  readonly #rules: CueRuleSet<IndexedRule>;
  readonly #vfx: VfxSpawner;
  readonly #now: () => number;
  readonly #locate: ((entity: EntityId) => VfxAnchor | undefined) | undefined;
  readonly #lookups: CueLookups;
  readonly #dev: boolean;
  readonly #warn: (message: string) => void;
  /** Events that stop some rule's loops. */
  readonly #stopEvents: ReadonlySet<string>;
  /** entity → loops rules started on it. */
  readonly #loops = new Map<EntityId, LiveLoop[]>();
  /** `effect|anchor` → last spawn time. */
  readonly #recent = new Map<string, number>();
  /** `rule|anchor` → last spawn time (rules with a cooldown only). */
  readonly #cooldowns = new Map<string, number>();
  readonly #maxCooldown: number;

  constructor(options: VfxCueBridgeOptions) {
    const rules = options.sheets.flatMap((sheet) => sheet.rules);
    this.#rules = new CueRuleSet(rules.map((rule, index) => ({ ...rule, index })));
    this.#stopEvents = new Set(rules.flatMap((rule) => rule.stopOn));
    this.#maxCooldown = Math.max(CUE_DEDUPE_MS, ...rules.map((r) => r.cooldownMs));
    this.#vfx = options.vfx;
    this.#now = options.now;
    this.#locate = options.locate;
    this.#lookups = options.lookups ?? NO_LOOKUPS;
    this.#dev = options.dev ?? import.meta.env.DEV;
    this.#warn =
      options.warn ??
      ((message) => {
        console.warn(message);
      });
    if (this.#dev) {
      const known = new Set(
        rules.map((rule) => rule.effect).filter((effect) => this.#vfx.has(effect)),
      );
      for (const warning of vfxCueSheetWarnings(options.sheets, known)) this.#warn(warning);
    }
  }

  /** Subscribes to every event a rule uses or stops on; returns a function that unsubscribes. */
  attach(events: CueEventSource): () => void {
    const names = new Set([...this.#rules.events(), ...this.#stopEvents]);
    const offs = [...names].map((name) => {
      const event = name as CueEventName; // rule and stopOn events are validated CueEventNames
      const binding = CUE_EVENT_BINDINGS[event];
      return events.on(binding.type, (payload) => {
        try {
          this.handle(event, binding.read(payload, this.#lookups));
        } catch (error) {
          this.#warn(`vfx cues: ${event} failed (${String(error)})`);
        }
      });
    });
    return () => {
      for (const off of offs) off();
    };
  }

  /** Stops loops this event ends, then resolves and spawns its rules; returns what was spawned. */
  handle(event: CueEventName, reading: CueReading): VfxCueSpawn[] {
    if (this.#stopEvents.has(event)) this.#stopLoops(event, reading);
    const now = this.#now();
    const spawns: VfxCueSpawn[] = [];
    for (const rule of this.#rules.resolve(event, reading.facts)) {
      const effect = interpolateCue(rule.effect, reading.facts);
      if (effect === undefined || (!this.#dev && !this.#vfx.has(effect))) continue;
      const anchor = reading.anchors[rule.at ?? defaultAnchor(event)];
      const where = this.#where(rule, anchor);
      if (where === undefined) continue;
      const key = placementKey(where);
      const dedupeKey = `${effect}|${key}`;
      if (within(this.#recent.get(dedupeKey), now, CUE_DEDUPE_MS)) continue;
      const cooldownKey = `${String(rule.index)}|${key}`;
      if (rule.cooldownMs > 0 && within(this.#cooldowns.get(cooldownKey), now, rule.cooldownMs)) {
        continue;
      }
      const options = this.#options(rule, where, reading);
      const handle = this.#vfx.spawn(effect, options);
      this.#recent.set(dedupeKey, now);
      if (rule.cooldownMs > 0) this.#cooldowns.set(cooldownKey, now);
      if (handle === null) continue;
      if (rule.stopOn.length > 0 && options.entity !== undefined) {
        this.#track(options.entity, { handle, stopOn: rule.stopOn });
      }
      spawns.push({ effect, handle, options });
    }
    this.#prune(now);
    return spawns;
  }

  /** Looping effects rules have started and that are still running, per entity (debug overlays). */
  loops(): number {
    let count = 0;
    for (const list of this.#loops.values()) {
      for (const loop of list) if (this.#vfx.alive(loop.handle)) count++;
    }
    return count;
  }

  /**
   * Where a rule spawns: on the anchor entity when it attaches and the entity can be located, else at
   * the entity's current position or the anchor's own position; undefined when there is nowhere.
   */
  #where(rule: VfxCueRule, anchor: CueAnchor | undefined): Placement | undefined {
    if (anchor === undefined) return undefined;
    const { entity, position } = anchor;
    if (entity === undefined) return position && { position };
    const located = this.#locate?.(entity);
    // A located entity that is gone (destroyed this tick) falls back to the anchor's own position.
    if (this.#locate !== undefined && located === undefined) return position && { position };
    if (rule.attach) return { entity };
    const at = located?.position ?? position;
    return at && { position: at };
  }

  #options(rule: VfxCueRule, where: Placement, reading: CueReading): VfxSpawnOptions {
    const options: { -readonly [K in keyof VfxSpawnOptions]: VfxSpawnOptions[K] } = { ...where };
    if (rule.socket !== undefined) options.socket = rule.socket;
    const direction = rule.orientTo && reading.directions?.[rule.orientTo];
    if (direction !== undefined) {
      options.rotation = upTo(direction);
      options.worldRotation = true;
    }
    if (rule.scaleBy) {
      const { fact, min, max, floor } = rule.scaleBy;
      const value = reading.facts[fact];
      if (typeof value === 'number') {
        const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
        options.params = { intensity: floor + (1 - floor) * t };
      }
    }
    return options;
  }

  #track(entity: EntityId, loop: LiveLoop): void {
    const list = (this.#loops.get(entity) ?? []).filter((l) => this.#vfx.alive(l.handle));
    list.push(loop);
    this.#loops.set(entity, list);
  }

  /** Stops the loops on the event's default-anchor entity that this event ends. */
  #stopLoops(event: CueEventName, reading: CueReading): void {
    const entity = reading.anchors[defaultAnchor(event)]?.entity;
    const list = entity === undefined ? undefined : this.#loops.get(entity);
    if (entity === undefined || list === undefined) return;
    const keep = list.filter((loop) => {
      if (!loop.stopOn.includes(event)) return this.#vfx.alive(loop.handle);
      this.#vfx.stop(loop.handle);
      return false;
    });
    if (keep.length === 0) this.#loops.delete(entity);
    else this.#loops.set(entity, keep);
  }

  #prune(now: number): void {
    for (const map of [this.#recent, this.#cooldowns]) {
      if (map.size < PRUNE_AT) continue;
      for (const [key, at] of map) if (now - at >= this.#maxCooldown) map.delete(key);
    }
  }
}

/** Where an effect goes: following an entity, or at a fixed point. */
type Placement = { readonly entity: EntityId } | { readonly position: Vec3 };

function within(last: number | undefined, now: number, windowMs: number): boolean {
  return last !== undefined && now - last < windowMs;
}

/** An event's default anchor: its first (every event has at least one). */
function defaultAnchor(event: CueEventName): string {
  return cueEventSpec(event).anchors[0];
}

/** Identity of where an effect goes, for de-dupe and cooldowns. */
function placementKey(where: Placement): string {
  if ('entity' in where) return `e${String(where.entity)}`;
  const { x, y, z } = where.position;
  return `p${String(x)},${String(y)},${String(z)}`;
}

/**
 * The shortest rotation taking the effect's up axis (+y, its launch cone) onto unit direction `d`;
 * straight down (no unique shortest arc) turns about x.
 */
export function upTo(d: Vec3): Quat {
  const w = 1 + d.y; // 1 + dot(up, d)
  if (w < 1e-6) return { x: 1, y: 0, z: 0, w: 0 };
  // q = (up × d, 1 + up·d), normalised; up × d = (d.z, 0, -d.x).
  const length = Math.hypot(d.z, d.x, w);
  return { x: d.z / length, y: 0, z: -d.x / length, w: w / length };
}
