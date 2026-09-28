import { describe, expect, it } from 'vitest';
import {
  coreScenario,
  defineComponent,
  hashWorld,
  recordScenario,
  ReplayRecorder,
  ReplayRecordError,
  World,
  type JsonValue,
} from '@sim/index';

const Counter = defineComponent<{ n: number }>('Counter');

/** A world whose only system adds up numeric commands into entity 1's Counter. */
function counterWorld(): World {
  const world = new World({ seed: 9 }).register(Counter);
  world.add(world.spawn(), Counter, { n: 0 });
  world.addSystem({
    name: 'count',
    run({ inputs }) {
      const counter = world.get(1, Counter) ?? { n: NaN };
      for (const input of inputs) if (typeof input === 'number') counter.n += input;
    },
  });
  return world;
}

const options = { scenario: 'counter', buildSha: 'sha', contentHash: null };

describe('ReplayRecorder', () => {
  it('forwards commands to World.step and run-length encodes identical ticks', () => {
    const world = counterWorld();
    const recorder = new ReplayRecorder(world, options);
    for (const inputs of [[1], [1], [], [], [], [2, 3], [1]]) recorder.step(inputs);
    recorder.step();
    expect(world.get(1, Counter)).toEqual({ n: 8 });
    expect(recorder.finish().inputs).toEqual([
      [2, [1]],
      [3, []],
      [1, [2, 3]],
      [1, [1]],
      [1, []],
    ]);
  });

  it('keeps a JSON copy, so commands mutated after recording do not change the log', () => {
    const recorder = new ReplayRecorder(counterWorld(), options);
    const command = { kind: 'jump', power: 1 };
    recorder.step([command]);
    command.power = 99;
    expect(recorder.finish().inputs).toEqual([[1, [{ kind: 'jump', power: 1 }]]]);
  });

  it('checkpoints tick 0, every interval, and the final tick', () => {
    const world = counterWorld();
    const recorder = new ReplayRecorder(world, { ...options, checkpointInterval: 4 });
    for (let i = 0; i < 10; i++) recorder.step([1]);
    const replay = recorder.finish();
    expect(replay.checkpoints.map((c) => c.tick)).toEqual([0, 4, 8, 10]);
    expect(replay.finalHash).toBe(hashWorld(world));
    expect(replay.checkpoints.at(-1)?.state).toEqual(world.snapshot());
    expect(replay).toMatchObject({ ticks: 10, seed: 9, stepHz: 60, checkpointInterval: 4 });
  });

  it('does not duplicate a final checkpoint on an interval, and can keep recording after finish', () => {
    const recorder = new ReplayRecorder(counterWorld(), { ...options, checkpointInterval: 5 });
    for (let i = 0; i < 5; i++) recorder.step([1]);
    expect(recorder.finish().checkpoints.map((c) => c.tick)).toEqual([0, 5]);
    recorder.step([2]);
    expect(recorder.finish().checkpoints.map((c) => c.tick)).toEqual([0, 5, 6]);
  });

  it('stores hashes only when keepStates is false', () => {
    const recorder = new ReplayRecorder(counterWorld(), { ...options, keepStates: false });
    recorder.step([1]);
    expect(recorder.finish().checkpoints.every((c) => !('state' in c))).toBe(true);
  });

  it('only records from a fresh world and with a positive integer interval', () => {
    const world = counterWorld();
    world.step();
    expect(() => new ReplayRecorder(world, options)).toThrow(ReplayRecordError);
    expect(() => new ReplayRecorder(counterWorld(), { ...options, checkpointInterval: 0 })).toThrow(
      RangeError,
    );
    expect(
      () => new ReplayRecorder(counterWorld(), { ...options, checkpointInterval: 1.5 }),
    ).toThrow(/positive integer/);
  });

  it('rejects commands a JSON round trip would change, naming where they are', () => {
    const recorder = new ReplayRecorder(counterWorld(), options);
    const cases: [unknown, string][] = [
      [NaN, 'tick 0 commands[0] is NaN'],
      [{ v: [1, Infinity] }, 'tick 0 commands[0].v[1] is Infinity'],
      [{ v: -0 }, 'tick 0 commands[0].v is -0'],
      [{ v: undefined }, 'tick 0 commands[0].v is undefined'],
      [new Map(), 'tick 0 commands[0] is not a plain object'],
      [() => 1, 'tick 0 commands[0] is function'],
    ];
    for (const [command, message] of cases) {
      expect(() => {
        recorder.step([command]);
      }).toThrow(`cannot record ${message}`);
    }
    const fine: JsonValue = { a: [null, true, 'x', 0, { b: -1.5 }] };
    recorder.step([fine]);
    expect(recorder.finish().ticks).toBe(1);
  });
});

describe('recordScenario', () => {
  it('drives the scenario script by default and honours hz, interval and inputs overrides', () => {
    const scripted = recordScenario(coreScenario, {
      seed: 5,
      ticks: 400,
      buildSha: 'b',
      contentHash: 'c',
    });
    expect(scripted.inputs.length).toBeGreaterThan(1);
    expect(scripted).toMatchObject({ scenario: 'core', contentHash: null, stepHz: 60, ticks: 400 });

    const quiet = recordScenario(coreScenario, {
      seed: 5,
      hz: 30,
      ticks: 20,
      buildSha: 'b',
      contentHash: 'c',
      checkpointInterval: 10,
      keepStates: false,
      inputs: () => [],
    });
    expect(quiet.inputs).toEqual([[20, []]]);
    expect(quiet.checkpoints.map((c) => c.tick)).toEqual([0, 10, 20]);
    expect(quiet.stepHz).toBe(30);
    expect(quiet.checkpoints[0]?.state).toBeUndefined();
  });

  it('stores the content hash for scenarios that use content', () => {
    const replay = recordScenario(
      { ...coreScenario, usesContent: true },
      { seed: 1, ticks: 1, buildSha: 'b', contentHash: 'c0ffee' },
    );
    expect(replay.contentHash).toBe('c0ffee');
  });
});
