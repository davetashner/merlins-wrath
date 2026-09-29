import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadContent } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { describeContent } from '../testing.ts';
import type { AnimClipDefInput } from './anim-clip.ts';
import {
  ANIM_PARAMETER_NAMES,
  ANIM_PARAMETERS,
  animGraphSchema,
  motionClips,
  type AnimGraphDefInput,
} from './anim-graph.ts';

const skeleton: AnimGraphDefInput['skeleton'] = [
  { bone: 'root', parent: null, offset: [0, 1, 0] },
  { bone: 'arm', parent: 'root', offset: [0.2, 0, 0], shape: { size: [0.1, 0.3, 0.1] } },
];

const graph = (over: Partial<AnimGraphDefInput> = {}): AnimGraphDefInput => ({
  id: 'rig',
  notes: 'Test rig.',
  skeleton,
  masks: { arms: ['arm'] },
  layers: [
    {
      id: 'base',
      initial: 'idle',
      states: [
        { id: 'idle', motion: { kind: 'clip', clip: 'anim-idle' } },
        {
          id: 'move',
          motion: {
            kind: 'blend1d',
            param: 'speed',
            points: [
              { at: 0, clip: 'anim-idle' },
              { at: 2, clip: 'anim-idle' },
            ],
          },
        },
      ],
      transitions: [
        { from: 'idle', to: 'move', when: [{ param: 'speed', op: '>', value: 0.1 }] },
        { from: '*', to: 'idle', duration: 0.3 },
      ],
    },
  ],
  ...over,
});

const clip = (id: string, over: Partial<AnimClipDefInput> = {}): AnimClipDefInput => ({
  id,
  notes: 'Test clip.',
  rig: 'rig',
  duration: 1,
  tracks: { arm: [{ t: 0, rot: [0, 0, 0] }] },
  ...over,
});

const source = (type: string, id: string, value: unknown) => ({
  path: `data/${type}/${id}.json`,
  text: JSON.stringify(value),
});

const load = (graphValue: AnimGraphDefInput, clips: AnimClipDefInput[] = [clip('anim-idle')]) =>
  loadContent(
    contentTypes,
    [
      source('anim-graph', graphValue.id, graphValue),
      ...clips.map((c) => source('anim-clip', c.id, c)),
    ],
    contentChecks,
  );

const loadIssues = (graphValue: AnimGraphDefInput, clips?: AnimClipDefInput[]) => {
  try {
    load(graphValue, clips);
  } catch (error) {
    if (error instanceof ContentLoadError) return error.issues;
    throw error;
  }
  return [];
};

const problems = (value: unknown) =>
  (animGraphSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describeContent(
  'anim-graph',
  'plays only its own rig’s clips, all in the manifest',
  (entry, content) => {
    for (const layer of entry.layers) {
      for (const state of layer.states) {
        for (const id of motionClips(state.motion)) {
          const found = content.get('anim-clip', id);
          expect(found.rig.id).toBe(entry.id);
          expect(found.additive).toBe(layer.mode === 'additive');
        }
      }
    }
    expect(entry.layers[0]?.id).toBe('base');
  },
);

describe('animation graph schema', () => {
  it('loads a valid graph and fills defaults', () => {
    const loaded = load(graph()).get('anim-graph', 'rig');
    expect(loaded.layers[0]?.mode).toBe('override');
    expect(loaded.layers[0]?.transitions[0]?.duration).toBe(0.2);
    expect(loaded.layers[0]?.transitions[1]?.when).toEqual([]);
    expect(loaded.skeleton[1]?.shape?.center).toEqual([0, 0, 0]);
  });

  it('AC-1: a transition to an unknown state fails validation naming the graph file and path', () => {
    const bad = graph();
    const base = bad.layers[0];
    if (base === undefined) throw new Error('no base');
    const issues = loadIssues({
      ...bad,
      layers: [{ ...base, transitions: [{ from: 'idle', to: 'sprint' }] }],
    });
    // (The clip that names the rejected graph as its rig is reported too, in its own file.)
    expect(issues.filter((i) => i.file.includes('anim-graph'))).toEqual([
      {
        file: 'data/anim-graph/rig.json',
        pointer: '/layers/0/transitions/0/to',
        message:
          'graph "rig": transition to unknown state "sprint" in layer "base" (at layers[0].transitions[0].to)',
      },
    ]);
  });

  it('AC-1: a clip id missing from the clip manifest fails validation naming the graph file and path', () => {
    const issues = loadIssues(graph(), [clip('anim-other')]);
    expect(issues).toEqual([
      {
        file: 'data/anim-graph/rig.json',
        pointer: '/layers/0/states/0/motion/clip',
        message: 'anim-graph:rig references missing anim-clip:anim-idle',
      },
      {
        file: 'data/anim-graph/rig.json',
        pointer: '/layers/0/states/1/motion/points/0/clip',
        message: 'anim-graph:rig references missing anim-clip:anim-idle',
      },
      {
        file: 'data/anim-graph/rig.json',
        pointer: '/layers/0/states/1/motion/points/1/clip',
        message: 'anim-graph:rig references missing anim-clip:anim-idle',
      },
    ]);
  });

  it('checks the skeleton: unique bones, parents listed first, exactly one root', () => {
    expect(
      problems(
        graph({
          skeleton: [
            { bone: 'root', parent: null, offset: [0, 0, 0] },
            { bone: 'root', parent: 'root', offset: [0, 0, 0] },
            { bone: 'leg', parent: 'foot', offset: [0, 0, 0] },
            { bone: 'foot', parent: null, offset: [0, 0, 0] },
          ],
          masks: { arms: ['arm'] },
        }),
      ),
    ).toEqual([
      'skeleton.1.bone: graph "rig": bone "root" is listed twice',
      'skeleton.2.parent: graph "rig": parent "foot" must be a bone listed before "leg"',
      'skeleton.3.parent: graph "rig": only the first bone may be the root',
      'skeleton: graph "rig": needs exactly one root bone (parent null), has 2',
      'masks.arms.0: graph "rig": mask bone "arm" is not in the skeleton',
    ]);
  });

  it('checks layers: base unmasked override, known masks, unique ids, initial and from states', () => {
    const base = graph().layers[0];
    if (base === undefined) throw new Error('no base');
    expect(
      problems(
        graph({
          layers: [
            { ...base, mask: 'arms' },
            {
              id: 'base',
              mode: 'additive',
              mask: 'legs',
              initial: 'nope',
              states: [
                { id: 'a', motion: { kind: 'none' } },
                { id: 'a', motion: { kind: 'action', fallback: 'anim-idle' } },
              ],
              transitions: [{ from: 'b', to: 'a' }],
            },
          ],
        }),
      ),
    ).toEqual([
      'layers.0: graph "rig": the first (base) layer must be an unmasked override layer',
      'layers.1.id: graph "rig": layer "base" is listed twice',
      'layers.1.mask: graph "rig": unknown mask "legs"',
      'layers.1.states.1.id: graph "rig": state "a" is listed twice',
      'layers.1.initial: graph "rig": unknown state "nope" in layer "base"',
      'layers.1.transitions.0.from: graph "rig": transition from unknown state "b" in layer "base"',
    ]);
    expect(problems(graph({ layers: [{ ...base, mode: 'additive' }] }))).toEqual([
      'layers.0: graph "rig": the first (base) layer must be an unmasked override layer',
    ]);
  });

  it('checks conditions against each parameter’s kind', () => {
    const base = graph().layers[0];
    if (base === undefined) throw new Error('no base');
    const when = (
      w: NonNullable<AnimGraphDefInput['layers'][number]['transitions']>[number]['when'],
    ) =>
      problems(
        graph({ layers: [{ ...base, transitions: [{ from: 'idle', to: 'move', when: w }] }] }),
      );
    expect(
      when([
        { param: 'speed', op: '==', value: true },
        { param: 'acting', op: '>', value: 1 },
        { param: 'actionPhase', op: '==', value: 'windup' },
        { param: 'actionVerb', op: '!=', value: 'attack' },
        { param: 'hitReact', op: '!=', value: false },
      ]),
    ).toEqual([
      'layers.0.transitions.0.when.0.value: graph "rig": speed is a number',
      'layers.0.transitions.0.when.1.op: graph "rig": acting is a boolean: use == or !=',
      'layers.0.transitions.0.when.1.value: graph "rig": acting is a boolean',
      'layers.0.transitions.0.when.2.value: graph "rig": actionPhase is one of: none, startup, active, recovery',
    ]);
  });

  it('checks blends: numeric parameters, ascending 1D points', () => {
    const base = graph().layers[0];
    if (base === undefined) throw new Error('no base');
    const states: AnimGraphDefInput['layers'][number]['states'] = [
      { id: 'idle', motion: { kind: 'clip', clip: 'anim-idle' } },
      {
        id: 'move',
        motion: {
          kind: 'blend1d',
          param: 'grounded',
          points: [
            { at: 1, clip: 'anim-idle' },
            { at: 1, clip: 'anim-idle' },
          ],
        },
      },
      {
        id: 'turn',
        motion: {
          kind: 'blend2d',
          x: 'speed',
          y: 'actionVerb',
          points: [{ at: [0, 0], clip: 'anim-idle' }],
        },
      },
    ];
    expect(problems(graph({ layers: [{ ...base, states }] }))).toEqual([
      'layers.0.states.1.motion.param: graph "rig": blend parameter grounded must be a number',
      'layers.0.states.1.motion.points.1.at: graph "rig": blend points must be in strictly ascending order',
      'layers.0.states.2.motion.y: graph "rig": blend parameter actionVerb must be a number',
    ]);
  });

  it('names every parameter it publishes, and lists clips per motion', () => {
    expect(ANIM_PARAMETER_NAMES).toEqual(Object.keys(ANIM_PARAMETERS));
    const parsed = animGraphSchema.parse({
      ...graph(),
      layers: [
        {
          id: 'base',
          initial: 'a',
          states: [
            { id: 'a', motion: { kind: 'none' } },
            { id: 'b', motion: { kind: 'action', fallback: 'anim-x' } },
            {
              id: 'c',
              motion: {
                kind: 'blend2d',
                x: 'speed',
                y: 'turnRate',
                points: [{ at: [0, 0], clip: 'anim-y' }],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.layers[0]?.states.map((s) => motionClips(s.motion))).toEqual([
      [],
      ['anim-x'],
      ['anim-y'],
    ]);
  });
});
