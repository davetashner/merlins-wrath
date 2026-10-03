# music-open-world

| Field | Value |
|---|---|
| Asset id | `music-open-world` (Open-world explore (from the mine-gallery explore prompt)) |
| Category | music |
| Consuming bead(s) | the demo slice mine gallery and skeleton fight (`mw-e01.5`) |
| Prompt bead | `mw-798` |
| Suno mode | Songs (Custom, Instrumental ON) |
| Template | `_templates/music-track.md` |
| Anchor / reference inputs | none |
| Family | Deepworks (C sharp Phrygian; 64 bpm explore, 128 bpm combat), per the slice brief; not yet checked against audio bible |

## Brief

Generated from the mine corridor / spawn-room explore prompt (C sharp Phrygian, 64 bpm). The take came out as an open-world theme rather than a sparse mine bed, so the owner kept it as `music-open-world`. The mine gallery still needs its own explore bed.

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, C sharp Phrygian, 64 BPM, sparse and slow, long hurdy-gurdy drone in the tonic and fifth, low bowed cello and double bass, distant single hand bell, wide silences between phrases, dripping-stone cavern reverb, ancient abandoned mine gallery, unease and patience, loopable, almost no percussion

LYRICS FIELD:
[Intro]
[Drone]
[Instrumental]
[Instrumental break]
[Drone]
[Outro]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | C sharp Phrygian (intended; verify) |
| BPM / metre | 64 (intended; verify) |
| Source format | WAV in `assets/_incoming/music/music-open-world.wav` |
| Measured | 179.88 s (2:59.9), 48 kHz 16-bit stereo, -15.0 LUFS integrated, LRA 5.1 LU, peak -2.8 dBFS |

## Consistency checklist

- [x] Preamble pasted verbatim
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
| 1 | 2026-10-03 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/music-open-world.wav` | yes, owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-open-world | `assets/_incoming/music/music-open-world.wav` | `f31d51e717712cb065d39c07c8d416c78e13371c21253734144947c43b57fa98` | Suno v6 (Pro plan, annual), owner-made | 2026-10-03 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
