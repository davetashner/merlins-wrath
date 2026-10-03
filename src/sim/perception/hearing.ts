// Hearing (mw-e11.5): a heard noise as a percept. Sound propagation (mw-e09.3) has already decided
// that the agent hears it (at or above its threshold, within its range) and where it seems to come
// from: the last doorway the sound came through, else the source. The percept carries that perceived
// position, never the true source behind the wall (no omniscience).
//
//   strength  = thresholdStrength at the threshold, rising linearly to 1 at fullAboveDb over it
//   certainty = 1 for a sound that came straight; the tuning's portal certainty when it came through a
//               doorway; its muffled certainty when walls or floors on a straight route muffled it
//
// The source is the entity that sounded (the pot), else whoever it is attributed to, else the
// sound's kind.

import type { Frozen, SenseProfile } from '@content/index';
import type { NoiseHeard } from '../noise/system';
import { entitySource, percept, soundSource, type Percept } from './percept';
import type { PerceptionTuning } from './tuning';

/** A sense profile's hearing. */
export type HearingProfile = Frozen<NonNullable<SenseProfile['hearing']>>;

/** The heard-noise percept of `heard` for an agent with `hearing`. */
export function hearingPercept(
  hearing: HearingProfile,
  heard: NoiseHeard,
  tuning: PerceptionTuning,
): Percept {
  const { thresholdStrength, fullAboveDb, portalCertainty, muffledCertainty } = tuning.hearing;
  const over = Math.max(0, heard.level - hearing.thresholdDb);
  const rise = Math.min(1, over / fullAboveDb);
  const { entity, source, kind } = heard.noise;
  const from = entity ?? source;
  let certainty = 1;
  if (heard.via !== null) certainty = portalCertainty;
  else if (heard.occlusion > 0) certainty = muffledCertainty;
  return percept({
    source: from === null ? soundSource(kind) : entitySource(from),
    kind: 'heard-noise',
    sense: 'hearing',
    position: heard.perceived,
    strength: thresholdStrength + (1 - thresholdStrength) * rise,
    certainty,
  });
}
