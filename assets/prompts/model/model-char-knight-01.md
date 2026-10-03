# model-char-knight-01 — the knight (placeholder model)

**Status: placeholder.** Not owner-approved (no turntable approval, mw-e37.21 AC-6 open) and the
generator's output licence is not yet verified. Replace before m3 unless both are settled.

## Source

- Approved flat: `char-knight-base-01` v1 (four-view sheet, ChatGPT image generation). Sheet sha256
  `2ccb44e05f5c58250afcd699f134aed54893fd4b76a23508376decb86d0864d4`.
- The whole sheet fed to the generator produced a mesh of **four knights side by side** (job
  `e374cfdd-41d6-4f62-84ae-fa9f55f7e1c4`, discarded). The input is the sheet's front view, cropped and
  padded square on the sheet's background: sha256
  `f5f370e1ac1c807740ff75bce364250e16816ef7ecd4ed1f1c857365ad3c0665`.

## Generation

- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus,
  2026-10-03, 9 credits.
- Job `3085240d-074b-46ff-b9d2-03ddfd4f10bf`; `face_limit` 12000, `texture` true, `pbr` false,
  `texture_quality` / `geometry_quality` standard, `quad` false, `auto_size` true.
- Raw result: 11,182 triangles, one material, one 2048² JPEG base-colour texture, unrigged, facing +x.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 1024` →
   `public/assets/model/model-char-knight-01.glb` (164 KB; one 1024² atlas, style bible §13.2).
2. At load (`src/render/player/knight-model.ts`): turned to face −z, stood on the ground, and skinned to
   the grey-box humanoid rig by nearest-bone weights (`src/render/animation/auto-skin.ts`).

## Known gaps

- Sword and shield are part of the mesh (they should be separate props: `prop-arming-sword-01`,
  `prop-wooden-shield-01`); the sword follows the right forearm, the shield the left arm.
- Skin weights are automatic, so shoulders and hips bend more crudely than a hand-weighted rig.
- No LOD1, no KTX2 (e37-model-import-pipeline, mw-e37.8).
