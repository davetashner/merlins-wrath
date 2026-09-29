import { describe, expect, it } from 'vitest';
import {
  ANIM_MAX_MARKER_DRIFT_TICKS,
  animMarkerDrift,
  checkAnimation,
  type DriftMove,
} from './anim-checks.ts';
import { loadGameContent } from './game-content.ts';
import type { LoadedEntry } from './loader.ts';
import { animClipSchema, type AnimClipDefInput } from './types/anim-clip.ts';
import { animGraphSchema, type AnimGraphDefInput } from './types/anim-graph.ts';

const graph = (id: string, layers?: AnimGraphDefInput['layers']): LoadedEntry => ({
  type: 'anim-graph',
  file: `data/anim-graph/${id}.json`,
  value: animGraphSchema.parse({
    id,
    notes: 'Test rig.',
    skeleton: [
      { bone: 'root', parent: null, offset: [0, 0, 0] },
      { bone: 'arm', parent: 'root', offset: [0, 0, 0] },
    ],
    layers: layers ?? [
      {
        id: 'base',
        initial: 'idle',
        states: [{ id: 'idle', motion: { kind: 'clip', clip: 'anim-idle' } }],
      },
      {
        id: 'hit',
        mode: 'additive',
        initial: 'none',
        states: [
          { id: 'none', motion: { kind: 'none' } },
          { id: 'react', motion: { kind: 'clip', clip: 'anim-react' } },
          { id: 'ghost', motion: { kind: 'clip', clip: 'anim-missing' } },
        ],
      },
    ],
  }),
});

const clip = (over: Partial<AnimClipDefInput> & { id: string }): LoadedEntry => ({
  type: 'anim-clip',
  file: `data/anim-clip/${over.id}.json`,
  value: animClipSchema.parse({
    notes: 'Test clip.',
    rig: 'rig',
    duration: 1,
    tracks: { root: [{ t: 0, rot: [0, 0, 0] }] },
    ...over,
  }),
});

describe('checkAnimation', () => {
  it('accepts clips of the rig with matching additive flags', () => {
    expect(
      checkAnimation([
        graph('rig'),
        clip({ id: 'anim-idle', tracks: { arm: [{ t: 0, rot: [1, 0, 0] }] } }),
        clip({ id: 'anim-react', additive: true }),
      ]),
    ).toEqual([]);
  });

  it('reports bones the rig lacks, other rigs’ clips and additive mismatches', () => {
    expect(
      checkAnimation([
        graph('rig'),
        graph('other', [
          {
            id: 'base',
            initial: 'idle',
            states: [{ id: 'idle', motion: { kind: 'clip', clip: 'anim-react' } }],
          },
        ]),
        clip({
          id: 'anim-idle',
          additive: true,
          tracks: { 'tail/tip': [{ t: 0, rot: [0, 0, 0] }] },
        }),
        clip({ id: 'anim-react' }),
        clip({ id: 'anim-orphan', rig: 'gone' }),
      ]),
    ).toEqual([
      {
        file: 'data/anim-clip/anim-idle.json',
        pointer: '/tracks/tail~1tip',
        message: 'clip "anim-idle" keys bone "tail/tip", which rig "rig" does not have',
      },
      {
        file: 'data/anim-graph/rig.json',
        pointer: '/layers/0/states/0/motion',
        message: 'additive clip "anim-idle" is played by override layer "base"',
      },
      {
        file: 'data/anim-graph/rig.json',
        pointer: '/layers/1/states/1/motion',
        message: 'clip "anim-react" is not additive but layer "hit" is',
      },
      {
        file: 'data/anim-graph/other.json',
        pointer: '/layers/0/states/0/motion',
        message: 'graph "other" state "idle" plays clip "anim-react" of rig "rig"',
      },
    ]);
  });
});

const hittingMove = (id: string, startup: number, anim: string): DriftMove => ({
  id,
  frames: { startup, active: 4 },
  hitbox: {},
  presentation: { anim },
});

describe('animMarkerDrift', () => {
  it('AC-3: a hit marker at 0.40 s is reported against a move whose first active tick is 12', () => {
    const drifts = animMarkerDrift(
      [hittingMove('swing', 12, 'anim-swing')],
      [{ id: 'anim-swing', markers: [{ kind: 'hit', t: 0.4 }] }],
    );
    expect(drifts).toEqual([
      {
        move: 'swing',
        clip: 'anim-swing',
        activeTick: 12,
        markerTick: 24,
        drift: 12,
        message:
          'clip "anim-swing" hit marker at 0.4 s (tick 24) drifts 12 ticks from move "swing"\'s first active tick 12',
      },
    ]);
  });

  it('AC-3: a marker within one tick of the move data is not reported; beyond one tick is', () => {
    const at = (t: number) =>
      animMarkerDrift(
        [hittingMove('swing', 12, 'anim-swing')],
        [
          {
            id: 'anim-swing',
            markers: [
              { kind: 'footstep', t: 0 },
              { kind: 'hit', t },
            ],
          },
        ],
      );
    expect(at(13 / 60)).toEqual([]);
    expect(at(11 / 60)).toEqual([]);
    expect(at(13.5 / 60).map((d) => d.drift)).toEqual([1.5]);
    expect(ANIM_MAX_MARKER_DRIFT_TICKS).toBe(1);
  });

  it('reports a hitting move whose clip has no hit marker; skips unknown clips and non-hitting moves', () => {
    const drifts = animMarkerDrift(
      [
        hittingMove('b-swing', 12, 'anim-swing'),
        hittingMove('a-unknown', 12, 'anim-nope'),
        { id: 'roll', frames: { startup: 2, active: 13 }, presentation: { anim: 'anim-roll' } },
      ],
      [
        { id: 'anim-swing', markers: [] },
        { id: 'anim-roll', markers: [] },
      ],
    );
    expect(drifts).toEqual([
      {
        move: 'b-swing',
        clip: 'anim-swing',
        activeTick: 12,
        markerTick: null,
        drift: null,
        message: 'move "b-swing" can hit but clip "anim-swing" has no hit marker',
      },
    ]);
  });

  it('AC-3: the shipped moves’ clips line up with their frame data', () => {
    const content = loadGameContent();
    expect(animMarkerDrift(content.all('move'), content.all('anim-clip'))).toEqual([]);
  });
});
