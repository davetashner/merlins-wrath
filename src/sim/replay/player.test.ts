import { describe, expect, it } from 'vitest';
import {
  coreComponents,
  coreScenario,
  describeOutcome,
  InvalidReplayError,
  parseReplay,
  playReplay,
  reblessReplay,
  recordScenario,
  ReplayError,
  serializeReplay,
  World,
  type CoreCommand,
  type Divergence,
  type Replay,
  type ReplayScenario,
} from '@sim/index';

const { Health, Position } = coreComponents;

/** A replay as it comes back from disk. */
const reload = (replay: Replay): Replay => parseReplay(JSON.parse(serializeReplay(replay)));

const session = (ticks: number, keepStates = true): Replay =>
  reload(
    recordScenario(coreScenario, { seed: 7, ticks, buildSha: 'rec', contentHash: '', keepStates }),
  );

/**
 * The core scenario with a "sim change": during tick `at` the healthiest body (lowest id on ties, so
 * it outlives the next checkpoint) is nudged 0.5 along x. Returns the scenario and the nudged entity.
 */
function nudgedAt(at: number, base: ReplayScenario<CoreCommand> = coreScenario) {
  let nudged: number | undefined;
  const scenario: ReplayScenario<CoreCommand> = {
    ...base,
    create(options) {
      nudged = undefined;
      const world = base.create(options);
      world.addSystem({
        name: 'nudge',
        run({ tick }) {
          if (tick !== at) return;
          let best = -1;
          world.query(Position, Health).forEach((id, _position, health) => {
            if (health.hp <= best) return;
            best = health.hp;
            nudged = id;
          });
          if (nudged === undefined) return;
          const position = world.get(nudged, Position);
          if (position) world.set(nudged, Position, { x: position.x + 0.5, y: position.y });
        },
      });
      return world;
    },
  };
  return { scenario, nudged: () => nudged };
}

const recording = session(3600);

describe('playReplay', () => {
  it('AC-1: a recorded 3,600-tick session replays with every checkpoint and the final hash matching', () => {
    const outcome = playReplay(recording, coreScenario);
    expect(recording.checkpoints).toHaveLength(61);
    expect(outcome).toEqual({
      status: 'passed',
      finalHash: recording.finalHash,
      checkpoints: 61,
      contentChanged: false,
    });
  });

  it('AC-2: a change to one component at tick 1,234 fails at checkpoint 1,260 naming the entity and field', () => {
    const { scenario, nudged } = nudgedAt(1234);
    const outcome = playReplay(recording, scenario);
    expect(outcome.status).toBe('diverged');
    if (outcome.status !== 'diverged') return;
    const { divergence } = outcome;
    expect(divergence.tick).toBe(1260);
    expect(divergence.expectedHash).toBe(recording.checkpoints[21]?.hash);
    expect(divergence.actualHash).not.toBe(divergence.expectedHash);
    expect(divergence.difference).toMatchObject({
      section: 'components',
      entity: nudged(),
      component: 'Position',
      field: 'x',
    });
    const report = describeOutcome('core.json', outcome);
    expect(report).toContain('core.json: determinism failure');
    expect(report).toContain('diverged at checkpoint tick 1260');
    expect(report).toContain(`first difference: components.Position[${String(nudged())}].x`);
    expect(report).toContain('pnpm replay:rebless');
  });

  it('reports the tick without a field diff when the replay kept no states', () => {
    const outcome = playReplay(session(300, false), nudgedAt(100).scenario);
    expect(outcome).toMatchObject({
      status: 'diverged',
      divergence: { tick: 120, difference: undefined },
    });
    expect(describeOutcome('x', outcome)).toContain('no recorded state at this checkpoint');
  });

  it('catches a scenario whose starting state changed at checkpoint 0', () => {
    const outcome = playReplay(session(60), {
      ...coreScenario,
      create: () => new World({ seed: 7 }),
    });
    expect(outcome).toMatchObject({ status: 'diverged', divergence: { tick: 0 } });
  });

  describe('AC-4: content changes', () => {
    const contentScenario: ReplayScenario<CoreCommand> = { ...coreScenario, usesContent: true };
    const onContent = reload(
      recordScenario(contentScenario, { seed: 7, ticks: 300, buildSha: 'b', contentHash: 'aaaa' }),
    );
    const nudged = nudgedAt(100, contentScenario).scenario;

    it('reports "content changed", distinct from a determinism failure, when it diverges', () => {
      const outcome = playReplay(onContent, nudged, { contentHash: 'bbbb' });
      expect(outcome).toMatchObject({
        status: 'content-changed',
        recordedContentHash: 'aaaa',
        currentContentHash: 'bbbb',
        divergence: { tick: 120 },
      });
      const report = describeOutcome('slice.json', outcome);
      expect(report).toContain('slice.json: content changed since recording');
      expect(report).not.toContain('determinism failure');
    });

    it('passes, flagging the change, when the replay still matches', () => {
      expect(playReplay(onContent, contentScenario, { contentHash: 'bbbb' })).toMatchObject({
        status: 'passed',
        contentChanged: true,
      });
    });

    it('is a determinism failure when content is unchanged or unknown', () => {
      expect(playReplay(onContent, nudged, { contentHash: 'aaaa' }).status).toBe('diverged');
      expect(playReplay(onContent, nudged).status).toBe('diverged');
    });

    it('ignores content for replays of content-free scenarios', () => {
      const outcome = playReplay(session(10), coreScenario, { contentHash: 'bbbb' });
      expect(outcome).toMatchObject({ status: 'passed', contentChanged: false });
    });
  });

  it('refuses a replay recorded for another scenario', () => {
    expect(() => playReplay(session(10), { ...coreScenario, name: 'other' })).toThrow(ReplayError);
  });

  it('refuses a scenario that builds a world past tick 0', () => {
    const late: ReplayScenario<CoreCommand> = {
      ...coreScenario,
      create(options) {
        const world = coreScenario.create(options);
        world.step();
        return world;
      },
    };
    expect(() => playReplay(session(10), late)).toThrow(/tick 1, not 0/);
  });

  it('validates every command against the scenario, listing each bad one', () => {
    const replay = session(10);
    const bad: Replay = {
      ...replay,
      inputs: [
        [5, [{ type: 'spawn', x: 0, y: 0 }]],
        [5, [{ type: 'teleport' }, { type: 'hit', target: 0, amount: 0 }]],
      ],
    };
    expect(() => playReplay(bad, coreScenario)).toThrow(InvalidReplayError);
    try {
      playReplay(bad, coreScenario);
    } catch (error) {
      expect((error as InvalidReplayError).issues).toEqual([
        expect.stringMatching(/^inputs\[1\]\[1\]\[0\]\.type: /),
        expect.stringMatching(/^inputs\[1\]\[1\]\[1\]\.amount: /),
      ]);
    }
  });
});

describe('reblessReplay', () => {
  it('re-records the same commands so an intended change passes again', () => {
    const { scenario } = nudgedAt(100);
    const replay = session(300);
    const reblessed = reblessReplay(replay, scenario, { buildSha: 'new', contentHash: 'c' });
    expect(reblessed.inputs).toEqual(replay.inputs);
    expect(reblessed).toMatchObject({ buildSha: 'new', contentHash: null, checkpointInterval: 60 });
    expect(reblessed.checkpoints[0]?.state).toBeDefined();
    expect(reblessed.checkpoints[2]?.hash).not.toBe(replay.checkpoints[2]?.hash);
    expect(playReplay(reload(reblessed), scenario).status).toBe('passed');
  });

  it('keeps the replay’s choices: no states stays no states; content hash refreshed when used', () => {
    const contentScenario = { ...coreScenario, usesContent: true };
    const lean = reload(
      recordScenario(contentScenario, {
        seed: 2,
        ticks: 50,
        buildSha: 'b',
        contentHash: 'old',
        keepStates: false,
        checkpointInterval: 10,
      }),
    );
    const reblessed = reblessReplay(lean, contentScenario, { buildSha: 'n', contentHash: 'new' });
    expect(reblessed.contentHash).toBe('new');
    expect(reblessed.checkpointInterval).toBe(10);
    expect(reblessed.checkpoints.some((checkpoint) => checkpoint.state !== undefined)).toBe(false);
    expect(reblessed.checkpoints).toEqual(lean.checkpoints);
  });
});

describe('describeOutcome', () => {
  const divergence = (a: unknown, b: unknown): Divergence => ({
    tick: 60,
    expectedHash: '00000000',
    actualHash: '11111111',
    difference: { section: 'components', path: 'components.Tag[1]', a, b },
  });

  it('summarises a pass', () => {
    expect(
      describeOutcome('a.json', {
        status: 'passed',
        finalHash: '12345678',
        checkpoints: 3,
        contentChanged: false,
      }),
    ).toBe('a.json: passed (3 checkpoints, final hash 12345678)');
  });

  it('renders absent values, -0 and structured values readably', () => {
    const report = describeOutcome('b', {
      status: 'diverged',
      divergence: divergence(undefined, -0),
    });
    expect(report).toContain('replayed -0, recorded (absent)');
    const structured = describeOutcome('b', {
      status: 'diverged',
      divergence: divergence({ x: 1 }, 'hot'),
    });
    expect(structured).toContain('replayed "hot", recorded {"x":1}');
    expect(describeOutcome('b', { status: 'diverged', divergence: divergence(1.5, 2) })).toContain(
      'replayed 2, recorded 1.5',
    );
  });
});
