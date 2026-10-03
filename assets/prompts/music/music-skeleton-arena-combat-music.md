# music-skeleton-arena-combat-music

| Field | Value |
|---|---|
| Asset id | `music-skeleton-arena-combat-music` (Skeleton arena combat loop) |
| Category | music |
| Consuming bead(s) | the demo slice mine gallery and skeleton fight (`mw-e01.5`) |
| Prompt bead | `mw-798` |
| Suno mode | Songs (Custom, Instrumental ON) |
| Template | `_templates/music-track.md` |
| Anchor / reference inputs | none |
| Family | Deepworks (C sharp Phrygian; 64 bpm explore, 128 bpm combat), per the slice brief; not yet checked against audio bible |

## Brief

Combat loop for the lone Forgotten-skeleton fight in the slice's stone arena (mw-e01.5). C sharp Phrygian at 128 bpm, 6/8: a 1:2 ratio with the 64 bpm explore tempo. Urgent but restrained, tension without triumph, no melodic resolution.

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, C sharp Phrygian, 128 BPM, driving frame drums and bodhran in 6/8, low string ostinato, nyckelharpa stabs, wooden clacks, chains rattling in rhythm, urgent but restrained, a lone skeleton fight in a stone arena, tension without triumph, loopable, no melody resolution

LYRICS FIELD:
[Intro]
[Driving ostinato]
[Instrumental]
[Instrumental break]
[Driving ostinato]
[Instrumental]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | C sharp Phrygian (intended; verify) |
| BPM / metre | 128, 6/8 (intended; verify) |
| Source format | WAV in `assets/_incoming/music/music-skeleton-arena-combat-music.wav` |
| Measured | 119.60 s (1:59.6), 48 kHz 16-bit stereo, -16.1 LUFS integrated, LRA 5.0 LU, peak -4.1 dBFS |

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
| 1 | 2026-10-03 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/music-skeleton-arena-combat-music.wav` | yes, owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-skeleton-arena-combat-music | `assets/_incoming/music/music-skeleton-arena-combat-music.wav` | `dc06561a3e68a037187dededa3329eca7c09fabb27806a823169dd6bed0e2079` | Suno v6 (Pro plan, annual), owner-made | 2026-10-03 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
