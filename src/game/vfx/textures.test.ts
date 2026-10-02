import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import { vfxTextureManifest } from './texture-data.ts';
import {
  textureProblems,
  VFX_TEXTURE_BASE_URL,
  vfxTextureManifestSchema,
  vfxTextureUrls,
  type VfxTextureEntry,
} from './textures.ts';

const ring: VfxTextureEntry = {
  id: 'vfx-base-ring-01',
  width: 64,
  height: 64,
  cols: 1,
  rows: 1,
  placeholder: true,
};

describe('VFX texture manifest (mw-e29.2)', () => {
  it('AC-1: every texture the game’s effect definitions reference resolves to a manifest entry', () => {
    const effects = loadGameContent().all('vfx-effect');
    expect(effects.length).toBeGreaterThan(0);
    expect(textureProblems(effects, vfxTextureManifest())).toEqual([]);
  });

  it('AC-1: names an effect whose texture is missing or read with the wrong frame grid', () => {
    const emitter = (id: string, texture: string, flipbook?: { cols: number; rows: number }) =>
      ({ id, texture, ...(flipbook && { flipbook }) }) as never;
    const effects = [
      {
        id: 'vfx-a',
        emitters: [
          emitter('ok', 'vfx-base-ring-01'),
          emitter('gone', 'vfx-nowhere-01'),
          emitter('grid', 'vfx-base-ring-01', { cols: 4, rows: 4 }),
        ],
      },
    ];
    expect(textureProblems(effects, [ring])).toEqual([
      'effect "vfx-a" emitter "gone" names texture "vfx-nowhere-01", which has no manifest entry',
      'effect "vfx-a" emitter "grid" reads "vfx-base-ring-01" as 4×4 frames, but the sheet is 1×1',
    ]);
  });

  it('serves only listed textures, from /assets/vfx by default', () => {
    const url = vfxTextureUrls([ring]);
    expect(url('vfx-base-ring-01')).toBe(`${VFX_TEXTURE_BASE_URL}/vfx-base-ring-01.png`);
    expect(url('vfx-nowhere-01')).toBeUndefined();
    expect(vfxTextureUrls([ring], '/cdn')('vfx-base-ring-01')).toBe('/cdn/vfx-base-ring-01.png');
  });

  it('rejects duplicate ids and ids that are not VFX asset ids', () => {
    expect(vfxTextureManifestSchema.safeParse([ring, ring]).error?.issues[0]?.message).toBe(
      'duplicate VFX texture id "vfx-base-ring-01"',
    );
    expect(vfxTextureManifestSchema.safeParse([{ ...ring, id: 'tex-x' }]).success).toBe(false);
    expect(vfxTextureManifest().every((entry) => entry.placeholder)).toBe(true);
  });
});
