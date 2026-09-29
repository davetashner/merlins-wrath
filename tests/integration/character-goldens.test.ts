// mw-e02.7: golden replays lock the character controller's determinism. Each golden input log
// (tests/replays/character-*.json: basic moves, the slopes/steps traversal course, a stress run of
// rapid direction changes) replays with a state-hash checkpoint every 60 ticks. A controller or tuning
// change fails at the first checkpoint it moves, and the display's frame rate never reaches the sim.
//
// Re-record after an intended change to the controller or its tuning:
//   pnpm replay:rebless        (prints each changed golden's first changed checkpoint and field)
// After changing an input log in src/tools/replay/character-scenarios.ts:
//   pnpm replay:record <character-basic|character-course|character-stress> --force
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { createFrameLoop, FakeFrames } from '@game/loop/index';
import {
  hashWorld,
  playReplay,
  ReplayRecorder,
  type CharacterInput,
  type Replay,
  type ReplayScenario,
} from '@sim/index';
import {
  characterCommand,
  characterGoldens,
  characterScenario,
  playerTuning,
  stressGolden,
  type CharacterGolden,
} from '@tools/replay/character-scenarios';
import { expectReplay, ReplayAssertionError } from '@tools/replay/expect-replay';
import { currentContentHash, GOLDEN_REPLAY_DIR, readReplay } from '@tools/replay/files';

const CHECKPOINT_EVERY = 60;
const pathOf = (golden: CharacterGolden) => join(GOLDEN_REPLAY_DIR, `${golden.name}.json`);
const byName = characterGoldens.map((golden) => [golden.name, golden] as const);

/** The shipped tuning with run speed changed by 1%. */
function runSpeedPlusOnePercent() {
  const tuning = playerTuning();
  return { ...tuning, speeds: { ...tuning.speeds, run: tuning.speeds.run * 1.01 } };
}

/**
 * The first tick at which two worlds, one per scenario, driven by the same log, hash differently —
 * found by comparing every tick, independently of the replay's checkpoints.
 */
function firstDivergentTick(
  a: ReplayScenario<CharacterInput>,
  b: ReplayScenario<CharacterInput>,
  replay: Replay,
): number | undefined {
  const left = a.create({ seed: replay.seed, hz: replay.stepHz });
  const right = b.create({ seed: replay.seed, hz: replay.stepHz });
  for (const commands of commandsPerTick(replay)) {
    left.step(commands);
    right.step(commands);
    if (hashWorld(left) !== hashWorld(right)) return left.tick;
  }
  return undefined;
}

/** A replay's commands, one list per tick. */
function commandsPerTick(replay: Replay): CharacterInput[][] {
  return replay.inputs.flatMap(([count, commands]) =>
    Array.from({ length: count }, () => commands.map((c) => characterCommand.parse(c))),
  );
}

interface LoopRun {
  readonly replay: Replay;
  /** Frames the display rendered. */
  readonly frames: number;
}

/**
 * Runs a golden's world through the fixed-step frame loop on a display refreshing every `frameMs`,
 * recording the commands the loop sampled for each tick (and the checkpoint hashes) until `ticks`.
 */
function recordThroughLoop(
  golden: CharacterGolden,
  frameMs: number,
  ticks: number,
  sample: (tick: number, timeMs: number) => readonly CharacterInput[],
  seed = 1,
): LoopRun {
  const world = characterScenario(golden).create({ seed, hz: 60 });
  const recorder = new ReplayRecorder(world, {
    scenario: golden.name,
    buildSha: 'test',
    contentHash: currentContentHash(),
    checkpointInterval: CHECKPOINT_EVERY,
  });
  const fake = new FakeFrames(1000);
  const loop = createFrameLoop<CharacterInput>({
    sim: {
      get tick() {
        return world.tick;
      },
      step: (commands) => {
        recorder.step(commands);
      },
    },
    hz: world.clock.hz,
    now: fake.now,
    scheduler: fake,
    visibility: fake,
    sampleCommands: (tick) => sample(tick, fake.now()),
    onStep: (tick) => {
      if (tick === ticks) loop.stop();
    },
  });
  loop.start();
  let frames = 0;
  while (loop.running) {
    fake.frame(frameMs);
    frames++;
  }
  return { replay: recorder.finish(), frames };
}

/** The golden log's commands for a tick (what a recorded log feeds back). */
const fromLog = (golden: CharacterGolden) => (tick: number) => {
  const input = golden.log[tick];
  return input === undefined ? [] : [input];
};

const hashes = (replay: Replay) => replay.checkpoints.map(({ tick, hash }) => ({ tick, hash }));

describe('character controller golden replays (mw-e02.7)', () => {
  it.for(byName)(
    'AC-1: %s replays in CI with every checkpoint hash matching the committed golden',
    { timeout: 30_000 },
    ([, golden], { task }) => {
      markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
      const replay = readReplay(pathOf(golden));
      expect(replay.scenario).toBe(golden.name);
      expect(replay.ticks).toBe(golden.ticks);
      expect(replay.checkpointInterval).toBe(CHECKPOINT_EVERY);
      // A checkpoint every 60 ticks from tick 0, plus the final tick.
      expect(replay.checkpoints.length).toBe(Math.ceil(golden.ticks / CHECKPOINT_EVERY) + 1);
      const outcome = expectReplay(pathOf(golden));
      expect(outcome).toMatchObject({
        status: 'passed',
        finalHash: replay.finalHash,
        checkpoints: replay.checkpoints.length,
      });
    },
  );

  it.for(byName)(
    'AC-2: %s fails on a 1% runSpeed change and reports the first divergent checkpoint tick',
    { timeout: 30_000 },
    ([, golden], { task }) => {
      markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
      const shipped = characterScenario(golden);
      const mutated = characterScenario(golden, runSpeedPlusOnePercent());
      const replay = readReplay(pathOf(golden));

      // Where the change first shows, found tick by tick; the report names the checkpoint after it.
      const tick = firstDivergentTick(shipped, mutated, replay);
      expect(tick).toBeDefined();
      const checkpoint = Math.ceil((tick ?? 0) / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;

      let failure: unknown;
      try {
        expectReplay(pathOf(golden), { scenarios: { [golden.name]: mutated } });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ReplayAssertionError);
      const { outcome, message } = failure as ReplayAssertionError;
      expect(outcome.divergence.tick).toBe(checkpoint);
      expect(message).toContain(`${pathOf(golden)}: determinism failure`);
      expect(message).toContain(`diverged at checkpoint tick ${String(checkpoint)}:`);
      // The golden keeps full states, so the report also names the first field that moved.
      expect(message).toMatch(
        /first difference: components\["character\.controller"\]\[1\]\.\S+ — replayed \S+, recorded /,
      );
      expect(message).toContain('pnpm replay:rebless');
    },
  );

  it.for(byName)(
    'AC-3: %s driven by 30 Hz and 144 Hz displays samples the same per-tick commands and hashes',
    { timeout: 30_000 },
    ([, golden], { task }) => {
      markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
      const committed = readReplay(pathOf(golden));
      const { seed } = committed;
      const at30 = recordThroughLoop(golden, 1000 / 30, golden.ticks, fromLog(golden), seed);
      const at144 = recordThroughLoop(golden, 1000 / 144, golden.ticks, fromLog(golden), seed);
      expect(at30.replay.ticks).toBe(golden.ticks);
      expect(at144.replay.ticks).toBe(golden.ticks);
      // Nearly five times the frames rendered, for the same ticks simulated.
      expect(at144.frames).toBeGreaterThan(at30.frames * 4);
      expect(at144.replay.inputs).toEqual(at30.replay.inputs);
      expect(hashes(at144.replay)).toEqual(hashes(at30.replay));
      expect(at144.replay.finalHash).toBe(at30.replay.finalHash);
      // …and both are the committed golden, recorded headlessly.
      expect(at30.replay.inputs).toEqual(committed.inputs);
      expect(hashes(at30.replay)).toEqual(hashes(committed));
    },
  );

  it(
    'AC-3: a log recorded from live input on a 30 Hz display replays on a 144 Hz display (and vice versa) to identical sim hashes',
    { timeout: 30_000 },
    ({ task }) => {
      markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
      // A "device" whose state changes on its own wall-clock schedule (every 23.7 ms), sampled
      // whenever the loop steps: what a display rate changes is which state each tick sees.
      const device = (_tick: number, timeMs: number) => {
        const input = stressGolden.log[Math.floor((timeMs - 1000) / 23.7) % stressGolden.ticks];
        return input === undefined ? [] : [input];
      };
      const ticks = 900;
      const live30 = recordThroughLoop(stressGolden, 1000 / 30, ticks, device).replay;
      const live144 = recordThroughLoop(stressGolden, 1000 / 144, ticks, device).replay;
      // Live input lands on different ticks at different refresh rates…
      expect(live144.inputs).not.toEqual(live30.inputs);

      // …but a recorded log replays to its recorded hashes at any refresh rate, and headlessly.
      for (const [recorded, otherMs] of [
        [live30, 1000 / 144],
        [live144, 1000 / 30],
      ] as const) {
        const log = commandsPerTick(recorded);
        const replayed = recordThroughLoop(stressGolden, otherMs, ticks, (tick) => log[tick] ?? []);
        expect(replayed.replay.inputs).toEqual(recorded.inputs);
        expect(hashes(replayed.replay)).toEqual(hashes(recorded));
        const headless = playReplay(recorded, characterScenario(stressGolden), {
          contentHash: currentContentHash(),
        });
        expect(headless).toMatchObject({ status: 'passed', finalHash: recorded.finalHash });
      }
    },
  );
});
