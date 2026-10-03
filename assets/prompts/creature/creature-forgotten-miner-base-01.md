# creature-forgotten-miner-base-01: the Forgotten miner, unarmed A-pose flat

**Status: candidates, awaiting owner approval** (mw-0i5). Four variants (a to d) were generated. **All four
are modelled** and one is drawn at random for each miner each game (mw-1ja): `model-creature-forgotten-miner-01`
is variant b, `-02` is a, `-03` is c, `-04` is d. Drop any the owner dislikes from
`FORGOTTEN_MINER_URLS` (src/render/creatures/forgotten-model.ts) and `MINER_VARIANTS`.

| Field | Value |
|---|---|
| Asset id | `creature-forgotten-miner-base-01` |
| Category | creature (single-view model source, not a four-view sheet: image-to-3D reads a sheet as several figures) |
| Tool | Higgsfield `gpt_image_2_5`, text only, 1:1, 4 variants, 2026-10-03, about 0.25 credits each |
| Variant jobs | a `05e63dd5-89a5-41d7-a023-9794db1d0b2c`, b `f4e10e41-3594-4b23-8f7c-06dccb63c109`, c `f1a81981-c24c-4999-8eab-94d0b04d9d92`, d `c2c220e0-acab-45b9-bac0-3e83f4689e57` |
| Local files | `assets/_incoming/creature-forgotten-miner-base-01/{a,b,c,d}.png` (gitignored) |
| Canon | story bible §8 (the Forgotten: miner-Forgotten with picks and lamp-hooks); style bible §5.2 |
| Consuming bead | mw-2l9 |

## Prompt (preamble verbatim from docs/art/style-bible.md §14)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

CREATURE MODEL SOURCE: ONE character only, full body, front view, in a neutral A-pose with arms angled slightly away from the body, both hands empty with open fingers, evenly lit, plain flat parchment (#EFE2C4) background, no cast shadows, no ground, orthographic feel, no perspective distortion, centred.

CREATURE: a miner-Forgotten, a skeleton of a miner who walked into the song and forgot himself, family forgotten. PRIMARY SHAPE: tall, angular and gappy; the negative space between the ribs and limbs is the read. SCALE: about 1.9 m tall, long thin limbs, slightly stooped from years of hauling. DISPOSITION CUES: neutral and patient, head slightly bowed, not aggressive. ANATOMY AND MATERIALS: chunky stylized bones with soft bevelled edges (not anatomical detail), a few rotted scraps of a miner's leather harness, a worn leather cap with a small empty lamp-hook clipped to it, a rope belt, cracked leather kneepads and mining boots, rusted iron buckles. NO tools, NO weapon, NO pick in the hands. COLOURS: bone #E5DCC5, habit cloth and leather in bark brown #5A3E2B and dusk violet, rusted iron, eye sockets with small cold eye-glow points #9FD8E0 (cold blue-white, never red). Skull must be clearly readable with two glowing eye points. No gore, no flesh.
```

## Consistency checklist

- [x] Preamble pasted verbatim (extracted from the bible, not retyped)
- [x] Palette: bone `#E5DCC5`, habit cloth in bark and dusk, eye glow `#9FD8E0` (cold, not red)
- [x] Tall, angular, gappy silhouette; negative space between ribs and limbs
- [x] Hands empty (the pick is a separate prop: `prop-miner-pick-01`)
- [x] No text, logos, gore or red eyes
- [ ] Owner approval
