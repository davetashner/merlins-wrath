# music-motif-nightjar-song

| Field | Value |
|---|---|
| Asset id | `music-motif-nightjar-song` (Motif anchor: the Nightjar's song) |
| Category | music |
| Consuming bead(s) | `mw-e38.104`; night in town (song on still nights), Hushlings, the Cradle, song-swell beats |
| Prompt bead | `mw-e38.101` |
| Generate bead | `mw-e38.102` (owner) |
| Approval | `mw-e38.103` (owner pick in Suno recorded here; `approvals.json` entry pending) |
| Template | `_templates/music-track.md` v1 |
| Anchor / reference inputs | none |
| Family | motif anchor (no family); every Nightjar quote derives from this take |
| Leitmotif | nightjar-song (audio bible §1.4) |

## Brief

The song that walks sleepers into the dark. A lulling 3/4 lullaby, a falling minor sixth then gently rocking seconds, over a soft churring trill (the nightjar's churr), sung by a distant wordless voice with glass harmonica. It slowly drifts out of tune. It must be seductive and beautiful: the dread comes from how lovely it is. If Suno's take stays in tune, the import pipeline applies the microtonal sag.

## Filled prompt

Suno Custom mode, Instrumental ON. The Style field starts with the audio bible §4.1 preamble, verbatim.

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, eerie lullaby, E aeolian, 60 bpm, 3/4 waltz lullaby, a beautiful lulling melody falling a minor sixth then gently rocking back and forth, the melody slowly drifts out of tune as it repeats, distant solo wordless voice humming oohs, glass harmonica, soft churring insect-like trill underneath, bowed metal shimmer, night, moonlight, seductive and tender, quietly unsettling, very sparse, no percussion, fades into silence

LYRICS FIELD:
[Intro]
[Lullaby]
[Lullaby - drifting out of tune]
[Outro - fading]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | E Aeolian, detuning |
| BPM / metre | 60, 3/4 |
| Length | linear anchor; the motif is cut from the take |
| Source format | WAV download to `assets/_incoming/music/music-motif-nightjar-song.wav` |
| Runtime | Opus .ogg 112 kbps stereo + AAC .m4a fallback |
| Loudness | explore −18 LUFS ±1, ≤ −1.5 dBTP (applied on import) |

## Consistency checklist

- [x] Preamble pasted verbatim
- [x] No artist, composer, band or game names
- [x] Generated on a paid Suno tier (Pro, annual), tier and date recorded
- [x] Zero intelligible words: the owner kept this take after auditioning in Suno
- [ ] Key and BPM verified with an analyser on import
- [ ] Instrumentation within audio bible §1.1 (checked on import)
- [ ] Leitmotif recognisable when quoted (checked when variants are derived)
- [ ] Loop seam / motif cut points chosen on import

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| music-take (owner picks in Suno) | v1 | approved | owner | 2026-09-27 | the one take downloaded (download allowance); `approvals.json` hash entry to follow when that log exists |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-09-27 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/music-motif-nightjar-song.wav` (179.88 s (2:59.9), 48 kHz 16-bit stereo, −16.1 LUFS integrated, LRA 7.6 LU, peak −4.1 dBFS) | yes — owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-motif-nightjar-song | `assets/_incoming/music/music-motif-nightjar-song.wav` | `bae149885224bdde29998c7a6091a3c414d8b1eafded0f333fd13b2a1ab2930a` | Suno v6 (Pro plan, annual), owner-made | 2026-09-27 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
