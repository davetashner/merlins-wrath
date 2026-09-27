# Template: Item icon

> **How to use:** copy to `assets/prompts/icon-item/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> Always attach the approved icon-series anchor image so angle, light and framing match.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `icon-item-<item>-<variant>-<nn>` (kebab-case; equals the final filename stem) |
| Category | icon-item |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/item-icon.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Item, its category (weapon, tool, key, consumable, book, quest), rarity/quality cue (material, not rainbow glow), what makes it distinct from similar items.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Single game inventory icon, one object, three-quarter top-down view, centred, filling about 80% of the frame, warm key light from upper left, soft ink drop shadow, transparent background, readable at 64 pixels.

ITEM: <e.g. iron lockpick set in a rolled leather pouch>.
MATERIALS & COLOURS: <…> (hex from style bible §2).
DISTINCTIVE FEATURE: <the one shape that tells it apart at 64 px>.
QUALITY CUE: <plain iron | brass fittings | black steel with gilt> — no rarity glow or beams.
MATCH THE STYLE, ANGLE AND LIGHTING OF THE ATTACHED ANCHOR ICON.
```

## 4. Output spec

| Property | Value |
|---|---|
| Size | generate 1024×1024; export 256², 128², 64² |
| Background | transparent |
| Framing | object fills ~80 %, centred, drop shadow down-right |
| Format | PNG source → icon atlas (KTX2 UASTC or WebP for DOM) |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Readable at 64 px (downscale test)
- [ ] Camera angle, light direction and shadow match the anchor icon
- [ ] Distinguishable from sibling items in greyscale
- [ ] No rarity rainbow/beam glow

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
| <asset-id> | `assets/source/icon-item/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
