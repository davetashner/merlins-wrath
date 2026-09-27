# Template: VFX flipbook texture

> **How to use:** copy to `assets/prompts/vfx/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> GPT is unreliable at exact frame grids — expect to generate key frames and assemble/align them. Record the method in the iteration log.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `vfx-<school-or-element>-<effect>-<grid>-<nn>` (kebab-case; equals the final filename stem) |
| Category | vfx |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/vfx-flipbook-texture.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Effect (flame loop, frost burst, smoke puff, magic motes), school/element, blend mode, loop or one-shot, where it is used.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Stylized hand-painted VFX animation frames arranged in an exact grid of equal cells, one frame per cell, centred in each cell, pure black background for additive blending (or transparent for alpha), no background elements, smooth frame-to-frame progression, loopable.

EFFECT: <e.g. stylised fire flame loop>.
SCHOOL COLOURS: core <hex>, highlight <hex>, shadow <hex> (style bible §2.3).
SHAPE & MOTION: <teardrop flames rising and licking | hexagonal frost shards forming | …> (motion signature §2.3).
GRID: <4×4 = 16 | 8×8 = 64> frames, reading left-to-right, top-to-bottom.
BLEND: <additive on pure black | alpha on transparent>.
LOOP: <yes — last frame flows into first | no — one-shot, ends empty>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Sheet size | 1024×1024 (4×4 → 256² cells) or 1024×1024 (8×8 → 128² cells) |
| Background | pure black #000000 (additive) or transparent (alpha) |
| Frame rate | <12–24> fps |
| Format | PNG → KTX2 (UASTC if banding) |
| Budget | counts toward particle/overdraw budgets (style bible §13.1) |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Cells exactly equal; content centred and never crossing cell borders
- [ ] Loop seam invisible (for loops)
- [ ] School identifiable by shape + motion, not just colour
- [ ] Photosensitivity: no frame-to-frame full-cell flashes

## 6. Approval gate(s)

> Recorded in `assets/approvals.json` via `e37-asset-approval-log` (asset id, gate, version, file SHA-256, approver, date). CI refuses final assets without a matching record.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result (file in `iterations/`) | Keep? |
|---|---|---|---|---|---|
| 1 | <yyyy-mm-dd> | <tool> / <model version> / <tier> | initial | `assets/_incoming/<asset-id>/v1.<ext>` | <yes/no + why> |

## 8. Provenance (copy into `assets/CREDITS.md` in the same commit)

| Asset id | Source file | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| <asset-id> | `assets/source/vfx/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
