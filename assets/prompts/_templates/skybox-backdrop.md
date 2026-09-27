# Template: Skybox / backdrop

> **How to use:** copy to `assets/prompts/sky/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e37-image-gen-runner` (`codex exec` → gpt-image, ChatGPT subscription; fallback OpenAI Images API) — owner approves**.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `sky-<location>-<time-of-day>-<nn>` (kebab-case; equals the final filename stem) |
| Category | sky |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/skybox-backdrop.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |

## 2. Brief

<Location, time-of-day preset (style bible §3), distant landmarks visible (e.g. Mooring's Watch on the eastern spur, Bellwater Priory's belfry on the hill beyond the Briarwood), mood.>

## 3. Filled prompt

```text
{{GPT_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/art/style-bible.md §14

Wide panoramic painted sky and distant landscape backdrop, seamless left-right wrap, horizon at vertical centre, no foreground objects, soft painterly clouds, atmospheric perspective.

LOCATION: <…>. TIME OF DAY: <preset> — key <hex>, sky <hex>, fog <hex> (style bible §3).
DISTANT SILHOUETTES: <ridge line, Mooring's Watch, Briarwood edge, Bellwater Priory belfry> in <dusk/fog> values.
CLOUDS: <big soft cumulus | streaks | overcast with a break of light>.
SUN/MOON POSITION: <azimuth/elevation matching the scene's key light>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Size | generate 1536×1024 or larger panels; assemble to equirect 4096×2048 (High) / 2048×1024 (Low) |
| Wrap | seamless horizontally; top area plain for zenith fill |
| Format | PNG → KTX2 (High/Low variants) |

## 5. Consistency checklist

- [ ] GPT STYLE PREAMBLE pasted verbatim (diff against style bible §14)
- [ ] Palette: dominant colours within the global + location palette (style bible §2); saturation reserved for magic/fire/POI
- [ ] No pure black / pure white in painted surfaces
- [ ] Lighting: warm key upper-left, cool fill, gentle rim (§3)
- [ ] Shape language matches subject (§4); big–medium–small hierarchy
- [ ] No text, letters, numbers, logos, watermarks or signatures anywhere in the image
- [ ] Nothing on the "we never do" list (§11)
- [ ] Horizontal seam invisible at 360°
- [ ] Sun position matches in-scene key light direction
- [ ] Landmarks match world layout
- [ ] Distant values lighter/cooler than any foreground (atmospheric perspective)

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
| <asset-id> | `assets/source/sky/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
