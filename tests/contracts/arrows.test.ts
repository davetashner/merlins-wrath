// Contract between layers (mw-e05.1): an arrow's stimulus payloads name elements of the sim's one
// stimulus API (mw-e03.3), and every sound cue a shipped arrow names is a sound the audio layer's
// manifest declares (placeholders count), so an arrow can never reference a sound that does not exist.

import { describe, expect, it } from 'vitest';
import { SOUND_MANIFEST } from '@audio/index';
import { arrowSchema, loadGameContent } from '@content/index';
import { STIMULUS_ELEMENTS } from '@sim/index';

describe('arrow payloads and cues (mw-e05.1)', () => {
  it('every sim stimulus element is accepted by an arrow stimulus payload', () => {
    for (const element of STIMULUS_ELEMENTS) {
      const result = arrowSchema.safeParse({
        id: 'contract-arrow',
        name: 'Contract Arrow',
        massGrams: 25,
        dragK: 0,
        damage: { amounts: {} },
        penetration: 20,
        onImpact: 'stick',
        payload: [
          { op: 'stimulus', element, intensity: 1, ...(element === 'gas' ? { gas: 'smoke' } : {}) },
        ],
        cues: { trailVfx: 'vfx-arrow-trail-contract' },
      });
      expect(result.error?.issues ?? [], element).toEqual([]);
    }
  });

  it('every shipped arrow sound cue exists in the sound manifest', () => {
    const sounds = new Set(SOUND_MANIFEST.map((s) => s.id));
    for (const arrow of loadGameContent().all('arrow')) {
      for (const cue of [arrow.cues.flightSfx, arrow.cues.impactSfx]) {
        if (cue !== undefined) expect(sounds, `${arrow.id}: ${cue}`).toContain(cue);
      }
    }
  });
});
