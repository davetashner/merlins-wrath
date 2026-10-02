// Candidate A: behaviour tree (mw-e11.1 spike). A JSON tree of selector / sequence / condition /
// action nodes, compiled once into a flat array (node ids = depth-first index). Per-agent memory is
// plain data: the running leaf and each memory-sequence's resume index. Semantics:
//
// - selector: reactive — ticks children from the first every think, so a higher-priority branch
//   pre-empts a running lower one (which is halted);
// - sequence: with `"memory": true` it resumes at its running child, otherwise restarts each think;
// - condition: an input threshold test (`{ "input": "awareness", "gte": 0.6 }`), or `any`/`all` of them;
// - action: a shared primitive (`{ "do": "move-to", "target": "stimulus" }`). Starting it returns
//   running; its result is read at the next think.
//
// The alert state is not part of the formalism: the tree writes it with `set-alert` actions and reads
// it back through the `alert.<state>` input.

import { compileTest, type InputTest, type Test } from '../shared/inputs';
import {
  ALERT_STATES,
  type Brain,
  type PrimitiveSpec,
  type ScenarioWorld,
  type Status,
} from '../shared/world';

export type ConditionDef =
  InputTest | { readonly any: readonly ConditionDef[] } | { readonly all: readonly ConditionDef[] };

export type BtNodeDef =
  | { readonly type: 'selector'; readonly name: string; readonly children: readonly BtNodeDef[] }
  | {
      readonly type: 'sequence';
      readonly name: string;
      readonly memory?: boolean;
      readonly children: readonly BtNodeDef[];
    }
  | { readonly type: 'condition'; readonly name?: string; readonly test: ConditionDef }
  | { readonly type: 'action'; readonly name: string; readonly action: PrimitiveSpec };

export interface BtDef {
  readonly id: string;
  readonly thinkHz: number;
  readonly root: BtNodeDef;
}

interface Node {
  readonly id: number;
  readonly kind: BtNodeDef['type'];
  readonly name: string;
  readonly parent: number;
  readonly children: readonly number[];
  readonly memory: boolean;
  readonly test: Test | null;
  readonly action: PrimitiveSpec | null;
}

export interface BtMemory {
  /** Node id of the running action leaf, -1 when none. */
  running: number;
  /** Resume index per node (only memory sequences use it). */
  resume: number[];
}

function compileCondition(def: ConditionDef, owner: string): Test {
  if ('any' in def) {
    const parts = def.any.map((d) => compileCondition(d, owner));
    return (w, a) => parts.some((t) => t(w, a));
  }
  if ('all' in def) {
    const parts = def.all.map((d) => compileCondition(d, owner));
    return (w, a) => parts.every((t) => t(w, a));
  }
  if (def.input.startsWith('alert.')) {
    const state = def.input.slice('alert.'.length);
    if (!(ALERT_STATES as readonly string[]).includes(state)) {
      throw new Error(`${owner}: unknown alert state "${state}"`);
    }
    return (_w, a) => a.alert === state;
  }
  return compileTest(def, owner);
}

export function compileBt(def: BtDef): Node[] {
  const nodes: Node[] = [];
  const visit = (n: BtNodeDef, parent: number): number => {
    const id = nodes.length;
    const owner = `behaviour "${def.id}" node ${String(id)}`;
    const placeholder = {
      id,
      kind: n.type,
      name: 'name' in n && n.name !== undefined ? n.name : n.type,
      parent,
      children: [] as number[],
      memory: n.type === 'sequence' && n.memory === true,
      test: n.type === 'condition' ? compileCondition(n.test, owner) : null,
      action: n.type === 'action' ? n.action : null,
    };
    nodes.push(placeholder);
    if (n.type === 'selector' || n.type === 'sequence') {
      if (n.children.length === 0) throw new Error(`${owner}: composite without children`);
      for (const c of n.children) placeholder.children.push(visit(c, id));
    }
    return id;
  };
  visit(def.root, -1);
  return nodes;
}

export function btBrain(def: BtDef): Brain<BtMemory> {
  const nodes = compileBt(def);
  const isAncestor = (anc: number, of: number): boolean => {
    for (let n = of; n !== -1; n = (nodes[n] as Node).parent) if (n === anc) return true;
    return false;
  };

  return {
    name: 'behaviour-tree',
    thinkHz: def.thinkHz,
    init: () => ({ running: -1, resume: nodes.map(() => 0) }),
    think(world, agent, memory) {
      const w = world as ScenarioWorld<unknown>;
      const previous = memory.running;
      // The previous leaf's result, if it finished since the last think.
      const finished = previous === -1 ? null : w.takeResult(agent);
      let started = -1;

      const tick = (id: number): Status => {
        const node = nodes[id] as Node;
        switch (node.kind) {
          case 'condition':
            return (node.test as Test)(w, agent) ? 'success' : 'failure';
          case 'action': {
            if (id === previous && finished !== null) {
              if (finished === 'running') {
                started = id;
                return 'running';
              }
              memory.running = -1;
              return finished;
            }
            const status = w.start(agent, node.action as PrimitiveSpec, node.name);
            if (status === 'running') started = id;
            return status;
          }
          case 'selector':
            for (const c of node.children) {
              const s = tick(c);
              if (s !== 'failure') return s;
            }
            return 'failure';
          case 'sequence': {
            const from = node.memory ? (memory.resume[id] as number) : 0;
            for (let i = from; i < node.children.length; i++) {
              const s = tick(node.children[i] as number);
              if (s === 'running') {
                memory.resume[id] = i;
                return 'running';
              }
              if (s === 'failure') {
                memory.resume[id] = 0;
                return 'failure';
              }
            }
            memory.resume[id] = 0;
            return 'success';
          }
        }
      };

      tick(0);
      if (started !== previous && previous !== -1 && started !== -1) {
        // Pre-empted: forget the resume points of sequences that are not above the new leaf.
        for (const n of nodes) {
          if (n.memory && !isAncestor(n.id, started)) memory.resume[n.id] = 0;
        }
      }
      if (started === -1 && previous !== -1 && agent.prim !== null) w.halt(agent);
      memory.running = started;
    },
    introspect(agent, memory) {
      // The active path: root → running leaf.
      const path: string[] = [];
      for (let n = memory.running; n !== -1; n = (nodes[n] as Node).parent) {
        path.unshift((nodes[n] as Node).name);
      }
      return { architecture: 'behaviour-tree', alert: agent.alert, path };
    },
  };
}
