# music-title-main-theme

| Field | Value |
|---|---|
| Asset id | `music-title-main-theme` |
| Category | music |
| Consuming bead(s) | `e01-title-new-game-flow` |
| Template | `_templates/music-track.md` v1 |
| Anchor / reference inputs | none (this is a motif anchor) |
| Family | `music-title` — anchor track: this |
| Leitmotif | the-glen (with a faint nightjar-song shadow at the end) |

## Brief

Plays on the title screen and loops while the player sits in the menu. It is the first thing anyone hears,
so it establishes the main theme, "The Glen" (audio bible §1.4): a rising perfect fifth, then a stepwise
descent home, D–A–G–F–E–D, in 6/8 on nyckelharpa over a hurdy-gurdy drone. Warm, hopeful and a little
melancholy, like lamplight in a valley at dusk. Near the end, the warmth thins: a distant wordless voice
and a soft churring trill hint at the Nightjar's song before the loop returns to the drone. Wonder first,
unease second. The best take becomes the anchor for "The Glen" in later tracks.

## Filled prompt

Suno Custom mode, Instrumental ON.

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, title screen main theme, D dorian, 84 bpm, 6/8, slow lilting waltz-like sway, nyckelharpa lead melody over hurdy-gurdy drone, memorable folk melody that rises a fifth then steps gently back down home, harp and dulcimer arpeggios, cello countermelody, soft frame drum heartbeat, warm lamplit valley at dusk, bittersweet and hopeful, distant glass harmonica shimmer near the end, loopable

LYRICS FIELD:
[Intro]
[Hurdy-gurdy drone]
[Main theme]
[Instrumental]
[Main theme - fuller, cello countermelody]
[Quiet bridge - distant wordless voice, glass harmonica]
[Main theme - solo nyckelharpa]
[Outro - drone]
```

**Exclude styles:**

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | D Dorian |
| BPM / metre | 84, 6/8 |
| Length | 2:00–3:00; loop region ≥ 60 s, bar-aligned |
| Source format | WAV download to `assets/_incoming/music/music-title-main-theme.wav` |
| Runtime | Opus .ogg 112 kbps stereo + AAC .m4a fallback |
| Loudness | −18 LUFS ±1, ≤ −1.5 dBTP |

## Consistency checklist

- [ ] Preamble pasted verbatim
- [ ] No artist, composer, band or game names
- [ ] Generated on a paid Suno tier (distribution rights), tier and date recorded
- [ ] Zero intelligible words (listen through fully)
- [ ] Key D Dorian and 84 bpm 6/8 verified
- [ ] No synths, drum kit or electric guitar
- [ ] Main theme recognisable: rising fifth, stepwise descent home
- [ ] Loop seam inaudible at the candidate loop point

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| music-take (owner picks in Suno) | v1 | approved | owner | 2026-09-27 | Suno titled the take "The Dusk Waltz"; renamed to the asset id |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-09-27 | Suno / Pro plan (annual) | initial | `assets/_incoming/music/music-title-main-theme.wav` (3:03, 48 kHz 16-bit stereo, −16.5 LUFS integrated, LRA 4.7 LU) | yes — owner's pick |
