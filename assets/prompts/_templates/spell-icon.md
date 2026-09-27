# Template: Spell icon

> **How to use:** copy to `assets/prompts/icon-spell/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> The school frame (rim) is shared per school; the central symbol is unique per spell. Attach the school frame anchor.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `icon-spell-<school>-<spell>-<nn>` (kebab-case; equals the final filename stem) |
| Category | icon-spell |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/spell-icon.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Spell name, school, what it does in one line (verb-first), the symbol idea.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Circular painted spell medallion icon, one simple bold central symbol, school colour dominant, ornate but simple rim frame, centred, transparent background, readable at 48 pixels.

SPELL: <name> — <verb-first effect, e.g. "freezes water into walkable ice">.
SCHOOL: <school> — core <hex>, highlight <hex>, shadow <hex> (style bible §2.3); shape motif <from §2.3>.
SYMBOL: <single bold symbol, e.g. "a snowflake crystallising over a ripple">.
FRAME: match the attached <school> frame anchor exactly.
```

## 4. Output spec

| Property | Value |
|---|---|
| Size | generate 1024×1024; export 256², 128², 48² |
| Background | transparent |
| Format | PNG → spell icon atlas |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] School identifiable by frame + colour + motif (not colour alone — colour-blind check with a deuteranopia filter)
- [ ] Symbol readable at 48 px
- [ ] Distinct from other spells in the same school
- [ ] Emissive whites only in the symbol core

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
| <asset-id> | `assets/source/icon-spell/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
