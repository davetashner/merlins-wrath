# Template: Prop sheet

> **How to use:** copy to `assets/prompts/prop/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> A prop sheet designs a related set that will share one atlas + one material (style bible §6.3). Bulk props come from recoloured CC0 kits; unique props may go through the image-to-3D API flow (style bible §17.2).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-<location-or-set>-<set-name>-<nn>` (kebab-case; equals the final filename stem) |
| Category | prop |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/prop-sheet.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Set name, where it appears, list of props (4–9), which are interactive/systemic (flammable, breakable, movable, lockable).>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: <e.g. "Deepworks shoring and tools">, location palette <hex list>.
PROPS (left to right, top to bottom): <1. …>, <2. …>, <3. …>, <4. …>.
SYSTEMIC CUES: <prop n is flammable → dry straw/tan hemp rope/oil stains>; <prop n is breakable → pale thin planks with nail-heads>; <prop n is movable → rope lashings>; <prop n is lockable → brass keyhole plate>.
SHAPE: chunky, bevelled, slightly leaning, big–medium–small; readable at 10 m.
SCALE REFERENCE: include a small 1.8 m human outline at the edge.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 1:1 1024×1024 or 3:2 1536×1024 |
| Background | flat parchment |
| Format | PNG |
| Downstream | small 50–400 tris, medium 400–2 k, large 2–5 k; one shared prop atlas (style bible §13.2) |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Props share palette, bevel size and lighting — look like one set
- [ ] Systemic props carry the correct Legibility cue; non-systemic props do not
- [ ] Detail achievable within tri budget and a shared atlas
- [ ] Consistent scale across the sheet

## 6. Approval gate(s)

> Recorded in `assets/approvals.json` via `e37-asset-approval-log` (asset id, gate, version, file SHA-256, approver, date). CI refuses final assets without a matching record.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |
| turntable (if image-to-3D) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result (file in `iterations/`) | Keep? |
|---|---|---|---|---|---|
| 1 | <yyyy-mm-dd> | <tool> / <model version> / <tier> | initial | `assets/_incoming/<asset-id>/v1.<ext>` | <yes/no + why> |

## 8. Provenance (copy into `assets/CREDITS.md` in the same commit)

| Asset id | Source file | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| <asset-id> | `assets/source/prop/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
