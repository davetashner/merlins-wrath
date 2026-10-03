// The AI debug overlay's state (mw-e11.17): on or off, the selected agent, and freeze/step of the
// sim. While on it builds one introspection snapshot per sim tick (never per frame: a frozen sim
// rebuilds only when the selection changes), remembers recent noises (each noise's ring and the
// routes to the listeners that heard it) and reads the light level under the cursor. While off it
// builds nothing and listens to nothing: zero overhead (AC-5).
//
// Freeze holds the sim (the game ORs `held` into the frame loop's `simPaused`); `step` freezes and
// asks the loop for exactly one step (`FrameLoop.stepOnce`), so `ai.step` advances one tick (AC-3).
// Neither changes sim state: the sim simply is not stepped, as when a pausing menu is open.

import {
  aiSnapshotter,
  noiseEmitted,
  noiseHeard,
  PlacementComponent,
  type AiDebugSnapshot,
  type AiSnapshotter,
  type EntityId,
  type NoiseEvent,
  type NoiseHeard,
  type Vec3,
  type World,
} from '@sim/index';
import type { AiOverlayModel } from '@render/debug/ai-overlay';
import { overlayModel, pickAgent, type LightProbe, type NoiseMark, type Ray } from './model';

/** Noises remembered at once (older ones drop first). */
export const MAX_NOISES = 16;

/** How long a noise ring lasts, seconds of sim time. */
export const NOISE_RING_S = 2;

export interface AiDebugOptions {
  readonly world: World<never>;
  /** The frame loop (one more step on the next frame). */
  readonly loop: { stepOnce(): void };
  /** Defaults to `aiSnapshotter(world)`. */
  readonly snapshotter?: AiSnapshotter;
  /** The level's light, for the probe; without it there is no probe. */
  readonly light?: { levelAt(point: Vec3): number };
  /** The point under the cursor (the view centre), for the probe. */
  readonly cursorPoint?: () => Vec3 | undefined;
}

/** What the overlay draws this frame, with the snapshot it came from. */
export interface AiDebugFrame {
  readonly snapshot: AiDebugSnapshot;
  readonly model: AiOverlayModel;
}

export class AiDebug {
  readonly #world: World<never>;
  readonly #loop: { stepOnce(): void };
  readonly #snapshotter: AiSnapshotter;
  readonly #light: AiDebugOptions['light'];
  readonly #cursorPoint: AiDebugOptions['cursorPoint'];
  #enabled = false;
  #frozen = false;
  #selected: EntityId | undefined;
  #noises: NoiseMark[] = [];
  #unsubscribe: (() => void)[] = [];
  #frame: AiDebugFrame | undefined;
  #stale = true;

  constructor(options: AiDebugOptions) {
    this.#world = options.world;
    this.#loop = options.loop;
    this.#snapshotter = options.snapshotter ?? aiSnapshotter(options.world);
    this.#light = options.light;
    this.#cursorPoint = options.cursorPoint;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Turns the overlay on or off; off forgets noises and the last frame and stops listening. */
  set enabled(on: boolean) {
    if (on === this.#enabled) return;
    this.#enabled = on;
    this.#stale = true;
    if (on) {
      const events = this.#world.events;
      this.#unsubscribe.push(
        events.on(noiseEmitted, (noise) => {
          this.#noted(noise);
        }),
        events.on(noiseHeard, (heard) => {
          this.#heard(heard);
        }),
      );
      return;
    }
    for (const off of this.#unsubscribe.splice(0)) off();
    this.#noises = [];
    this.#frame = undefined;
  }

  /** The sim is held (no steps but `step`'s). */
  get held(): boolean {
    return this.#frozen;
  }

  get frozen(): boolean {
    return this.#frozen;
  }

  set frozen(on: boolean) {
    this.#frozen = on;
    this.#stale = true;
  }

  /** Freezes the sim (when it is not) and advances it exactly one tick on the next frame. */
  step(): void {
    this.frozen = true;
    this.#loop.stepOnce();
  }

  get selected(): EntityId | undefined {
    return this.#selected;
  }

  /** Selects `entity` (its label shows everything), or clears the selection. */
  set selected(entity: EntityId | undefined) {
    if (entity === this.#selected) return;
    this.#selected = entity;
    this.#stale = true;
  }

  /** Selects the agent `ray` points at (see `pickAgent`); returns it, or undefined for none. */
  pick(ray: Ray): EntityId | undefined {
    const agents = (this.#frame?.snapshot ?? this.#snapshotter.build(this.#selected)).agents;
    const picked = pickAgent(ray, agents);
    if (picked !== undefined) this.selected = picked;
    return picked;
  }

  /** Snapshots built so far (AC-5: none while the overlay is off). */
  get builds(): number {
    return this.#snapshotter.builds;
  }

  /**
   * This frame's overlay, or undefined while off. Rebuilds the snapshot when the sim ticked or the
   * selection or freeze changed; the light probe is read every frame (the camera moves while frozen).
   */
  frame(): AiDebugFrame | undefined {
    if (!this.#enabled) return undefined;
    const world = this.#world;
    const probe = this.#probe();
    const previous = this.#frame;
    if (this.#stale || previous?.snapshot.tick !== world.tick) {
      this.#stale = false;
      const snapshot = this.#snapshotter.build(this.#selected);
      const cutoff = world.tick - NOISE_RING_S * world.clock.hz;
      this.#noises = this.#noises.filter((noise) => noise.tick > cutoff);
      this.#frame = { snapshot, model: this.#model(snapshot, probe) };
      return this.#frame;
    }
    if (!sameProbe(probe, this.#lastProbe)) {
      this.#frame = { snapshot: previous.snapshot, model: this.#model(previous.snapshot, probe) };
    }
    return this.#frame;
  }

  #lastProbe: LightProbe | undefined;

  #model(snapshot: AiDebugSnapshot, probe: LightProbe | undefined): AiOverlayModel {
    this.#lastProbe = probe;
    return overlayModel(snapshot, {
      selected: this.#selected,
      frozen: this.#frozen,
      noises: this.#noises,
      noiseTicks: NOISE_RING_S * this.#world.clock.hz,
      probe,
    });
  }

  #probe(): LightProbe | undefined {
    const point = this.#light === undefined ? undefined : this.#cursorPoint?.();
    if (point === undefined || this.#light === undefined) return undefined;
    const level = Math.round(this.#light.levelAt(point) * 100) / 100;
    const at = {
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
      z: Math.round(point.z * 10) / 10,
    };
    return { point: at, level };
  }

  #noted(noise: NoiseEvent): void {
    this.#noises.push({
      tick: noise.tick,
      position: noise.position,
      loudness: noise.loudness,
      kind: noise.kind,
      routes: [],
      heard: [],
    });
    if (this.#noises.length > MAX_NOISES) this.#noises.shift();
    this.#stale = true;
  }

  #heard(heard: NoiseHeard): void {
    const mark = this.#noises.findLast(
      (n) => n.tick === heard.noise.tick && samePoint(n.position, heard.noise.position),
    );
    const listener = this.#world.get(heard.listener, PlacementComponent);
    if (mark === undefined || listener === undefined) return;
    const route: Vec3[] = [heard.noise.position];
    if (heard.via !== null) route.push(heard.perceived);
    route.push({ x: listener.x, y: listener.y, z: listener.z });
    mark.routes.push(route);
    mark.heard.push(heard.level);
    this.#stale = true;
  }

  /** Stops listening (the overlay is going away). */
  dispose(): void {
    this.enabled = false;
  }
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function sameProbe(a: LightProbe | undefined, b: LightProbe | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.level === b.level && samePoint(a.point, b.point);
}
