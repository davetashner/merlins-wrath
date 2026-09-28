// AC-3 [integration] (mw-e30.4): a thumbnail capture that fails — tainted canvas, lost context, or a
// capture returning garbage — never fails the save. It goes through the real registry and IndexedDB
// store, and the slot lists with the placeholder thumbnail (null) and loads normally.
import 'fake-indexeddb/auto';
import { defineComponent, World } from '@sim/index';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from '../sections';
import { openSaveStore } from '../storage/index';
import { SaveSlots, type SaveSlotInput } from './manager';
import type { ThumbnailCapture } from './thumbnail';

const Position = defineComponent<{ x: number }>('Position');

async function setup() {
  const { store } = await openSaveStore({ indexedDB: new IDBFactory(), storage: undefined });
  const manager = new SaveSlots({
    store,
    registry: createGameSaveRegistry(),
    build: { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' },
    now: () => 1_790_000_000_000,
  });
  const world = new World({ seed: 11 }).register(Position);
  world.add(world.spawn(), Position, { x: 4 });
  return { manager, world };
}

const input: SaveSlotInput = {
  characterName: 'Aldric',
  classId: 'knight',
  areaId: 'testbed-arena',
};

const failures: [string, ThumbnailCapture | undefined, RegExp][] = [
  [
    'canvas tainted',
    () => {
      throw new DOMException('The canvas has been tainted', 'SecurityError');
    },
    /^thumbnail capture failed: SecurityError: The canvas has been tainted$/,
  ],
  [
    'context lost',
    () => Promise.reject(new Error('WebGL context lost')),
    /^thumbnail capture failed: Error: WebGL context lost$/,
  ],
  [
    'oversized capture',
    () => ({ mimeType: 'image/webp', width: 1920, height: 1080, bytes: new Uint8Array(8) }),
    /^thumbnail rejected: size 1920×1080/,
  ],
  ['no capture supplied', undefined, /^no thumbnail capture was supplied$/],
];

describe('thumbnail capture failures', () => {
  it.each(failures)(
    'AC-3: %s — the save still succeeds with a placeholder thumbnail',
    async (_name, captureThumbnail, reason) => {
      const { manager, world } = await setup();
      const outcome = await manager.saveNew(
        world,
        captureThumbnail === undefined ? input : { ...input, captureThumbnail },
      );
      expect(outcome).toMatchObject({ status: 'saved', slot: 'manual-1' });
      expect(outcome.status === 'saved' && outcome.thumbnail.status).toBe('placeholder');
      expect(
        outcome.status === 'saved' && 'reason' in outcome.thumbnail && outcome.thumbnail.reason,
      ).toMatch(reason);

      const [listed] = await manager.list();
      expect(listed).toMatchObject({
        state: 'ready',
        details: { classId: 'knight', thumbnail: null },
      });
      expect(await manager.load('manual-1', world)).toMatchObject({ status: 'loaded' });
    },
  );
});
