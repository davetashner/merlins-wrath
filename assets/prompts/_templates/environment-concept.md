# Template: Environment concept

> **How to use:** copy to `assets/prompts/environment/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `env-<location>-<area>-<nn>` (kebab-case; equals the final filename stem) |
| Category | environment |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/environment-concept.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Area, its gameplay purpose (hub, combat arena, stealth route, puzzle room), the multiple routes available (knight/thief/archer/sorcerer), and the emotional beat.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Environment concept painting, eye-level third-person game camera about 4 m behind and 2 m above a small figure for scale, strong foreground-midground-background separation, warm light source and cool shadow region, visible gameplay affordances.

AREA: <location> — <area name>. <one-sentence description>.
LOCATION PALETTE: base <hex>, secondary <hex>, accent <hex> (style bible §2.2).
LIGHT: <preset from §3>; warm source: <torch/window/sun/spell>; shadow region: <where the thief hides>.
ROUTES VISIBLE: <main path>; <climb route with pale briar-ivy / worn ledges>; <weak wall with diagonal cracks and patched mortar>; <mechanism target for arrows>; <thieves' chalk mark near a vent>.
LANDMARK: <big readable shape for navigation>.
HISTORY DETAIL: <what happened here>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 16:9 — 1536×1024 |
| Background | opaque |
| Format | PNG |
| Downstream | greybox layout reference + modular kit list; not shipped |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Warm/cool split present; dark areas are plausible real hiding places
- [ ] Every affordance drawn uses the Legibility Language (§7) and nothing decorative mimics a cue
- [ ] At least two distinct routes are visually readable
- [ ] Landmark readable in silhouette
- [ ] Buildable with modular kit pieces at our budgets (no bespoke organic mega-meshes)

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
| <asset-id> | `assets/source/environment/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
