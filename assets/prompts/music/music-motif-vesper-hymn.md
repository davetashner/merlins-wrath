# music-motif-vesper-hymn

| Field | Value |
|---|---|
| Asset id | `music-motif-vesper-hymn` (Motif anchor: the Vesper hymn) |
| Category | music |
| Consuming bead(s) | `mw-e38.104` (motif anchors into adaptive music); Bellwater Priory, calming the Forgotten, befriending Horn, the Climb, "Vespers Rung" |
| Prompt bead | `mw-e38.101` |
| Generate bead | `mw-e38.102` (owner) |
| Approval | `mw-e38.103` (owner pick in Suno recorded here; `approvals.json` entry pending) |
| Template | `_templates/music-track.md` v1 |
| Anchor / reference inputs | none |
| Family | motif anchor (no family); every hymn quote derives from this take |
| Leitmotif | vesper-hymn (audio bible §1.4) |

## Brief

The in-world hymn the monks rang at dusk to keep the Nightjar asleep, and the tune the player hums to calm the Forgotten. A plainchant-like stepwise line in a narrow D Dorian range, three short phrases each ending on a long held tonic, each answered by one low bronze bell toll. It must be simple enough to hum and recognise when quoted on cello, choir or bell elsewhere. The source for `music-hymn-vesper-hum`.

## Filled prompt

Suno Custom mode, Instrumental ON. The Style field starts with the audio bible §4.1 preamble, verbatim.

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, monastic hymn, D dorian, free time, slow, plainchant-like stepwise melody in a narrow range, three short phrases each ending on a long held low note, wordless male unison choir humming oohs, solo cello doubling the line, one deep bronze church bell toll answering each phrase, vast stone chapel reverb, candlelit, peaceful, sacred, lullaby-like calm, sparse, no percussion, no drone changes

LYRICS FIELD:
[Intro]
[Hymn]
[Bell]
[Hymn]
[Bell]
[Hymn]
[Bell]
[Outro]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | D Dorian |
| BPM / metre | free time |
| Length | linear anchor; the motif (three phrases + tolls) is cut from the take |
| Source format | WAV download to `assets/_incoming/music/music-motif-vesper-hymn.wav` |
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
| 1 | 2026-09-27 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/music-motif-vesper-hymn.wav` (179.36 s (2:59.4), 48 kHz 16-bit stereo, −15.9 LUFS integrated, LRA 5.4 LU, peak −4.1 dBFS) | yes — owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-motif-vesper-hymn | `assets/_incoming/music/music-motif-vesper-hymn.wav` | `811214c952beb5a15871aafb95758859674d00fa8421eab9383b365c8bc1fa7c` | Suno v6 (Pro plan, annual), owner-made | 2026-09-27 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
