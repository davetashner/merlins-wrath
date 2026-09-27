# Template: Key art / title screen

> **How to use:** copy to `assets/prompts/keyart/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `keyart-<use>-<nn>` (kebab-case; equals the final filename stem) |
| Category | keyart |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/key-art-title-screen.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Use (title screen, itch/store capsule, social banner), the promise it sells (four classes, the Knot, Brother Horn the misunderstood warden), negative space for the logo (title: The Vesper Bell, typeset separately, never painted into the image).>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Key art illustration, epic but warm, strong central composition with negative space reserved for a title logo (added later, do not draw text), cinematic lighting, rich detail at the focal point only.

SCENE: <e.g. the four heroes on the ridge above Briar Glen at golden hour, the boarded Deepworks gate glowing faintly below>.
CHARACTERS: <which, poses, each with signature prop visible in silhouette (style bible §5.1)>.
LOGO SPACE: <top third | left third> kept calm and low-detail.
LIGHT: golden hour key #FFB870, cool violet shadow #3B3A5A.
HOOK DETAIL: <a pair of great bronze-bound horns silhouetted in the mine mouth; the signal mirror flashing on Mooring's Watch>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 16:9 1536×1024 (title) + crops: <capsule sizes> |
| Background | opaque |
| Format | PNG master → WebP/KTX2 runtime |
| Logo | overlaid in engine/UI with Cinzel Decorative — never generated |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Logo negative space clean at all target crops
- [ ] Class silhouettes match approved character sheets
- [ ] Warm, hopeful tone — not bleak
- [ ] No generated text

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
| <asset-id> | `assets/source/keyart/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
