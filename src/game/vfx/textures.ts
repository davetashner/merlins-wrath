// The VFX texture manifest (mw-e29.2): every texture or flipbook an effect may name, keyed by its
// final asset id (style bible §15.1), with its size, frame grid and whether it is still a generated
// placeholder. `pnpm vfx:placeholders` (scripts/vfx) writes the placeholder entries and their PNGs
// under public/assets/vfx/<asset-id>.png; final art replaces a file and flips its flag, so
// integration is a file swap (e37-asset-vfx-base-textures-decals-integrate). The renderer only
// loads ids the manifest lists, and the generator's check fails when an effect names a texture the
// manifest lacks.

// Imports stay relative and alias-free so scripts/vfx (plain Node) can use the checks too.
import { z } from 'zod';
import { VFX_TEXTURE_PATTERN } from '../../content/types/vfx-effect.ts';
import type { VfxEffectEntry } from './effects.ts';

/** Where runtime VFX textures are served (style bible §15.2: public/assets/<category>/). */
export const VFX_TEXTURE_BASE_URL = '/assets/vfx';

/** One manifest entry: a texture or flipbook sheet. */
export const vfxTextureSchema = z.strictObject({
  id: z.string().regex(VFX_TEXTURE_PATTERN, 'must be a VFX asset id like "vfx-base-ring-01"'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Flipbook frame columns and rows (1 × 1 for a plain texture). */
  cols: z.number().int().min(1).max(16),
  rows: z.number().int().min(1).max(16),
  /** Generated stand-in under the final id; false once approved art lands. */
  placeholder: z.boolean(),
});

/** The manifest file: entries with unique ids. */
export const vfxTextureManifestSchema = z.array(vfxTextureSchema).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `duplicate VFX texture id "${entry.id}"`,
      });
    }
    seen.add(entry.id);
  });
});

export type VfxTextureEntry = z.output<typeof vfxTextureSchema>;

/**
 * The runtime URL of a texture the manifest lists, else undefined (the renderer then keeps its
 * procedural stand-in rather than requesting a file that is not there).
 */
export function vfxTextureUrls(
  manifest: readonly Pick<VfxTextureEntry, 'id'>[],
  base: string = VFX_TEXTURE_BASE_URL,
): (textureId: string) => string | undefined {
  const ids = new Set(manifest.map((entry) => entry.id));
  return (textureId) => (ids.has(textureId) ? `${base}/${textureId}.png` : undefined);
}

/**
 * mw-e29.2 AC-1: problems with the textures `effects` name: an id the manifest lacks, or a flipbook
 * grid that differs from the sheet's. Empty when every reference resolves.
 */
export function textureProblems(
  effects: readonly Pick<VfxEffectEntry, 'id' | 'emitters'>[],
  manifest: readonly VfxTextureEntry[],
): string[] {
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));
  const problems: string[] = [];
  for (const effect of effects) {
    for (const emitter of effect.emitters) {
      const entry = byId.get(emitter.texture);
      const where = `effect "${effect.id}" emitter "${emitter.id}"`;
      if (entry === undefined) {
        problems.push(`${where} names texture "${emitter.texture}", which has no manifest entry`);
        continue;
      }
      const cols = emitter.flipbook?.cols ?? 1;
      const rows = emitter.flipbook?.rows ?? 1;
      if (cols !== entry.cols || rows !== entry.rows) {
        problems.push(
          `${where} reads "${emitter.texture}" as ${String(cols)}×${String(rows)} frames, but the sheet is ${String(entry.cols)}×${String(entry.rows)}`,
        );
      }
    }
  }
  return problems;
}
