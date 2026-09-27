# keyart-title-screen-01

| Field | Value |
|---|---|
| Asset id | `keyart-title-screen-01` (v1 = logo / key-art master with painted title) |
| Category | key art |
| Consuming bead(s) | `e37-asset-keyart-title-integrate`, `e01-title-new-game-flow`, landing page (`mw-e00.24`) |
| Template | `_templates/key-art-title-screen.md` v1 |
| Source | Owner-made in ChatGPT image generation, supplied 2026-09-27 (prompt not recorded) |

## Notes

- Dusk over Briar Glen: the River Wend, the Deepworks lit in the cliff, Mooring's Watch on the ridge, a bell
  tower, a cloaked hero in the foreground. Palette matches style bible §2 (hearth gold against violet ink).
- The title "The Vesper Bell" with a bell emblem is painted into the image. Use v1 as the **logo and
  marketing master**. The in-game title screen and website hero need a **textless variant (v2)** of the same
  scene at ≥ 2560×1440 so the title can be typeset (style bible: no text inside generated images).
- Rendering is painterly-realistic rather than the in-game chunky low-poly look. Treated as key art only
  (style bible key-art exception), not as the in-game style lock, unless the owner decides otherwise.

## Output spec

| Property | v1 (as supplied) | v2 (supplied, textless) |
|---|---|---|
| Size | 1672×941 PNG | 1672×941 PNG; ≥ 2560×1440 still wanted for in-game |
| Use | logo, store capsule, social | title screen background, website hero |

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved as logo / key-art master | owner | 2026-09-27 | title painted in |
| image | v2 | approved as textless background | owner | 2026-09-27 | same scene, 1672×941; used as the website hero (lanczos-scaled copies in `site/img/`); regenerate or upscale to ≥ 2560×1440 before the in-game title screen |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| keyart-title-screen-01 | `assets/_incoming/keyart-title-screen-01/v1.png`, `v2.png` (textless) | ChatGPT image generation (OpenAI) | 2026-09-27 | OpenAI terms: output owned by the user | this file |
