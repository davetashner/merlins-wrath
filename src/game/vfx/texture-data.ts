// The committed VFX texture manifest (mw-e29.2), for the game: `pnpm vfx:placeholders` writes its
// placeholder entries; the asset integration beads flip them to final.
import manifestJson from './data/texture-manifest.json';
import { vfxTextureManifestSchema, type VfxTextureEntry } from './textures.ts';

/** The committed manifest (src/game/vfx/data/texture-manifest.json), validated. */
export function vfxTextureManifest(): readonly VfxTextureEntry[] {
  return vfxTextureManifestSchema.parse(manifestJson);
}
