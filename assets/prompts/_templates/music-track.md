# Template: Music track (Suno)

> **How to use:** copy to `assets/prompts/music/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Suno — human-in-the-loop: Claude writes this prompt, the owner pastes it into Suno (paid tier), picks the take and drops it in `assets/_incoming/music/<asset-id>.wav`; Claude does everything after**.
>
> One file per track in a family (explore/stealth/tension/combat). Families share key and BPM (audio bible §2.2). Generate the family anchor (usually `explore`) first, then derive variants with Extend/Cover/audio reference.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `music-<location>-<time?>-<state>` (kebab-case; equals the final filename stem) |
| Category | music |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — `needs-human` (owner runs Suno, ~1 min) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/music-track.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |
| Family | `music-<location>-<time?>` — anchor track: `<asset-id or "this">` |
| Leitmotif | <none \| the-glen \| knot \| horn \| horn-reveal \| nightjar-song \| vesper-hymn \| abbot \| the-tide \| magic> (audio bible §1.4) |

## 2. Brief

<Where/when it plays, music state, emotional target, what the player is doing, leitmotif usage, how it should transition.>

## 3. Filled prompt

> Claude fills everything below. Owner: paste into Suno Custom mode, Instrumental ON, Style field = block below, Exclude field = negatives; generate, pick the best take, download WAV to `assets/_incoming/music/<asset-id>.wav`.

```text
STYLE FIELD:
{{SUNO_STYLE_PREAMBLE}}
# ↑ replace with the verbatim block from docs/audio/audio-bible.md §4.1
, <mode e.g. D dorian>, <BPM> bpm, <time signature e.g. 6/8>, <state tags: e.g. "gentle exploration, walking pace" | "sparse stealth, pizzicato, ticking" | "tension ostinato, low strings pulse" | "driving combat, frame drums, low horns">, <lead instrument>, <location colour: e.g. "hammered dulcimer and harp, village warmth">, <motif hint: e.g. "rising fifth then stepwise descending folk melody">

LYRICS FIELD (structure only, no words):
[Intro]
[Instrumental]
[Main theme]
[Instrumental break]
[Main theme]
[Outro]
```

**Negative / exclude:**

```text
{{SUNO_EXCLUDE_STYLES}}  # ↑ verbatim from docs/audio/audio-bible.md §4.1
```

## 4. Output spec

| Property | Value |
|---|---|
| Key / mode | <e.g. D Dorian> (must match family) |
| BPM / metre | <88, 6/8> (must match family) |
| Length | explore 2:00–3:30; tension/combat 1:30–2:30; loop region ≥ 60 s |
| Loop points | bar-aligned, zero-crossing; stored in sidecar JSON in 48 kHz samples |
| Source format | WAV download (48 kHz/24-bit after pipeline resample) |
| Runtime | Opus .ogg 112 kbps stereo + AAC .m4a fallback |
| Loudness | explore/stealth −18 LUFS ±1, ≤ −1.5 dBTP; combat −16 LUFS ±1, ≤ −1.0 dBTP |
| Stems | <if available: drone / melody / perc> |

## 5. Consistency checklist

- [ ] Preamble pasted verbatim
- [ ] No artist, composer, band or game names in the prompt
- [ ] Generated on a tier whose terms permit free public distribution (recorded in provenance)
- [ ] Naming matches audio bible §6; sidecar JSON prepared
- [ ] Instrumental: zero intelligible words (listen through fully)
- [ ] Key and BPM verified by ear/analyser and match the family
- [ ] Instrumentation within audio bible §1.1; nothing from the "never" list (synths, drum kit, electric guitar)
- [ ] Leitmotif recognisable if specified
- [ ] Loop seam inaudible at candidate loop points
- [ ] Transition test: crossfades cleanly on a bar line to its family siblings

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
