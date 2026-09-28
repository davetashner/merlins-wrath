import { describe, expect, it } from 'vitest';
import {
  coreScenario,
  InvalidReplayError,
  parseReplay,
  recordScenario,
  REPLAY_FORMAT_VERSION,
  serializeReplay,
  UnsupportedReplayVersionError,
  type Replay,
} from '@sim/index';

const replay: Replay = recordScenario(coreScenario, {
  seed: 3,
  ticks: 150,
  buildSha: 'abc123',
  contentHash: 'ignored',
});

/** The replay as parsed JSON with some fields replaced. */
const variant = (fields: Record<string, unknown>): unknown => ({
  ...(JSON.parse(serializeReplay(replay)) as object),
  ...fields,
});

function issuesOf(data: unknown): readonly string[] {
  try {
    parseReplay(data);
  } catch (error) {
    if (error instanceof InvalidReplayError) return error.issues;
    throw error;
  }
  throw new Error('expected an InvalidReplayError');
}

describe('replay format', () => {
  it('round-trips through its JSON text', () => {
    expect(parseReplay(JSON.parse(serializeReplay(replay)))).toEqual(
      JSON.parse(JSON.stringify(replay)),
    );
  });

  it('writes one input run and one checkpoint per line, and empty lists inline', () => {
    const text = serializeReplay(replay);
    const lines = text.split('\n');
    expect(lines[0]).toBe('{');
    expect(lines).toContain('  "formatVersion": 1,');
    expect(lines.filter((line) => line.startsWith('    {"tick":'))).toHaveLength(
      replay.checkpoints.length,
    );
    expect(lines.filter((line) => line.startsWith('    ['))).toHaveLength(replay.inputs.length);
    expect(text.endsWith('}\n')).toBe(true);
    const empty = recordScenario(coreScenario, {
      seed: 3,
      ticks: 0,
      buildSha: '',
      contentHash: '',
    });
    expect(serializeReplay(empty)).toContain('  "inputs": [],');
  });

  it('AC-3: refuses a newer formatVersion with a typed UnsupportedReplayVersion error', () => {
    const newer = variant({ formatVersion: REPLAY_FORMAT_VERSION + 1 });
    expect(() => parseReplay(newer)).toThrow(UnsupportedReplayVersionError);
    try {
      parseReplay(newer);
    } catch (error) {
      expect(error).toMatchObject({
        name: 'UnsupportedReplayVersion',
        version: REPLAY_FORMAT_VERSION + 1,
        supported: REPLAY_FORMAT_VERSION,
      });
    }
  });

  it('treats non-objects and non-numeric versions as invalid, not unsupported', () => {
    expect(issuesOf(null)[0]).toMatch(/^\$: /);
    expect(issuesOf('replay')).toHaveLength(1);
    expect(issuesOf(variant({ formatVersion: '9' }))[0]).toMatch(/^\$\.formatVersion: /);
    expect(issuesOf({ nothing: true }).length).toBeGreaterThan(1);
  });

  it('rejects hashes from an older snapshot encoding with a re-bless hint', () => {
    expect(issuesOf(variant({ snapshotEncoding: 0 }))).toEqual([
      expect.stringMatching(/^\$\.snapshotEncoding: .*re-bless/),
    ]);
  });

  it('rejects input runs that do not cover exactly `ticks` ticks', () => {
    expect(issuesOf(variant({ ticks: 151 }))).toContain(
      '$.inputs: runs cover 150 ticks but ticks is 151',
    );
  });

  it('rejects checkpoints out of order, past the end, or not ending at finalHash', () => {
    const [first, second] = replay.checkpoints;
    expect(
      issuesOf(variant({ checkpoints: [second, first, ...replay.checkpoints.slice(2)] })),
    ).toContain('$.checkpoints[1].tick: checkpoint ticks must ascend within [0, 150]');
    const late = { tick: 151, hash: replay.finalHash };
    expect(issuesOf(variant({ checkpoints: [...replay.checkpoints, late] }))).toContain(
      '$.checkpoints[4].tick: checkpoint ticks must ascend within [0, 150]',
    );
    const ending = '$.finalHash: the last checkpoint must be at the final tick with hash finalHash';
    expect(issuesOf(variant({ checkpoints: replay.checkpoints.slice(0, -1) }))).toContain(ending);
    expect(issuesOf(variant({ finalHash: '00000000' }))).toContain(ending);
    expect(issuesOf(variant({ checkpoints: [] }))[0]).toMatch(/^\$\.checkpoints: /);
  });

  it('validates hashes and snapshot state shapes', () => {
    const bad = [{ tick: 0, hash: 'XYZ', state: { seed: 1 } }, ...replay.checkpoints.slice(1)];
    const issues = issuesOf(variant({ checkpoints: bad }));
    expect(issues).toContain('$.checkpoints[0].hash: expected an 8-digit lowercase hex state hash');
    expect(issues.some((issue) => issue.startsWith('$.checkpoints[0].state.clock: '))).toBe(true);
  });
});
