import { describe, expect, it } from 'vitest';
import { gameContentSources, GAME_CONTENT_ROOT } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  checkSocketTracks,
  compileSocketTrack,
  compileSocketTracks,
  socketTrackSchema,
  type SocketTrackDefInput,
  type SocketTrackEntry,
} from './socket-track.ts';

const IDENTITY = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const valid = {
  id: 'test-arc',
  notes: 'Test arc.',
  keys: [IDENTITY, { position: { x: 0, y: 0, z: 0.5 }, rotation: { x: 0, y: 0.6, z: 0, w: 0.8 } }],
} satisfies SocketTrackDefInput;

const problems = (value: unknown) =>
  (socketTrackSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

/** The game's content with `path` (under the content root) replaced by `json`. */
function withFile(path: string, json: (old: Record<string, unknown>) => unknown): ContentSource[] {
  const full = `${GAME_CONTENT_ROOT}/${path}`;
  const sources = gameContentSources();
  const old = sources.find((s) => s.path === full);
  if (old === undefined) throw new Error(`no ${full}`);
  const text = JSON.stringify(json(JSON.parse(old.text) as Record<string, unknown>));
  return sources.map((s) => (s.path === full ? { path: full, text } : s));
}

function loadIssues(sources: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('socket-track schema (mw-e04.26)', () => {
  it('accepts a track of unit-rotation keys', () => {
    expect(socketTrackSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty track, non-finite numbers and non-unit rotations', () => {
    expect(problems({ ...valid, keys: [] })).toEqual([
      'keys: Too small: expected array to have >=1 items',
    ]);
    expect(
      problems({
        ...valid,
        keys: [
          { ...IDENTITY, position: { x: Number.NaN, y: 0, z: 0 } },
          { ...IDENTITY, rotation: { x: 0, y: 0, z: 0, w: 1.01 } },
        ],
      }),
    ).toEqual([
      'keys.0.position.x: Invalid input: expected number, received NaN',
      'keys.1.rotation: must be a unit quaternion (length 1 within 0.001)',
    ]);
  });
});

describe('socket track load checks (mw-e04.26)', () => {
  it('the shipped content passes', () => {
    expect(loadIssues(gameContentSources())).toEqual([]);
  });

  it('AC-1: a move whose hitbox.track names a missing track fails to load, naming move and track', () => {
    const sources = withFile('move/sword-light-1.json', (move) => ({
      ...move,
      hitbox: { ...(move['hitbox'] as object), track: 'knight-sword-arc-missing' },
    }));
    expect(loadIssues(sources)).toEqual([
      `${GAME_CONTENT_ROOT}/move/sword-light-1.json#/hitbox/track: move "sword-light-1" names ` +
        'socket track "knight-sword-arc-missing", which does not exist',
    ]);
  });

  it("AC-2: a track with more keys than the move's active ticks + 1 fails to load", () => {
    // sword-light-1 is active for 4 ticks: 5 keys at most.
    const sources = withFile('socket-track/knight-sword-arc-light-1.json', (track) => ({
      ...track,
      keys: Array.from({ length: 6 }, () => IDENTITY),
    }));
    expect(loadIssues(sources)).toEqual([
      `${GAME_CONTENT_ROOT}/socket-track/knight-sword-arc-light-1.json#/keys: socket track ` +
        '"knight-sword-arc-light-1" has 6 keys but move "sword-light-1" is active for 4 ticks ' +
        '(at most 5 keys: key 0 plus one per active tick)',
    ]);
    // Exactly active + 1 keys, or fewer (the last key holds), is fine.
    for (const length of [1, 5]) {
      const ok = withFile('socket-track/knight-sword-arc-light-1.json', (track) => ({
        ...track,
        keys: Array.from({ length }, () => IDENTITY),
      }));
      expect(loadIssues(ok)).toEqual([]);
    }
  });

  it('ignores moves without a hitbox', () => {
    expect(
      checkSocketTracks([
        { type: 'move', file: 'm.json', value: { id: 'roll', frames: { active: 3 } } as never },
      ]),
    ).toEqual([]);
  });
});

describe('compileSocketTracks (mw-e04.26)', () => {
  it('normalises rotations and orders tracks by id', () => {
    const skewed = {
      id: 'b-arc',
      notes: 'n',
      keys: [{ position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1.0005 } }],
    } as SocketTrackEntry;
    const plain = { ...skewed, id: 'a-arc', keys: [IDENTITY] } as SocketTrackEntry;
    const table = compileSocketTracks([skewed, plain]);
    expect([...table.keys()]).toEqual(['a-arc', 'b-arc']);
    expect(table.get('b-arc')).toEqual({
      id: 'b-arc',
      keys: [{ position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }],
    });
    expect(Object.isFrozen(compileSocketTrack(plain).keys[0])).toBe(true);
  });
});

describeContent(
  'socket-track',
  'is valid, round-trips and is swept by a move',
  (track, content) => {
    expect(socketTrackSchema.parse(JSON.parse(serializeContent(track)))).toEqual(track);
    const users = content.all('move').filter((m) => m.hitbox?.track === track.id);
    expect(users.length).toBeGreaterThan(0);
    for (const move of users) expect(track.keys.length).toBe(move.frames.active + 1);
  },
);
