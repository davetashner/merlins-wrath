# Template: Sound effect (SFX)

> **How to use:** copy to `assets/prompts/sfx/<asset-id>.md`, fill every `<…>`, delete lines starting
> with `>`. Replace the preamble placeholder with the **verbatim** bible text — never paraphrase it.
> Contract: `docs/backlog-contract.md` §6. Tool: **Claude via `e38-sfx-gen-client` (ElevenLabs Sound Effects API, paid tier) per `e38-sfx-tool-decision`; CC0 libraries as fallback — owner approves by listening**.
>
> One prompt file may cover a round-robin set (e.g. `sfx-foot-stone-walk-01..06`). For library sourcing, the prompt is the search brief and the provenance table lists each source URL + licence.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `sfx-<source>-<action>-<material?>-<nn>` (kebab-case; equals the final filename stem) |
| Category | sfx |
| Consuming bead(s) | `mw-<…>` — the gameplay/content bead(s) that use this asset |
| Prompt bead | `mw-<…>` |
| Generate bead | `mw-<…>` — Claude-run (not needs-human) |
| Approval bead(s) | `mw-<…>` — `needs-human` owner gate(s), see §6 |
| Integrate bead | `mw-<…>` |
| Template | `_templates/sfx.md` v1 |
| Anchor / reference inputs | `<repo paths of previously approved assets, or "none">` — our own assets only, never third-party art |
| Sourcing | <library (CC0) \| generated \| recorded \| hybrid layered> |
| Round-robin count | <n> (≥ 3 for repeated sounds; footsteps 4–6) |
| Sim link | <surface id / noise radius / element / creature state this must match> |

## 2. Brief

<What makes the sound, in what situation, how loud relative to siblings (e.g. must be louder than walk-on-stone because the sim gives gravel a bigger noise radius), emotional quality.>

## 3. Filled prompt

```text
{{SFX_PREAMBLE}}
# ↑ replace with the verbatim block from docs/audio/audio-bible.md §8

<CATEGORY ADD-ON — pick one:>
# Footstep:  "Single footstep of a <light|armoured> adventurer <sneaking|walking|running|landing> on <surface>, <boot type>, one step only."
# Impact:    "<Object> striking <material> with <force>; crisp transient, solid body, very short debris."
# Weapon:    "<Weapon> <swing|parry|block|draw|release>, <material> ringing/thudding, weighty and satisfying."
# Spell:     "Magic <cast|sustain loop|impact> for a <school> spell: <sonic palette from audio bible §7.4>, fantastical but organic."
# Creature:  "<Creature (canon name, audio bible §7.5)> <idle|suspicious|alert|attack|hurt|flee|death|calm> vocalisation: <palette from §7.5>, non-verbal, no words."
# Signature: "<Vesper Bell toll (cracked|tongueless strike|mended) | hummed Vesper hymn | tower alarm bell | signal-mirror pivot>: <rules from audio bible §7.8>."
# UI:        "Short <page turn|quill scratch|brass click|leather flap|coin clink|wooden knock> UI sound, under 0.4 seconds, soft and pleasant."
# Ambience:  "Seamless <location> ambience bed: <elements>, no distinct events, loopable." (drop the "no ambience" line from the preamble)

SPECIFIC: <one-sentence description of this exact sound>.
DURATION: <seconds>.
```

## 4. Output spec

| Property | Value |
|---|---|
| Duration | <s> |
| Channels | mono (positional) \| stereo (UI/ambience) |
| Leading silence | ≤ 10 ms (one-shots) |
| Source format | WAV 48 kHz/24-bit |
| Runtime | Opus .ogg 64 kbps mono / 80 kbps stereo + AAC .m4a fallback |
| Loudness | per audio bible §5.1 category |
| Loop | <no \| yes — seamless, sidecar loop points> |

## 5. Consistency checklist

- [ ] Preamble pasted verbatim
- [ ] No artist, composer, band or game names in the prompt
- [ ] Generated on a tier whose terms permit free public distribution (recorded in provenance)
- [ ] Naming matches audio bible §6; sidecar JSON prepared
- [ ] SFX PREAMBLE used verbatim (generated) or brief followed (library)
- [ ] Dry — no baked reverb unless ambience
- [ ] Relative loudness ordering matches the sim (audio bible §7.3: sneak < walk < run < land; surface ordering)
- [ ] Material/school/creature palette matches audio bible §7
- [ ] Round-robins vary in pitch/timbre but stay the same event
- [ ] Licence allows public-repo redistribution (CC0 preferred; no "no-redistribution" libraries)

## 6. Approval gate(s)

> Recorded in `assets/approvals.json` via `e37-asset-approval-log` (asset id, gate, version, file SHA-256, approver, date). CI refuses final assets without a matching record.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| sfx-batch (owner listens) | v<N> | <approved / rejected> | <owner> | <yyyy-mm-dd> | <…> |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result (file in `iterations/`) | Keep? |
|---|---|---|---|---|---|
| 1 | <yyyy-mm-dd> | <tool> / <model version> / <tier> | initial | `assets/_incoming/<asset-id>/v1.<ext>` | <yes/no + why> |

## 8. Provenance (copy into `assets/CREDITS.md` in the same commit)

| Asset id | Source file | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| <asset-id> | `assets/source/sfx/<asset-id>/<file>` | <…> | <…> | <yyyy-mm-dd> | <terms URL + one-line summary> | this file |
