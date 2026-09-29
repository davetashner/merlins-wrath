// The audio cue bridge (mw-e28.3): subscribes to the sim's event bus and turns events into sounds
// by resolving cue sheet rules (content type `cue-sheet`), so no gameplay code calls play(). Per
// event it reads anchors and facts (events.ts), picks the most specific rule per layer (matcher.ts),
// fills `{fact}` cue templates, then applies the rule's presentation: variant choice, pitch and
// volume jitter from its own presentation RNG (never a sim RNG stream), volume scaling by a number
// fact, per-rule cooldowns and a 30 ms de-dupe of identical cues on one anchor.
//
// Audio never feeds back into the sim: the bridge only reads payloads and material lookups, owns all
// of its state, and catches its own errors so a broken rule can't throw into the sim's event flush.

import type { PlayOptions } from '@audio/index';
import { dbToGain } from '@audio/index';
import {
  CUE_DEDUPE_MS,
  cueEventSpec,
  type CueEventName,
  type CueRuleDef,
  type MaterialDef,
} from '@content/index';
import { readProperty, Rng, type EntityId, type EventType, type World } from '@sim/index';
import { CUE_EVENT_BINDINGS, type CueAnchor, type CueLookups, type CueReading } from './events.ts';
import { CueRuleSet, interpolateCue } from './matcher.ts';

/** What the bridge plays through (the AudioEngine satisfies it). */
export interface CuePlayer {
  play(cueId: string, options: PlayOptions): unknown;
}

/** Where the bridge subscribes (the sim World's `events` bus satisfies it). */
export interface CueEventSource {
  on<T>(type: EventType<T>, handler: (payload: T) => void): () => void;
}

/** Default presentation RNG seed. */
export const DEFAULT_CUE_SEED = 0x5eed_cafe;

export interface AudioCueBridgeOptions {
  /** Loaded cue sheets; rules keep sheet order, then rule order (the specificity tie-break). */
  readonly sheets: readonly { readonly rules: readonly CueRuleDef[] }[];
  readonly player: CuePlayer;
  /** Presentation time in ms (sim time or the frame clock), for cooldowns and the de-dupe window. */
  readonly now: () => number;
  /** Seed of the presentation RNG (variants, jitter). */
  readonly seed?: number;
  /** Material lookups for hit facts; without them material facts are absent. */
  readonly lookups?: CueLookups;
  /** Variant count of a cue in the sound manifest, e.g. `soundVariantCount(registry)`. */
  readonly variantCount?: (cueId: string) => number | undefined;
  readonly warn?: (message: string) => void;
}

/** What one `handle` call did, for tests and debug overlays. */
export interface CuePlay {
  readonly cue: string;
  readonly options: PlayOptions;
}

const unknown = (): undefined => undefined;
const NO_LOOKUPS: CueLookups = { materialOf: unknown, impactClassOf: unknown };

/** De-dupe and cooldown entries older than this are pruned once the maps grow. */
const PRUNE_AT = 512;

interface IndexedRule extends CueRuleDef {
  readonly index: number;
}

/** Plays cue sheet rules for sim events. One per world. */
export class AudioCueBridge {
  readonly #rules: CueRuleSet<IndexedRule>;
  readonly #player: CuePlayer;
  readonly #now: () => number;
  readonly #rng: Rng;
  readonly #lookups: CueLookups;
  readonly #variantCount: (cueId: string) => number | undefined;
  readonly #warn: (message: string) => void;
  /** `cue|anchor` → last play time. */
  readonly #recent = new Map<string, number>();
  /** `rule|anchor` → last play time (rules with a cooldown only). */
  readonly #cooldowns = new Map<string, number>();
  /** cue → last variant index, to avoid immediate repeats. */
  readonly #lastVariant = new Map<string, number>();
  readonly #maxCooldown: number;

  constructor(options: AudioCueBridgeOptions) {
    const rules = options.sheets.flatMap((sheet) => sheet.rules);
    this.#rules = new CueRuleSet(rules.map((rule, index) => ({ ...rule, index })));
    this.#maxCooldown = Math.max(CUE_DEDUPE_MS, ...rules.map((r) => r.cooldownMs));
    this.#player = options.player;
    this.#now = options.now;
    this.#rng = Rng.create(options.seed ?? DEFAULT_CUE_SEED).stream('presentation.audio-cues');
    this.#lookups = options.lookups ?? NO_LOOKUPS;
    this.#variantCount = options.variantCount ?? (() => undefined);
    this.#warn =
      options.warn ??
      ((message) => {
        console.warn(message);
      });
  }

  /** Subscribes to every event some rule uses; returns a function that unsubscribes them all. */
  attach(events: CueEventSource): () => void {
    const offs = this.#rules.events().map((name) => {
      const event = name as CueEventName; // rule events are validated CueEventNames
      const binding = CUE_EVENT_BINDINGS[event];
      return events.on(binding.type, (payload) => {
        try {
          this.handle(event, binding.read(payload, this.#lookups));
        } catch (error) {
          this.#warn(`audio cues: ${event} failed (${String(error)})`);
        }
      });
    });
    return () => {
      for (const off of offs) off();
    };
  }

  /** Resolves and plays the rules for one event occurrence; returns what was played. */
  handle(event: CueEventName, reading: CueReading): CuePlay[] {
    const now = this.#now();
    const plays: CuePlay[] = [];
    for (const rule of this.#rules.resolve(event, reading.facts)) {
      const cue = interpolateCue(rule.cue, reading.facts);
      if (cue === undefined) continue;
      const anchor = reading.anchors[rule.at ?? defaultAnchor(event)];
      const where = anchorKey(anchor);
      const dedupeKey = `${cue}|${where}`;
      if (within(this.#recent.get(dedupeKey), now, CUE_DEDUPE_MS)) continue;
      const cooldownKey = `${String(rule.index)}|${where}`;
      if (rule.cooldownMs > 0 && within(this.#cooldowns.get(cooldownKey), now, rule.cooldownMs)) {
        continue;
      }
      const options = this.#options(rule, cue, anchor, reading);
      this.#player.play(cue, options);
      this.#recent.set(dedupeKey, now);
      if (rule.cooldownMs > 0) this.#cooldowns.set(cooldownKey, now);
      plays.push({ cue, options });
    }
    this.#prune(now);
    return plays;
  }

  #options(rule: CueRuleDef, cue: string, anchor: CueAnchor | undefined, reading: CueReading) {
    const options: {
      -readonly [K in keyof PlayOptions]: PlayOptions[K];
    } = {};
    if (anchor?.entity !== undefined) options.entity = anchor.entity;
    if (anchor?.position !== undefined) options.position = anchor.position;
    let db = rule.volumeDb + this.#spread(rule.volumeJitterDb);
    if (rule.volumeBy) {
      const { fact, min, max, floorDb } = rule.volumeBy;
      const value = reading.facts[fact];
      if (typeof value === 'number') {
        const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
        db += floorDb * (1 - t);
      }
    }
    options.volume = dbToGain(db);
    options.pitch = 1 + this.#spread(rule.pitchJitter);
    const variant = this.#variant(rule, cue);
    if (variant !== undefined) options.variant = variant;
    if (rule.priority !== undefined) options.priority = rule.priority;
    return options;
  }

  /** Uniform in [-amount, amount]; 0 without drawing when amount is 0. */
  #spread(amount: number): number {
    return amount === 0 ? 0 : (this.#rng.float() * 2 - 1) * amount;
  }

  /** A random variant index, never the previous one; undefined leaves the engine's round-robin. */
  #variant(rule: CueRuleDef, cue: string): number | undefined {
    const known = this.#variantCount(cue);
    const count =
      rule.variants === undefined ? known : Math.min(rule.variants, known ?? rule.variants);
    if (count === undefined) return undefined;
    const last = this.#lastVariant.get(cue);
    let pick = 0;
    if (count > 1) {
      const avoid = last !== undefined && last < count;
      pick = this.#rng.int(0, avoid ? count - 2 : count - 1);
      if (avoid && pick >= last) pick++;
    }
    this.#lastVariant.set(cue, pick);
    return pick;
  }

  #prune(now: number): void {
    for (const map of [this.#recent, this.#cooldowns]) {
      if (map.size < PRUNE_AT) continue;
      for (const [key, at] of map) if (now - at >= this.#maxCooldown) map.delete(key);
    }
  }
}

function within(last: number | undefined, now: number, windowMs: number): boolean {
  return last !== undefined && now - last < windowMs;
}

/** An event's default anchor: its first (every event has at least one). */
function defaultAnchor(event: CueEventName): string {
  return cueEventSpec(event).anchors[0];
}

/** Identity of an anchor for de-dupe and cooldowns. */
function anchorKey(anchor: CueAnchor | undefined): string {
  if (anchor?.entity !== undefined) return `e${String(anchor.entity)}`;
  if (anchor?.position !== undefined) {
    const { x, y, z } = anchor.position;
    return `p${String(x)},${String(y)},${String(z)}`;
  }
  return '-';
}

/** Variant counts from a sound registry (the engine's `SoundRegistry` satisfies it). */
export function soundVariantCount(registry: {
  get(id: string): { readonly variants: readonly string[] } | undefined;
}): (cueId: string) => number | undefined {
  return (cueId) => registry.get(cueId)?.variants.length;
}

/** Prefix of impact sound set ids (material `impactSound`). */
const IMPACT_PREFIX = 'sfx-impact-';

/**
 * Material lookups from a world with world properties registered (`registerWorldProperties`) and
 * the loaded materials: an entity's `material` property (the default "generic" when unset) and each
 * material's impact class, e.g. iron → "metal".
 */
export function worldCueLookups(
  world: World<never>,
  materials: readonly Pick<MaterialDef, 'id' | 'impactSound'>[],
): CueLookups {
  const classes = new Map(materials.map((m) => [m.id, m.impactSound.slice(IMPACT_PREFIX.length)]));
  return {
    materialOf: (entity: EntityId) =>
      world.isAlive(entity) ? readProperty(world, entity, 'material') : undefined,
    impactClassOf: (material) => classes.get(material),
  };
}
