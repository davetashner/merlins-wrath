// The AI debug overlay's drawing (mw-e11.17): per agent its sight cone (primary and peripheral fans,
// tinted by alert state), its hearing radius, its last-known-position marker (sized by confidence),
// the route it walks, and a screen label (state and time in state, activity, top scores, awareness
// bars per source); globally, noise rings with their loudness and propagation route, and the light
// probe under the cursor. It draws a model built by src/tools/ai-debug from sim introspection
// snapshots and never reads or feeds the sim.
//
// Cheap per frame: every Three.js object and label element is pooled and reused; geometry is shared
// (one fan geometry per cone shape, one unit circle), routes write into preallocated buffers, and a
// label's text is rewritten only when its model changed (identity), so a frame with the same model
// only moves labels to where their anchors project.
//
// Render-only glue (excluded from unit coverage with the rest of src/render): the e2e
// (e2e/ai-debug.spec.ts) checks it in the browser and tests/bench/ai-debug-overlay.bench.ts drives it
// headless for the frame-time budget, since building Three.js objects needs no GPU.

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Vector3,
  type Camera,
  type Material,
} from 'three';

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A label's awareness bar: a perceived source and its level, 0–1. */
export interface AiOverlayBar {
  readonly name: string;
  readonly level: number;
}

/** A label over an agent. */
export interface AiOverlayLabel {
  /** World point the label sits over. */
  readonly anchor: Point;
  readonly title: string;
  readonly lines: readonly string[];
  readonly bars: readonly AiOverlayBar[];
  /** Threshold marks on every bar, 0–1. */
  readonly marks: readonly number[];
}

/** One agent as drawn. */
export interface AiOverlayAgent {
  readonly entity: number;
  readonly selected: boolean;
  /** Alert-state tint, 0xRRGGBB. */
  readonly colour: number;
  readonly feet: Point;
  readonly eye: Point;
  /** Unit, horizontal. */
  readonly facing: Point;
  /** Degrees and metres; null for a blind agent. */
  readonly cone: {
    readonly primaryHalfAngle: number;
    readonly peripheralHalfAngle: number;
    readonly farRange: number;
  } | null;
  /** Metres; null for a deaf agent. */
  readonly hearingRange: number | null;
  readonly lkp: { readonly position: Point; readonly confidence: number } | null;
  /** The route from the agent's feet on (empty when it has none). */
  readonly route: readonly Point[];
  readonly label: AiOverlayLabel;
}

/** A noise ring. */
export interface AiOverlayNoise {
  readonly position: Point;
  /** Metres. */
  readonly radius: number;
  /** 1 when new, falling to 0 as it fades out. */
  readonly fade: number;
  /** Propagation routes to the listeners that heard it (source, portal, listener). */
  readonly routes: readonly (readonly Point[])[];
}

/** The light probe. */
export interface AiOverlayProbe {
  readonly point: Point;
}

/** Everything drawn on one frame. */
export interface AiOverlayModel {
  readonly agents: readonly AiOverlayAgent[];
  readonly noises: readonly AiOverlayNoise[];
  readonly probe: AiOverlayProbe | null;
  /** The status panel's lines (mode, tick, selection, probe reading, noise loudness). */
  readonly status: readonly string[];
}

/** What the overlay drew on its latest update (the e2e reads it). */
export interface AiOverlayStats {
  readonly agents: number;
  readonly cones: number;
  readonly labels: number;
  readonly noises: number;
}

/** The overlay: add `object` to the scene, call `update` every drawn frame while enabled. */
export interface AiOverlay {
  readonly object: Group;
  /** Hidden (3D and labels) while false. */
  enabled: boolean;
  /** Draws `model`; labels are placed by projecting through `camera` into a width × height view. */
  update(model: AiOverlayModel, camera: Camera, width: number, height: number): void;
  stats(): AiOverlayStats;
  dispose(): void;
}

/** Where labels go (a DOM element over the canvas), or none (headless benches). */
export interface AiOverlayOptions {
  readonly labels?: HTMLElement;
}

const FAN_SEGMENTS = 24;
const CIRCLE_SEGMENTS = 48;
const ROUTE_CAPACITY = 64;
const NOISE_POOL = 16;
const NOISE_ROUTE_CAPACITY = 8;
const GROUND_LIFT = 0.04;
const ROUTE_COLOUR = 0x3dd8ff;
const NOISE_COLOUR = 0xffffff;
const PROBE_COLOUR = 0xfff27a;
const DEG = Math.PI / 180;

/** A flat fan on the ground plane facing +z, from `innerDeg` to `outerDeg` either side of it. */
function fanGeometry(innerDeg: number, outerDeg: number, range: number): BufferGeometry {
  // Two wedges (left and right of the centre line) between inner and outer half-angles.
  const positions: number[] = [];
  const wedge = (from: number, to: number): void => {
    for (let i = 0; i < FAN_SEGMENTS; i++) {
      const a = (from + ((to - from) * i) / FAN_SEGMENTS) * DEG;
      const b = (from + ((to - from) * (i + 1)) / FAN_SEGMENTS) * DEG;
      positions.push(0, 0, 0);
      positions.push(Math.sin(a) * range, 0, Math.cos(a) * range);
      positions.push(Math.sin(b) * range, 0, Math.cos(b) * range);
    }
  };
  if (innerDeg === 0) wedge(-outerDeg, outerDeg);
  else {
    wedge(innerDeg, outerDeg);
    wedge(-outerDeg, -innerDeg);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function circleGeometry(): BufferGeometry {
  const positions = new Float32Array(CIRCLE_SEGMENTS * 3);
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    positions[i * 3] = Math.cos(a);
    positions[i * 3 + 2] = Math.sin(a);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

function lineBuffer(capacity: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setDrawRange(0, 0);
  return geometry;
}

/** Writes `points` (up to the buffer's capacity) into a line buffer. */
function writeLine(geometry: BufferGeometry, points: readonly Point[], lift: number): void {
  const attribute = geometry.getAttribute('position') as BufferAttribute;
  const array = attribute.array as Float32Array;
  const n = Math.min(points.length, attribute.count);
  points.slice(0, n).forEach((p, i) => {
    array[i * 3] = p.x;
    array[i * 3 + 1] = p.y + lift;
    array[i * 3 + 2] = p.z;
  });
  attribute.needsUpdate = true;
  geometry.setDrawRange(0, n);
}

interface AgentVisual {
  readonly group: Group;
  readonly primary: Mesh;
  readonly peripheral: Mesh;
  readonly hearing: LineLoop;
  readonly lkp: Mesh;
  readonly route: Line;
  coneKey: string;
}

interface NoiseVisual {
  readonly ring: LineLoop;
  readonly material: LineBasicMaterial;
  readonly routes: Line[];
}

interface BarView {
  readonly el: HTMLElement;
  readonly name: HTMLElement;
  readonly track: HTMLElement;
  readonly level: HTMLElement;
  /** What was last written (marks key, name, width, colour). */
  marks: string;
  shown: boolean;
  name_: string;
  width: string;
  colour: string;
}

interface LabelView {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly body: HTMLElement;
  readonly bars: HTMLElement;
  readonly rows: BarView[];
  /** Values last written, by key, so unchanged text is never rewritten. */
  readonly written: Map<string, string>;
  model: AiOverlayLabel | undefined;
  selected: boolean | undefined;
  transform: string;
}

/** Builds the overlay (disabled until `enabled` is set). */
export function createAiOverlay(options: AiOverlayOptions = {}): AiOverlay {
  const root = new Group();
  root.name = 'ai-debug-overlay';
  root.visible = false;
  root.renderOrder = 998;
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];
  const keep = <T extends Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const fill = new Map<string, MeshBasicMaterial>();
  const fillOf = (colour: number, opacity: number): MeshBasicMaterial => {
    const key = `${String(colour)}/${String(opacity)}`;
    let found = fill.get(key);
    if (found === undefined) {
      found = keep(
        new MeshBasicMaterial({
          color: colour,
          transparent: true,
          opacity,
          depthWrite: false,
          depthTest: false,
          side: DoubleSide,
        }),
      );
      fill.set(key, found);
    }
    return found;
  };
  const strokes = new Map<string, LineBasicMaterial>();
  const strokeOf = (colour: number, opacity = 0.8): LineBasicMaterial => {
    const key = `${String(colour)}/${String(opacity)}`;
    let found = strokes.get(key);
    if (found === undefined) {
      found = keep(
        new LineBasicMaterial({ color: colour, transparent: true, opacity, depthTest: false }),
      );
      strokes.set(key, found);
    }
    return found;
  };
  const fans = new Map<string, [BufferGeometry, BufferGeometry]>();
  const fansOf = (cone: NonNullable<AiOverlayAgent['cone']>): [BufferGeometry, BufferGeometry] => {
    const key = `${String(cone.primaryHalfAngle)}/${String(cone.peripheralHalfAngle)}/${String(cone.farRange)}`;
    let found = fans.get(key);
    if (found === undefined) {
      found = [
        fanGeometry(0, cone.primaryHalfAngle, cone.farRange),
        fanGeometry(cone.primaryHalfAngle, cone.peripheralHalfAngle, cone.farRange),
      ];
      geometries.push(...found);
      fans.set(key, found);
    }
    return found;
  };
  const circle = circleGeometry();
  const marker = new OctahedronGeometry(1, 0);
  const probeGeometry = new SphereGeometry(0.08, 8, 6);
  geometries.push(circle, marker, probeGeometry);

  const agents: AgentVisual[] = [];
  const agentVisual = (index: number): AgentVisual => {
    let visual = agents[index];
    if (visual === undefined) {
      const group = new Group();
      const primary = new Mesh(undefined, fillOf(0xffffff, 0.22));
      const peripheral = new Mesh(undefined, fillOf(0xffffff, 0.08));
      const hearing = new LineLoop(circle, strokeOf(0xffffff, 0.45));
      const lkp = new Mesh(marker, fillOf(0xffffff, 0.9));
      const routeGeometry = lineBuffer(ROUTE_CAPACITY);
      geometries.push(routeGeometry);
      const route = new Line(routeGeometry, strokeOf(ROUTE_COLOUR, 0.9));
      for (const o of [primary, peripheral, hearing, lkp, route]) {
        o.renderOrder = 998;
        o.frustumCulled = false;
        group.add(o);
      }
      root.add(group);
      visual = { group, primary, peripheral, hearing, lkp, route, coneKey: '' };
      agents[index] = visual;
    }
    return visual;
  };

  const noises: NoiseVisual[] = [];
  for (let i = 0; i < NOISE_POOL; i++) {
    const material = keep(
      new LineBasicMaterial({ color: NOISE_COLOUR, transparent: true, depthTest: false }),
    );
    const ring = new LineLoop(circle, material);
    ring.visible = false;
    ring.frustumCulled = false;
    root.add(ring);
    const routes: Line[] = [];
    for (let r = 0; r < NOISE_ROUTE_CAPACITY; r++) {
      const geometry = lineBuffer(4);
      geometries.push(geometry);
      const line = new Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false;
      root.add(line);
      routes.push(line);
    }
    noises.push({ ring, material, routes });
  }
  const probe = new Mesh(probeGeometry, fillOf(PROBE_COLOUR, 1));
  probe.visible = false;
  root.add(probe);

  // Labels: a layer over the canvas with one pooled element per agent and a status panel.
  const layer = options.labels;
  const doc = layer?.ownerDocument;
  const labels: LabelView[] = [];
  let status: HTMLElement | undefined;
  let statusText = '';
  if (layer !== undefined && doc !== undefined) {
    layer.style.display = 'none';
    status = doc.createElement('pre');
    status.dataset['testid'] = 'ai-debug-status';
    status.style.cssText =
      'position:absolute;right:8px;top:8px;margin:0;padding:6px 8px;background:rgba(10,12,16,0.78);' +
      'color:#e8ecf2;font:11px/1.35 ui-monospace,monospace;border-radius:4px;pointer-events:none;';
    layer.append(status);
  }
  const labelView = (index: number): LabelView | undefined => {
    if (layer === undefined || doc === undefined) return undefined;
    let view = labels[index];
    if (view === undefined) {
      const el = doc.createElement('div');
      el.dataset['testid'] = 'ai-debug-label';
      el.style.cssText =
        'position:absolute;left:0;top:0;min-width:120px;max-width:260px;padding:3px 5px;' +
        'background:rgba(10,12,16,0.72);color:#e8ecf2;font:10px/1.3 ui-monospace,monospace;' +
        'border-left:3px solid #9aa4b2;border-radius:3px;pointer-events:none;white-space:pre;' +
        'will-change:transform;';
      const title = doc.createElement('div');
      title.style.fontWeight = '700';
      const body = doc.createElement('div');
      const bars = doc.createElement('div');
      el.append(title, body, bars);
      layer.append(el);
      view = {
        root: el,
        title,
        body,
        bars,
        rows: [],
        written: new Map(),
        model: undefined,
        selected: undefined,
        transform: '',
      };
      labels[index] = view;
    }
    return view;
  };
  const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;
  /** Sets `key` of a cached write only when the value changed. */
  const changed = (view: LabelView, key: string, value: string): boolean => {
    if (view.written.get(key) === value) return false;
    view.written.set(key, value);
    return true;
  };
  const barRow = (view: LabelView, index: number, marks: readonly number[]): BarView => {
    let row = view.rows[index];
    const doc = view.root.ownerDocument;
    if (row === undefined) {
      const el = doc.createElement('div');
      el.style.cssText = 'display:flex;gap:4px;align-items:center;';
      const name = doc.createElement('span');
      name.style.cssText = 'flex:0 0 70px;overflow:hidden;text-overflow:ellipsis;';
      const track = doc.createElement('span');
      track.style.cssText =
        'position:relative;flex:1 1 auto;height:6px;background:rgba(255,255,255,0.15);';
      const level = doc.createElement('span');
      level.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:0;';
      track.append(level);
      el.append(name, track);
      view.bars.append(el);
      row = { el, name, track, level, marks: '', shown: true, name_: '', width: '', colour: '' };
      view.rows[index] = row;
    }
    const markKey = marks.join(',');
    if (row.marks !== markKey) {
      row.marks = markKey;
      for (const old of [...row.track.children].slice(1)) old.remove();
      for (const mark of marks) {
        const tick = doc.createElement('span');
        tick.style.cssText = `position:absolute;left:${String(Math.round(mark * 100))}%;top:-1px;bottom:-1px;width:1px;background:#fff;`;
        row.track.append(tick);
      }
    }
    return row;
  };
  const writeLabel = (view: LabelView, agent: AiOverlayAgent): void => {
    const { label } = agent;
    if (view.model !== label) {
      view.model = label;
      if (changed(view, 'title', label.title)) view.title.textContent = label.title;
      const body = label.lines.join('\n');
      if (changed(view, 'body', body)) view.body.textContent = body;
      const colour = hex(agent.colour);
      if (changed(view, 'colour', colour)) view.root.style.borderLeftColor = colour;
      label.bars.forEach((bar, i) => {
        const row = barRow(view, i, label.marks);
        if (!row.shown) row.el.hidden = !(row.shown = true);
        if (row.name_ !== bar.name) row.name.textContent = row.name_ = bar.name;
        const width = `${String(Math.round(bar.level * 100))}%`;
        if (row.width !== width) row.level.style.width = row.width = width;
        if (row.colour !== colour) row.level.style.background = row.colour = colour;
      });
      for (const row of view.rows.slice(label.bars.length)) {
        if (row.shown) row.el.hidden = !(row.shown = false);
      }
    }
    if (view.selected !== agent.selected) {
      view.selected = agent.selected;
      view.root.style.outline = agent.selected ? '1px solid #fff27a' : 'none';
      view.root.style.zIndex = agent.selected ? '2' : '1';
      view.root.dataset['selected'] = agent.selected ? 'true' : 'false';
    }
  };

  const scratch = new Vector3();
  const yaw = (facing: Point): number => Math.atan2(facing.x, facing.z);
  let lastStats: AiOverlayStats = { agents: 0, cones: 0, labels: 0, noises: 0 };

  const hideAll = (): void => {
    if (layer !== undefined) layer.style.display = 'none';
  };

  const overlay: AiOverlay = {
    object: root,
    get enabled() {
      return root.visible;
    },
    set enabled(on: boolean) {
      root.visible = on;
      if (!on) {
        hideAll();
        lastStats = { agents: 0, cones: 0, labels: 0, noises: 0 };
      }
    },
    update(model, camera, width, height) {
      if (!root.visible) return;
      if (layer !== undefined) layer.style.display = '';
      let cones = 0;
      let shownLabels = 0;
      camera.updateMatrixWorld();
      model.agents.forEach((agent, i) => {
        const v = agentVisual(i);
        v.group.visible = true;
        const { cone } = agent;
        if (cone === null) {
          v.primary.visible = false;
          v.peripheral.visible = false;
        } else {
          const key = `${String(cone.primaryHalfAngle)}/${String(cone.peripheralHalfAngle)}/${String(cone.farRange)}`;
          if (v.coneKey !== key) {
            const [primary, peripheral] = fansOf(cone);
            v.primary.geometry = primary;
            v.peripheral.geometry = peripheral;
            v.coneKey = key;
          }
          v.primary.material = fillOf(agent.colour, agent.selected ? 0.32 : 0.2);
          v.peripheral.material = fillOf(agent.colour, agent.selected ? 0.12 : 0.07);
          for (const fan of [v.primary, v.peripheral]) {
            fan.visible = true;
            fan.position.set(agent.feet.x, agent.feet.y + GROUND_LIFT, agent.feet.z);
            fan.rotation.set(0, yaw(agent.facing), 0);
          }
          cones++;
        }
        if (agent.hearingRange === null) v.hearing.visible = false;
        else {
          v.hearing.visible = true;
          v.hearing.material = strokeOf(agent.colour, 0.45);
          v.hearing.position.set(agent.feet.x, agent.feet.y + GROUND_LIFT, agent.feet.z);
          v.hearing.scale.setScalar(agent.hearingRange);
        }
        if (agent.lkp === null) v.lkp.visible = false;
        else {
          const { position, confidence } = agent.lkp;
          v.lkp.visible = true;
          v.lkp.material = fillOf(agent.colour, 0.35 + 0.6 * confidence);
          v.lkp.position.set(position.x, position.y + 0.3, position.z);
          v.lkp.scale.setScalar(0.12 + 0.2 * confidence);
        }
        if (agent.route.length < 2) v.route.visible = false;
        else {
          v.route.visible = true;
          writeLine(v.route.geometry, agent.route, 0.08);
        }
        const view = labelView(i);
        if (view !== undefined) {
          const { anchor } = agent.label;
          scratch.set(anchor.x, anchor.y, anchor.z).project(camera);
          const inView = scratch.z < 1 && Math.abs(scratch.x) <= 1.2 && Math.abs(scratch.y) <= 1.2;
          view.root.hidden = !inView;
          if (inView) {
            writeLabel(view, agent);
            const x = Math.round((scratch.x * 0.5 + 0.5) * width);
            const y = Math.round((-scratch.y * 0.5 + 0.5) * height);
            const transform = `translate(${String(x)}px, ${String(y)}px) translate(-50%, -100%)`;
            if (view.transform !== transform) {
              view.transform = transform;
              view.root.style.transform = transform;
            }
            shownLabels++;
          }
        }
      });
      for (const v of agents.slice(model.agents.length)) v.group.visible = false;
      for (const view of labels.slice(model.agents.length)) view.root.hidden = true;
      let shownNoises = 0;
      noises.forEach((visual, i) => {
        const noise = model.noises[i];
        visual.ring.visible = noise !== undefined;
        visual.routes.forEach((line, r) => {
          const route = noise?.routes[r];
          line.visible = route !== undefined && route.length >= 2;
          if (route !== undefined && line.visible) writeLine(line.geometry, route, 0.1);
        });
        if (noise === undefined) return;
        shownNoises++;
        visual.material.opacity = 0.15 + 0.85 * noise.fade;
        visual.ring.position.set(noise.position.x, noise.position.y + 0.06, noise.position.z);
        visual.ring.scale.setScalar(Math.max(0.05, noise.radius * (1.15 - 0.15 * noise.fade)));
      });
      probe.visible = model.probe !== null;
      if (model.probe !== null) {
        probe.position.set(model.probe.point.x, model.probe.point.y, model.probe.point.z);
      }
      if (status !== undefined) {
        const text = model.status.join('\n');
        if (text !== statusText) status.textContent = statusText = text;
      }
      lastStats = {
        agents: model.agents.length,
        cones,
        labels: shownLabels,
        noises: shownNoises,
      };
    },
    stats() {
      return lastStats;
    },
    dispose() {
      root.removeFromParent();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      layer?.replaceChildren();
    },
  };
  return overlay;
}
