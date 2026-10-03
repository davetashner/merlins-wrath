# mine-ambience-bed

| Field | Value |
|---|---|
| Asset id | `mine-ambience-bed` (Mine gallery ambience bed) |
| Category | ambience |
| Consuming bead(s) | the demo slice mine gallery and skeleton fight (`mw-e01.5`) |
| Prompt bead | `mw-798` |
| Suno mode | Sounds |
| Template | `_templates/music-track.md (no template fits ambience; sfx.md is the nearest)` |
| Anchor / reference inputs | none |
| Family | Deepworks (C sharp Phrygian; 64 bpm explore, 128 bpm combat), per the slice brief; not yet checked against audio bible |

## Brief

Quiet room-tone loop for the slice's mine gallery: slow water drips, faint torch crackle, a soft draught, occasional distant stone settling. No melody, no rhythm. Suno is a music tool, so this is experimental; ElevenLabs is the fallback. Does not use the bible preamble.

## Filled prompt

```text
STYLE FIELD:
field recording ambience, stone mine gallery, low room tone, slow distant water drips, faint torch crackle, soft draught through a corridor, occasional distant stone settling, no melody, no rhythm, no instruments, no music, quiet, seamless loop
```

**Exclude styles** (if the field exists; ambience only, not the music list):

```text
melody, drums, choir, piano, strings, pads, drone
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | none |
| BPM / metre | none |
| Source format | WAV in `assets/_incoming/music/mine-ambience-bed.wav` |
| Measured | 19.56 s, 48 kHz 16-bit stereo, -19.9 LUFS integrated, LRA 16.6 LU, peak -5.7 dBFS |

## Consistency checklist

- [ ] Preamble pasted verbatim (n/a: ambience prompt does not use it)
- [x] No artist, composer, band or game names
- [x] Generated on a paid Suno tier (Pro, annual v6), tier and date recorded
- [ ] Zero intelligible words / unwanted musical content (owner kept this take after auditioning)
- [ ] Key and BPM verified with an analyser on import
- [ ] Instrumentation within audio bible §1.1 (checked on import)
- [ ] Loop seam / cut points chosen on import

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| music-take (owner picks in Suno) | v1 | approved | owner | 2026-10-03 | the one take downloaded; `approvals.json` hash entry to follow |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-10-03 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/mine-ambience-bed.wav` | yes, owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| mine-ambience-bed | `assets/_incoming/music/mine-ambience-bed.wav` | `cb11485fe352fae67a5e3b990761b56d60d0fb13ca8cdc0f97abde4a9e81531c` | Suno v6 (Pro plan, annual), owner-made | 2026-10-03 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
