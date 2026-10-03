# model-creature-forgotten-miner-01: the Forgotten miner (placeholder model)

**Status: placeholder.** Neither the flat (`creature-forgotten-miner-base-01` variant b) nor the turntable is
owner-approved yet (mw-2l9), and the Tripo half of the licence is unconfirmed (mw-uuk).

## Generation

- Source: `creature-forgotten-miner-base-01` variant b (see `assets/prompts/creature/`).
- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus,
  2026-10-03, 9 credits. Job `6185891b-49c1-4b5e-82f5-056bd3e8aff4`; `face_limit` 6000, `texture` true,
  `pbr` false, standard quality, `auto_size` true.
- Raw result: 5,936 triangles, one material, unrigged, 1.8 m tall, facing +x, A-pose. The cold eye glow is
  painted into the base colour.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-creature-forgotten-miner-01.glb` (93 KB; standard creature budget 2 to 6 k
   triangles, one 512² texture).
2. At load (`src/render/creatures/forgotten-model.ts`): turned −90° about y so it faces +z (creatures face
   +z), stood on the ground, scaled to the creature's nav height. `createCreatureProxy` swaps it in for the
   placeholder capsule once loaded and keeps the capsule if it never loads. The material is cloned per
   creature so the telegraph glow lights one miner at a time.

## Known gaps

- **Static.** Creatures have no animation driver yet, so the miner slides and does not walk or swing
  (animation integration: mw-e37.401, mw-e37.402). It is a rigid mesh, not skinned.
- The pick floats in an open hand (the hands are open in the A-pose).
- No LOD1/LOD2, no KTX2 (mw-e37.8).

## Licence (checked 2026-10-03, mw-qov; open item mw-uuk)

The job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
are unread (tripo3d.ai returns 403 to automated fetches); the owner confirms them under mw-uuk. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
