import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  coreComponents,
  coreScenario,
  InvalidReplayError,
  recordScenario,
  UnsupportedReplayVersionError,
  type CoreCommand,
  type ReplayScenario,
} from '@sim/index';
import { loadGameContent } from '@content/game-content';
import { expectReplay, ReplayAssertionError } from './expect-replay';
import { currentContentHash, readReplay, scenarioOf, writeReplay } from './files';

const GOLDEN = 'tests/replays/core.json';
const dir = mkdtempSync(join(tmpdir(), 'replay-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Core scenario that pushes one body's Position.x by 0.5 during `at` ("a sim change"). */
function changedAt(at: number, base: ReplayScenario<CoreCommand> = coreScenario) {
  const { Position } = coreComponents;
  return {
    ...base,
    create(options: { seed: number; hz: number }) {
      const world = base.create(options);
      world.addSystem({
        name: 'change',
        run({ tick }) {
          if (tick !== at) return;
          world.query(Position).forEach((id, position) => {
            world.set(id, Position, { x: position.x + 0.5, y: position.y });
          });
        },
      });
      return world;
    },
  };
}

function failure(run: () => unknown): ReplayAssertionError {
  try {
    run();
  } catch (error) {
    if (error instanceof ReplayAssertionError) return error;
    throw error;
  }
  throw new Error('expected the replay to fail');
}

describe('expectReplay', () => {
  it('passes the core golden with the default scenarios and current content', () => {
    expect(expectReplay(GOLDEN)).toMatchObject({ status: 'passed', checkpoints: 61 });
  });

  it('AC-2: fails the golden at checkpoint 1,260 naming the entity and field changed at tick 1,234', () => {
    const error = failure(() => expectReplay(GOLDEN, { scenarios: { core: changedAt(1234) } }));
    expect(error.outcome).toMatchObject({
      status: 'diverged',
      divergence: { tick: 1260, difference: { component: 'Position', field: 'x' } },
    });
    const entity = error.outcome.divergence.difference?.entity;
    expect(entity).toBeTypeOf('number');
    expect(error.message).toContain(`${GOLDEN}: determinism failure`);
    expect(error.message).toContain('checkpoint tick 1260');
    expect(error.message).toContain(`components.Position[${String(entity)}].x`);
  });

  it('AC-4: reports a content change distinctly from a determinism failure', () => {
    const scenario = { ...coreScenario, usesContent: true };
    const path = join(dir, 'content.json');
    writeReplay(
      path,
      recordScenario(scenario, { seed: 1, ticks: 120, buildSha: 't', contentHash: 'stale' }),
    );
    const changed = changedAt(30, scenario);
    const error = failure(() => expectReplay(path, { scenarios: { core: changed } }));
    expect(error.outcome).toMatchObject({
      status: 'content-changed',
      recordedContentHash: 'stale',
      currentContentHash: currentContentHash(),
    });
    expect(error.message).toContain('content changed since recording');
    const unaffected = expectReplay(path, { scenarios: { core: scenario } });
    expect(unaffected.contentChanged).toBe(true);
    const same = failure(() =>
      expectReplay(path, { scenarios: { core: changed }, contentHash: 'stale' }),
    );
    expect(same.outcome.status).toBe('diverged');
  });
});

describe('replay files', () => {
  it('AC-3: loading a replay from a newer format fails with UnsupportedReplayVersion', () => {
    const path = join(dir, 'future.json');
    writeFileSync(path, JSON.stringify({ ...readReplay(GOLDEN), formatVersion: 99 }));
    expect(() => readReplay(path)).toThrow(UnsupportedReplayVersionError);
    expect(() => expectReplay(path)).toThrow(/formatVersion 99 is newer than supported \(1\)/);
  });

  it('names the file when it is not JSON, and reports invalid replays', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ nope');
    expect(() => readReplay(path)).toThrow(`${path}: cannot read replay JSON`);
    writeFileSync(path, '{}');
    expect(() => readReplay(path)).toThrow(InvalidReplayError);
  });

  it('resolves scenarios by name and lists the registered ones for unknown names', () => {
    const replay = readReplay(GOLDEN);
    expect(scenarioOf(replay)).toBe(coreScenario);
    expect(() => scenarioOf({ ...replay, scenario: 'ghost' })).toThrow(
      'unknown replay scenario "ghost" (registered: core, character-basic, character-course, character-stress, character-mantle, action-timeline, dodge-on-time, dodge-early)',
    );
  });

  it('checks against the hash of the content loaded now', () => {
    expect(currentContentHash()).toBe(loadGameContent().hash);
  });
});
