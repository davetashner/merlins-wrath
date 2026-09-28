# music-briar-glen-day

| Field | Value |
|---|---|
| Asset id | `music-briar-glen-day` (Briar Glen, day) |
| Category | music |
| Consuming bead(s) | the Briar Glen day music family (explore anchor; tension/combat derived later) |
| Prompt bead | `mw-e38.177` (preamble probe) |
| Generate bead | `mw-e38.177` (owner) |
| Approval | owner pick in Suno (`approvals.json` gate pending `mw-e38.103`-style review) |
| Template | `_templates/music-track.md` v1 |
| Anchor / reference inputs | none |
| Family | `music-briar-glen-day` — anchor track: this |
| Leitmotif | the-glen (audio bible §1.4) |

## Brief

Plays while the player walks Briar Glen by day: the Market Green, the notice board, the Sleeping Ox's door. Warm, cosy, lived-in golden hour, carrying "The Glen" (rising fifth, stepwise descent home) so the town feels like the title screen come true. One faint uneasy chord in the bridge keeps the missing sleepers in mind. Also the **preamble probe** for a warm cue (`mw-e38.177`).

## Filled prompt

Suno Custom mode, Instrumental ON. The Style field starts with the audio bible §4.1 preamble, verbatim.

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, exploration music for a lamplit valley town by day, D dorian, 88 bpm, 6/8, gentle lilting sway, nyckelharpa and wooden flute trading a folk melody that rises a fifth then steps gently back home, hurdy-gurdy drone, harp and dulcimer arpeggios, soft frame drum heartbeat, cello countermelody, cosy, lived-in, golden hour, one faint uneasy minor chord in the bridge, calm and loopable, no big climax

LYRICS FIELD:
[Intro]
[Main theme]
[Instrumental]
[Bridge]
[Main theme]
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
| BPM / metre | 88, 6/8 |
| Length | explore 2:00–3:30; loop region ≥ 60 s |
| Source format | WAV download to `assets/_incoming/music/music-briar-glen-day.wav` |
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
| 1 | 2026-09-27 | Suno v6 / Pro plan (annual) | initial | `assets/_incoming/music/music-briar-glen-day.wav` (179.56 s (2:59.6), 48 kHz 16-bit stereo, −16.3 LUFS integrated, LRA 7.1 LU, peak −4.2 dBFS) | yes — owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-briar-glen-day | `assets/_incoming/music/music-briar-glen-day.wav` | `a50c4545d2936429a58ddd1c2693632329b9b46249b6a817608527057c17224a` | Suno v6 (Pro plan, annual), owner-made | 2026-09-27 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
