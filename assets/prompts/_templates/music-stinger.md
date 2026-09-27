# Template: Music stinger (Suno)

> **How to use:** copy to `assets/prompts/music/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Suno — human-in-the-loop (owner generates + picks the take into `assets/_incoming/music/`); Claude trims/encodes in the pipeline**.
>
> Suno generates full pieces; stingers are **cut** from a short generation designed to contain a strong hit/cadence. Generate 30–60 s, trim to the event length.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `music-stinger-<event>-<key?>` (kebab-case; equals the final filename stem) |
| Category | music |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — `needs-human` (owner runs Suno, ~1 min) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/music-stinger.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |
| Event | <combat-start \| combat-victory \| detected \| lost-them \| discovery \| death \| quest-complete \| capability-unlock \| fold-reveal \| song-swell \| vespers-rung \| tidefair-start \| tidefair-win \| tidefair-lose> |
| Key | <key of the location family, or "neutral" for percussive/atonal> |

## 2. Brief

<Game event, desired emotion, length, what it masks (e.g. explore→combat transition), motif fragment if any.>

## 3. Filled prompt

```text
STYLE FIELD:
{{SUNO_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/audio/audio-bible.md §4.1
, <key/mode>, <BPM of target family>, short dramatic <hit | cadence | swell | resolution>, <instrument focus e.g. "big frame drum hit and low horn stab" | "descending solo cello line" | "harp and glass harmonica sparkle">, <emotion>, clear ending

LYRICS FIELD:
[Intro]
[Big hit]
[End]
```

**Negative / exclude:**

```text
{{SUNO_EXCLUDE_STYLES}}  # ↑ verbatim from docs/audio/audio-bible.md §4.1
```

## 4. Output spec

| Property | Value |
|---|---|
| Length | <1–10 s per audio bible §2.3> |
| Key | must match target family (or neutral) |
| Start | transient within 20 ms of file start |
| Tail | natural decay ≤ 2 s, faded to silence |
| Format | WAV source → Opus .ogg + AAC .m4a |
| Loudness | −16 LUFS short-term max ±1, ≤ −1.0 dBTP |

## 5. Consistency checklist

- [ ] Preamble pasted verbatim
- [ ] No artist, composer, band or game names in the prompt
- [ ] Generated on a tier whose terms permit free public distribution (recorded in provenance)
- [ ] Naming matches audio bible §6; sidecar JSON prepared
- [ ] Correct key vs the family it plays over (test layered over the family loop)
- [ ] Event emotion unmistakable in ≤ 1 s
- [ ] No vocals
- [ ] Clean start/end — no clipped decay

## 6. Approval gate(s)

> Recorded in `assets/approvals.json` via `e37-asset-approval-log` (asset id, gate, version, file SHA-256, approver, date). CI refuses final assets without a matching record.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| music-take (owner picks in Suno) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result (file in `iterations/`) | Keep? |
|---|---|---|---|---|---|
| 1 | <yyyy-mm-dd> | <tool> / <model version> / <tier> | initial | `assets/_incoming/<asset-id>/v1.<ext>` | <yes/no + why> |

## 8. Provenance (copy into `assets/CREDITS.md` in the same commit)

| Asset id | Source file | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| <asset-id> | `assets/source/music/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
