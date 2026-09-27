# Template: Tileable texture

> **How to use:** copy to `assets/prompts/texture/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> GPT outputs are rarely perfectly seamless; the import pipeline or a manual offset-and-heal pass fixes seams. Record which in the iteration log.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-<material>-<variant>-<location?>-<nn>` (kebab-case; equals the final filename stem) |
| Category | texture |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/tileable-texture.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Material, where it is used, scale (metres per tile), which Legibility cue it carries if any (e.g. climbable ledge trim, weak-wall mortar).>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: <cobblestone|plank floor|thatch|plaster|cave rock|mossy flagstone|…>.
REAL-WORLD SCALE: one tile = <2> m × <2> m; element size <e.g. cobbles ~25 cm>.
COLOURS: <hex list from location palette>.
SURFACE CHARACTER: broad painted shapes, soft value variation, subtle chunky bevels on each element, painted ambient occlusion in cracks only.
WEAR: <moss in gaps | soot | water stains | none>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Size | generate 1024×1024; runtime T2 1024² (High) / 512² (Low), KTX2 ETC1S |
| Texel density | 256 px/m target at High (style bible §6.2) → set tile scale accordingly |
| Tileable | yes, both axes (verify with 2×2 tiling preview) |
| Maps | albedo; optional derived normal (hero surfaces only, not on Low); optional vertex-blend partner texture id |
| Format | PNG source → KTX2 runtime |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] 2×2 and 4×4 tiling previews show no visible seams or obvious repeating feature
- [ ] No baked directional lighting or shadows
- [ ] Value range compatible with the shared ramp material (no crushed darks)
- [ ] Texel density matches neighbours in the same scene
- [ ] If it carries a Legibility cue, the cue matches §7 exactly

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
| <asset-id> | `assets/source/texture/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
