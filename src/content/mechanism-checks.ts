// Load-time mechanism checks (mw-e03.18): what a scene file can't check alone. Every signal graph a
// scene places must find its entities among the scene's spawns: each name a graph node binds (a
// lever's, a receiver's, a sensor's `entity`) is a spawn id, or the scene's `bindings` map it to one.
// A typo fails in CI, not when the scene loads in play. A missing graph is already reported by the
// loader's reference check. Issues name the scene file, the JSON pointer and the unbound name.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { SceneDef } from './types/scene.ts';
import type { SignalGraphEntry } from './types/signal-graph.ts';

/** The entity names a graph's nodes bind, in node order without repeats. */
function boundNames(graph: SignalGraphEntry): string[] {
  const names = graph.nodes.flatMap((node) => {
    const { entity } = node as { readonly entity?: string };
    return entity === undefined ? [] : [entity];
  });
  return [...new Set(names)];
}

/** The content check for scenes' signal graphs: every name they bind is a spawn of the scene. */
export const checkSceneSignals: ContentCheck = (entries) => {
  const graphs = new Map<string, SignalGraphEntry>();
  for (const { type, value } of entries) {
    if (type === 'signal-graph') graphs.set(value.id, value as SignalGraphEntry);
  }
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'scene') continue;
    const scene = value as SceneDef;
    const spawns = new Set(scene.spawns.map((spawn) => spawn.id));
    scene.signals.forEach((signal, index) => {
      const graph = graphs.get(signal.graph.id);
      if (graph === undefined) return;
      for (const name of boundNames(graph)) {
        const id = signal.bindings[name] ?? name;
        if (spawns.has(id)) continue;
        issues.push({
          file,
          pointer: `/signals/${String(index)}`,
          message: `scene:${scene.id} places signal graph "${graph.id}", whose "${name}" binds spawn "${id}", which the scene does not have`,
        });
      }
    });
  }
  return issues;
};
