import { describe, expect, it } from 'vitest';
import {
  AnimationController,
  blend1dWeights,
  blend2dWeights,
  compileGraph,
  conditionHolds,
  warpActionTime,
  type ActionSample,
  type AnimParams,
  type MarkerEvent,
} from './controller';
import { parseClips, parseGraph, TEST_CLIPS, TEST_GRAPH, testGraph } from './fixtures';
import { clipTime, compileClip, compileRig, sampleClip } from './library';
import { boneAngleDeg, createPose, maxBoneDeltaDeg, quatFromEulerDeg } from './math';

const FRAME = 1 / 60;

const params = (
  over: Partial<AnimParams> & { values?: AnimParams['values'] } = {},
): AnimParams => ({
  values: {},
  timeScale: 1,
  action: null,
  ...over,
});

const LEGS = 1;
const ARMS = 2;

/** Rotation of `bone` in `pose` about x, degrees (the fixtures rotate about x only). */
function pitchOf(pose: Float64Array, bone: number): number {
  const x = pose[bone * 4] ?? 0;
  const w = pose[bone * 4 + 3] ?? 1;
  return (2 * Math.atan2(x, w) * 180) / Math.PI;
}

describe('AnimationController: crossfades', () => {
  it('AC-2: a 0.2 s crossfade from idle to run is 0.5/0.5 at 0.1 s, and layer weights sum to 1 on every sample', () => {
    const anim = new AnimationController(testGraph());
    const pose = createPose(3);
    const running = params({ values: { speed: 4 } });
    anim.update(0, running); // the transition starts
    const weightsAt: number[][] = [];
    for (let i = 0; i <= 18; i++) {
      if (i > 0) anim.update(FRAME, running);
      anim.evaluate(pose);
      const probe = anim.probe();
      for (const layer of probe.layers) {
        const sum = Object.values(layer.weights).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 9);
      }
      const base = probe.layers[0]?.weights ?? {};
      weightsAt.push([base['idle'] ?? 0, base['run'] ?? 0]);
    }
    const [idle, run] = weightsAt[6] ?? [];
    expect(idle).toBeCloseTo(0.5, 2);
    expect(run).toBeCloseTo(0.5, 2);
    expect(Math.abs((idle ?? 0) - 0.5)).toBeLessThanOrEqual(0.01);
    // Halfway, the legs are halfway between idle (0°) and run (90°).
    anim.update(0, running);
    expect(weightsAt[12]).toEqual([0, 1]);
    expect(anim.probe().layers[0]).toEqual({
      id: 'base',
      state: 'run',
      weights: { run: 1 },
      clip: 'anim-run',
    });
  });

  it('AC-2: the blended pose follows the weights', () => {
    const anim = new AnimationController(testGraph());
    const pose = createPose(3);
    const running = params({ values: { speed: 4 } });
    anim.update(0, running);
    for (let i = 0; i < 6; i++) anim.update(FRAME, running);
    anim.evaluate(pose);
    expect(pitchOf(pose, LEGS)).toBeCloseTo(45, 0);
  });

  it('an interrupted crossfade fades every outgoing state out of what it had', () => {
    const anim = new AnimationController(testGraph());
    anim.update(0, params({ values: { speed: 4 } }));
    anim.update(0.1, params({ values: { speed: 4 } }));
    anim.update(0, params({ values: { speed: 0 } })); // back to idle mid-fade
    expect(anim.probe().layers[0]?.weights).toEqual({ idle: 0.5, run: 0.5 });
    anim.update(0.1, params({ values: { speed: 0 } }));
    const weights = anim.probe().layers[0]?.weights ?? {};
    expect((weights['idle'] ?? 0) + (weights['run'] ?? 0)).toBeCloseTo(1, 9);
    expect(weights['run']).toBeCloseTo(0.25, 9);
    anim.update(0.2, params({ values: { speed: 0 } }));
    expect(anim.probe().layers[0]?.weights).toEqual({ idle: 1 });
  });
});

describe('AnimationController: layers', () => {
  it('a masked override layer replaces only its bones; an additive layer adds on top', () => {
    const anim = new AnimationController(testGraph());
    const pose = createPose(3);
    const action: ActionSample = {
      move: 'm',
      clip: 'anim-swing',
      key: 1,
      moveTick: 12,
      activeFrom: 12,
      totalTicks: 30,
    };
    anim.update(0, params({ values: { acting: true, speed: 4 }, action }));
    anim.update(1, params({ values: { acting: true, speed: 4 }, action }));
    anim.evaluate(pose);
    expect(pitchOf(pose, ARMS)).toBeCloseTo(90, 6); // the swing's hit pose
    expect(pitchOf(pose, LEGS)).toBeCloseTo(90, 6); // still running underneath
    expect(anim.probe().layers[1]).toEqual({
      id: 'action',
      state: 'attack',
      weights: { attack: 1 },
      clip: 'anim-swing',
    });
    expect(anim.probe().layers[2]?.clip).toBeNull(); // hit: none

    anim.update(FRAME, params({ values: { hitReact: true, speed: 4 } }));
    anim.evaluate(pose);
    const flinch = quatFromEulerDeg(0, 30, 0);
    const root = new Float64Array(4);
    root.set(pose.subarray(0, 4));
    expect(Array.from(root).map((v) => Math.round(v * 1e6) / 1e6)).toEqual(
      flinch.map((v) => Math.round(v * 1e6) / 1e6),
    );
    const identity = createPose(3);
    expect(boneAngleDeg(pose, identity, 0)).toBeCloseTo(30, 6);
  });

  it('additive and override layers respect partial mask weights', () => {
    const graph = testGraph();
    const masks = graph.rig.masks as Map<string, Float64Array>;
    masks.set('upper', Float64Array.from([0, 0, 0.5]));
    const layers = graph.layers.map((layer) =>
      layer.id === 'hit' ? { ...layer, mask: masks.get('upper') ?? null } : layer,
    );
    const anim = new AnimationController({ ...graph, layers });
    const pose = createPose(3);
    const action: ActionSample = {
      move: 'm',
      clip: 'anim-swing',
      key: 1,
      moveTick: 12,
      activeFrom: 12,
      totalTicks: 30,
    };
    anim.update(0, params({ values: { acting: true, hitReact: true }, action }));
    anim.evaluate(pose);
    expect(boneAngleDeg(pose, createPose(3), 0)).toBeCloseTo(0, 6); // root outside the flinch mask
    expect(boneAngleDeg(pose, createPose(3), LEGS)).toBeCloseTo(0, 6);
    expect(boneAngleDeg(pose, createPose(3), ARMS)).toBeGreaterThan(40); // half the swing + half the flinch
  });

  it('a "*" transition leaves any other state, never re-enters its target', () => {
    const graph = parseGraph({
      ...TEST_GRAPH,
      layers: [
        {
          id: 'base',
          initial: 'run',
          states: [
            { id: 'idle', motion: { kind: 'clip', clip: 'anim-idle' } },
            { id: 'run', motion: { kind: 'clip', clip: 'anim-run' } },
          ],
          transitions: [{ from: '*', to: 'idle', duration: 0.1 }],
        },
      ],
    });
    const anim = new AnimationController(compileGraph(graph, parseClips(TEST_CLIPS)));
    anim.update(0.05, params());
    anim.update(0.05, params());
    expect(anim.probe().layers[0]?.weights).toEqual({ idle: 1 });
  });

  it('a graph without layers evaluates to the rest pose', () => {
    const anim = new AnimationController({ ...testGraph(), layers: [] });
    const pose = createPose(3);
    pose[0] = 1;
    anim.update(1, params());
    anim.evaluate(pose);
    expect(maxBoneDeltaDeg(pose, createPose(3))).toBe(0);
    expect(anim.probe().layers).toEqual([]);
  });

  it('refuses to compile a graph naming a clip it was not given', () => {
    expect(() => compileGraph(parseGraph(TEST_GRAPH), [])).toThrow(/no clip "anim-idle"/);
    const bad = parseGraph(TEST_GRAPH);
    const layer = bad.layers[0];
    if (layer === undefined) throw new Error('no layer');
    expect(() =>
      compileGraph({ ...bad, layers: [{ ...layer, initial: 'nope' }] }, parseClips(TEST_CLIPS)),
    ).toThrow(/no state "nope"/);
  });
});

describe('AnimationController: blends', () => {
  it('1D weights are linear between neighbours and clamp at the ends', () => {
    const points = [{ at: 0 }, { at: 1.5 }, { at: 4 }];
    const out: number[] = [];
    blend1dWeights(points, -1, out);
    expect(out).toEqual([1, 0, 0]);
    blend1dWeights(points, 0.75, out);
    expect(out).toEqual([0.5, 0.5, 0]);
    blend1dWeights(points, 2.75, out);
    expect(out).toEqual([0, 0.5, 0.5]);
    blend1dWeights(points, 9, out);
    expect(out).toEqual([0, 0, 1]);
    blend1dWeights([{ at: 3 }], 9, out);
    expect(out).toEqual([1]);
  });

  it('2D weights are exact on a point and otherwise inverse-distance, summing to 1', () => {
    const points = [{ at: [0, 0] as const }, { at: [2, 0] as const }, { at: [0, 2] as const }];
    const out: number[] = [];
    blend2dWeights(points, 2, 0, out);
    expect(out).toEqual([0, 1, 0]);
    blend2dWeights(points, 1, 0, out);
    expect(out[0]).toBeCloseTo(out[1] ?? 0, 9);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('blend states sample every weighted clip on one shared phase', () => {
    const graph = parseGraph({
      ...TEST_GRAPH,
      layers: [
        {
          id: 'base',
          initial: 'move',
          states: [
            {
              id: 'move',
              motion: {
                kind: 'blend1d',
                param: 'speed',
                points: [
                  { at: 0, clip: 'anim-idle' },
                  { at: 2, clip: 'anim-run' },
                ],
              },
            },
            {
              id: 'strafe',
              motion: {
                kind: 'blend2d',
                x: 'speed',
                y: 'turnRate',
                points: [
                  { at: [0, 0], clip: 'anim-idle' },
                  { at: [2, 2], clip: 'anim-run' },
                ],
              },
            },
          ],
          transitions: [
            {
              from: 'move',
              to: 'strafe',
              duration: 0,
              when: [{ param: 'turnRate', op: '>', value: 1 }],
            },
          ],
        },
      ],
    });
    const anim = new AnimationController(compileGraph(graph, parseClips(TEST_CLIPS)));
    const markers: MarkerEvent[] = [];
    anim.onMarker = (e) => markers.push(e);
    const pose = createPose(3);
    expect(anim.probe().layers[0]?.clip).toBe('anim-idle'); // not yet advanced: the first point
    anim.update(0.1, params({ values: { speed: 1 } }));
    anim.evaluate(pose);
    expect(pitchOf(pose, LEGS)).toBeCloseTo(45, 6);
    anim.update(0, params({ values: { speed: 1.5 } }));
    // mw-e02.6: the probe names the blend's heaviest clip.
    expect(anim.probe().layers[0]?.clip).toBe('anim-run');
    // Idle is the heaviest clip at speed 0.5: its footstep (0.5 of its 1 s) fires as the phase passes it.
    for (let i = 0; i < 60; i++) anim.update(FRAME, params({ values: { speed: 0.5 } }));
    expect(markers.map((m) => [m.state, m.clip, m.kind])).toContainEqual([
      'move',
      'anim-idle',
      'footstep',
    ]);
    anim.update(0, params({ values: { speed: 2, turnRate: 2 } }));
    anim.update(FRAME, params({ values: { speed: 2, turnRate: 2 } }));
    anim.evaluate(pose);
    expect(pitchOf(pose, LEGS)).toBeCloseTo(90, 6);
    expect(anim.probe().layers[0]?.state).toBe('strafe');
    expect(anim.probe().layers[0]?.clip).toBe('anim-run');
  });
});

describe('AnimationController: conditions', () => {
  it('compares numbers with every operator, flags and strings with == and !=', () => {
    const p = params({ values: { speed: 2, grounded: true, actionPhase: 'active' } });
    const holds = (
      param: 'speed' | 'grounded' | 'actionPhase' | 'turnRate' | 'actionVerb' | 'acting',
      op: '==' | '!=' | '<' | '<=' | '>' | '>=',
      value: number | boolean | string,
    ) => conditionHolds({ param, op, value }, p);
    expect([
      holds('speed', '<', 3),
      holds('speed', '<=', 2),
      holds('speed', '>', 2),
      holds('speed', '>=', 2),
    ]).toEqual([true, true, false, true]);
    expect([holds('speed', '==', 2), holds('speed', '!=', 2)]).toEqual([true, false]);
    expect([holds('grounded', '==', true), holds('actionPhase', '!=', 'active')]).toEqual([
      true,
      false,
    ]);
    // Unpublished parameters read as 0, false and "none".
    expect([
      holds('turnRate', '==', 0),
      holds('acting', '==', false),
      holds('actionVerb', '==', 'none'),
    ]).toEqual([true, true, true]);
    // A relational operator on a non-number never holds.
    expect(holds('grounded', '>', 0)).toBe(false);
  });
});

describe('AnimationController: time', () => {
  it('holds every clip and crossfade while the time scale is 0', () => {
    const anim = new AnimationController(testGraph());
    const pose = createPose(3);
    const before = createPose(3);
    anim.update(0, params({ values: { speed: 4 } }));
    anim.update(0.05, params({ values: { speed: 4 } }));
    anim.evaluate(before);
    for (let i = 0; i < 10; i++) anim.update(FRAME, params({ values: { speed: 4 }, timeScale: 0 }));
    anim.evaluate(pose);
    expect(maxBoneDeltaDeg(pose, before)).toBe(0);
    expect(anim.probe().layers[0]?.weights['run']).toBeCloseTo(0.25, 9);
    anim.update(-1, params({ values: { speed: 4 }, timeScale: -1 })); // never runs backwards
    expect(anim.probe().layers[0]?.weights['run']).toBeCloseTo(0.25, 9);
  });

  it('fires loop markers once per pass, including across the wrap', () => {
    const anim = new AnimationController(testGraph());
    const markers: MarkerEvent[] = [];
    anim.onMarker = (e) => markers.push(e);
    anim.update(0.4, params());
    expect(markers).toEqual([]);
    anim.update(0.2, params());
    expect(markers).toEqual([
      { layer: 'base', state: 'idle', clip: 'anim-idle', kind: 'footstep', t: 0.5 },
    ]);
    anim.update(2, params()); // passes 1.5 and 2.5
    expect(markers).toHaveLength(3);
    anim.update(0, params());
    expect(markers).toHaveLength(3);
  });
});

describe('AnimationController: actions', () => {
  const swing = (moveTick: number, key = 1, clip = 'anim-swing'): ActionSample => ({
    move: 'swing',
    clip,
    key,
    moveTick,
    activeFrom: 12,
    totalTicks: 30,
  });

  it('AC-3: warps a clip so its 0.40 s hit marker lands on the move’s first active tick (12)', () => {
    const clip = { duration: 1, hitMarker: 0.4 };
    expect(warpActionTime(clip, { moveTick: 12, activeFrom: 12, totalTicks: 30 })).toBeCloseTo(
      0.4,
      12,
    );
    expect(warpActionTime(clip, { moveTick: 6, activeFrom: 12, totalTicks: 30 })).toBeCloseTo(
      0.2,
      12,
    );
    expect(warpActionTime(clip, { moveTick: 21, activeFrom: 12, totalTicks: 30 })).toBeCloseTo(
      0.7,
      12,
    );
    expect(warpActionTime(clip, { moveTick: 40, activeFrom: 12, totalTicks: 30 })).toBe(1);
    expect(warpActionTime(clip, { moveTick: -3, activeFrom: 12, totalTicks: 30 })).toBe(0);
    // No marker, or no startup: stretched over the move.
    expect(
      warpActionTime(
        { duration: 1, hitMarker: null },
        { moveTick: 15, activeFrom: 12, totalTicks: 30 },
      ),
    ).toBe(0.5);
    expect(warpActionTime(clip, { moveTick: 15, activeFrom: 0, totalTicks: 30 })).toBe(0.5);
  });

  it('AC-3: played tick by tick at 60 Hz, the hit marker fires on move tick 12', () => {
    const anim = new AnimationController(testGraph());
    const fired: number[] = [];
    let tick = 0;
    anim.onMarker = (e) => {
      if (e.kind === 'hit') fired.push(tick);
    };
    for (tick = 0; tick < 30; tick++) {
      anim.update(FRAME, params({ values: { acting: true }, action: swing(tick) }));
    }
    expect(fired).toEqual([12]);
  });

  it('plays the running move’s own clip, or the fallback when the rig has none', () => {
    const anim = new AnimationController(testGraph());
    const pose = createPose(3);
    anim.update(0, params({ values: { acting: true }, action: swing(30, 1, 'anim-unknown') }));
    anim.evaluate(pose);
    expect(pitchOf(pose, ARMS)).toBeCloseTo(60, 6); // anim-plain-swing's end
    const other = new AnimationController(testGraph());
    other.update(0, params({ values: { acting: true }, action: swing(30, 1, 'anim-flinch') }));
    other.evaluate(pose);
    expect(pitchOf(pose, ARMS)).toBeCloseTo(60, 6); // an additive clip is never an action clip
  });

  it('entering an action state before the sim reports a move starts the fallback at 0', () => {
    const anim = new AnimationController(testGraph());
    const pose = createPose(3);
    anim.update(0, params({ values: { acting: true } }));
    anim.update(0.5, params({ values: { acting: true } }));
    anim.evaluate(pose);
    expect(pitchOf(pose, ARMS)).toBeCloseTo(0, 6);
    // The move shows up: the state restarts on its run.
    anim.update(0, params({ values: { acting: true }, action: swing(12) }));
    expect(Object.keys(anim.probe().layers[1]?.weights ?? {})).toEqual(['attack']);
    anim.update(1, params({ values: { acting: true }, action: swing(12) }));
    anim.evaluate(pose);
    expect(pitchOf(pose, ARMS)).toBeCloseTo(90, 6);
  });

  it('a new run of a move restarts the action state with a short crossfade', () => {
    const anim = new AnimationController(testGraph());
    anim.update(0, params({ values: { acting: true }, action: swing(20) }));
    anim.update(0, params({ values: { acting: true }, action: swing(0, 2) }));
    const weights = anim.probe().layers[1]?.weights ?? {};
    expect(weights).toEqual({ attack: 1 });
    anim.update(0.04, params({ values: { acting: true }, action: swing(3, 2) }));
    expect(anim.probe().layers[1]?.weights['attack']).toBeCloseTo(1, 9);
  });

  it('a finished move holds its last pose while it fades out', () => {
    const anim = new AnimationController(testGraph());
    const pose = createPose(3);
    anim.update(0, params({ values: { acting: true }, action: swing(12) }));
    anim.update(0, params({ values: { acting: false } }));
    anim.update(0.05, params({ values: { acting: false } }));
    anim.evaluate(pose);
    expect(anim.probe().layers[1]?.weights).toEqual({ attack: 0.5, none: 0.5 });
    expect(pitchOf(pose, ARMS)).toBeCloseTo(45, 0);
  });
});

describe('clips', () => {
  it('AC-5: root translation in a clip is extracted as a velocity curve, never as a pose', () => {
    const rig = compileRig(parseGraph(TEST_GRAPH));
    const run = parseClips(TEST_CLIPS).find((c) => c.id === 'anim-run');
    if (run === undefined) throw new Error('no run clip');
    const clip = compileClip(run, rig);
    expect(clip.rootVelocity).toEqual([{ t: 0.25, velocity: [0, 0, -4] }]);
    // A pose is rotations only: four numbers per bone, no translation channel exists.
    const pose = createPose(3);
    sampleClip(clip, 0.3, pose);
    expect(pose).toHaveLength(rig.bones.length * 4);
  });

  it('wraps looping clip time and clamps one-shots; drops tracks of bones the rig lacks', () => {
    const rig = compileRig(parseGraph(TEST_GRAPH));
    const [idle, , swing] = parseClips(TEST_CLIPS).map((c) => compileClip(c, rig));
    if (idle === undefined || swing === undefined) throw new Error('fixtures');
    expect(clipTime(idle, 2.25)).toBe(0.25);
    expect(clipTime(idle, -0.25)).toBe(0.75);
    expect(clipTime(swing, 3)).toBe(1);
    expect(clipTime(swing, -1)).toBe(0);
    const [idleDef] = parseClips(TEST_CLIPS);
    if (idleDef === undefined) throw new Error('fixtures');
    const stray = compileClip(
      { ...idleDef, tracks: { tail: [{ t: 0, rot: [1, 2, 3] }] }, root: undefined },
      rig,
    );
    expect(stray.tracks).toEqual([]);
    expect(stray.rootVelocity).toEqual([]);
    const pose = createPose(3);
    sampleClip(swing, 0.2, pose);
    expect(pitchOf(pose, ARMS)).toBeCloseTo(45, 0);
    sampleClip(swing, 5, pose);
    expect(pitchOf(pose, ARMS)).toBeCloseTo(0, 6);
  });
});
