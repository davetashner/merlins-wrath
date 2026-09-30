// The layered animation state machine (mw-e02.20): one runtime for every rig, driven by a graph from
// content (anim-graph) and parameters read from the sim. It never writes to the sim: the game reads
// sim state into AnimParams each frame (src/game/animation) and the controller turns them into a pose.
//
// Layers are evaluated bottom-up. The first (base) layer produces a full pose; override layers
// replace it on their mask's bones by their weight; additive layers add their rotations on top. Each
// layer is a state machine: transitions are tried in order and the first whose `from` and conditions
// match crossfades to its target over `duration` seconds. A crossfade is linear: the target's weight
// rises 0 → 1 while every outgoing state keeps its share of the rest, so a layer's state weights
// always sum to 1 (a "none" state counts; it contributes nothing).
//
// Time follows the sim. Each update's seconds are scaled by the entity's local time scale (hit-stop
// 0, slow-motion < 1), so clips and crossfades hold while the sim holds. Action states do not keep
// time at all: they show the sim's running move at its (interpolated) move tick, time-warped so the
// clip's first hit marker lands on the move's first active tick — the sim decides when a hit happens
// and the clip is bent to match, never the other way round.
//
// Clip markers are alignment only. `onMarker` listeners (VFX/SFX flourishes) hear them as a clip
// plays; gameplay listens to sim events instead.

import {
  ANIM_PARAMETERS,
  ANIM_RESTART_FADE,
  type AnimConditionDef,
  type AnimGraphDef,
  type AnimLayerMode,
  type AnimMarkerKind,
  type AnimParameterName,
  type Frozen,
} from '@content/index';
import {
  accumulatePose,
  clipTime,
  compileClip,
  compileRig,
  normalisePose,
  sampleClip,
  type Clip,
  type ClipSource,
  type Rig,
} from './library';
import { createPose, identityPose, multiplyInto, nlerpInto, type Pose } from './math';

/** A parameter value published from the sim. */
export type AnimParamValue = number | boolean | string;

/** The sim's running move, as the action states read it. */
export interface ActionSample {
  /** Move id. */
  readonly move: string;
  /** The move's clip id (its presentation.anim). */
  readonly clip: string;
  /** Identifies this run of the move (its start tick): a new key restarts the action state. */
  readonly key: number;
  /** Move tick being shown, fractional (interpolated between sim steps; holds in hit-stop). */
  readonly moveTick: number;
  /** The move's first active tick. */
  readonly activeFrom: number;
  /** The move's length in ticks. */
  readonly totalTicks: number;
}

/** Everything a controller reads for one update: sim-published parameters. */
export interface AnimParams {
  readonly values: Readonly<Partial<Record<AnimParameterName, AnimParamValue>>>;
  /** The entity's sim local time scale: 1 normal, 0 hit-stop. */
  readonly timeScale: number;
  /** The move in progress, or null. */
  readonly action: ActionSample | null;
}

/** A marker a playing clip passed. */
export interface MarkerEvent {
  readonly layer: string;
  readonly state: string;
  readonly clip: string;
  readonly kind: AnimMarkerKind;
  /** Marker time in the clip, seconds. */
  readonly t: number;
}

/** One layer as the dev probe reports it. */
export interface LayerProbe {
  readonly id: string;
  /** The state the layer is in (or crossfading to). */
  readonly state: string;
  /** Weight per state id, summing to 1. */
  readonly weights: Readonly<Record<string, number>>;
  /**
   * The clip that state is playing (a blend's heaviest clip, an action's move clip), or null for a
   * "none" state (mw-e02.6: the probe shows run vs walk inside a speed blend).
   */
  readonly clip: string | null;
}

/** The dev state probe: every layer's state and weights. */
export interface AnimProbe {
  readonly rig: string;
  readonly layers: readonly LayerProbe[];
}

type Motion =
  | { readonly kind: 'clip'; readonly clip: Clip }
  | {
      readonly kind: 'blend1d';
      readonly param: AnimParameterName;
      readonly points: readonly { readonly at: number; readonly clip: Clip }[];
    }
  | {
      readonly kind: 'blend2d';
      readonly x: AnimParameterName;
      readonly y: AnimParameterName;
      readonly points: readonly { readonly at: readonly [number, number]; readonly clip: Clip }[];
    }
  | { readonly kind: 'action'; readonly fallback: Clip }
  | { readonly kind: 'none' };

interface State {
  readonly id: string;
  readonly motion: Motion;
}

interface Transition {
  readonly from: string;
  readonly to: State;
  readonly duration: number;
  readonly when: readonly Frozen<AnimConditionDef>[];
}

interface Layer {
  readonly id: string;
  readonly mode: AnimLayerMode;
  readonly mask: Float64Array | null;
  readonly initial: State;
  readonly transitions: readonly Transition[];
}

/** A graph compiled against its rig and clip manifest. */
export interface CompiledGraph {
  readonly rig: Rig;
  readonly layers: readonly Layer[];
  /** This rig's clips by id (action states look up the running move's clip here). */
  readonly clips: ReadonlyMap<string, Clip>;
}

/** Compiles a graph; `clips` must hold every clip it names (the content loader guarantees it). */
export function compileGraph(
  graph: Frozen<AnimGraphDef>,
  clips: readonly ClipSource[],
): CompiledGraph {
  const rig = compileRig(graph);
  const library = new Map<string, Clip>();
  for (const source of clips) {
    if (source.rig.id === graph.id) library.set(source.id, compileClip(source, rig));
  }
  const clip = (id: string): Clip => {
    const found = library.get(id);
    if (found === undefined)
      throw new RangeError(`graph "${graph.id}": no clip "${id}" for this rig`);
    return found;
  };
  const layers = graph.layers.map((layer): Layer => {
    const states = new Map<string, State>();
    for (const state of layer.states) {
      const m = state.motion;
      let motion: Motion;
      switch (m.kind) {
        case 'clip':
          motion = { kind: 'clip', clip: clip(m.clip.id) };
          break;
        case 'blend1d':
          motion = {
            kind: 'blend1d',
            param: m.param,
            points: m.points.map((p) => ({ at: p.at, clip: clip(p.clip.id) })),
          };
          break;
        case 'blend2d':
          motion = {
            kind: 'blend2d',
            x: m.x,
            y: m.y,
            points: m.points.map((p) => ({ at: p.at, clip: clip(p.clip.id) })),
          };
          break;
        case 'action':
          motion = { kind: 'action', fallback: clip(m.fallback.id) };
          break;
        case 'none':
          motion = { kind: 'none' };
          break;
      }
      states.set(state.id, { id: state.id, motion });
    }
    const state = (id: string): State => {
      const found = states.get(id);
      if (found === undefined) throw new RangeError(`graph "${graph.id}": no state "${id}"`);
      return found;
    };
    return {
      id: layer.id,
      mode: layer.mode,
      mask: layer.mask === undefined ? null : (rig.masks.get(layer.mask) ?? null),
      initial: state(layer.initial),
      transitions: layer.transitions.map((t) => ({
        from: t.from,
        to: state(t.to),
        duration: t.duration,
        when: t.when,
      })),
    };
  });
  return { rig, layers, clips: library };
}

/**
 * Where an action clip is at `moveTick`: the clip spans the whole move, piecewise linear so its first
 * hit marker falls exactly on the move's first active tick (without a hit marker, or for a move with
 * no startup or no ticks after it, the clip is simply stretched over the move).
 */
export function warpActionTime(
  clip: Pick<Clip, 'duration' | 'hitMarker'>,
  action: Pick<ActionSample, 'moveTick' | 'activeFrom' | 'totalTicks'>,
): number {
  const { activeFrom, totalTicks } = action;
  const m = Math.min(Math.max(action.moveTick, 0), totalTicks);
  const h = clip.hitMarker;
  if (h === null || activeFrom <= 0 || activeFrom >= totalTicks) {
    return (clip.duration * m) / totalTicks;
  }
  if (m <= activeFrom) return (h * m) / activeFrom;
  return h + ((clip.duration - h) * (m - activeFrom)) / (totalTicks - activeFrom);
}

/** Linear 1D blend weights of `points` (ascending) at `v`, written to `out`. */
export function blend1dWeights(
  points: readonly { readonly at: number }[],
  v: number,
  out: number[],
): void {
  out.length = points.length;
  out.fill(0);
  const last = points.length - 1;
  const first = points[0]?.at ?? 0;
  if (v <= first || last === 0) {
    out[0] = 1;
    return;
  }
  if (v >= (points[last]?.at ?? 0)) {
    out[last] = 1;
    return;
  }
  let k = 1;
  while ((points[k]?.at ?? Infinity) < v) k++;
  const a = points[k - 1]?.at ?? 0;
  const b = points[k]?.at ?? a;
  const t = (v - a) / (b - a);
  out[k - 1] = 1 - t;
  out[k] = t;
}

/** Inverse-distance 2D blend weights of `points` at (x, y): exact on a point, summing to 1. */
export function blend2dWeights(
  points: readonly { readonly at: readonly [number, number] }[],
  x: number,
  y: number,
  out: number[],
): void {
  out.length = points.length;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [px, py] = points[i]?.at ?? [0, 0];
    const d2 = (px - x) ** 2 + (py - y) ** 2;
    if (d2 < 1e-12) {
      out.fill(0);
      out[i] = 1;
      return;
    }
    out[i] = 1 / d2;
    total += 1 / d2;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / total;
}

/** Passes every marker of `clip` crossed going from time `from` to `to` (raw, unwrapped seconds). */
function crossedMarkers(
  clip: Clip,
  from: number,
  to: number,
  emit: (kind: AnimMarkerKind, t: number) => void,
): void {
  if (to <= from) return;
  for (const marker of clip.markers) {
    if (!clip.loop) {
      if (marker.t > from && marker.t <= to) emit(marker.kind, marker.t);
      continue;
    }
    const d = clip.duration;
    let k = Math.floor((from - marker.t) / d) + 1;
    while (marker.t + k * d <= to) {
      emit(marker.kind, marker.t);
      k++;
    }
  }
}

/** The clip `inst` shows most of: see LayerProbe.clip. */
function clipOf(inst: Instance): string | null {
  const motion = inst.state.motion;
  switch (motion.kind) {
    case 'clip':
      return motion.clip.id;
    case 'action':
      return (inst.actionClip ?? motion.fallback).id;
    case 'blend1d':
    case 'blend2d': {
      let heaviest = 0;
      inst.blend.forEach((w, i) => {
        if (w > (inst.blend[heaviest] ?? 0)) heaviest = i;
      });
      return motion.points[heaviest]?.clip.id ?? null;
    }
    case 'none':
      return null;
  }
}

/** Whether `action` is the run `inst` shows. */
const sameRun = (action: ActionSample, inst: { actionKey: number | null }): boolean =>
  action.key === inst.actionKey;

class Instance {
  /** Seconds played (clip states: raw, unwrapped; action states: the warped clip time). */
  time = 0;
  /** Normalised phase of a blend (cycles played). */
  phase = 0;
  weight = 0;
  /** Weight when the current crossfade began (outgoing instances fade from it). */
  from = 0;
  /** The action run this instance shows, and its clip. */
  actionKey: number | null = null;
  actionClip: Clip | null = null;
  readonly blend: number[] = [];

  constructor(readonly state: State) {}
}

class LayerState {
  current: Instance;
  outgoing: Instance[] = [];
  fadeElapsed = 0;
  fadeDuration = 0;

  constructor(readonly layer: Layer) {
    this.current = new Instance(layer.initial);
    this.current.weight = 1;
  }

  *instances(): Generator<Instance> {
    yield* this.outgoing;
    yield this.current;
  }
}

const valueOf = (params: AnimParams, name: AnimParameterName): AnimParamValue => {
  const value = params.values[name];
  if (value !== undefined) return value;
  const spec = ANIM_PARAMETERS[name];
  if (spec.kind === 'number') return 0;
  if (spec.kind === 'boolean') return false;
  return 'none';
};

const numberOf = (params: AnimParams, name: AnimParameterName): number => {
  const value = valueOf(params, name);
  return typeof value === 'number' ? value : 0;
};

const compare = (op: '<' | '<=' | '>' | '>=', a: number, b: number): boolean =>
  op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;

/** Whether `condition` holds for `params`. */
export function conditionHolds(condition: Frozen<AnimConditionDef>, params: AnimParams): boolean {
  const value = valueOf(params, condition.param);
  const target = condition.value;
  switch (condition.op) {
    case '==':
      return value === target;
    case '!=':
      return value !== target;
    default:
      return (
        typeof value === 'number' &&
        typeof target === 'number' &&
        compare(condition.op, value, target)
      );
  }
}

/** One character's animation: a graph instance with its layers' states, times and crossfades. */
export class AnimationController {
  /** Hears clip markers as they play (render-side flourishes only). */
  onMarker: ((event: MarkerEvent) => void) | undefined;
  private readonly layers: LayerState[];
  private readonly clipPose: Pose;
  private readonly instancePose: Pose;
  private readonly layerPose: Pose;

  constructor(readonly graph: CompiledGraph) {
    this.layers = graph.layers.map((layer) => new LayerState(layer));
    const bones = graph.rig.bones.length;
    this.clipPose = createPose(bones);
    this.instancePose = createPose(bones);
    this.layerPose = createPose(bones);
  }

  /** Advances by `seconds` of frame time (scaled by the sim's local time scale) with `params`. */
  update(seconds: number, params: AnimParams): void {
    const dt = Math.max(0, seconds) * Math.max(0, params.timeScale);
    for (const layer of this.layers) {
      this.transition(layer, params);
      this.advance(layer, dt, params);
    }
  }

  /** Writes the blended pose (local bone rotations) into `out`. */
  evaluate(out: Pose): void {
    const [base, ...rest] = this.layers;
    out.fill(0);
    if (base !== undefined) {
      for (const inst of base.instances()) {
        this.instancePoseOf(inst, this.instancePose);
        accumulatePose(out, this.instancePose, inst.weight);
      }
    }
    normalisePose(out);
    for (const layer of rest) this.applyLayer(layer, out);
  }

  /** The dev state probe: each layer's state and state weights. */
  probe(): AnimProbe {
    return {
      rig: this.graph.rig.id,
      layers: this.layers.map((layer) => {
        const weights: Record<string, number> = {};
        for (const inst of layer.instances()) {
          weights[inst.state.id] = (weights[inst.state.id] ?? 0) + inst.weight;
        }
        return {
          id: layer.layer.id,
          state: layer.current.state.id,
          weights,
          clip: clipOf(layer.current),
        };
      }),
    };
  }

  private transition(layer: LayerState, params: AnimParams): void {
    const current = layer.current;
    for (const t of layer.layer.transitions) {
      const fromMatches = t.from === '*' ? t.to !== current.state : t.from === current.state.id;
      if (!fromMatches || !t.when.every((c) => conditionHolds(c, params))) continue;
      this.startFade(layer, t.to, t.duration, params);
      return;
    }
    // A new run of a move while its action state plays: restart it with a short crossfade.
    const action = params.action;
    if (
      current.state.motion.kind === 'action' &&
      action !== null &&
      action.key !== current.actionKey
    ) {
      this.startFade(layer, current.state, ANIM_RESTART_FADE, params);
    }
  }

  private startFade(layer: LayerState, to: State, duration: number, params: AnimParams): void {
    const next = new Instance(to);
    if (to.motion.kind === 'action') this.bindAction(next, to.motion.fallback, params.action);
    const outgoing = [...layer.instances()].filter((inst) => inst.weight > 0);
    for (const inst of outgoing) inst.from = inst.weight;
    layer.outgoing = outgoing;
    layer.current = next;
    layer.fadeElapsed = 0;
    layer.fadeDuration = duration;
    this.updateWeights(layer);
  }

  private bindAction(inst: Instance, fallback: Clip, action: ActionSample | null): void {
    inst.actionKey = action?.key ?? null;
    inst.actionClip = (action && this.graph.clips.get(action.clip)) ?? fallback;
    if (inst.actionClip.additive) inst.actionClip = fallback;
    inst.time = action === null ? 0 : warpActionTime(inst.actionClip, action);
  }

  private updateWeights(layer: LayerState): void {
    // (A fade within a rounding error of its end is done: frame times rarely sum exactly.)
    const progress = layer.fadeDuration <= 0 ? 1 : layer.fadeElapsed / layer.fadeDuration;
    const p = progress >= 1 - 1e-9 ? 1 : progress;
    layer.current.weight = p;
    for (const inst of layer.outgoing) inst.weight = inst.from * (1 - p);
    if (p >= 1) layer.outgoing = [];
  }

  private advance(layer: LayerState, dt: number, params: AnimParams): void {
    layer.fadeElapsed += dt;
    this.updateWeights(layer);
    for (const inst of layer.instances()) {
      this.advanceInstance(layer, inst, dt, params, inst === layer.current);
    }
  }

  private advanceInstance(
    layer: LayerState,
    inst: Instance,
    dt: number,
    params: AnimParams,
    current: boolean,
  ): void {
    const motion = inst.state.motion;
    const emit = (clip: Clip) => (kind: AnimMarkerKind, t: number) => {
      this.onMarker?.({ layer: layer.layer.id, state: inst.state.id, clip: clip.id, kind, t });
    };
    switch (motion.kind) {
      case 'clip': {
        const before = inst.time;
        inst.time += dt;
        if (current) crossedMarkers(motion.clip, before, inst.time, emit(motion.clip));
        return;
      }
      case 'action': {
        const action = params.action;
        const clip = inst.actionClip ?? motion.fallback;
        // A finished or replaced run holds its last pose while it fades out.
        if (action === null || !sameRun(action, inst)) return;
        const before = inst.time;
        inst.time = warpActionTime(clip, action);
        if (current) crossedMarkers(clip, before, inst.time, emit(clip));
        return;
      }
      case 'blend1d':
      case 'blend2d': {
        const points = motion.points;
        if (motion.kind === 'blend1d') {
          blend1dWeights(motion.points, numberOf(params, motion.param), inst.blend);
        } else {
          blend2dWeights(
            motion.points,
            numberOf(params, motion.x),
            numberOf(params, motion.y),
            inst.blend,
          );
        }
        // Clips of a blend share one normalised phase, advancing at their weighted average rate.
        let rate = 0;
        let heaviest = 0;
        points.forEach((p, i) => {
          const w = inst.blend[i] ?? 0;
          rate += w / p.clip.duration;
          if (w > (inst.blend[heaviest] ?? 0)) heaviest = i;
        });
        const before = inst.phase;
        inst.phase += dt * rate;
        const lead = points[heaviest]?.clip;
        if (current && lead !== undefined) {
          crossedMarkers(lead, before * lead.duration, inst.phase * lead.duration, emit(lead));
        }
        return;
      }
      case 'none':
        return;
    }
  }

  /** The pose `inst` shows now, into `out`. */
  private instancePoseOf(inst: Instance, out: Pose): void {
    const motion = inst.state.motion;
    switch (motion.kind) {
      case 'clip':
        sampleClip(motion.clip, clipTime(motion.clip, inst.time), out);
        return;
      case 'action':
        sampleClip(inst.actionClip ?? motion.fallback, inst.time, out);
        return;
      case 'blend1d':
      case 'blend2d': {
        out.fill(0);
        motion.points.forEach((p, i) => {
          const w = inst.blend[i] ?? 0;
          if (w <= 0) return;
          sampleClip(p.clip, clipTime(p.clip, inst.phase * p.clip.duration), this.clipPose);
          accumulatePose(out, this.clipPose, w);
        });
        normalisePose(out);
        return;
      }
      case 'none':
        identityPose(out);
        return;
    }
  }

  /** Blends an override or additive layer over `out`. */
  private applyLayer(layer: LayerState, out: Pose): void {
    const acc = this.layerPose;
    acc.fill(0);
    let weight = 0;
    for (const inst of layer.instances()) {
      if (inst.state.motion.kind === 'none' || inst.weight <= 0) continue;
      this.instancePoseOf(inst, this.instancePose);
      accumulatePose(acc, this.instancePose, inst.weight);
      weight += inst.weight;
    }
    if (weight <= 0) return;
    const mask = layer.layer.mask;
    const bones = out.length / 4;
    if (layer.layer.mode === 'override') {
      normalisePose(acc);
      for (let b = 0; b < bones; b++) {
        const t = weight * (mask === null ? 1 : (mask[b] ?? 0));
        if (t > 0) nlerpInto(out, b * 4, out, b * 4, acc, b * 4, t);
      }
      return;
    }
    // Additive: the offset is the weighted rotation blended from identity by the layer's weight.
    identityPose(this.instancePose);
    accumulatePose(acc, this.instancePose, 1 - weight);
    normalisePose(acc);
    for (let b = 0; b < bones; b++) {
      const m = mask === null ? 1 : (mask[b] ?? 0);
      if (m <= 0) continue;
      if (m < 1) nlerpInto(acc, b * 4, this.instancePose, b * 4, acc, b * 4, m);
      multiplyInto(out, b * 4, out, b * 4, acc, b * 4);
    }
  }
}
