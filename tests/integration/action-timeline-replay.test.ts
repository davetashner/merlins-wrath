// mw-e04.4 AC-6: the action timeline golden (a 3-hit light chain and a dodge cancel, recorded as
// ActionFrames with a state hash on every tick) replays to identical hashes 100 times in a row.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActionStarted, playReplay, type ActionStartInfo } from '@sim/index';
import {
  actionTimelineLog,
  actionTimelineScenario,
  createActionTimelineWorld,
} from '@tools/replay/action-timeline-scenario';
import { currentContentHash, GOLDEN_REPLAY_DIR, readReplay } from '@tools/replay/files';

const replay = readReplay(join(GOLDEN_REPLAY_DIR, 'action-timeline.json'));

describe('action timeline replay (mw-e04.4)', () => {
  it('AC-6: the recorded log is a 3-hit chain with a dodge cancel, hashed on every tick', () => {
    expect(replay.scenario).toBe('action-timeline');
    expect(replay.checkpointInterval).toBe(1);
    expect(replay.checkpoints).toHaveLength(replay.ticks + 1);
    const world = createActionTimelineWorld({ seed: replay.seed, hz: replay.stepHz });
    const started: ActionStartInfo[] = [];
    world.events.on(ActionStarted, (e) => started.push(e));
    for (const frame of actionTimelineLog()) world.step([frame]);
    expect(started.map((e) => [e.tick, e.move, e.cancelled])).toEqual([
      [10, 'sword-light-1', null],
      [44, 'sword-light-2', null],
      [78, 'sword-light-3', null],
      [105, 'dodge-roll', 'sword-light-3'],
    ]);
  });

  it('AC-6: replayed 100 times, every tick’s state hash is identical', () => {
    const contentHash = currentContentHash();
    const finals = new Set<string>();
    for (let run = 0; run < 100; run++) {
      const outcome = playReplay(replay, actionTimelineScenario, { contentHash });
      expect(outcome.status).toBe('passed');
      if (outcome.status === 'passed') {
        expect(outcome.checkpoints).toBe(replay.ticks + 1);
        finals.add(outcome.finalHash);
      }
    }
    expect(finals.size).toBe(1);
  });
});
