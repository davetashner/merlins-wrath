import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetCategory, gameSoundRegistry, loopSidecarSchema } from '@audio/index';
import { SLICE_MUSIC_CUES } from './slice-music.ts';

const AUDIO_DIR = 'public/assets/audio';

describe('slice music assets (mw-0j5)', () => {
  const registry = gameSoundRegistry();

  it.each(Object.values(SLICE_MUSIC_CUES))(
    'AC-6: %s is a final (non-placeholder) cue whose Opus and AAC files exist',
    (cue) => {
      const def = registry.get(cue);
      expect(def).toBeDefined();
      expect(def?.placeholder).toBe(false);
      for (const asset of def?.variants ?? []) {
        for (const ext of ['ogg', 'm4a']) {
          expect(existsSync(`${AUDIO_DIR}/${assetCategory(asset)}/${asset}.${ext}`)).toBe(true);
        }
      }
    },
  );

  it.each([SLICE_MUSIC_CUES.ambience, SLICE_MUSIC_CUES.combat])(
    'AC-7: looping cue %s has a valid loop sidecar spanning its file',
    (cue) => {
      const def = registry.get(cue);
      expect(def?.loop).toBe(true);
      for (const asset of def?.variants ?? []) {
        const path = `${AUDIO_DIR}/${assetCategory(asset)}/${asset}.json`;
        const sidecar = loopSidecarSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        expect(sidecar.loopStartSample).toBe(0);
      }
    },
  );

  it('AC-8: the explore bed plays once; the beds sit on the music and ambience buses', () => {
    expect(registry.get(SLICE_MUSIC_CUES.explore)?.loop).toBe(false);
    expect(registry.get(SLICE_MUSIC_CUES.explore)?.bus).toBe('music');
    expect(registry.get(SLICE_MUSIC_CUES.combat)?.bus).toBe('music');
    expect(registry.get(SLICE_MUSIC_CUES.ambience)?.bus).toBe('ambience');
  });
});
