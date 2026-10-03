import type { AiAgentSnapshot, AiDebugSnapshot } from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  ALERT_COLOURS,
  LABEL_BARS,
  labelLines,
  MAX_RING_RADIUS,
  NO_BRAIN_COLOUR,
  overlayAgent,
  overlayModel,
  overlayNoise,
  pickAgent,
  ringRadius,
  sourceName,
  type NoiseMark,
} from './model';

const BARE: AiAgentSnapshot = {
  entity: 4,
  creature: null,
  feet: { x: 0, y: 0, z: 0 },
  eye: { x: 0, y: 1.6, z: 0 },
  facing: { x: 0, y: 0, z: 1 },
  cone: null,
  hearing: null,
  brain: null,
  awareness: [],
  lkp: null,
  route: null,
};

const BRAIN: NonNullable<AiAgentSnapshot['brain']> = {
  behaviour: 'fixture-guard',
  state: 'investigating',
  timeInState: 3.25,
  postAlert: true,
  activity: 'investigate',
  step: 1,
  primitive: 'move-to',
  nodePath: ['investigating', 'investigate', '1:move-to'],
  scores: [
    ['investigate', 0.8],
    ['look-around', 0.25],
  ],
};

const GUARD: AiAgentSnapshot = {
  entity: 7,
  creature: 'fixture-guard',
  feet: { x: 2, y: 0, z: 3 },
  eye: { x: 2, y: 1.62, z: 3 },
  facing: { x: 1, y: 0, z: 0 },
  cone: {
    primaryHalfAngle: 35,
    peripheralHalfAngle: 80,
    verticalHalfAngle: 40,
    nearRange: 8,
    farRange: 20,
  },
  hearing: { thresholdDb: 30, range: 25 },
  brain: BRAIN,
  awareness: ['entity:1', 'sound:throw', 'anomaly:door', 'x'].map((source, i) => ({
    source,
    level: 0.9 - i * 0.2,
    quietS: 0,
    sense: i === 0 ? 'sight' : 'hearing',
    kind: i === 0 ? 'seen-target' : 'heard-noise',
    position: { x: 1, y: 0, z: 1 },
  })),
  lkp: { position: { x: 5, y: 0, z: 5.04 }, confidence: 0.66 },
  route: {
    status: 'ready',
    goal: { x: 9, y: 0, z: 9 },
    points: [
      { x: 4, y: 0, z: 4 },
      { x: 9, y: 0, z: 9 },
    ],
  },
};

const DETAILED: AiAgentSnapshot = {
  ...GUARD,
  detail: {
    entity: 7,
    behaviour: 'fixture-guard',
    state: 'investigating',
    timeInState: 3.25,
    postAlert: true,
    activity: 'investigate',
    step: 1,
    primitive: 'move-to',
    path: ['investigating', 'investigate', '1:move-to'],
    scores: [
      {
        activity: 'investigate',
        score: 0.8,
        considerations: [{ input: 'awareness', value: 0.654, curve: { kind: 'linear' } as never }],
      },
      { activity: 'look-around', score: 0.25, considerations: [] },
    ],
  },
};

const THRESHOLDS = { suspicious: 0.3, investigating: 0.6, detected: 1 };

describe('AI debug overlay model (mw-e11.17)', () => {
  it('names perceived sources briefly', () => {
    expect(sourceName('entity:12')).toBe('#12');
    expect(sourceName('sound:footstep')).toBe('♪footstep');
    expect(sourceName('anomaly:door-open')).toBe('?door-open');
    expect(sourceName('smell')).toBe('smell');
  });

  it('a noise ring reaches the 30 dB floor, between 1 m and the cap', () => {
    expect(ringRadius(50)).toBeCloseTo(10, 9);
    expect(ringRadius(10)).toBe(1);
    expect(ringRadius(200)).toBe(MAX_RING_RADIUS);
    expect(ringRadius(40, 20)).toBeCloseTo(10, 9);
  });

  it('labels: state and time in state, node path, top scores, LKP and route', () => {
    expect(labelLines(GUARD, false)).toEqual([
      'investigating 3.3s · on edge',
      'investigate › 1:move-to',
      'investigate 0.80 | look-around 0.25',
      'LKP (5.0, 0.0, 5.0) 66%',
      'route ready · 2 pts',
    ]);
    const idle = {
      ...BRAIN,
      state: 'unaware',
      postAlert: false,
      nodePath: ['unaware'],
      scores: [],
    } as const;
    expect(labelLines({ ...BARE, brain: idle }, false)).toEqual(['unaware 3.3s', 'idle']);
    expect(labelLines(BARE, true)).toEqual(['no brain (AI not running)']);
  });

  it('the selected agent’s label adds its senses and each top score’s considerations', () => {
    expect(labelLines(DETAILED, true).slice(5)).toEqual([
      'sight 35°/80° 8–20 m',
      'hearing 30 dB ≤ 25 m',
      '  investigate: awareness=0.65',
      '  look-around: (no considerations)',
    ]);
    expect(labelLines(GUARD, true).slice(5)).toEqual([
      'sight 35°/80° 8–20 m',
      'hearing 30 dB ≤ 25 m',
    ]);
  });

  it('an overlay agent is tinted by alert state (grey without a brain) with its route from its feet', () => {
    const marks = [0.3, 0.6, 1];
    const drawn = overlayAgent(GUARD, false, marks);
    expect(drawn).toMatchObject({
      entity: 7,
      selected: false,
      colour: ALERT_COLOURS.investigating,
      hearingRange: 25,
      cone: GUARD.cone,
      lkp: GUARD.lkp,
      route: [GUARD.feet, ...(GUARD.route?.points ?? [])],
      label: { anchor: { x: 2, y: 2.12, z: 3 }, title: '#7 fixture-guard', marks },
    });
    expect(drawn.label.bars).toHaveLength(LABEL_BARS);
    expect(drawn.label.bars[0]).toEqual({ name: '#1 sight', level: 0.9 });
    expect(overlayAgent(GUARD, true, marks).label.bars).toHaveLength(4);
    const bare = overlayAgent(BARE, false, marks);
    expect(bare).toMatchObject({
      colour: NO_BRAIN_COLOUR,
      hearingRange: null,
      route: [],
      label: { title: '#4 agent' },
    });
    for (const state of Object.keys(ALERT_COLOURS)) {
      expect(ALERT_COLOURS[state as keyof typeof ALERT_COLOURS]).toBeGreaterThan(0);
    }
  });

  it('noise rings fade over their lifetime and are gone after it', () => {
    const mark: NoiseMark = {
      tick: 100,
      position: { x: 1, y: 0, z: 1 },
      loudness: 50,
      kind: 'pot',
      routes: [],
      heard: [],
    };
    expect(overlayNoise(mark, 100, 120)?.fade).toBe(1);
    expect(overlayNoise(mark, 160, 120)?.fade).toBeCloseTo(0.5, 9);
    expect(overlayNoise(mark, 99, 120)?.fade).toBe(1); // a mark from the future reads as new
    expect(overlayNoise(mark, 220, 120)).toBeUndefined();
  });

  it('the model: agents, live noise rings, the probe and the status lines', () => {
    const snapshot: AiDebugSnapshot = { tick: 130, agents: [GUARD, BARE], thresholds: THRESHOLDS };
    const noises: NoiseMark[] = [
      { tick: 0, position: { x: 0, y: 0, z: 0 }, loudness: 60, kind: 'old', routes: [], heard: [] },
      {
        tick: 120,
        position: { x: 3, y: 0, z: 3 },
        loudness: 62.4,
        kind: 'pot',
        routes: [
          [
            { x: 3, y: 0, z: 3 },
            { x: 2, y: 0, z: 3 },
          ],
        ],
        heard: [41.6],
      },
      {
        tick: 125,
        position: { x: 1, y: 0, z: 1 },
        loudness: 40,
        kind: 'step',
        routes: [],
        heard: [],
      },
    ];
    const model = overlayModel(snapshot, {
      selected: 7,
      frozen: true,
      noises,
      noiseTicks: 120,
      probe: { point: { x: 1, y: 0, z: 2 }, level: 0.4 },
    });
    expect(model.agents.map((a) => [a.entity, a.selected])).toEqual([
      [7, true],
      [4, false],
    ]);
    expect(model.agents[0]?.label.marks).toEqual([0.3, 0.6, 1]);
    expect(model.noises).toHaveLength(2);
    expect(model.probe).toEqual({ point: { x: 1, y: 0, z: 2 } });
    expect(model.status).toEqual([
      'AI debug · tick 130 · FROZEN (ai.step)',
      '2 agents · selected #7',
      'noise pot 62 dB → heard 42 dB',
      'noise step 40 dB',
      'light 0.40 at (1.0, 0.0, 2.0)',
    ]);
    const plain = overlayModel(
      { tick: 1, agents: [], thresholds: THRESHOLDS },
      { selected: undefined, frozen: false, noises: [], noiseTicks: 120, probe: undefined },
    );
    expect(plain).toEqual({
      agents: [],
      noises: [],
      probe: null,
      status: ['AI debug · tick 1', '0 agents · selected none'],
    });
  });

  it('picks the nearest agent whose body the ray passes within a metre of, in front of it', () => {
    const a = { entity: 1, feet: { x: 0, y: 0, z: -5 }, eye: { x: 0, y: 1.6, z: -5 } };
    const b = { entity: 2, feet: { x: 0.5, y: 0, z: -10 }, eye: { x: 0.5, y: 1.6, z: -10 } };
    const c = { entity: 3, feet: { x: 0, y: 0, z: 5 }, eye: { x: 0, y: 1.6, z: 5 } }; // behind
    const forward = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    expect(pickAgent(forward, [b, a, c])).toBe(1);
    expect(pickAgent(forward, [b, c])).toBe(2);
    const aside = { origin: { x: 5, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    expect(pickAgent(aside, [a, b, c])).toBeUndefined();
    expect(pickAgent(forward, [])).toBeUndefined();
  });
});
