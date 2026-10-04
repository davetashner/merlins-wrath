# Texture prompt: Wendmouth glenstone quay style probe

## Asset

| Field | Value |
|---|---|
| Asset id | `tex-glenstone-quay-wendmouth-probe-01` |
| Category | texture |
| Consuming bead | `mw-e37.432` |
| Style-probe bead | `mw-e37.431` |
| Template | `_templates/tileable-texture.md` v1 |
| Anchor input | `assets/_incoming/tex-glenstone-quay-wendmouth-probe-01/v1.png` |

## Filled prompt

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: monumental glenstone quay paving made from large, slightly irregular rectangular blocks.
REAL-WORLD SCALE: one tile = 4 m × 4 m; individual blocks roughly 80–140 cm wide.
COLOURS: pale honey-grey glenstone #CDB89A weathered toward salt-grey #9C9788, joints #7E8584.
SURFACE CHARACTER: broad painted shapes, soft value variation, rounded worn edges, shallow painted ambient occlusion only inside joints.
WEAR: subtle salt staining, smooth hull-scraped patches and sparse dark damp seams; no moss focal point and no readable mason's marks.
```

## Output and iteration

| Version | Result | Status |
|---|---|---|
| v1 | `assets/_incoming/tex-glenstone-quay-wendmouth-probe-01/v1.png` | Original owner-generated probe; 1254² |
| v2 | `assets/_incoming/tex-glenstone-quay-wendmouth-probe-01/v2.png` | Seamless edit generated with the built-in Codex image tool; source 1254² |
| runtime | `public/assets/texture/tex-glenstone-quay-wendmouth-probe-01.webp` | 1024² WebP (quality 88, 261 KB) made from the 1024² PNG placeholder, for in-game evaluation (wired by mw-7w0) |

This remains a placeholder/style probe until owner approval and the `mw-e37.8` KTX2 import pipeline.

## Where it is used (mw-7w0)

- **Testbed** (`createGreyboxView`, `stoneFor`): the floor (`walkable` purpose) only, on upward-facing
  surfaces, one tile per 4 m, with the 1 m grid still drawn (the owner's original wiring).
- **Slice**: the `walkable`, `blocking` and `climbable` parts, on every face, projected along the
  surface's dominant axis (one texture fetch, not a blend: the slice is built of axis-aligned boxes), no grid. The pillars, the ivy ledge, the crate, the doors and the models keep their own art.
- The painting fades in once it has loaded (no black flash), and a failed load leaves the flat colours.
- The runtime file is WebP (261 KB) rather than the 2 MB PNG, to keep the transfer small.
- **Cost:** a three-fetch triplanar blend cut the slice from 24 to 14 fps under software GL (what CI renders
  with) and failed three e2e shards on tick-paced thresholds; one fetch by dominant axis is within about 9% of
  no texture (22 fps).

