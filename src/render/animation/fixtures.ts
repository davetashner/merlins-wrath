// Test fixtures for the animation runtime (mw-e02.20): a three-bone rig ("root", "legs", "arms", arms
// masked as "upper") with clips whose rotations are easy to read back. Parsed through the real
// content schemas, so fixtures are exactly what the loader would hand the runtime.

import {
  animClipSchema,
  animGraphSchema,
  type AnimClipDef,
  type AnimClipDefInput,
  type AnimGraphDef,
  type AnimGraphDefInput,
} from '@content/index';
import { compileGraph, type CompiledGraph } from './controller';

/** Clips of the test rig. */
export const TEST_CLIPS: readonly AnimClipDefInput[] = [
  {
    id: 'anim-idle',
    notes: 'legs at 0°',
    rig: 'test-rig',
    duration: 1,
    loop: true,
    tracks: { legs: [{ t: 0, rot: [0, 0, 0] }] },
    markers: [{ kind: 'footstep', t: 0.5 }],
  },
  {
    id: 'anim-run',
    notes: 'legs at 90° about x',
    rig: 'test-rig',
    duration: 0.5,
    loop: true,
    tracks: { legs: [{ t: 0, rot: [90, 0, 0] }] },
    root: [
      { t: 0, pos: [0, 0, 0] },
      { t: 0.5, pos: [0, 0, -2] },
    ],
  },
  {
    id: 'anim-swing',
    notes: 'arms 0° → 90° at the hit marker (0.40 s) → 0°',
    rig: 'test-rig',
    duration: 1,
    tracks: {
      arms: [
        { t: 0, rot: [0, 0, 0] },
        { t: 0.4, rot: [90, 0, 0] },
        { t: 1, rot: [0, 0, 0] },
      ],
    },
    markers: [{ kind: 'hit', t: 0.4 }],
  },
  {
    id: 'anim-plain-swing',
    notes: 'arms 0° → 60°, no markers',
    rig: 'test-rig',
    duration: 1,
    tracks: {
      arms: [
        { t: 0, rot: [0, 0, 0] },
        { t: 1, rot: [60, 0, 0] },
      ],
    },
  },
  {
    id: 'anim-flinch',
    notes: 'additive: +30° about y on every bone',
    rig: 'test-rig',
    duration: 0.5,
    additive: true,
    tracks: {
      root: [{ t: 0, rot: [0, 30, 0] }],
      legs: [{ t: 0, rot: [0, 30, 0] }],
      arms: [{ t: 0, rot: [0, 30, 0] }],
    },
  },
  {
    id: 'anim-other-rig',
    notes: 'belongs to another rig',
    rig: 'other-rig',
    duration: 1,
    tracks: { legs: [{ t: 0, rot: [45, 0, 0] }] },
  },
];

/** The test graph: base idle ⇄ run by speed; action layer on "upper"; additive flinch layer. */
export const TEST_GRAPH: AnimGraphDefInput = {
  id: 'test-rig',
  notes: 'Runtime test rig.',
  skeleton: [
    { bone: 'root', parent: null, offset: [0, 1, 0] },
    { bone: 'legs', parent: 'root', offset: [0, -0.5, 0] },
    { bone: 'arms', parent: 'root', offset: [0, 0.5, 0] },
  ],
  masks: { upper: ['arms'] },
  layers: [
    {
      id: 'base',
      initial: 'idle',
      states: [
        { id: 'idle', motion: { kind: 'clip', clip: 'anim-idle' } },
        { id: 'run', motion: { kind: 'clip', clip: 'anim-run' } },
      ],
      transitions: [
        { from: 'idle', to: 'run', duration: 0.2, when: [{ param: 'speed', op: '>', value: 1 }] },
        { from: 'run', to: 'idle', duration: 0.2, when: [{ param: 'speed', op: '<=', value: 1 }] },
      ],
    },
    {
      id: 'action',
      mask: 'upper',
      initial: 'none',
      states: [
        { id: 'none', motion: { kind: 'none' } },
        { id: 'attack', motion: { kind: 'action', fallback: 'anim-plain-swing' } },
      ],
      transitions: [
        {
          from: 'none',
          to: 'attack',
          duration: 0,
          when: [{ param: 'acting', op: '==', value: true }],
        },
        {
          from: 'attack',
          to: 'none',
          duration: 0.1,
          when: [{ param: 'acting', op: '!=', value: true }],
        },
      ],
    },
    {
      id: 'hit',
      mode: 'additive',
      initial: 'none',
      states: [
        { id: 'none', motion: { kind: 'none' } },
        { id: 'flinch', motion: { kind: 'clip', clip: 'anim-flinch' } },
      ],
      transitions: [
        {
          from: 'none',
          to: 'flinch',
          duration: 0,
          when: [{ param: 'hitReact', op: '==', value: true }],
        },
        {
          from: 'flinch',
          to: 'none',
          duration: 0,
          when: [{ param: 'hitReact', op: '==', value: false }],
        },
      ],
    },
  ],
};

/** Parses a graph input as the loader would (refs, defaults). */
export const parseGraph = (graph: AnimGraphDefInput): AnimGraphDef => animGraphSchema.parse(graph);
/** Parses clip inputs as the loader would. */
export const parseClips = (clips: readonly AnimClipDefInput[]): AnimClipDef[] =>
  clips.map((c) => animClipSchema.parse(c));

/** The compiled test graph. */
export function testGraph(graph: AnimGraphDefInput = TEST_GRAPH): CompiledGraph {
  return compileGraph(parseGraph(graph), parseClips(TEST_CLIPS));
}
