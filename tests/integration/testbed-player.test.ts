// mw-e02.23 AC-4: the player in the greybox testbed, through the game's own wiring (scene loader,
// setupTestbedPlayer, the ActionSampler, the frame loop). The recorded input log
// (tests/replays/testbed-player.json) replays twice to identical final state hashes, and live input
// sampled on a 144 Hz display lands on the same hashes.
//
// After an intended change: `pnpm replay:rebless`. After editing the script in
// src/tools/replay/testbed-player-scenario.ts: `pnpm replay:record testbed-player --force`.
import { describe, expect, it } from 'vitest';
import { PLAYER_CONTROLLER_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import { createFrameLoop, FakeFrames } from '@game/loop/index';
import {
  CharacterController,
  hashWorld,
  PlayerLook,
  playReplay,
  type ActionFrame,
  type CharacterState,
} from '@sim/index';
import { currentContentHash, readReplay } from '@tools/replay/files';
import {
  createTestbedWorld,
  scriptedInput,
  TESTBED_SCRIPT,
  TESTBED_TICKS,
  testbedLog,
  testbedPlayerScenario,
} from '@tools/replay/testbed-player-scenario';

const GOLDEN = 'tests/replays/testbed-player.json';

/** The player's entity in a testbed world (the only one with a PlayerLook). */
function playerOf(world: ReturnType<typeof createTestbedWorld>): number {
  const [id] = world.query(PlayerLook).ids();
  if (id === undefined) throw new Error('no player');
  return id;
}

/** Runs the scripted input live through a frame loop on a display of `hz`; returns the world. */
function runLive(displayHz: number, seed: number) {
  const world = createTestbedWorld({ seed, hz: 60 });
  const sampler = new ActionSampler();
  const drive = scriptedInput(TESTBED_SCRIPT, sampler);
  const frames = new FakeFrames(1000);
  const loop = createFrameLoop<ActionFrame>({
    sim: world,
    hz: world.clock.hz,
    now: frames.now,
    scheduler: frames,
    visibility: frames,
    sampleCommands: (tick) => {
      drive(tick);
      return sampler.sampleCommands(tick);
    },
    onStep: (tick) => {
      if (tick === TESTBED_TICKS) loop.stop();
    },
  });
  loop.start();
  while (loop.running) frames.frame(1000 / displayHz);
  return world;
}

describe('testbed player (mw-e02.23)', () => {
  it('the script walks the testbed: doorway, jump, corridor wall, and back', ({ task }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const world = createTestbedWorld({ seed: 1, hz: 60 });
    const player = playerOf(world);
    const trace: CharacterState[] = testbedLog().map((frame) => {
      world.step([frame]);
      const state = world.get(player, CharacterController);
      if (state === undefined) throw new Error('player gone');
      return state;
    });
    expect(trace).toHaveLength(TESTBED_TICKS);
    expect(Math.max(...trace.map((s) => s.position.y))).toBeGreaterThan(1); // the jump
    expect(Math.max(...trace.map((s) => s.position.z))).toBeGreaterThan(6); // into the corridor
    // The corridor's walls (x = ±1, 0.2 m thick) keep the player inside it.
    const inCorridor = trace.filter((s) => s.position.z > 5.5 && s.position.z < 14.5);
    expect(inCorridor.length).toBeGreaterThan(0);
    expect(inCorridor.every((s) => Math.abs(s.position.x) < 0.9 - 0.35 + 0.02)).toBe(true);
    expect(trace.some((s) => s.crouched)).toBe(true);
    expect(trace.at(-1)?.grounded).toBe(true);
  });

  it('AC-4: the recorded input log replays twice through the testbed wiring to the same final hash', ({
    task,
  }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const replay = readReplay(GOLDEN);
    expect(replay.scenario).toBe(testbedPlayerScenario.name);
    expect(replay.ticks).toBe(TESTBED_TICKS);
    const contentHash = currentContentHash();
    const first = playReplay(replay, testbedPlayerScenario, { contentHash });
    const second = playReplay(replay, testbedPlayerScenario, { contentHash });
    expect(first).toEqual({
      status: 'passed',
      finalHash: replay.finalHash,
      checkpoints: replay.checkpoints.length,
      contentChanged: false,
    });
    expect(second).toEqual(first);
  });

  it('AC-4: live input through the frame loop at 144 Hz and 60 Hz ends on the recorded hash', ({
    task,
  }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const replay = readReplay(GOLDEN);
    const at144 = runLive(144, replay.seed);
    const at60 = runLive(60, replay.seed);
    expect(at144.tick).toBe(TESTBED_TICKS);
    expect(hashWorld(at144)).toBe(replay.finalHash);
    expect(hashWorld(at60)).toBe(replay.finalHash);
  });
});
