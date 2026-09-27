# Template: In-world book (cover and page)

> **How to use:** copy to `assets/prompts/book/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> Books are a pillar (spells are learned from books, bookshops are destinations). The image supplies binding, paper and illustrations; **titles and body text are always font-rendered** (IM Fell English, style bible §9.1).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `book-<title-slug>-<cover|page|spread>-<nn>` (kebab-case; equals the final filename stem) |
| Category | book |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/book-cover-and-page.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Book title (for the game to render), school/subject, rarity (common primer, rare tome, forbidden text, damaged), physical condition, author/origin flavour.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

In-world book asset, flat front-facing orthographic, aged leather or cloth binding with embossed motif, no readable text or letters (blank title plate or abstract ornament), even lighting.

BOOK: <canon title from story bible §7.2–7.3, e.g. "Frostglass for the Careful" (frost primer) or "The Vesperine Hours" (Bellwater Priory hymnal)>.
COURT STATUS: <licensed: red-wax lantern seal | restricted: lantern seal + writ ribbon | forbidden: no seal, scraped/scorched patch> (style bible §5.3).
FORMAT: <cover | single page | open spread>.
BINDING / PAPER: <leather colour hex, metal corners, clasp; paper parchment #EFE2C4 with foxing>.
MOTIF: <school symbol from style bible §2.3 embossed or illuminated>.
CONDITION: <pristine | worn | water-damaged | burned edge | chained (forbidden)>.
PAGE LAYOUT (page/spread only): <empty text column areas left clear; marginal illustration of …; illuminated initial frame without a letter>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | cover 2:3 1024×1536; spread 3:2 1536×1024 |
| Background | transparent for cover (book object), opaque for pages |
| Text-safe areas | <define rectangles in px where the UI renders text> |
| Format | PNG → WebP/KTX2 |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Zero glyphs/letters generated (inspect at 100 %)
- [ ] School motif and colour correct
- [ ] Rarity/condition readable from binding alone
- [ ] Text-safe areas low-contrast enough for ≥ 7:1 ink text

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
| <asset-id> | `assets/source/book/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
