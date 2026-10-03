# music-stinger-bundle

| Field | Value |
|---|---|
| Asset id | `music-stinger-bundle` (Slice stinger bundle (four cues in one take)) |
| Category | music |
| Consuming bead(s) | the demo slice mine gallery and skeleton fight (`mw-e01.5`) |
| Prompt bead | `mw-798` |
| Suno mode | Songs (Custom, Instrumental ON) |
| Template | `_templates/music-stinger.md` |
| Anchor / reference inputs | none |
| Family | Deepworks (C sharp Phrygian; 64 bpm explore, 128 bpm combat), per the slice brief; not yet checked against audio bible |

## Brief

One take holding four short cues separated by silence, to save a Suno download: combat-start, combat-victory, discovery (loot or key), and the locked iron door. Cut into four stingers on import (trim, fade, check each cue starts on a transient and ends clean).

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, C sharp Phrygian, short separate percussive and string hits with long silences between them, each hit a different cue, big frame drum hit with low bowed double bass and deep bronze bell then silence, descending solo cello line then silence, harp and glass harmonica sparkle then silence, dull iron door thud with low drone then silence, clear endings, no continuous music

LYRICS FIELD:
[Intro]
[Big hit: frame drum, low bass and bronze bell]
[Silence]
[Descending solo cello line, resolving]
[Silence]
[Harp and glass harmonica sparkle]
[Silence]
[Dull iron door thud, low drone]
[Silence]
[End]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | C sharp Phrygian / neutral percussive |
| BPM / metre | n/a |
| Source format | WAV in `assets/_incoming/music/music-stinger-bundle.wav` |
| Measured | 74.28 s (1:14.3), 48 kHz 16-bit stereo, -16.4 LUFS integrated, LRA 4.5 LU, peak -3.7 dBFS |

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
| 1 | 2026-10-03 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/music-stinger-bundle.wav` | yes, owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-stinger-bundle | `assets/_incoming/music/music-stinger-bundle.wav` | `b840db055922dfe7d332f8fd3373f68bf6bffd7bb1eb4cc52cd79e56218e1ea7` | Suno v6 (Pro plan, annual), owner-made | 2026-10-03 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
