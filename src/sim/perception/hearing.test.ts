// Hearing percepts (mw-e11.5): a propagated noise (mw-e09.3) as a heard-noise percept.
import { describe, expect, it } from 'vitest';
import type { NoiseEvent } from '../noise/events';
import type { NoiseHeard } from '../noise/system';
import { hearingPercept, type HearingProfile } from './hearing';
import { DEFAULT_PERCEPTION_TUNING as TUNING } from './tuning';

const EARS: HearingProfile = { thresholdDb: 30, range: 25 };
const SOURCE = { x: -6, y: 0, z: 4 };
const DOORWAY = { x: 0, y: 1, z: 2 };

function heard(fields: Partial<NoiseHeard> = {}, noise: Partial<NoiseEvent> = {}): NoiseHeard {
  return {
    tick: 3,
    listener: 2,
    noise: {
      tick: 3,
      position: SOURCE,
      loudness: 80,
      kind: 'break',
      entity: null,
      source: null,
      ...noise,
    },
    level: 45,
    perceived: DOORWAY,
    via: 'west-doorway',
    occlusion: 20,
    ...fields,
  };
}

describe('hearing (mw-e11.5)', () => {
  it('AC-5: a 45 dB noise over a 30 dB threshold, routed through a doorway, is heard at the doorway', () => {
    const percept = hearingPercept(EARS, heard(), TUNING);
    expect(percept).toEqual({
      source: 'sound:break',
      kind: 'heard-noise',
      sense: 'hearing',
      position: DOORWAY,
      strength: 0.1 + 0.9 * (15 / 30),
      certainty: TUNING.hearing.portalCertainty,
    });
    expect(percept.position).not.toEqual(SOURCE);
  });

  it('is surest of a sound that came straight, less of one muffled by a wall', () => {
    const straight = heard({ via: null, occlusion: 0, perceived: SOURCE });
    expect(hearingPercept(EARS, straight, TUNING)).toMatchObject({
      position: SOURCE,
      certainty: 1,
    });
    const muffled = heard({ via: null, occlusion: 30, perceived: SOURCE });
    expect(hearingPercept(EARS, muffled, TUNING).certainty).toBe(TUNING.hearing.muffledCertainty);
  });

  it('rises from the threshold strength at the threshold to 1 at 30 dB over it', () => {
    expect(hearingPercept(EARS, heard({ level: 30 }), TUNING).strength).toBe(0.1);
    expect(hearingPercept(EARS, heard({ level: 60 }), TUNING).strength).toBe(1);
    expect(hearingPercept(EARS, heard({ level: 95 }), TUNING).strength).toBe(1);
    expect(hearingPercept(EARS, heard({ level: 20 }), TUNING).strength).toBe(0.1);
  });

  it('names the sounding entity, else whoever made it, else the kind of sound', () => {
    expect(hearingPercept(EARS, heard({}, { entity: 5, source: 9 }), TUNING).source).toBe(
      'entity:5',
    );
    expect(hearingPercept(EARS, heard({}, { source: 9 }), TUNING).source).toBe('entity:9');
  });
});
