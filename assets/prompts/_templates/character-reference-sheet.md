# Template: Character reference sheet (turnaround)

> **How to use:** copy to `assets/prompts/character/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> Used as the input for 3D and as the canonical look. 3D flow (style bible §17.2): flat concept → OWNER GATE → Claude calls Meshy/Tripo image-to-3D via `e37-3d-gen-api-client` → remesh to budget → rig/animate → validate → turntable (`e37-turntable-preview`) → OWNER GATE → commit.
> Generate the front view first; once accepted, attach it as the reference input for the full turnaround. Image-to-3D works best from the clean front / three-quarter view on a flat background.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `char-<class-or-npc>-<variant>-<nn>` (kebab-case; equals the final filename stem) |
| Category | character |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/character-reference-sheet.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Who this is (class or NPC role), personality in 3 words, silhouette signature from style bible §5.1, signature prop.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Character turnaround sheet: front, three-quarter, side and back views of the same character in a neutral A-pose, full body, identical proportions and colours in every view, evenly lit, plain flat parchment (#EFE2C4) background, no cast shadows, orthographic feel, no perspective distortion.

CHARACTER: <class/role>, <age range>, <build>, about 6.5 heads tall, heroic-stylised proportions with hands, feet and shoulders exaggerated.
PRIMARY SHAPE: <tall triangle | inverted triangle | lean vertical with diagonal | low compact teardrop | …>.
SIGNATURE PROP (always visible in silhouette): <staff | shield | longbow | hood and scarf | …>.
COSTUME: <layers from inside out, materials: cloth, leather, plate…>.
COLOURS: primary <hex>, secondary <hex>, trim <hex> (style bible §5.1).
BACK DETAIL (camera sees the back most of the time): <cape/quiver/shield back/hood detail>.
FACE: <expression, features> — friendly-readable, not grotesque.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 3:2 — 1536×1024 (four views side by side) |
| Background | flat parchment #EFE2C4, no shadows |
| Pose | A-pose, arms ~45°, feet shoulder-width |
| Format | PNG |
| Downstream | model budget per style bible §13.2 (player 8–12 k tris, 1 material, ≤ 65 bones) |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] All four views match (colours, proportions, props on the same side)
- [ ] Silhouette test: solid-ink fill at 64 px tall is identifiable and distinct from the other three classes
- [ ] Signature prop visible in every view
- [ ] Back view designed, not an afterthought
- [ ] Costume is practical — nothing from the "we never do" list (no impractical armour)
- [ ] Detail density feasible for 8–12 k tris + a 1024² atlas

## 6. Approval gate(s)

> Recorded in `assets/approvals.json` via `e37-asset-approval-log` (asset id, gate, version, file SHA-256, approver, date). CI refuses final assets without a matching record.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |
| turntable (3D model, if modelled) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result (file in `iterations/`) | Keep? |
|---|---|---|---|---|---|
| 1 | <yyyy-mm-dd> | <tool> / <model version> / <tier> | initial | `assets/_incoming/<asset-id>/v1.<ext>` | <yes/no + why> |

## 8. Provenance (copy into `assets/CREDITS.md` in the same commit)

| Asset id | Source file | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| <asset-id> | `assets/source/character/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
