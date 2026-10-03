// The game's sound manifest (mw-e28.2): every cue the engine can play, final or placeholder. The
// placeholder entries and their files are written by `pnpm audio:placeholders`
// (scripts/audio/gen-placeholders.ts); final entries are added by the SFX integration beads.
import manifest from './data/sound-manifest.json';
import { SoundRegistry, type SoundDefInput } from './manifest.ts';

/** The committed manifest's entries. */
export const SOUND_MANIFEST: readonly SoundDefInput[] = manifest as unknown as SoundDefInput[];

/** A registry of the game's sounds (validated; throws on a bad manifest). */
export function gameSoundRegistry(): SoundRegistry {
  return new SoundRegistry().register(SOUND_MANIFEST);
}
