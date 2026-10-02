// The placeholder VFX texture set (mw-e29.2): one entry per final asset id from the asset plan's base
// textures and decals (e37-asset-vfx-base-textures-decals: 16 ids), so approved art drops in under
// the same ids. Sizes are small on purpose (the whole set stays far under its 1.5 MB budget); final
// sheets are 512² or 1024² (style bible §8).

import type { TextureSpec } from './recipes.ts';

const single = (id: string, kind: TextureSpec['kind'], cell = 64): TextureSpec => ({
  id,
  kind,
  cell,
  cols: 1,
  rows: 1,
});

/** Every placeholder texture, in asset plan order. */
export function placeholderTextureSpecs(): TextureSpec[] {
  return [
    // Base particle textures.
    single('vfx-base-soft-circle-01', 'soft-circle'),
    single('vfx-base-spark-streak-01', 'spark-streak'),
    single('vfx-base-smoke-noise-01', 'smoke-noise'),
    single('vfx-base-ring-01', 'ring'),
    single('vfx-base-shard-01', 'shard'),
    { id: 'vfx-base-flame-8x8-01', kind: 'flame', cell: 32, cols: 8, rows: 8 },
    // The six spell VFX templates.
    single('vfx-template-cast-windup-01', 'cast-windup'),
    single('vfx-template-projectile-head-01', 'projectile-head'),
    single('vfx-template-projectile-trail-01', 'projectile-trail'),
    single('vfx-template-impact-01', 'impact'),
    single('vfx-template-area-ring-01', 'area-ring'),
    single('vfx-template-beam-01', 'beam'),
    // Projected decals.
    single('vfx-decal-scorch-01', 'scorch', 128),
    single('vfx-decal-frost-01', 'frost', 128),
    single('vfx-decal-wet-01', 'wet', 128),
    single('vfx-decal-arrow-hole-01', 'arrow-hole', 64),
  ];
}
