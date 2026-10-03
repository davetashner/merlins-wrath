// The AI debug overlay's model (mw-e11.17): turns a sim introspection snapshot (src/sim/debug/
// ai-snapshot.ts), the recent noises and the light probe into what src/render/debug/ai-overlay.ts
// draws — colours by alert state, label text, awareness bars with threshold marks, routes from the
// agent's feet, noise rings — and picks the agent a ray points at (click selection). Pure functions
// of their inputs; nothing here reads the world.

import type { AlertState } from '@content/index';
import type { AiAgentSnapshot, AiDebugSnapshot, EntityId, Vec3 } from '@sim/index';
import type {
  AiOverlayAgent,
  AiOverlayModel,
  AiOverlayNoise,
  AiOverlayProbe,
} from '@render/debug/ai-overlay';

/** Sight-cone and label tint per alert state. */
export const ALERT_COLOURS: Readonly<Record<AlertState, number>> = Object.freeze({
  unaware: 0x5dff7a,
  suspicious: 0xffd23d,
  investigating: 0xff9f3d,
  searching: 0xb07dff,
  alerted: 0xff5a3d,
  combat: 0xff2030,
});

/** Tint of an agent without a brain (AI not running it). */
export const NO_BRAIN_COLOUR = 0x9aa4b2;

/** Awareness bars a label shows (the selected agent shows every source). */
export const LABEL_BARS = 3;

/** Quietest level, dB, a noise ring's radius reaches (a humanoid's hearing threshold). */
export const RING_FLOOR_DB = 30;

/** Largest noise ring radius, metres. */
export const MAX_RING_RADIUS = 60;

/** A noise the overlay remembers while its ring fades. */
export interface NoiseMark {
  readonly tick: number;
  readonly position: Vec3;
  /** dB at 1 m. */
  readonly loudness: number;
  readonly kind: string;
  /** Source → portal (when it came through one) → listener, per listener that heard it. */
  readonly routes: Vec3[][];
  /** Perceived level per listener that heard it, dB. */
  readonly heard: number[];
}

/** The light level under the cursor. */
export interface LightProbe {
  readonly point: Vec3;
  /** 0–1. */
  readonly level: number;
}

/** What the model is built from besides the snapshot. */
export interface ModelInputs {
  readonly selected: EntityId | undefined;
  readonly frozen: boolean;
  readonly noises: readonly NoiseMark[];
  /** Ticks a noise ring lasts. */
  readonly noiseTicks: number;
  readonly probe: LightProbe | undefined;
}

const fixed = (n: number, digits = 1): string => n.toFixed(digits);
const pct = (n: number): string => `${String(Math.round(n * 100))}%`;
const vec = (v: Vec3): string => `(${fixed(v.x)}, ${fixed(v.y)}, ${fixed(v.z)})`;

/** The radius, metres, at which a noise of `loudness` dB at 1 m falls to `floorDb` (free field). */
export function ringRadius(loudness: number, floorDb = RING_FLOOR_DB): number {
  const r = 10 ** ((loudness - floorDb) / 20);
  return Math.min(MAX_RING_RADIUS, Math.max(1, r));
}

/** A perceived source as a short bar name (`entity:7` → `#7`, `sound:throw` → `♪throw`). */
export function sourceName(source: string): string {
  const [kind, id = ''] = source.split(':', 2);
  if (kind === 'entity') return `#${id}`;
  if (kind === 'sound') return `♪${id}`;
  if (kind === 'anomaly') return `?${id}`;
  return source;
}

/** The label lines of `agent` (more for the selected agent). */
export function labelLines(agent: AiAgentSnapshot, selected: boolean): string[] {
  const lines: string[] = [];
  const { brain } = agent;
  if (brain === null) lines.push('no brain (AI not running)');
  else {
    const edge = brain.postAlert ? ' · on edge' : '';
    lines.push(`${brain.state} ${fixed(brain.timeInState)}s${edge}`);
    lines.push(brain.nodePath.slice(1).join(' › ') || 'idle');
    if (brain.scores.length > 0) {
      lines.push(brain.scores.map(([name, score]) => `${name} ${fixed(score, 2)}`).join(' | '));
    }
  }
  if (agent.lkp !== null) {
    lines.push(`LKP ${vec(agent.lkp.position)} ${pct(agent.lkp.confidence)}`);
  }
  if (agent.route !== null) {
    lines.push(`route ${agent.route.status} · ${String(agent.route.points.length)} pts`);
  }
  if (selected) {
    if (agent.cone !== null) {
      const c = agent.cone;
      lines.push(
        `sight ${String(c.primaryHalfAngle)}°/${String(c.peripheralHalfAngle)}° ${String(c.nearRange)}–${String(c.farRange)} m`,
      );
    }
    if (agent.hearing !== null) {
      lines.push(
        `hearing ${String(agent.hearing.thresholdDb)} dB ≤ ${String(agent.hearing.range)} m`,
      );
    }
    for (const score of agent.detail?.scores ?? []) {
      const inputs = score.considerations.map((c) => `${c.input}=${fixed(c.value, 2)}`).join(' ');
      lines.push(`  ${score.activity}: ${inputs || '(no considerations)'}`);
    }
  }
  return lines;
}

/** The overlay agent for `agent`. */
export function overlayAgent(
  agent: AiAgentSnapshot,
  selected: boolean,
  marks: readonly number[],
): AiOverlayAgent {
  const colour = agent.brain === null ? NO_BRAIN_COLOUR : ALERT_COLOURS[agent.brain.state];
  const bars = (selected ? agent.awareness : agent.awareness.slice(0, LABEL_BARS)).map((r) => ({
    name: `${sourceName(r.source)} ${r.sense}`,
    level: r.level,
  }));
  return {
    entity: agent.entity,
    selected,
    colour,
    feet: agent.feet,
    eye: agent.eye,
    facing: agent.facing,
    cone: agent.cone,
    hearingRange: agent.hearing?.range ?? null,
    lkp: agent.lkp,
    route: agent.route === null ? [] : [agent.feet, ...agent.route.points],
    label: {
      anchor: { x: agent.eye.x, y: agent.eye.y + 0.5, z: agent.eye.z },
      title: `#${String(agent.entity)} ${agent.creature ?? 'agent'}`,
      lines: labelLines(agent, selected),
      bars,
      marks,
    },
  };
}

/** The overlay's noise ring for `mark` at `tick`, or undefined once it has faded. */
export function overlayNoise(
  mark: NoiseMark,
  tick: number,
  noiseTicks: number,
): AiOverlayNoise | undefined {
  const age = tick - mark.tick;
  if (age >= noiseTicks) return undefined;
  return {
    position: mark.position,
    radius: ringRadius(mark.loudness),
    fade: 1 - Math.max(0, age) / noiseTicks,
    routes: mark.routes,
  };
}

/** Everything the overlay draws for `snapshot`. */
export function overlayModel(snapshot: AiDebugSnapshot, inputs: ModelInputs): AiOverlayModel {
  const { thresholds } = snapshot;
  const marks = [thresholds.suspicious, thresholds.investigating, thresholds.detected];
  const agents = snapshot.agents.map((agent) =>
    overlayAgent(agent, agent.entity === inputs.selected, marks),
  );
  const noises: AiOverlayNoise[] = [];
  const status: string[] = [
    `AI debug · tick ${String(snapshot.tick)}${inputs.frozen ? ' · FROZEN (ai.step)' : ''}`,
    `${String(agents.length)} agents · selected ${inputs.selected === undefined ? 'none' : `#${String(inputs.selected)}`}`,
  ];
  for (const mark of inputs.noises) {
    const ring = overlayNoise(mark, snapshot.tick, inputs.noiseTicks);
    if (ring === undefined) continue;
    noises.push(ring);
    const heard =
      mark.heard.length === 0
        ? ''
        : ` → heard ${mark.heard.map((db) => fixed(db, 0)).join('/')} dB`;
    status.push(`noise ${mark.kind} ${fixed(mark.loudness, 0)} dB${heard}`);
  }
  let probe: AiOverlayProbe | null = null;
  if (inputs.probe !== undefined) {
    probe = { point: inputs.probe.point };
    status.push(`light ${fixed(inputs.probe.level, 2)} at ${vec(inputs.probe.point)}`);
  }
  return { agents, noises, probe, status };
}

/** A ray: origin and unit direction. */
export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** Most metres between a ray and an agent's body axis for a click to pick it. */
export const PICK_RADIUS = 1;

/**
 * The agent `ray` points at: of those whose body (the segment from feet to eye) passes within
 * PICK_RADIUS of the ray in front of its origin, the nearest along the ray; undefined for none.
 */
export function pickAgent(
  ray: Ray,
  agents: readonly Pick<AiAgentSnapshot, 'entity' | 'feet' | 'eye'>[],
): EntityId | undefined {
  let best: EntityId | undefined;
  let bestT = Infinity;
  const { origin: o, direction: d } = ray;
  for (const agent of agents) {
    // Sample the body axis at feet, middle and eye; take the closest approach.
    for (const s of [0, 0.5, 1]) {
      const p = {
        x: agent.feet.x + (agent.eye.x - agent.feet.x) * s,
        y: agent.feet.y + (agent.eye.y - agent.feet.y) * s,
        z: agent.feet.z + (agent.eye.z - agent.feet.z) * s,
      };
      const t = (p.x - o.x) * d.x + (p.y - o.y) * d.y + (p.z - o.z) * d.z;
      if (t <= 0) continue;
      const dx = o.x + d.x * t - p.x;
      const dy = o.y + d.y * t - p.y;
      const dz = o.z + d.z * t - p.z;
      if (dx * dx + dy * dy + dz * dz > PICK_RADIUS * PICK_RADIUS) continue;
      if (t < bestT) {
        bestT = t;
        best = agent.entity;
      }
    }
  }
  return best;
}
