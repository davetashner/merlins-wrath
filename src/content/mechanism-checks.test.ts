import { describe, expect, it } from 'vitest';
import { gameContentSources } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { checkSceneSignals } from './mechanism-checks.ts';
import { contentChecks, contentTypes } from './registry.ts';
import { ContentRef } from './schema.ts';

const file = (path: string, json: unknown): ContentSource => ({ path, text: JSON.stringify(json) });

function loadIssues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

const scene = (signals: unknown) =>
  file('src/content/data/scene/wired.json', {
    id: 'wired',
    name: 'Wired',
    camera: { position: [0, 5, -5], target: [0, 0, 0] },
    placements: [{ piece: 'floor', at: [0, 0, 0] }],
    spawns: [
      { id: 'north-gate', at: [0, 0, 5], door: { profile: 'portcullis' } },
      { id: 'lever', at: [1, 0, 4], switch: { kind: 'lever' } },
    ],
    signals,
  });

describe('scene signal checks (mw-e03.18)', () => {
  it('reports every name a placed graph binds that is not a spawn of the scene', () => {
    expect(loadIssues([scene([{ graph: 'mechanism-room', bindings: {} }])])).toEqual([
      'src/content/data/scene/wired.json#/signals/0: scene:wired places signal graph "mechanism-room", whose "north-lever" binds spawn "north-lever", which the scene does not have',
      'src/content/data/scene/wired.json#/signals/0: scene:wired places signal graph "mechanism-room", whose "east-button" binds spawn "east-button", which the scene does not have',
      'src/content/data/scene/wired.json#/signals/0: scene:wired places signal graph "mechanism-room", whose "east-door" binds spawn "east-door", which the scene does not have',
      'src/content/data/scene/wired.json#/signals/0: scene:wired places signal graph "mechanism-room", whose "floor-crank" binds spawn "floor-crank", which the scene does not have',
      'src/content/data/scene/wired.json#/signals/0: scene:wired places signal graph "mechanism-room", whose "trapdoor" binds spawn "trapdoor", which the scene does not have',
    ]);
  });

  it('leaves a missing graph to the reference check', () => {
    expect(loadIssues([scene([{ graph: 'no-such-graph' }])])).toEqual([
      expect.stringContaining('no-such-graph'),
    ]);
  });

  it('skips a graph the content does not have (the reference check reports it)', () => {
    const value = {
      id: 'wired',
      spawns: [],
      signals: [{ graph: new ContentRef('signal-graph', 'missing'), bindings: {} }],
    };
    expect(checkSceneSignals([{ type: 'scene', file: 'wired.json', value }])).toEqual([]);
  });

  it('accepts renamed bindings', () => {
    const graph = file('src/content/data/signal-graph/gate.json', {
      id: 'gate',
      name: 'Gate',
      notes: 'Test.',
      nodes: [
        { id: 'pull', kind: 'lever', entity: 'gate-lever' },
        { id: 'gate', kind: 'receiver', receiver: 'door', entity: 'north-gate' },
      ],
      wires: [{ from: 'pull', to: 'gate' }],
    });
    expect(
      loadIssues([graph, scene([{ graph: 'gate', bindings: { 'gate-lever': 'lever' } }])]),
    ).toEqual([]);
  });

  it('reports a checkpoint that is not a volume node of its graph (mw-e01.4)', () => {
    const graph = file('src/content/data/signal-graph/gate.json', {
      id: 'gate',
      name: 'Gate',
      notes: 'Test.',
      nodes: [
        {
          id: 'step',
          kind: 'volume',
          shape: { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 1 },
        },
        { id: 'pull', kind: 'lever', entity: 'lever' },
        { id: 'gate', kind: 'receiver', receiver: 'door', entity: 'north-gate' },
      ],
      wires: [
        { from: 'pull', to: 'gate' },
        { from: 'step.enter', to: 'gate' },
      ],
    });
    expect(loadIssues([graph, scene([{ graph: 'gate', checkpoints: ['step'] }])])).toEqual([]);
    expect(
      loadIssues([graph, scene([{ graph: 'gate', checkpoints: ['step', 'pull', 'nowhere'] }])]),
    ).toEqual([
      'src/content/data/scene/wired.json#/signals/0/checkpoints/1: scene:wired marks "pull" of signal graph "gate" as a checkpoint, but the graph has no volume "pull"',
      'src/content/data/scene/wired.json#/signals/0/checkpoints/2: scene:wired marks "nowhere" of signal graph "gate" as a checkpoint, but the graph has no volume "nowhere"',
    ]);
  });
});
