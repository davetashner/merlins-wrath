# Template: NPC portrait

> **How to use:** copy to `assets/prompts/portrait/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.
>
> Portraits appear in dialogue UI. Attach the portrait-series anchor for framing/lighting consistency, and the NPC's character sheet if one exists.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `portrait-npc-<name>-<role>` (kebab-case; equals the final filename stem) |
| Category | portrait |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/npc-portrait.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Name, role, personality in 3 words, one visual story detail, disposition range (we may need neutral + one expression variant).>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Head-and-shoulders character portrait, three-quarter view, expressive but natural face, painted, soft warm key light and cool rim, simple softly blurred background in the location's colours, bust framing with space above the head.

NPC: <name>, <role e.g. bookseller of Briar Glen>, <age>, <build>.
PERSONALITY: <3 words> — shown through <expression / posture>.
CLOTHING: <…>, colours <hex>.
STORY DETAIL: <ink-stained fingers | spectacles on a chain | burn scar from a failed spell>.
BACKGROUND: blurred <location> colours <hex>.
EXPRESSION: <neutral | warm | wary | angry | sad>.
MATCH THE FRAMING AND LIGHTING OF THE ATTACHED PORTRAIT ANCHOR.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 1:1 1024×1024 (or 2:3 1024×1536 if the UI calls for it) |
| Background | opaque, soft blurred |
| Export | 512² and 256² |
| Variants | neutral + <n> expressions, same seed/reference |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Matches the NPC character sheet / 3D model colours if they exist
- [ ] Framing and light match the portrait anchor
- [ ] Humanity and warmth readable — even villains are people
- [ ] Diverse, non-stereotyped features across the cast

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
| <asset-id> | `assets/source/portrait/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
