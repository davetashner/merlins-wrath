// World facts inside the World (mw-e27.1): snapshots, hashes, diffs, restore, step commands, replays
// and the signal-graph fact setter.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { World, type WorldSnapshot } from '../core/world';
import { difficultyCommand } from '../difficulty';
import { registerWorldProperties } from '../properties/components';
import { parseReplay, serializeReplay, type Replay } from '../replay/format';
import { playReplay } from '../replay/player';
import { recordScenario } from '../replay/recorder';
import type { ReplayScenario } from '../replay/scenario';
import { SignalGraphError, compileSignalGraph, type SignalNodeDef } from '../signals/graph';
import { addSignalGraph, installSignals, setLever, signalSystem } from '../signals/runtime';
import {
  diffSnapshots,
  encodeCanonical,
  encodeSnapshot,
  hashSnapshot,
  hashWorld,
} from '../snapshot';
import { installStimuli } from '../stimulus/stimulus';
import {
  applyFactCommands,
  FACT_COMMAND,
  factCommand,
  isFactCommand,
  type FactCommand,
} from './commands';
import { factChanged, FactKeyError, FactTypeError, type FactChange } from './store';

describe('facts in world snapshots', () => {
  it('a world with no facts set snapshots and hashes as it did before facts existed', () => {
    const plain = new World({ seed: 5 });
    const declared = new World({ seed: 5 });
    declared.facts.declare('gate.open', { type: 'bool', default: true });
    expect('facts' in declared.snapshot()).toBe(false);
    expect(hashWorld(declared)).toBe(hashWorld(plain));
  });

  it('facts ride in the snapshot, the state hash and restore', () => {
    const world = new World({ seed: 5 });
    const empty = hashWorld(world);
    world.facts.set('quest.missing-miller.stage', 2);
    world.facts.set('bell.rung', true);
    const snap = world.snapshot();
    expect(snap.facts).toEqual({ 'bell.rung': true, 'quest.missing-miller.stage': 2 });
    expect(Object.keys(snap.facts ?? {})).toEqual(['bell.rung', 'quest.missing-miller.stage']);
    expect(hashWorld(world)).not.toBe(empty);
    // The fast snapshot encoder writes facts exactly where the generic form puts them.
    expect(encodeSnapshot(snap)).toEqual(
      new Uint8Array([0x56, 0x42, 0x53, 1, ...encodeCanonical(snap)]),
    );
    const withBoth = { ...snap, difficulty: { damageTaken: 2 } };
    expect(encodeSnapshot(withBoth)).toEqual(
      new Uint8Array([0x56, 0x42, 0x53, 1, ...encodeCanonical(withBoth)]),
    );

    const copy = new World({ seed: 1 });
    copy.facts.set('stale.fact', true);
    copy.restore(JSON.parse(JSON.stringify(snap)) as WorldSnapshot);
    expect(copy.facts.snapshot()).toEqual(snap.facts);
    expect(hashWorld(copy)).toBe(hashSnapshot(snap));
    copy.restore(new World({ seed: 1 }).snapshot()); // no facts field: every fact cleared
    expect(copy.facts.size).toBe(0);
  });

  it('an invalid facts record fails restore and leaves the world untouched', () => {
    const world = new World({ seed: 5 });
    world.facts.declare('gate.open', { type: 'bool' });
    world.facts.set('gate.open', true);
    world.step();
    const before = world.snapshot();
    const bad = { ...new World({ seed: 9 }).snapshot(), facts: { 'gate.open': 'yes' } };
    expect(() => {
      world.restore(bad);
    }).toThrow(FactTypeError);
    expect(world.snapshot()).toEqual(before);
  });

  it('diffSnapshots reports the first differing fact by key, after components', () => {
    const world = new World({ seed: 5 });
    const a = world.snapshot();
    world.facts.set('entity:mine/chest-3.looted', true);
    const b = world.snapshot();
    expect(diffSnapshots(a, b)).toEqual({
      section: 'facts',
      path: 'facts["entity:mine/chest-3.looted"]',
      fact: 'entity:mine/chest-3.looted',
      a: undefined,
      b: true,
    });
    world.facts.set('entity:mine/chest-3.looted', false);
    expect(diffSnapshots(b, world.snapshot())).toMatchObject({
      section: 'facts',
      a: true,
      b: false,
    });
    expect(diffSnapshots(b, b)).toBeUndefined();
  });
});

type Input = string | FactCommand;

/** A world whose one system records, each tick, the fact it reads and whether it saw the event. */
function probed(): { world: World<Input>; seen: unknown[] } {
  const seen: unknown[] = [];
  const world = new World<Input>({ seed: 9 }).addSystem({
    name: 'probe',
    run: (ctx) => seen.push(ctx.world.facts.get('miller.found') ?? null),
  });
  world.events.on(factChanged, (change) =>
    seen.push(`event:${String(change.new)}@${String(change.tick)}`),
  );
  return { world, seen };
}

describe('fact commands', () => {
  it('apply at the start of the tick, before any system, and emit before systems run', () => {
    const { world, seen } = probed();
    world.step(['move']);
    world.step([factCommand({ 'miller.found': true })]);
    world.step([]);
    expect(seen).toEqual([null, 'event:true@1', true, true]);
  });

  it('are all or nothing, and a bad one keeps a same-tick difficulty change from committing', () => {
    const { world } = probed();
    world.facts.set('miller.found', false);
    const bad = factCommand({ 'miller.found': 'yes', 'a.b': 1 });
    expect(() => {
      world.step([difficultyCommand({ damageTaken: 2 }) as never, factCommand({ 'z.z': 1 }), bad]);
    }).toThrow(FactTypeError);
    expect(world.facts.snapshot()).toEqual({ 'miller.found': false });
    expect(world.difficulty.damageTaken).toBe(1);
    expect(world.tick).toBe(0);
  });

  it('validate keys and value kinds when built', () => {
    expect(factCommand({ 'a.b': 1 })).toEqual({ kind: FACT_COMMAND, set: { 'a.b': 1 } });
    expect(() => factCommand({ 'A.b': 1 })).toThrow(FactKeyError);
    expect(() => factCommand({ 'a.b': {} as never })).toThrow('must be a primitive');
    expect(isFactCommand({ kind: FACT_COMMAND, set: {} })).toBe(true);
    expect(isFactCommand('move')).toBe(false);
    expect(isFactCommand(null)).toBe(false);
    expect(isFactCommand({ kind: 'other' })).toBe(false);
  });

  it('apply several commands in input order, each command in key order', () => {
    const world = new World({ seed: 1 });
    const changes: FactChange[] = [];
    world.events.on(factChanged, (c) => changes.push(c));
    applyFactCommands(world.facts, [
      factCommand({ 'b.b': 1, 'a.a': 1 }),
      'noise',
      factCommand({ 'b.b': 2 }),
    ]);
    world.events.flush();
    expect(changes.map((c) => [c.key, c.new])).toEqual([
      ['a.a', 1],
      ['b.b', 2], // one net change per fact, in first-write order
    ]);
  });

  it('are recorded in replays, which then reproduce the facts; dropping one diverges at facts', () => {
    const scenario: ReplayScenario<Input> = {
      name: 'fact-probe',
      usesContent: false,
      command: z.union([z.string(), z.custom<FactCommand>(isFactCommand)]),
      create: () => probed().world,
      drive: () => [],
    };
    const script = (tick: number): Input[] => {
      if (tick === 12) return ['move', factCommand({ 'miller.found': true, 'quest.stage': 2 })];
      if (tick === 25) return [factCommand({ 'quest.stage': 3 })];
      return ['move'];
    };
    const record = (inputs: (tick: number) => Input[]): Replay =>
      recordScenario(scenario, {
        seed: 9,
        ticks: 40,
        buildSha: 'test',
        contentHash: 'none',
        checkpointInterval: 10,
        inputs,
      });
    const live = record(script);
    const replay = parseReplay(JSON.parse(serializeReplay(live)));
    expect(playReplay(replay, scenario)).toMatchObject({ status: 'passed', checkpoints: 5 });
    const without = record((tick) => (tick === 25 ? ['move'] : script(tick)));
    expect(playReplay({ ...without, checkpoints: live.checkpoints }, scenario)).toMatchObject({
      status: 'diverged',
      divergence: {
        tick: 30,
        difference: { section: 'facts', path: 'facts["quest.stage"]', a: 3, b: 2 },
      },
    });
  });
});

describe('signal-graph fact setter', () => {
  const nodes = (key: string): SignalNodeDef[] =>
    [
      { id: 'pull', kind: 'lever' },
      { id: 'flag', kind: 'receiver', receiver: 'fact', key },
    ] as SignalNodeDef[];
  const def = (key: string) => ({
    id: 'g',
    nodes: nodes(key),
    wires: [{ from: 'pull', to: 'flag' }],
  });

  it('AC-5: when its input goes high the configured fact is set on that tick', () => {
    const world = installSignals(
      installStimuli(registerWorldProperties(new World<never>({ seed: 7 }))),
    ).addSystem(signalSystem());
    const graph = addSignalGraph(world, def('chapel-of-echoes.portcullis-dropped'));
    const changes: FactChange[] = [];
    world.events.on(factChanged, (c) => changes.push(c));
    world.step();
    expect(world.facts.has('chapel-of-echoes.portcullis-dropped')).toBe(false); // input low
    setLever(world, graph, 'pull', true);
    world.step();
    expect(changes).toEqual([
      {
        key: 'chapel-of-echoes.portcullis-dropped',
        old: undefined,
        new: true,
        source: graph,
        tick: 1,
      },
    ]);
    expect(world.facts.get('chapel-of-echoes.portcullis-dropped')).toBe(true);
    setLever(world, graph, 'pull', false);
    world.step();
    expect(world.facts.get('chapel-of-echoes.portcullis-dropped')).toBe(false); // follows its input
  });

  it('a malformed fact key is a graph compile error', () => {
    expect(() => compileSignalGraph(def('Chapel.Open'))).toThrow(SignalGraphError);
    try {
      compileSignalGraph(def('Chapel.Open'));
    } catch (error) {
      expect((error as SignalGraphError).problems[0]?.message).toMatch(/^invalid fact key/);
    }
  });
});
