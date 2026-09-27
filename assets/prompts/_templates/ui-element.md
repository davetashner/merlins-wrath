# Template: UI element

> **How to use:** copy to `assets/prompts/ui/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `ui-<element>-<variant>-<nn>` (kebab-case; equals the final filename stem) |
| Category | ui |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/ui-element.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Element (panel, button, bar frame, tooltip, cursor, divider), states needed (normal/hover/pressed/disabled), where used.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Game UI element, flat front-facing, clean crisp edges, parchment and ink with brass fittings, designed for 9-slice scaling with plain stretchable centre and edges, transparent background, no text.

ELEMENT: <e.g. parchment dialogue panel with deckled edges and small brass corner fittings>.
COLOURS: parchment #EFE2C4, ink #1E1B2E, brass #C9A042, hover accent hearth #E8A24A, warning ember #C8553D.
STATE: <normal | hover | pressed | disabled — one image per state, same framing>.
DETAIL: ornament only in the corners; edges repeatable; centre flat and low-contrast for text legibility.
```

## 4. Output spec

| Property | Value |
|---|---|
| Size | generate 1024×1024; export at 2× of the 1920×1080 design size |
| Background | transparent |
| 9-slice insets | <l,t,r,b in px> |
| Format | PNG source → KTX2 UASTC (no mips) or PNG/WebP for DOM UI |
| States | <list> |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Edges tile/stretch without visible artefacts at 75–200 % UI scale
- [ ] Text over centre achieves ≥ 7:1 contrast with ink text
- [ ] Consistent with existing UI set (attach anchor)
- [ ] No baked text or icons

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
| <asset-id> | `assets/source/ui/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
