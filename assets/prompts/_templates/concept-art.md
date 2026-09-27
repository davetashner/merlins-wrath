# Template: Concept art

> **How to use:** copy to `assets/prompts/concept/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `concept-<subject>-<nn>` (kebab-case; equals the final filename stem) |
| Category | concept |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/concept-art.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<What moment, place or idea this explores; what decision it should help make (e.g. "Which of three Mooring's Watch silhouettes reads best from Briar Glen?"). Name the location palette used.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Painterly concept illustration, cinematic composition, clear focal point, value structure readable in greyscale, 16:9.

SUBJECT: <one sentence — what we see>.
LOCATION PALETTE: <location name> — base <hex>, secondary <hex>, accent <hex> (style bible §2.2).
TIME OF DAY: <dawn|day|golden hour|dusk|night|underground> — key light <hex>.
FOCAL POINT: <what the eye goes to first and why>.
MOOD: <2–3 words, e.g. "weathered, watchful, hopeful">.
STORY DETAIL: <one environmental-storytelling detail, e.g. "fresh flowers on an old grave">.
GAMEPLAY HINTS: <any affordances that must read — climbable pale ivy, cracked wall, lit window>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 16:9 — 1536×1024 |
| Background | opaque |
| Format | PNG (source), not shipped at runtime unless used in UI/loading screens |
| Variants | 3–4 per prompt; pick 1, keep others in `iterations/` |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Reads in greyscale thumbnail (squint test) with one clear focal point
- [ ] Location palette dominant (≥ 60 % of area earthy neutrals)
- [ ] Scale figure present if architecture/landscape
- [ ] Gameplay affordances use the Legibility Language (§7) correctly — no decorative use of cues

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
| <asset-id> | `assets/source/concept/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
