// The VFX runtime (mw-e29.1): spawns effects from content definitions, simulates their particles on
// the CPU and fills one instance buffer per batch (texture × blend × flipbook grid) for a renderer to
// draw. Renderer-agnostic and allocation-free once warmed: effect instances come from per-effect
// pools, particles live in their instance's typed arrays, and batch buffers are sized to the particle
// cap up front. src/render/vfx draws the batches with Three.js.
//
// Every spawn goes through the budget (budget.ts): effects beyond 60 m are culled for free, nearer
// ones emit less with distance, and a full budget culls lower-priority effects or refuses the new one.
// A looping effect that is culled or refused is kept dormant (no particles, no budget) and starts
// when it is in range and fits; a one-shot effect gets no handle instead.
//
// Presentation only: randomness comes from the system's own RNG stream (never a sim stream), entity
// positions are read through an injected resolver, and nothing here writes to the sim. Spawning an
// unknown effect returns null and, in dev builds, leaves a magenta marker where it would have been.

import type { EntityId, Quat, Vec3 } from '@sim/index';
import { VFX_QUALITY_TIERS, type VfxBlendMode, type VfxQualityTier } from '@content/index';
import { Rng } from '@sim/index';
import {
  lodScale,
  ParticleBudget,
  VFX_LOD_TIERS,
  VFX_PARTICLE_CAPS,
  type VfxLodTier,
} from './budget.ts';
import { sampleIndex } from './curves.ts';
import {
  burstCount,
  compileEffect,
  effectCost,
  emitterCapacity,
  runsOn,
  tierScale,
  type CompiledEffect,
  type CompiledEmitter,
  type VfxEffectEntry,
} from './effects.ts';
import { at, known } from './indexing.ts';
import { Pool } from './pool.ts';

/** Floats per particle in an instance's arrays: position, velocity, age, life, a random 0–1. */
const STRIDE = 9;

/** Floats per particle in a batch buffer: x, y, z, size, r, g, b, a, flipbook frame. */
export const VFX_INSTANCE_FLOATS = 9;

/** Longest step simulated at once (a tab coming back from the background must not burst). */
export const VFX_MAX_STEP = 0.25;

/** Seconds a dev-build marker for an unknown effect stays visible. */
export const VFX_MARKER_SECONDS = 3;

/** Markers kept at once (oldest replaced first). */
export const VFX_MAX_MARKERS = 16;

/** Default presentation RNG seed. */
export const DEFAULT_VFX_SEED = 0x0f_ec75;

/** Where an entity (optionally one of its sockets) is right now. */
export interface VfxAnchor {
  readonly position: Vec3;
  readonly rotation?: Quat;
}

/** Reads an entity's socket transform; undefined when the entity or socket is gone. Read-only. */
export type VfxAnchorResolver = (
  entity: EntityId,
  socket: string | undefined,
) => VfxAnchor | undefined;

export interface VfxSpawnOptions {
  /** World position; ignored when `entity` is given. */
  readonly position?: Vec3;
  /** Entity to follow: the effect emits from its socket while it exists. */
  readonly entity?: EntityId;
  /** Socket on `entity`; default: the effect's own `socket`, else the entity's origin. */
  readonly socket?: string;
  /** Local rotation of the effect (its up axis is the launch cone's axis). */
  readonly rotation?: Quat;
  /**
   * `rotation` is in world space (e.g. turned to a hit normal) rather than relative to the anchor
   * entity's own rotation. Default false.
   */
  readonly worldRotation?: boolean;
  /** Uniform scale: particle size, launch speed and spawn radius. Default 1. */
  readonly scale?: number;
  readonly params?: {
    /** 0–1 emission multiplier (fewer particles for a weaker hit). Default 1. */
    readonly intensity?: number;
  };
}

/** A spawned effect. Stale handles are ignored by every call. */
export type VfxHandle = number;

/** One draw batch: the particles of every emitter sharing a texture, blend mode and frame grid. */
export interface VfxBatch {
  readonly key: string;
  readonly texture: string;
  readonly blend: VfxBlendMode;
  readonly cols: number;
  readonly rows: number;
  /** `count` particles × VFX_INSTANCE_FLOATS, valid after `update`. */
  readonly data: Float32Array;
  readonly count: number;
}

/** Dev-build markers for unknown effects: `count` × (x, y, z). */
export interface VfxMarkers {
  readonly data: Float32Array;
  readonly count: number;
}

/** Counters for the debug overlay. */
export interface VfxStats {
  readonly tier: VfxQualityTier;
  readonly cap: number;
  /** Particles reserved by running effects. */
  readonly reserved: number;
  /** Particles alive. */
  readonly particles: number;
  /** Running effects. */
  readonly effects: number;
  /** Looping effects waiting to come into range or fit the budget. */
  readonly dormant: number;
  /** Pooled instances ready for reuse. */
  readonly idle: number;
  /** Effect instances ever created. */
  readonly allocations: number;
  /** Spawns culled by distance. */
  readonly culled: number;
  /** Spawns refused by the budget. */
  readonly refused: number;
  /** Effects culled to make room for higher-priority ones. */
  readonly evicted: number;
  /** Spawns of unknown effect ids. */
  readonly missing: number;
}

export interface VfxSystemOptions {
  readonly effects: readonly VfxEffectEntry[];
  readonly tier?: VfxQualityTier;
  /** Live particle caps per tier; default VFX_PARTICLE_CAPS. */
  readonly caps?: Readonly<Record<VfxQualityTier, number>>;
  readonly lod?: readonly VfxLodTier[];
  readonly seed?: number;
  readonly anchors?: VfxAnchorResolver;
  /** Dev build: unknown effects leave a marker. Default: the Vite build mode. */
  readonly dev?: boolean;
  readonly warn?: (message: string) => void;
}

class EmitterState {
  readonly data: Float32Array;
  count = 0;
  /** Most particles this spawn may have alive (its share of the reservation). */
  limit = 0;
  /** Fractional particles owed by the rate. */
  acc = 0;
  nextBurst = 0;
  cycle = 0;

  constructor(readonly emitter: CompiledEmitter) {
    this.data = new Float32Array(Math.max(1, emitter.maxParticles) * STRIDE);
  }
}

class EffectInstance {
  handle = 0;
  priority = 0;
  cost = 0;
  seq = 0;
  age = 0;
  scale = 1;
  size = 1;
  intensity = 1;
  stopped = false;
  dormant = false;
  worldRotation = false;
  entity: EntityId | undefined;
  socket: string | undefined;
  readonly origin = { x: 0, y: 0, z: 0 };
  /** World rotation: the anchor's times the local one. */
  readonly rotation = { x: 0, y: 0, z: 0, w: 1 };
  readonly local = { x: 0, y: 0, z: 0, w: 1 };
  readonly emitters: EmitterState[];

  constructor(readonly effect: CompiledEffect) {
    this.emitters = effect.emitters.map((e) => new EmitterState(e));
  }
}

interface MutableBatch extends VfxBatch {
  count: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Runs VFX for one view. */
export class VfxSystem {
  readonly #effects = new Map<string, CompiledEffect>();
  readonly #pools = new Map<string, Pool<EffectInstance>>();
  readonly #live: EffectInstance[] = [];
  readonly #byHandle = new Map<VfxHandle, EffectInstance>();
  readonly #budget: ParticleBudget<EffectInstance>;
  readonly #caps: Readonly<Record<VfxQualityTier, number>>;
  readonly #lod: readonly VfxLodTier[];
  readonly #rng: Rng;
  readonly #anchors: VfxAnchorResolver;
  readonly #dev: boolean;
  readonly #warn: (message: string) => void;
  readonly #warned = new Set<string>();
  readonly #batches: MutableBatch[] = [];
  readonly #batchOf = new Map<CompiledEmitter, MutableBatch>();
  readonly #markerData = new Float32Array(VFX_MAX_MARKERS * 3);
  readonly #markerExpiry = new Float64Array(VFX_MAX_MARKERS);
  readonly #markers: Mutable<VfxMarkers> = { data: this.#markerData, count: 0 };
  readonly #camera = { x: 0, y: 0, z: 0 };
  readonly #counters = { culled: 0, refused: 0, evicted: 0, missing: 0, particles: 0 };
  #tier: VfxQualityTier;
  #time = 0;
  #nextHandle = 1;
  #seq = 0;
  #updating = false;

  constructor(options: VfxSystemOptions) {
    this.#tier = options.tier ?? 'high';
    this.#caps = options.caps ?? VFX_PARTICLE_CAPS;
    this.#lod = options.lod ?? VFX_LOD_TIERS;
    this.#budget = new ParticleBudget(this.#caps[this.#tier]);
    this.#rng = Rng.create(options.seed ?? DEFAULT_VFX_SEED).stream('presentation.vfx');
    this.#anchors = options.anchors ?? (() => undefined);
    this.#dev = options.dev ?? import.meta.env.DEV;
    this.#warn =
      options.warn ??
      ((message) => {
        console.warn(message);
      });
    const capacity = Math.max(...VFX_QUALITY_TIERS.map((t) => this.#caps[t]));
    const byKey = new Map<string, MutableBatch>();
    for (const def of options.effects) {
      const effect = compileEffect(def);
      this.#effects.set(effect.id, effect);
      this.#pools.set(effect.id, new Pool(() => new EffectInstance(effect)));
      for (const emitter of effect.emitters) {
        let batch = byKey.get(emitter.batch.key);
        if (batch === undefined) {
          batch = {
            ...emitter.batch,
            data: new Float32Array(capacity * VFX_INSTANCE_FLOATS),
            count: 0,
          };
          byKey.set(batch.key, batch);
          this.#batches.push(batch);
        }
        this.#batchOf.set(emitter, batch);
      }
    }
  }

  /** Every draw batch (most may be empty); contents are valid after `update`. */
  get batches(): readonly VfxBatch[] {
    return this.#batches;
  }

  /** Dev-build markers for unknown effects spawned in the last few seconds. */
  get markers(): VfxMarkers {
    return this.#markers;
  }

  get tier(): VfxQualityTier {
    return this.#tier;
  }

  /** Whether `effectId` is a known effect. */
  has(effectId: string): boolean {
    return this.#effects.has(effectId);
  }

  /** Pre-creates `count` idle instances of an effect (e.g. while a level loads). */
  warm(effectId: string, count: number): void {
    this.#pools.get(effectId)?.warm(count);
  }

  /** Instances an effect's pool has ever created (0 for an unknown effect). */
  allocations(effectId: string): number {
    return this.#pools.get(effectId)?.allocations ?? 0;
  }

  /** Switches quality tier: new cap, lower-priority effects culled to fit; new spawns use its rates. */
  setTier(tier: VfxQualityTier): void {
    this.#tier = tier;
    for (const victim of this.#budget.setCap(this.#caps[tier])) this.#evict(victim);
  }

  /** Where the camera is, for distance culling of the next spawns (update sets it too). */
  setCamera(position: Vec3): void {
    this.#camera.x = position.x;
    this.#camera.y = position.y;
    this.#camera.z = position.z;
  }

  /**
   * Spawns an effect at a position or on an entity's socket. Returns null (and never throws) when
   * the effect is unknown, has nowhere to be, is a one-shot culled by distance or refused by the
   * budget, or emits nothing on this tier.
   */
  spawn(effectId: string, options: VfxSpawnOptions = {}): VfxHandle | null {
    try {
      return this.#spawn(effectId, options);
    } catch (error) {
      this.#warn(`vfx: spawning "${effectId}" failed (${String(error)})`);
      return null;
    }
  }

  #spawn(effectId: string, options: VfxSpawnOptions): VfxHandle | null {
    const effect = this.#effects.get(effectId);
    const socket = options.socket ?? effect?.socket;
    const anchor =
      options.entity === undefined
        ? options.position && { position: options.position }
        : this.#anchors(options.entity, socket);
    if (effect === undefined) {
      this.#missing(effectId, anchor?.position);
      return null;
    }
    if (anchor === undefined) {
      this.#warnOnce(
        `nowhere:${effectId}`,
        `vfx: "${effectId}" spawned without a position or live entity`,
      );
      return null;
    }
    const intensity = clamp01(options.params?.intensity ?? 1);
    if (effectCost(effect, this.#tier, tierScale(effect, this.#tier) * intensity) === 0)
      return null;

    const pool = known(this.#pools.get(effectId)); // one pool per effect
    const inst = pool.acquire();
    inst.handle = this.#nextHandle++;
    inst.age = 0;
    inst.stopped = false;
    inst.dormant = true;
    inst.cost = 0;
    inst.priority = effect.priority;
    inst.intensity = intensity;
    inst.size = options.scale ?? 1;
    inst.entity = options.entity;
    inst.socket = socket;
    inst.worldRotation = options.worldRotation ?? false;
    copyQuat(inst.local, options.rotation ?? IDENTITY);
    this.#place(inst, anchor);
    for (const s of inst.emitters) {
      s.count = 0;
      s.acc = 0;
      s.nextBurst = 0;
      s.cycle = 0;
    }
    if (!this.#activate(inst, true) && !effect.loop) {
      pool.release(inst);
      return null;
    }
    this.#live.push(inst);
    this.#byHandle.set(inst.handle, inst);
    return inst.handle;
  }

  /**
   * Admits a dormant instance if it is in range and fits the budget: reserves its particles at the
   * current tier and distance LOD. `counting` records a cull or refusal in the stats (spawns only).
   */
  #activate(inst: EffectInstance, counting: boolean): boolean {
    const lod = lodScale(this.#distance(inst), this.#lod);
    if (lod === 0) {
      if (counting) this.#counters.culled++;
      return false;
    }
    const effect = inst.effect;
    const scale = lod * tierScale(effect, this.#tier) * inst.intensity;
    const cost = effectCost(effect, this.#tier, scale);
    const victims = this.#budget.request(effect.priority, cost);
    if (victims === undefined) {
      if (counting) this.#counters.refused++;
      return false;
    }
    // Evicting only removes budget entries; the reused victims array stays intact.
    for (const victim of victims) this.#evict(victim);
    inst.scale = scale;
    inst.cost = cost;
    inst.seq = this.#seq++;
    inst.dormant = false;
    for (const s of inst.emitters) {
      s.limit = runsOn(s.emitter, this.#tier) ? emitterCapacity(s.emitter, effect, scale) : 0;
    }
    this.#budget.add(inst);
    return true;
  }

  /** Puts a running instance to sleep: its particles vanish and its reservation is freed. */
  #sleep(inst: EffectInstance): void {
    this.#budget.remove(inst);
    inst.dormant = true;
    inst.cost = 0;
    for (const s of inst.emitters) s.count = 0;
  }

  #evict(inst: EffectInstance): void {
    this.#counters.evicted++;
    if (inst.effect.loop) this.#sleep(inst);
    else this.#kill(inst);
  }

  /** Stops emitting; the effect ends once its particles have died. A dormant effect just ends. */
  stop(handle: VfxHandle): void {
    const inst = this.#byHandle.get(handle);
    if (inst === undefined) return;
    if (inst.dormant) this.#kill(inst);
    else inst.stopped = true;
  }

  /** Removes an effect and its particles at once. */
  kill(handle: VfxHandle): void {
    const inst = this.#byHandle.get(handle);
    if (inst !== undefined) this.#kill(inst);
  }

  /** Whether the handle's effect is still running or dormant. */
  alive(handle: VfxHandle): boolean {
    return this.#byHandle.has(handle);
  }

  #kill(inst: EffectInstance): void {
    this.#budget.remove(inst);
    this.#byHandle.delete(inst.handle);
    inst.handle = 0;
    for (const s of inst.emitters) s.count = 0;
    if (this.#updating) return; // update() recycles it when it reaches it
    this.#live.splice(this.#live.indexOf(inst), 1);
    this.#recycle(inst);
  }

  #recycle(inst: EffectInstance): void {
    known(this.#pools.get(inst.effect.id)).release(inst);
  }

  /**
   * Advances every effect by `dt` seconds with the camera at `camera`, then refills the batches.
   * Call once per rendered frame.
   */
  update(dt: number, camera: Vec3): void {
    this.setCamera(camera);
    const step = Math.min(Math.max(dt, 0), VFX_MAX_STEP);
    this.#time += step;
    this.#updating = true;
    try {
      for (let i = 0; i < this.#live.length;) {
        const inst = at(this.#live, i);
        if (inst.handle !== 0) this.#step(inst, step);
        if (inst.handle === 0) {
          // Killed (here or earlier this frame): swap-remove and recycle.
          const last = known(this.#live.pop());
          if (last !== inst) this.#live[i] = last;
          this.#recycle(inst);
          continue;
        }
        i++;
      }
    } finally {
      this.#updating = false;
    }
    this.#fillBatches();
    this.#expireMarkers();
  }

  #step(inst: EffectInstance, dt: number): void {
    const effect = inst.effect;
    const before = inst.age;
    inst.age += dt;
    if (inst.entity !== undefined && !inst.stopped) {
      const anchor = this.#anchors(inst.entity, inst.socket);
      if (anchor === undefined)
        inst.stopped = true; // the entity is gone: let the particles finish
      else this.#place(inst, anchor);
    }
    if (effect.loop) {
      if (inst.dormant) {
        if (inst.stopped) this.#kill(inst);
        else this.#activate(inst, false);
        return;
      }
      if (lodScale(this.#distance(inst), this.#lod) === 0) {
        this.#sleep(inst);
        return;
      }
    }
    const end = effect.loop ? Infinity : effect.duration;
    const emitting = !inst.stopped && before < end;
    let alive = 0;
    for (const s of inst.emitters) {
      simulate(s, dt);
      if (emitting && s.limit > 0) this.#emit(inst, s, before, Math.min(inst.age, end));
      alive += s.count;
    }
    if (alive === 0 && !(emitting && inst.age < end)) this.#kill(inst);
  }

  /** Emits `s`'s rate particles for the time from `from` to `to` and any bursts now due. */
  #emit(inst: EffectInstance, s: EmitterState, from: number, to: number): void {
    const { emitter } = s;
    const effect = inst.effect;
    s.acc += emitter.rate * inst.scale * (to - from);
    const n = Math.floor(s.acc);
    s.acc -= n;
    for (let k = 0; k < n; k++) this.#particle(inst, s);
    const bursts = emitter.bursts;
    for (;;) {
      const base = s.cycle * effect.duration;
      let burst = bursts[s.nextBurst];
      while (burst !== undefined && base + burst.at <= inst.age) {
        const count = burstCount(burst.count, inst.scale);
        for (let k = 0; k < count; k++) this.#particle(inst, s);
        burst = bursts[++s.nextBurst];
      }
      if (!effect.loop || inst.age < base + effect.duration) return;
      s.cycle++;
      s.nextBurst = 0;
    }
  }

  /** One new particle, unless the emitter is at its limit. */
  #particle(inst: EffectInstance, s: EmitterState): void {
    if (s.count >= s.limit) return;
    const { emitter, data } = s;
    const rng = this.#rng;
    const i = s.count * STRIDE;
    s.count++;
    const q = inst.rotation;
    // Start: uniform in a sphere of spawnRadius around the origin.
    let px = 0;
    let py = 0;
    let pz = 0;
    if (emitter.spawnRadius > 0) {
      const r = emitter.spawnRadius * inst.size * Math.cbrt(rng.float());
      const z = rng.float() * 2 - 1;
      const phi = rng.float() * Math.PI * 2;
      const ring = Math.sqrt(1 - z * z) * r;
      px = ring * Math.cos(phi);
      py = z * r;
      pz = ring * Math.sin(phi);
    }
    // Direction: uniform in the cone around the local up axis, then rotated into the world.
    const cosT = 1 - rng.float() * (1 - emitter.cosCone);
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = rng.float() * Math.PI * 2;
    const speed = lerp(emitter.speedMin, emitter.speedMax, rng.float()) * inst.size;
    data[i] = inst.origin.x + rotX(q, px, py, pz);
    data[i + 1] = inst.origin.y + rotY(q, px, py, pz);
    data[i + 2] = inst.origin.z + rotZ(q, px, py, pz);
    const dx = sinT * Math.cos(phi);
    const dz = sinT * Math.sin(phi);
    data[i + 3] = rotX(q, dx, cosT, dz) * speed;
    data[i + 4] = rotY(q, dx, cosT, dz) * speed;
    data[i + 5] = rotZ(q, dx, cosT, dz) * speed;
    data[i + 6] = 0;
    data[i + 7] = lerp(emitter.lifeMin, emitter.lifeMax, rng.float());
    data[i + 8] = rng.float();
  }

  #fillBatches(): void {
    for (const batch of this.#batches) batch.count = 0;
    let particles = 0;
    for (const inst of this.#live) {
      for (const s of inst.emitters) {
        if (s.count === 0) continue;
        particles += s.count;
        writeParticles(s, inst.size, known(this.#batchOf.get(s.emitter)));
      }
    }
    this.#counters.particles = particles;
  }

  #place(inst: EffectInstance, anchor: VfxAnchor): void {
    inst.origin.x = anchor.position.x;
    inst.origin.y = anchor.position.y;
    inst.origin.z = anchor.position.z;
    if (inst.worldRotation) copyQuat(inst.rotation, inst.local);
    else multiplyQuat(inst.rotation, anchor.rotation ?? IDENTITY, inst.local);
  }

  #distance(inst: EffectInstance): number {
    const c = this.#camera;
    return Math.hypot(inst.origin.x - c.x, inst.origin.y - c.y, inst.origin.z - c.z);
  }

  #missing(effectId: string, position: Vec3 | undefined): void {
    this.#counters.missing++;
    this.#warnOnce(`missing:${effectId}`, `vfx: unknown effect "${effectId}"`);
    if (!this.#dev || position === undefined) return;
    // Replace the oldest marker when all are in use.
    let slot = this.#markers.count;
    if (slot === VFX_MAX_MARKERS) {
      slot = 0;
      for (let m = 1; m < VFX_MAX_MARKERS; m++) {
        if (at(this.#markerExpiry, m) < at(this.#markerExpiry, slot)) slot = m;
      }
    } else {
      this.#markers.count++;
    }
    this.#markerData[slot * 3] = position.x;
    this.#markerData[slot * 3 + 1] = position.y;
    this.#markerData[slot * 3 + 2] = position.z;
    this.#markerExpiry[slot] = this.#time + VFX_MARKER_SECONDS;
  }

  #expireMarkers(): void {
    const data = this.#markerData;
    for (let m = 0; m < this.#markers.count;) {
      if (at(this.#markerExpiry, m) > this.#time) {
        m++;
        continue;
      }
      const last = --this.#markers.count;
      data.copyWithin(m * 3, last * 3, last * 3 + 3);
      this.#markerExpiry[m] = at(this.#markerExpiry, last);
    }
  }

  #warnOnce(key: string, message: string): void {
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    this.#warn(message);
  }

  stats(): VfxStats {
    let effects = 0;
    let dormant = 0;
    for (const inst of this.#live) {
      if (inst.dormant) dormant++;
      else effects++;
    }
    let idle = 0;
    let allocations = 0;
    for (const pool of this.#pools.values()) {
      idle += pool.idle;
      allocations += pool.allocations;
    }
    const { culled, refused, evicted, missing, particles } = this.#counters;
    return {
      tier: this.#tier,
      cap: this.#budget.cap,
      reserved: this.#budget.used,
      particles,
      effects,
      dormant,
      idle,
      allocations,
      culled,
      refused,
      evicted,
      missing,
    };
  }
}

/** Ages, moves and retires the particles of one emitter. */
function simulate(s: EmitterState, dt: number): void {
  const { data, emitter } = s;
  const damp = Math.max(0, 1 - emitter.drag * dt);
  const fall = emitter.gravity * dt;
  for (let p = 0; p < s.count;) {
    const i = p * STRIDE;
    const age = f32(data, i + 6) + dt;
    if (age >= f32(data, i + 7)) {
      s.count--;
      data.copyWithin(i, s.count * STRIDE, s.count * STRIDE + STRIDE);
      continue;
    }
    data[i + 6] = age;
    const vx = f32(data, i + 3) * damp;
    const vy = (f32(data, i + 4) - fall) * damp;
    const vz = f32(data, i + 5) * damp;
    data[i + 3] = vx;
    data[i + 4] = vy;
    data[i + 5] = vz;
    data[i] = f32(data, i) + vx * dt;
    data[i + 1] = f32(data, i + 1) + vy * dt;
    data[i + 2] = f32(data, i + 2) + vz * dt;
    p++;
  }
}

/** Appends an emitter's particles to its batch: position, size, colour, alpha, frame. */
function writeParticles(s: EmitterState, sizeScale: number, batch: MutableBatch): void {
  const { data, emitter } = s;
  const out = batch.data;
  let o = batch.count * VFX_INSTANCE_FLOATS;
  for (let p = 0; p < s.count; p++) {
    const i = p * STRIDE;
    const age = f32(data, i + 6);
    const t = age / f32(data, i + 7);
    const k = sampleIndex(t);
    out[o] = f32(data, i);
    out[o + 1] = f32(data, i + 1);
    out[o + 2] = f32(data, i + 2);
    out[o + 3] = f32(emitter.size, k) * sizeScale;
    out[o + 4] = f32(emitter.colour, k * 3);
    out[o + 5] = f32(emitter.colour, k * 3 + 1);
    out[o + 6] = f32(emitter.colour, k * 3 + 2);
    out[o + 7] = f32(emitter.alpha, k);
    out[o + 8] = flipbookFrame(emitter, age, t, f32(data, i + 8));
    o += VFX_INSTANCE_FLOATS;
  }
  batch.count += s.count;
}

/** The flipbook frame of a particle: by fps from a random start, or once over its life. */
export function flipbookFrame(
  emitter: Pick<CompiledEmitter, 'frames' | 'fps'>,
  age: number,
  t: number,
  random: number,
): number {
  const { frames, fps } = emitter;
  if (frames === 1) return 0;
  if (fps > 0) return Math.floor(age * fps + random * frames) % frames;
  return Math.min(frames - 1, Math.floor(t * frames));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function copyQuat(out: Mutable<Quat>, q: Quat): void {
  out.x = q.x;
  out.y = q.y;
  out.z = q.z;
  out.w = q.w;
}

/** out = a × b (apply b, then a). */
function multiplyQuat(out: Mutable<Quat>, a: Quat, b: Quat): void {
  const { x: ax, y: ay, z: az, w: aw } = a;
  const { x: bx, y: by, z: bz, w: bw } = b;
  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
}

// Rotating (x, y, z) by unit quaternion q: v + 2w(q×v) + 2q×(q×v), one component at a time so no
// temporary object is allocated per particle.
function rotX(q: Quat, x: number, y: number, z: number): number {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return x + q.w * tx + (q.y * tz - q.z * ty);
}

function rotY(q: Quat, x: number, y: number, z: number): number {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return y + q.w * ty + (q.z * tx - q.x * tz);
}

function rotZ(q: Quat, x: number, y: number, z: number): number {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return z + q.w * tz + (q.x * ty - q.y * tx);
}

/**
 * A typed-array read for the particle loops. Same as `at`, but only ever called with Float32Arrays, so
 * the JIT keeps it monomorphic and inlines it (the shared `at` runs 4× slower here).
 */
function f32<T>(a: ArrayLike<T>, i: number): T {
  return a[i] as T;
}
