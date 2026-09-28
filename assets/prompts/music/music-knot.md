# music-knot

| Field | Value |
|---|---|
| Asset id | `music-knot` (The Knot) |
| Category | music |
| Consuming bead(s) | the Knot music family (explore anchor; stealth/tension/combat derived later) |
| Prompt bead | `mw-e38.177` (preamble probe) |
| Generate bead | `mw-e38.177` (owner) |
| Approval | owner pick in Suno |
| Template | `_templates/music-track.md` v1 |
| Anchor / reference inputs | none |
| Family | `music-knot` — anchor track: this |
| Leitmotif | knot (audio bible §1.4) |

## Brief

Plays in the labyrinth's corridors. The Knot is a sentence that never ends, so the music is a four-note circular turn (E–F–D♯–E, Phrygian) that never resolves, answered in canon. Cold, cavernous and hypnotic: uneasy wonder, not horror. Also the **preamble probe** for a dread cue (`mw-e38.177`).

## Filled prompt

Suno Custom mode, Instrumental ON. The Style field starts with the audio bible §4.1 preamble, verbatim.

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, exploration music for an ancient stone labyrinth, E phrygian, 58 bpm, slow and sparse, low sustained drone, low strings and bowed psaltery repeating a four-note circular figure that never resolves, the figure answered in canon by cello, distant frame drum pulse, cold cavernous echo, long silences, wordless low choir swells, ominous but not horror, uneasy wonder, hypnotic, loopable, no melody that resolves

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
| Key / mode | E Phrygian |
| BPM / metre | 58 |
| Length | explore 2:00–3:30; loop region ≥ 60 s |
| Source format | WAV download to `assets/_incoming/music/music-knot.wav` |
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
| 1 | 2026-09-27 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/music-knot.wav` (180.32 s (3:00.3), 48 kHz 16-bit stereo, −15.3 LUFS integrated, LRA 4.3 LU, peak −2.5 dBFS) | yes — owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-knot | `assets/_incoming/music/music-knot.wav` | `51c70219d45cf697028d48455b43712c6cad42480ac6456d22a571c9fbaa2634` | Suno v6 (Pro plan, annual), owner-made | 2026-09-27 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
