# Template: Creature reference sheet

> **How to use:** copy to `assets/prompts/creature/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> Names, lore and details must match `docs/narrative/story-bible.md` §8 (canon MVP roster) and style bible §5.2.
> Hero creatures (e.g. Brother Horn) feed the image-to-3D API flow (style bible §17.2: concept gate → API model → turntable gate); standard creatures guide CC0 kit selection/recolour.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `creature-<creature>-<variant>-<nn>` (kebab-case; equals the final filename stem) |
| Category | creature |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/creature-reference-sheet.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Creature, family (style bible §5.2), behaviour/disposition, role in the world (fight? talk? trick? help?), one thing that makes it memorable.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Creature turnaround sheet: front, side, back and three-quarter views in a neutral stance, full body, consistent proportions, plain flat parchment background, plus one small silhouette inset in solid ink colour. Readable disposition through pose.

CREATURE: <canon name>, family <forgotten|goblin|briar-wolf|loom-spider|hushling|hollow-sentinel|tallow-ooze|mimic|abbot|horn>.
PRIMARY SHAPE: <from style bible §5.2>.
SCALE: <height in metres>, shown next to a small 1.8 m human outline for scale.
DISPOSITION CUES: <pose, head/ears/weapon position that reads as neutral vs hostile>.
ANATOMY & MATERIALS: <fur, bone, armour, moss…> — painted detail, not sculpted micro-detail.
COLOURS: <hex list from §5.2>. Eyes: <colour> (no glowing red "evil" eyes).
PERSONALITY DETAIL: <e.g. a monk-Forgotten still clutching a broom; a Rootcellar goblin in a rank kettle-helm; Brother Horn's chipped horns bound in bronze wire>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 3:2 — 1536×1024 |
| Background | flat parchment #EFE2C4 |
| Format | PNG |
| Downstream | standard 2–6 k tris / 512² ; hero ≤ 20 k tris / 2048² (style bible §13.2) |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Family shape language respected (§5.2)
- [ ] Silhouette inset identifiable at 64 px
- [ ] Disposition readable — could plausibly be approached, not just fought (constitution §7)
- [ ] No gore, no red glowing eyes
- [ ] Views are consistent enough for image-to-3D (no hidden limbs, symmetric where the creature is symmetric)

## 6. Approval gate(s)

> Recorded in `assets/approvals.json` via `e37-asset-approval-log` (asset id, gate, version, file SHA-256, approver, date). CI refuses final assets without a matching record.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |
| turntable (3D model) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result (file in `iterations/`) | Keep? |
|---|---|---|---|---|---|
| 1 | <yyyy-mm-dd> | <tool> / <model version> / <tier> | initial | `assets/_incoming/<asset-id>/v1.<ext>` | <yes/no + why> |

## 8. Provenance (copy into `assets/CREDITS.md` in the same commit)

| Asset id | Source file | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| <asset-id> | `assets/source/creature/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
