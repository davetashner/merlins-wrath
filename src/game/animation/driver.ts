// Drives every animated character from the sim (mw-e02.20). After each sim step it captures each
// entity's parameters (read-only, see sim-params.ts); on each drawn frame it interpolates the running
// move's tick between the last two steps (exactly as render sync interpolates transforms, so the
// pose and the position shown agree), advances the entity's AnimationController by the frame time
// and applies the pose. It never writes to the sim: animation cannot decide gameplay.
//
// Hit-stop needs nothing special: a frozen entity's move tick stops advancing in the sim and its time
// scale is 0, so action poses and every clip and crossfade hold, then resume from the same frame.
//
// LOD: characters farther than `lod.near` metres from the focus (the camera) update only every
// `lod.interval` frames, with the time they skipped, staggered so they do not all update on the same
// frame. The dev state probe (`probe`) reports each character's layer states and the order states
// were entered in, for the e2e test.

import type { EntityId } from '@sim/index';
import {
  createPose,
  type ActionSample,
  type AnimationController,
  type AnimProbe,
  type Pose,
} from '@render/animation/index';
import type { SimView, Vec3 } from '../loop/render-sync';
import type { SimAnimReader, SimAnimSample } from './sim-params';

/** Level of detail by distance. */
export interface AnimationLod {
  /** Characters within this distance of the focus update every frame, metres. */
  readonly near: number;
  /** Farther characters update every this many frames. */
  readonly interval: number;
}

/** Characters beyond 30 m update at a quarter rate (15 Hz at 60 fps). */
export const DEFAULT_ANIMATION_LOD: AnimationLod = Object.freeze({ near: 30, interval: 4 });

/** Most state entries the probe keeps per character. */
export const PROBE_HISTORY = 32;

export interface AnimatedCharacter {
  /** Probe key, e.g. "greybox-humanoid". */
  readonly name: string;
  readonly controller: AnimationController;
  /** Reads the entity's parameters after each sim step. */
  readonly read: SimAnimReader;
  /** Writes a pose into the character's view (bone rotations only). */
  readonly apply: (pose: Pose) => void;
  /** Where the character is drawn (for LOD), or undefined when unknown (treated as near). */
  readonly locate?: () => Vec3 | undefined;
}

/** A character's probe: its layers now and the states it entered, oldest first. */
export interface CharacterProbe extends AnimProbe {
  readonly history: readonly string[];
}

interface Entry {
  readonly character: AnimatedCharacter;
  readonly pose: Pose;
  readonly slot: number;
  previous: SimAnimSample | undefined;
  current: SimAnimSample | undefined;
  pending: number;
  readonly entered: string[];
  readonly states: string[];
}

/** Per-frame counts, for the perf budget and tests. */
export interface AnimationFrameStats {
  readonly updated: number;
  readonly deferred: number;
}

export class AnimationDriver {
  private readonly entries = new Map<EntityId, Entry>();
  private frames = 0;
  private slots = 0;
  private stats: AnimationFrameStats = { updated: 0, deferred: 0 };

  constructor(
    private readonly view: SimView,
    private readonly lod: AnimationLod = DEFAULT_ANIMATION_LOD,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** What the last frame did. */
  get lastFrame(): AnimationFrameStats {
    return this.stats;
  }

  /** Animates `entity`; its parameters are read now so the first frame has them. */
  add(entity: EntityId, character: AnimatedCharacter): void {
    const sample = character.read(this.view, entity);
    this.entries.set(entity, {
      character,
      pose: createPose(character.controller.graph.rig.bones.length),
      slot: this.slots++,
      previous: sample,
      current: sample,
      pending: 0,
      entered: [],
      states: [],
    });
  }

  remove(entity: EntityId): boolean {
    return this.entries.delete(entity);
  }

  /** Records every character's parameters after a sim step (call from the loop's onStep). */
  capture(): void {
    for (const [entity, entry] of this.entries) {
      entry.previous = entry.current;
      entry.current = entry.character.read(this.view, entity);
    }
  }

  /**
   * Animates one drawn frame: `alpha` is the loop's interpolation fraction, `seconds` the frame time
   * and `focus` the point LOD distances are measured from. Characters whose entity is gone are
   * dropped.
   */
  frame(alpha: number, seconds: number, focus?: Vec3): void {
    let updated = 0;
    let deferred = 0;
    const frame = this.frames++;
    for (const [entity, entry] of this.entries) {
      if (!this.view.isAlive(entity)) {
        this.entries.delete(entity);
        continue;
      }
      const sample = entry.current;
      if (sample === undefined) continue;
      entry.pending += seconds;
      if (this.isFar(entry, focus) && (frame + entry.slot) % this.lod.interval !== 0) {
        deferred += 1;
        continue;
      }
      const { controller } = entry.character;
      controller.update(entry.pending, {
        values: sample.values,
        timeScale: sample.timeScale,
        action: interpolateAction(entry.previous, sample, alpha),
      });
      entry.pending = 0;
      controller.evaluate(entry.pose);
      entry.character.apply(entry.pose);
      this.record(entry, controller.probe());
      updated += 1;
    }
    this.stats = { updated, deferred };
  }

  /** The dev state probe: every character by name. */
  probe(): Record<string, CharacterProbe> {
    const out: Record<string, CharacterProbe> = {};
    for (const entry of this.entries.values()) {
      out[entry.character.name] = {
        ...entry.character.controller.probe(),
        history: [...entry.entered],
      };
    }
    return out;
  }

  private isFar(entry: Entry, focus: Vec3 | undefined): boolean {
    const at = focus === undefined ? undefined : entry.character.locate?.();
    if (focus === undefined || at === undefined) return false;
    const dx = at.x - focus.x;
    const dy = at.y - focus.y;
    const dz = at.z - focus.z;
    return dx * dx + dy * dy + dz * dz > this.lod.near * this.lod.near;
  }

  /** Appends each layer's newly entered state (other than "none") to the history. */
  private record(entry: Entry, probe: AnimProbe): void {
    probe.layers.forEach((layer, i) => {
      if (entry.states[i] === layer.state) return;
      entry.states[i] = layer.state;
      if (layer.state === 'none') return;
      entry.entered.push(layer.state);
      if (entry.entered.length > PROBE_HISTORY) entry.entered.shift();
    });
  }
}

/**
 * The running move as a frame shows it: its tick interpolated `alpha` of the way from the previous
 * step to the latest (a run that started at the latest step shows its latest tick).
 */
export function interpolateAction(
  previous: SimAnimSample | undefined,
  current: SimAnimSample,
  alpha: number,
): ActionSample | null {
  const now = current.action;
  if (now === null) return null;
  const before = previous?.action;
  const from = before?.key === now.key ? before.tick : now.tick;
  return {
    move: now.move,
    clip: now.clip,
    key: now.key,
    moveTick: from + (now.tick - from) * alpha,
    activeFrom: now.activeFrom,
    totalTicks: now.totalTicks,
  };
}
