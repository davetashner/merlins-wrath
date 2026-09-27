# The Vesper Bell — Audio Bible

> Status: **DRAFT v0.1 — awaiting owner sign-off** (bead `e38-audio-bible`).
> Subordinate to `CONSTITUTION.md`, `docs/backlog-contract.md` and aligned with `docs/art/style-bible.md`.
> Music tool: **Suno** (human-in-the-loop: Claude writes the prompt, the owner generates and picks the take).
> SFX tool: decided by `e38-sfx-tool-decision` — recommendation: **ElevenLabs Sound Effects API** (Claude-run), CC0 fallback (§9.4).
> No voice acting in MVP.
> Story names, locations, creatures and motifs are reconciled with `docs/narrative/story-bible.md` (**story
> canon**); if they disagree, the story bible wins. The game's title is **The Vesper Bell**
> (decided in `e39-title-decision`); "Merlin's Wrath" is only the original codename.

---

## 0. The sound in one sentence

**"Old-world folk instruments playing in stone rooms — a hurdy-gurdy drone and a lonely nyckelharpa over low
strings and breath-like choir, warm as a hearth in town and cavernous and uncertain below it; every footstep,
lock and spell sounds tactile, heavy and true."**

### Audio pillars

1. **Acoustic and hand-played.** Real (or real-sounding) folk and chamber instruments. No synth pads, no EDM,
   no trailer-braaams. Magic is the only place "impossible" sounds live.
2. **Warm above, cavernous below.** Briar Glen and daylight are melodic, modal, human; dungeons are sparse,
   droning, reverberant. Descent = fewer notes, more space.
3. **Sound is a gameplay system.** Stealth hears what the player hears (`e09-sound-propagation`). Surfaces,
   doors and noise must be *audibly* different in exactly the ways the sim treats them as different.
4. **Weight and consequence.** Souls-like impact: a parry rings, a shield bash thuds, a skeleton collapses in a
   rattle of distinct bones. Short pre-delays of silence before big hits make them land.
5. **Silence is an instrument.** Music drops out regularly; ambience carries exploration. No wall-to-wall score.
6. **Readable magic.** Each school has a sonic signature as distinct as its colour (§8).

---

## 1. Musical identity

### 1.1 Instrumentation

| Role | Instruments | Notes |
|---|---|---|
| **Signature lead** | Nyckelharpa, hurdy-gurdy (melody + drone), solo cello | The "voice" of the game. |
| **Drone / bed** | Hurdy-gurdy drone, low string ensemble (cello, double bass), harmonium, bowed psaltery | Drones in the tonic/fifth define dungeon cues. |
| **Colour** | Hammered dulcimer, Celtic harp, lute, wooden flute / recorder, low whistle, kantele | Town, the Briarwood, day. |
| **Choir** | Wordless choir (ooh/aah, soft), solo female/male wordless voice | Mystery, Bellwater Priory, the Vesper hymn, the Nightjar's song. Never lyrics. |
| **Percussion** | Frame drum, bodhrán, daf, taiko-ish low drum (sparingly), hand bells, wooden clacks, chains | Combat and tension; no drum kit. |
| **Weight** | Low brass (horns, tuba — sparing), bass drum | Reserved for Brother Horn (the Warden encounter) and major combat. |
| **Magic texture** | Glass harmonica, bowed metal, singing bowls, reversed harp | Arcane/illusion/time moments; the Nightjar's churring trill. |
| **Bells** | Low bronze bell (Vesper Bell toll: strong minor-third partial), small hand bells | The Vesper Bell and hymn; the Mooring's Watch tower bell. |
| **Harbour colour** | Fiddle and nyckelharpa in shanty rhythm, bodhrán, foot-stomps and hand-claps, low whistle, hurdy-gurdy drone, wordless call-and-response "oohs" | Wendmouth, the Drowned Gull, the Tidefair. Shanty-*inflected* rhythm only: **no accordion or concertina, no lyrics, no pirate cliché**. It stays the same dark-folk ensemble in a louder mood. |
| **Hornfolk drone** | Low overtone drone with a throat-singing texture (wordless), or bowed double-bass harmonics | Brother Horn, Hornfolk carvings, the Standing Horn. Reject any take where it sounds like words. |

Never: electric guitar, synth lead/pad, trap/EDM drums, drum kit, orchestral "Hollywood hits", dubstep risers,
vocals with lyrics.

### 1.2 Modes & harmony

| Mode | Feeling | Used for |
|---|---|---|
| **D Dorian** | Warm melancholy, folk | Briar Glen, main theme (home key of the game) |
| **Mixolydian** | Bright, rustic, tavern | The Sleeping Ox, Wendmouth by day, the Drowned Gull, the Tidefair, merchant cues |
| **Aeolian** | Longing, mystery | The Briarwood, Mooring's Watch, the Weeping Adit |
| **Phrygian** | Ancient, threatening, exotic | The Knot, the Deepworks below the Bell Line, combat |
| **Lydian** | Wonder, magic | Discoveries, learning a spell, the Lamplit Stacks, the Fold reveal |
| **Locrian / clusters** | Wrongness | Necromancy, the Sleepless Abbot, the Cradle — sparingly |

Harmony is modal and drone-based: long pedal tones, parallel fifths/fourths, occasional suspended chords.
Avoid functional pop progressions (I–V–vi–IV).

### 1.3 Tempo ranges

| State | BPM | Feel |
|---|---|---|
| Ambient / exploration (dungeon) | 50–70 or free-time | Sparse, drone |
| Exploration (town/Briarwood) | 70–96 | Walking pace, 3/4 or 6/8 welcome |
| Stealth | 80–100 (sparse, half-time feel) | Pizzicato, ticking |
| Tension | 90–110 | Ostinato pulse |
| Combat | 120–150 | Driving frame drums, 6/8 or 7/8 allowed |
| Boss (Warden encounter; Sleepless Abbot / Cradle confrontation) | 100–130 with heavy half-time | Weight over speed |

### 1.4 Leitmotifs

Leitmotifs are short (2–4 bars), described here by interval shape so they can be requested from Suno and
recognised by ear. Suno cannot reliably reproduce an exact melody from text; we therefore (a) generate a
motif-establishing track, (b) pick the best take as the **motif anchor**, and (c) use Suno's cover/extend/
"use audio as reference" features (where available) from that anchor to derive variants.

| Motif | Shape | Instrument | Appears in |
|---|---|---|---|
| **Main theme — "The Glen"** | Rising perfect fifth, then stepwise descent home (D–A–G–F–E–D), 6/8 | Nyckelharpa over hurdy-gurdy drone | Title, Briar Glen day, victory/rest stinger |
| **The Knot** | Four-note circular turn that never resolves (E–F–D♯–E, Phrygian), repeated in canon — a sentence that never ends | Low strings, bowed psaltery | The Knot, the Deepworks below the Bell Line, Brother Horn foreshadowing |
| **Brother Horn (the Warden)** | Heavy falling minor third on low horn (A–F♯) with a big drum hit, over the Hornfolk drone. **Reveal variant:** same notes re-harmonised in Lydian/major, played on solo cello + harp, tender | Low horns → cello | Warden encounter → the Fold reveal |
| **The Nightjar's song** | A lulling, beautiful lullaby figure in 3/4 — falling minor sixth, then gently rocking seconds — that slowly **drifts out of tune** (microtonal sag) over a soft churring trill (the nightjar's churr). Seductive, not scary: dread comes from its beauty. Distant solo wordless voice | Solo wordless voice, glass harmonica, bowed metal churr | Night sleepwalking, the song reaching town on still nights, Hushlings, the Cradle, song-swell beats |
| **The Vesper hymn / Vesper Bell** | Plainchant-like stepwise line in a narrow range (D Dorian), three short phrases ending on a long held tonic, answered by one low **bell toll**. The in-world hymn that calms the Forgotten and puts the Nightjar to sleep; the player can hum it | Wordless male unison choir or solo cello + low bronze bell | Bellwater Priory, calming the Forgotten, befriending Horn, the Climb, "Vespers Rung" |
| **The Sleepless Abbot** | The Vesper hymn **inverted** (the silenced hymn turned upside down), played gently and courteously on harmonium with whispered wordless choir; in confrontation it braids with the Nightjar's song | Harmonium, whispered choir | "A friend below" notes, the Act III reveal, the Cradle confrontation |
| **Wendmouth — "The Tide"** | Rolling 6/8 shanty figure: a rising fourth, then bouncing repeated notes, answered call-and-response between fiddle and low whistle over stomps. **Heist variant:** the same figure on pizzicato cello and muted dulcimer, half-time, with ticking | Fiddle, low whistle, bodhrán → pizzicato | Wendmouth, the Tidefair, the bonded-warehouse and Gilded Tern heists |
| **Magic / learning** | Arpeggiated Lydian sparkle | Dulcimer, glass harmonica | Spell learned, the Lamplit Stacks, discovery |

**Class idents (not leitmotifs):** each class has a 1–2 bar *ident* used only at class select, level-up/
capability-unlock stingers and the credits:

| Class | Ident |
|---|---|
| Sorcerer | Glass harmonica + harp Lydian arpeggio |
| Knight | Low horn + frame drum, square rhythm |
| Archer | Wooden flute leap (octave) with a plucked "string release" |
| Thief | Pizzicato cello + muted dulcimer, off-beat, playful |

---

## 2. Adaptive music design

### 2.1 States

The music system (implemented on `e28-audio-engine`) maps game state to a music state. Mapping follows
`e11-alert-states` (Unaware → Suspicious → Investigating → Searching → Alerted → Combat).

| Music state | Trigger | Content |
|---|---|---|
| `silence` | Default in dungeons between cues; after long exploration | Ambience only |
| `explore` | Location entered, no threats | Location explore track |
| `stealth` | Player sneaking with an unaware/suspicious creature within hearing range | Sparse stealth layer (pizzicato, soft ticking) |
| `tension` | Any creature Investigating/Searching the player | Tension track (ostinato) |
| `combat` | Any creature in Combat with the player | Combat track |
| `boss` | Scripted | Boss track: the Warden encounter (Brother Horn) or the Sleepless Abbot / Cradle confrontation |
| `resolve` | Combat ends / search abandoned | Stinger, then fade to `explore` or `silence` |

Rules:
- **Hysteresis:** entering combat is immediate (on next beat); leaving combat waits 4 s of no combat, leaving
  tension waits 6 s — prevents flip-flopping.
- **Music never tells the player something the world didn't.** Tension music starts only when a creature is
  actually investigating — this is a legitimate stealth cue, so it must be accurate.
- **Silence budget:** explore tracks play once (or 2 loops max) then drop to ambience for 60–180 s before
  returning.

### 2.2 Structure: "track families" (horizontal) with optional stems (vertical)

Suno produces full mixed tracks; stem separation quality varies. So the primary approach is **horizontal
re-sequencing** with **key- and tempo-locked families**:

- Each location has a **family**: `explore`, `tension`, `combat` (+ `stealth` for dungeons), all in the **same
  key/mode and BPM** (or BPM ratios 1:1, 2:3, 1:2).
- Transitions happen **on bar boundaries** (music clock from the track's BPM metadata): 1–2 bar equal-power
  crossfade, optionally masked by a **stinger**.
- If Suno stems are available on our tier (see §4) and separation is clean, a family may additionally ship
  **stems** (`-drone`, `-melody`, `-perc`) for vertical layering: e.g. `stealth` = drone only;
  `tension` = drone + perc. Stems are an enhancement, never a dependency.
- `e38-suno-adaptive-spike` proves this on one location before we commit to producing all families.

### 2.3 Stingers

| Stinger | Length | Content |
|---|---|---|
| `combat-start` | 1–2 s | Drum hit + low horn/string stab in the location key |
| `combat-victory` | 3–5 s | Main-theme fragment, resolving |
| `detected` | 1 s | Sharp string/choir swell (paired with stealth UI) |
| `lost-them` | 2 s | Descending harp, relief |
| `discovery` | 2–4 s | Magic motif sparkle (secret found, spell learned) |
| `death` | 4–6 s | Solo cello falling line, not despairing |
| `quest-complete` | 3–5 s | Main-theme fragment with dulcimer |
| `capability-unlock` | 2–3 s | Class ident |
| `fold-reveal` | 6–10 s | Brother Horn motif, reveal variant (first sight of the sleepers in the Fold) |
| `song-swell` | 3–6 s | Nightjar's song fragment rising and detuning (the song swells; a sleeper stands) |
| `tidefair-start` | 1–2 s | Festive fiddle flourish and stomp in the Tidefair key (contest begins) |
| `tidefair-win` | 3–4 s | "The Tide" fragment, triumphant, with a crowd-like stomp |
| `tidefair-lose` | 2–3 s | Comic, gracious deflating fiddle slide (you lost; someone buys you a drink) |
| `vespers-rung` | 6–10 s | Vesper Bell toll + Vesper hymn cadence, "wrong and beautiful" (the bell is rung in Act III) |

Stingers are generated per key family where it matters (combat-start/victory in each location key) or
key-neutral (percussive/atonal) otherwise.

---

## 3. Location music list

| Asset id (family root) | Location | Key / mode | BPM | States |
|---|---|---|---|---|
| `music-title-main-theme` | Title screen | D Dorian | 84 | loop |
| `music-briar-glen-day` | Briar Glen, day | D Dorian | 88 (6/8) | explore, tension, combat |
| `music-briar-glen-night` | Briar Glen, night | D Aeolian | 72 | explore, stealth, tension, combat |
| `music-sleeping-ox` | The Sleeping Ox (inn) | G Mixolydian | 108 | explore (diegetic, "played" in the room) |
| `music-lamplit-stacks` | The Lamplit Stacks (bookshop) | A Lydian | 70 | explore |
| `music-briarwood` | The Briarwood | A Aeolian | 80 | explore, stealth, tension, combat |
| `music-moorings-watch` | Mooring's Watch | E Aeolian | 76 | explore, tension, combat |
| `music-deepworks` | The Deepworks | C♯ Phrygian | 64 | explore (sparse), stealth, tension, combat |
| `music-bellwater-priory` | Bellwater Priory | F Dorian (choir) | 60 | explore, stealth, tension, combat |
| `music-knot` | The Knot | E Phrygian | 58 | explore (drone), stealth, tension, combat |
| `music-knot-fold` | The Fold (sleepers' vault) and Horn's Hall once Horn is at peace | E Lydian | 66 | explore |
| `music-knot-cradle` | The Cradle, where the Nightjar sleeps | E Phrygian with the Nightjar's song drifting out of tune | 50 / free-time | explore (drone), tension |
| `music-boss-warden` | The Warden encounter, Horn's Hall — Horn fights to **stop** you, not to kill: weight and sorrow, not menace | E Phrygian | 112 half-time | boss (intro, loop A, loop B — loop B leans toward the reveal harmony) |
| `music-boss-abbot` | The Sleepless Abbot / Cradle confrontation — Nightjar's song vs Vesper hymn | E Phrygian / Locrian clusters | 100 (3/4) | boss (intro, loop A, loop B) |
| `music-sounding-shaft-climb` | The Climb up the Sounding Shaft, song rising behind | E Phrygian rising to D Dorian | 132 | combat (chase) |
| `music-motif-vesper-hymn` | Motif anchor: the Vesper hymn (diegetic hum source, priory, "Vespers Rung") | D Dorian | free-time | linear |
| `music-motif-nightjar-song` | Motif anchor: the Nightjar's song (night in town, Hushlings, the Cradle) | E Aeolian, detuning | 60 (3/4) | linear |
| `music-river-wend` | The River Wend: Briar Glen Quay, the Millweir, the towpath, Kestrel Lock | B Dorian | 84 (6/8) | explore, stealth, tension, combat |
| `music-barge-journey` | Barge ride between the Quay and Wendmouth (narrated journey / fast travel) | D Dorian | 76 (6/8) | linear (main theme flowing on harp and low whistle) |
| `music-weeping-adit` | The Weeping Adit: flooded tunnel into the lower Deepworks, humming faintly | C♯ Aeolian (bridges to `music-deepworks`) | 56 / free-time | explore (drone, faint Nightjar song on the water), stealth |
| `music-wendmouth-day` | Wendmouth by day: loud, cheerful, crooked, with "The Tide" | A Mixolydian | 112 (6/8) | explore, tension, combat |
| `music-wendmouth-night` | Wendmouth by night; includes the **heist/stealth layer** (bonded warehouse, customs strongroom, the Gilded Tern) | A Dorian | 90 | explore, stealth (heist variant of "The Tide"), tension, combat |
| `music-drowned-gull` | The Drowned Gull tavern (rowdier than the Sleeping Ox) | D Mixolydian | 120 | explore (diegetic, "played" in the room) |
| `music-tidefair` | The Tidefair: market-day contests on the Ore Wharf (festive cue) | A Mixolydian | 120 (6/8) | explore (festive loop), plus the Tidefair stingers |
| `music-undertow` | The Undertow black market | D Phrygian | 70 | explore, stealth, tension |
| `music-credits` | Credits | D Dorian → D Lydian | 84 | linear |

`music-briar-glen-night` carries faint, distant fragments of the Nightjar's song on still nights (the song
reaches the town through the breach).

---

## 4. Suno usage notes

- **Instrumental only:** always enable Suno's *Instrumental* toggle and include `instrumental, no vocals`
  in style. Wordless choir is requested as "wordless choir, oohs" — reject any take with intelligible words.
- **Model:** use the current flagship model at generation time and record the version in the prompt file
  iteration log and `CREDITS.md`.
- **Style field:** paste the SUNO STYLE PREAMBLE (§4.1) + the track-specific tags. Keep the whole style field
  under the tool's limit (≈ 1000 chars); put hard negatives in the **Exclude styles** field when available.
- **Lyrics field** (Custom mode): use structure tags only, no words — e.g.
  `[Intro] [Instrumental] [Verse] [Instrumental break] [Outro]`, or leave blank with Instrumental on.
- **Lengths:** explore tracks 2:00–3:30; tension/combat 1:30–2:30 (they loop); stingers are cut from longer
  generations (generate a 20–30 s "ending"/"hit" piece and trim). Target a clean loop region ≥ 60 s.
- **Extending:** use *Extend* from a chosen timestamp to lengthen or to create the family variant; use
  *Cover*/*Remix*/audio-reference (whatever the current UI calls it) from the anchor track to create
  tension/combat variants that keep key and melody. Always re-verify key and BPM after extension.
- **Stems:** if the tier offers stem export/separation, download stems for family anchor tracks and keep
  them in `assets/source/music/<asset-id>/stems/`. Evaluate separation quality in the spike before relying on it.
- **Licence tier:** outputs generated on a **free tier are generally owned by the tool and limited to
  non-commercial use with attribution**; **paid tiers (Pro/Premier) grant ownership/commercial rights for
  songs generated while subscribed.** Although The Vesper Bell is free, the repo is public and redistributes
  the files, so **generate all shipping music on a paid tier** (one or two months of Pro for a batch is
  enough). Record the tier and date per track in `CREDITS.md`; free-tier takes are placeholders only.
  Re-read Suno's current terms before each batch and link them in the credits entry.
- **Artist names:** never reference artists, bands, composers or game titles in prompts (both a terms issue
  and a copyright-imitation issue). Describe instruments, mode, tempo and mood instead.
- **Download format:** download **WAV** (lossless) masters when available; MP3 only for placeholder takes.

### 4.1 SUNO STYLE PREAMBLE (verbatim — paste first in the Style field)

```text
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals
```

**Exclude styles (verbatim, when the field exists; otherwise append as "no …" at the end of Style):**

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

---

## 5. Loudness, formats & technical rules

### 5.1 Loudness targets

Measured with ITU-R BS.1770 / EBU R128 (integrated LUFS, true peak dBTP). The mixer (E28) then applies bus
gains; these are **file-level** targets so assets arrive consistent.

| Asset type | Integrated | True peak | Notes |
|---|---|---|---|
| Music (explore, stealth) | −18 LUFS ± 1 | ≤ −1.5 dBTP | Sits under SFX |
| Music (combat, boss) | −16 LUFS ± 1 | ≤ −1.0 dBTP | |
| Stingers | −16 LUFS ± 1 (short-term max) | ≤ −1.0 dBTP | |
| Ambience beds | −24 LUFS ± 2 | ≤ −3.0 dBTP | |
| SFX (one-shots) | peak-normalised to −3 dBFS; momentary max ≈ −14 LUFS for loud hits | ≤ −1.0 dBTP | Relative loudness defined by category table §7.3 |
| UI | −20 LUFS short-term ± 2 | ≤ −3.0 dBTP | Never louder than combat SFX |

**Master output target:** ≈ −16 LUFS integrated over a play session, true peak ≤ −1 dBTP (limiter on master).

### 5.2 Formats

| Stage | Format |
|---|---|
| Source masters | WAV, 48 kHz, 24-bit (or 44.1 kHz as delivered by the tool — resampled to 48 kHz in the pipeline) |
| Runtime primary | **Opus in Ogg (`.ogg`)**, 48 kHz |
| Runtime fallback | **AAC-LC in MP4 (`.m4a`)**, 48 kHz — for any browser where `canPlayType('audio/ogg; codecs=opus')` is falsy |
| Bitrates | Music stereo 112 kbps Opus / 160 kbps AAC; ambience stereo 80 kbps; SFX **mono** 64 kbps Opus / 96 kbps AAC (positional sounds must be mono) |

- Short, frequently-used SFX are fully decoded into `AudioBuffer`s; music and long ambience stream via
  media elements or chunked decode (decided in `e28-audio-engine`).
- Initial download budget for audio ≤ 8 MB (style bible §13.3): UI + core SFX + first ambience; music streams.

### 5.3 Loop-point rules

- Loops are cut **at bar boundaries** computed from BPM, at a zero crossing, with the loop region's end
  sample equal to its start sample in phase (no clicks).
- Loop points are stored in a **sidecar JSON** per file: `{ "bpm": 88, "beatsPerBar": 6, "loopStartSample": …,
  "loopEndSample": …, "key": "D dorian" }` in **source-sample units at 48 kHz**. The runtime uses
  `AudioBufferSourceNode.loopStart/loopEnd`.
- **Encoder offset:** Opus adds pre-skip (typically 312 samples at 48 kHz) and AAC adds priming; the import
  pipeline compensates so runtime loop points are sample-accurate. The loop validator (`e38-audio-validator`)
  checks for discontinuities at the loop seam (sample delta and short-window RMS jump thresholds).
- Ambience loops ≥ 30 s with no memorable events (bird calls etc. are separate randomised one-shots).
- Tails: combat/explore tracks provide an `-end` segment or the engine fades 2 bars.

### 5.4 Sample rate & channels

48 kHz everywhere at runtime (Opus native, matches typical `AudioContext`). Music and ambience stereo; SFX
mono unless they are 2D UI/stingers.

---

## 6. File naming

Asset IDs follow contract §6: `<category>-<subject>-<variant>`, lower-kebab-case, two-digit variant numbers.

| Pattern | Example |
|---|---|
| `music-<location>-<time?>-<state>` | `music-briar-glen-day-explore`, `music-knot-combat` |
| `music-stinger-<event>-<key?>` | `music-stinger-combat-start-e-phrygian`, `music-stinger-discovery` |
| `music-<family>-stem-<layer>` | `music-knot-explore-stem-drone` |
| `amb-<location>-<variant>` | `amb-deepworks-drips-01`, `amb-wendmouth-harbour-01`, `amb-millweir-rush-01` |
| `sfx-<source>-<action>-<material?>-<nn>` | `sfx-knight-parry-metal-01`, `sfx-foot-stone-walk-03` |
| `sfx-spell-<school>-<spell>-<phase>-<nn>` | `sfx-spell-fire-ember-cast-01`, `sfx-spell-fire-ember-impact-01` |
| `sfx-creature-<creature>-<vocal>-<nn>` | `sfx-creature-horn-bellow-02`, `sfx-creature-hushling-mimic-01` |
| `sfx-ui-<action>-<nn>` | `sfx-ui-page-turn-01` |

Round-robin variants: minimum 3 per frequently repeated sound (footsteps: 4–6 per surface per gait).
Runtime path: `public/assets/audio/<category>/<asset-id>.ogg` (+ `.m4a`, `.json` sidecar).

---

## 7. SFX sonic palette

### 7.1 Principles

- **Stylised-real:** grounded recordings exaggerated for weight (layer a low-end thump under impacts, a bright
  transient on top). Not cartoon, not hyper-real gore.
- **Three-layer impacts:** transient (click/crack) + body (material) + tail (debris/room). Tail is added by
  runtime reverb, not baked, wherever possible.
- **Dry sources:** SFX are delivered dry; the engine adds location reverb (town: short, the Deepworks: medium
  wood-rock, Bellwater Priory: long hall, the Knot: long stone with pre-delay). Special spaces: the **Chapel of
  Echoes** (sound misbehaves — echoes return late or from the wrong side; must stay consistent with
  `e09-sound-propagation` wherever the sim models it), river and harbour spaces (Wendmouth waterfront: open air
  with a short slap off warehouse walls; the Undertow: low vaulted cellar; ship holds: boxy wood; the Weeping
  Adit: long, wet flooded tunnel), the **Sounding Shaft** (tall pipe resonance; the bell's
  note falls down it), and **the Cradle** (muffled, sounds drawn toward the centre, a faint hum under everything).
- **Every systemic material sounds different in the same way the sim treats it** (wood burns and breaks,
  metal conducts and rings, stone is heavy, glass shatters).

### 7.2 Materials (impacts, breaks, footsteps, scrapes)

| Material | Character |
|---|---|
| Stone | Heavy, dull, short grit tail; large pieces add low-end thud |
| Wood | Hollow knock, creak, splinter crack on break |
| Metal (plate/iron) | Bright ring, clang, long shimmer; chainmail = jingle |
| Cloth / leather | Soft rustle, creak on stretch |
| Glass / crystal | Tink, shatter, crystalline scatter |
| Earth / mud | Squelch, soft thud |
| Water | Splash scaled by mass; shallow vs deep |
| Bone | Dry clack, hollow rattle |
| Flesh / creature hit | Muffled thump + cloth — never wet gore |
| Straw / hay | Crunchy rustle (flammable cue) |
| Rope | Creak under tension, fibrous snap |

### 7.3 Footstep surface set

Surfaces (must match `e09-sound-propagation` surface ids and noise multipliers):
`stone`, `wood`, `wood-hollow` (bridges, upper floors — loud), `dirt`, `grass`, `gravel` (loud), `mud`,
`water-shallow` (loud), `snow-ice` (frozen by Frost), `metal-grate` (loud), `straw`, `carpet` (quiet), `bone-litter`
(loud — the Knot's Ossuary Galleries), `leaves` (loud — the Briarwood), `glass-shards` (very loud — broken windows and bottles; a thief's trap and a hazard). River and harbour reuse existing ids:
piers, barge and ship decks = `wood-hollow`; breakwater and quays = `stone`; towpath = `dirt`/`mud`; the
Millweir sluice walk = `stone` (wet).

Gaits: `sneak`, `walk`, `run`, `land` (+ `scuff` for turns). Armour layer: `plate`, `chain`, `leather`, `cloth`
(added on top of footsteps, Knight loudest; sharkskin brigandine uses `leather` at reduced gain). **Loudness ordering must match the sim's noise radius:**
sneak < walk < run < land; carpet < grass < dirt < stone < wood-hollow < gravel/water/metal-grate/bone < glass-shards.

### 7.4 Magic schools

| School | Cast | Loop/sustain | Impact | Palette notes |
|---|---|---|---|---|
| Fire | Inhale whoosh + ignition pop | Roar/crackle | Whumpf + crackle | Organic flame recordings |
| Frost | Crystalline shimmer, breath | Creaking ice | Shatter / freeze crunch | Glass + ice + high sine |
| Storm | Static crackle build | Buzz/hum | Thunder crack (short), zap | Electrical arcs; capped harshness |
| Arcane | Bowl strike, rising tone | Harmonic hum | Pure tonal "bloom" | Singing bowls, glass harmonica |
| Illusion | Reversed shimmer, chorus | Wavering detune | Pop of air, whisper | Heavy chorus/flanger, reversed harp |
| Alteration | Liquid morph, stretched tone | Rippling | Soft "shlorp"/click-in-place | Pitch-bent textures |
| Conjuration | Deep portal suck-in | Whirl | Burst + creature arrival | Low whoosh + tonal swell |
| Necromancy | Bone rattle + breath | Dry whispers (unintelligible) | Hollow crumble | Bones, dry leaves, reversed breath |
| Nature | Wooden creak, rustle burst | Growth creak | Root thud, leaf burst | Wood stress, leaves, birdsong-like chirp |
| Light | Choir-ish "aah" swell, bell | Warm hum | Bright chime | Bells, soft choir |
| Shadow | Air sucked away, muffling | Low-pass murmur | Muted thud | Everything dulled/filtered |
| Gravity | Sub-bass drop | Pulsing low hum + debris rattle | Deep boom | Sub + pitch-down |
| Time | Clock tick slowing, reversed chime | Ticking | Tape-stop / rewind | Ticks, reversed bells, tape effects |

### 7.5 Creatures

MVP roster = story bible §8. Asset ids use the canon short names (`forgotten`, `clatter`, `goblin`,
`briar-wolf`, `loom-spider`, `hushling`, `tallow-ooze`, `mimic-book|lectern|chest`, `mimic-mortimer`,
`hollow-sentinel`, `abbot`, `horn`). No voice acting in MVP: nothing below uses intelligible words.

| Creature | Palette |
|---|---|
| **The Forgotten** (skeletons) | Bone clacks, joint creaks, no voice (or a dry ghost-breath) — collapse is a distinct multi-bone rattle. Habit sounds give them away before you see them: a broom sweeping, censer chains, a pick tapping, a murmured breath-rhythm like prayer (unintelligible). `calm` set for when the Vesper hymn is hummed: the rattle slows and settles. |
| **Clatter** | The Forgotten palette made expressive: hesitant, apologetic rattles and fidgets, a soft tuneless hum (he "sings it flat"). His dialogue is text only. |
| **Rootcellar Goblins** | Expressive, chattering, gibberish "language" (pitched, processed, unintelligible) with emotional contour — they're people. Kettle-helm clanks and **very loud alarms** (pot-and-kettle banging, whistles). Mother Kettleback: lower, rounder, drier. |
| **Briar Wolves** | Low growl, pant, whimper (fear), paw-pads on leaves. **No howls in MVP** — they have gone silent since the breach; the missing howl is the story (Juniper: "Wolves don't go quiet"). |
| **Loom Spiders** | Clicking mandibles, skittering legs, hiss, the fibrous creak of silk being spun; a sharp recoil skitter when light hits them. |
| **Hushlings** | Blind fog-children that hunt by sound. Idle: soft breathy fog-hiss and a faraway child's hum of the Nightjar's song. **Voice mimicry:** they imitate the voices of the missing ("Da? I'm cold") — delivered as a pitch-contoured, fog-filtered murmur with the intonation of a familiar voice but **no intelligible words**; the line itself appears as caption text. Hunting: the hum stops (silence is the tell). Death: loud sounds tear them apart — a ripping-air whoosh scattering into whispers. |
| **Tallow Ooze** | Soft waxy squelch, slow drip, candle-stub clatter inside. Fire: sizzle and melt into a spreading flammable puddle; frost: brittle crackle, then shatter. **Wax, not element-flavoured.** |
| **Mimics** (book, lectern, chest) | Book: leather creak, page-flutter snap, paper chewing. Lectern: wooden creak and clack. Chest: hinge groan, teeth clack. **Mortimer**: a contented page-rustle "purr" and a warning snap for shoplifters. |
| **Hollow Sentinels** | Metallic clanks, hollow resonance inside, a halting drilled march step. When relieved (watchword, knight's words, "watch ended" bell): a single salute clank and a settling sigh of metal. |
| **The Sleepless Abbot** (wraith) | Gentle breathy presence, lantern-chain creak, a hush of moving fog; when solid (singing), a wordless fragment of the Nightjar's song in a warm male voice. Courteous, never a wail. His speech is text only. |
| **Brother Horn** | Enormous bellows and snorts, hoof-stamps on stone, the stone axe scraping. **Soft variants:** low Hornfolk throat-song humming, gentle snorts, a lowing call — used in the reveal and when calm. The same creature must be able to sound both terrifying and sad; in the Warden fight he sounds effortful and reluctant, not bloodthirsty. |
| **The Nightjar** | Never heard as a creature voice — only as its song (music motif + diegetic song ambience in the Cradle). |
| *Post-MVP (not in the story bible roster)* | Trolls/ogres (deep grunts, heavy footfalls), boars — do not generate for MVP. |

Every creature gets vocal sets for its alert states: `idle`, `suspicious`, `alert`, `attack`, `hurt`,
`fear/flee`, `death` (+ `calm/friendly` for social creatures).

### 7.6 UI sounds

Wood, paper, leather and brass — the "field journal": page turns (menu nav), quill scratch (journal update),
leather flap (inventory open), brass click (equip), coin clink (buy/sell), soft chime (quest), low wooden knock
(error/deny), book thud (spell learned, followed by `discovery` stinger). All short (≤ 400 ms except stingers),
dry, mono-or-centre, at the UI loudness target.

### 7.7 Ambience

Per location: a stereo bed (wind, room tone, distant town, dripping) + randomised positional one-shots
(birds, creaks, distant goblin chatter, rock falls). **Ambience also carries gameplay:** weak walls emit a
faint draught; hidden passages have air movement; water you can freeze is audible.

Per-location ambience notes: Briar Glen night falls unnaturally silent past midnight, with the Nightjar's song
faint on still nights; the Briarwood lacks wolf howls; Mooring's Watch is wind and flapping banner remnants;
the Deepworks has winch-house creaks and distant goblin chatter; Bellwater Priory has wind through the
roofless nave and the occasional hum of the cracked bell; the Knot has dripping stone and far bone-rattle; the
Cradle carries the song itself as a low, drifting bed.

River and harbour ambience:
- **River** (`amb-river-wend-*`): flowing-water bed, reed rustle, herons, towpath hooves and tow-rope creak.
- **Weir** (`amb-millweir-*`): a continuous roar. If the sim treats it as a noise-masking zone, the masking
  radius must match `e09-sound-propagation`.
- **Lock** (`amb-kestrel-lock-*`): gate creaks, sluice rush, windlass clank, a quiet cottage.
- **Harbour** (`amb-wendmouth-harbour-*`): gulls, halyards slapping masts, lapping water, a distant wordless
  crowd, crane winches, the bell buoy, sea wind. Louder and busier than any Briar Glen bed.
- **Tavern** (`amb-drowned-gull-*`): rowdy wordless walla, dice, tankards, arm-wrestling table thumps, waves
  under the floorboards. The Sleeping Ox bed (`amb-sleeping-ox-*`) is hushed and hearth-crackly by contrast.

### 7.8 Signature diegetic sounds

| Sound | Rules |
|---|---|
| **The Vesper Bell** | Low bronze toll with a strong minor-third partial and a long bloom. **Cracked** (as found): beating, slightly sour partials — "wrong and beautiful" when rung with its tongue in Act III (`vespers-rung`). **Tongueless strike** (hammer, arrow, Thunderclap): a harsh, cracked clank that is gameplay-loud — it wakes the Forgotten and draws Hushlings (and Horn). **Mended** (sorcerer's Frostglass/Alteration): a truer, cleaner note. Asset ids `sfx-vesper-bell-<variant>-<nn>`. |
| **The Vesper hymn (hummed)** | The player hums the hymn: a soft, wordless, voice-neutral hum of the Vesper hymn motif (§1.4). Calms the Forgotten and is one route to befriending Horn; must be audible to the sim at a quiet noise radius. |
| **The Nightjar's song (diegetic)** | The song as heard in the world: the Nightjar motif rendered as a distant, sourceless wordless voice and churring trill, louder near the breach and the Cradle, swelling in Act III. Sleepwalkers and Hushlings hum along. |
| **Mooring's Watch tower bell** | A small iron alarm bell on a cord; the "watch ended" signal that stands the Hollow Sentinels down. |
| **Signal mirror** | Heavy iron pivot creak and a bright metallic glint "ting" when it catches the light. |
| **Hornfolk horn-coins** | Heavy, dull clink — heavier than silver. |

### 7.9 River and harbour SFX palette

Wendmouth adds **no new creature types**. Its human opposition (Low Tide Company smugglers, the harbour
watch, the Gilded Tern's crew) uses non-verbal alarm sounds: smugglers' **whistles**, the watch's **wooden
rattle and handbell**, and crew bosun's pipe calls. Dialogue is text only. Crowd walla is a wordless
murmur.

| Group | Sounds |
|---|---|
| **Rigging and ships** | Rigging creaks, block-and-tackle squeal, halyards slapping masts, sail luff flap and snap-fill, hull groan, anchor chain, the Tern's ship's bell (time bells), deck planks (`wood-hollow`) |
| **Cargo** | Crane winch ratchet and pawl clicks, cargo net strain and creak under load, **net cut** (fibrous snap and a whoosh of the falling load), crate thud on planking, ore rattling into bins, barrels rolling |
| **River** | Barge pole plunge, tiller creak, tow-rope creak, horse hooves and harness jingle on the towpath, Ore Stair chute rumble, lock windlass clank, lock gates groaning, sluice rush |
| **Bells and buoys** | **Bell buoy** (irregular, wave-driven dull clang), harbour bell, fog bell on the breakwater. These are low, tolling and a little sad, and must never be confused with the Vesper Bell (§7.8): thinner, shorter, no minor-third bloom. |
| **Gulls and rats** | Gulls: screech, laughing call, squabbles, wingbeat flurry, and a triumphant "ha-ha" call when one snatches a shiny. Wharf rats: squeaks and a scurry-scatter when startled. A startled rat is a noise event and must match `e09-sound-propagation`. |
| **Tidefair** | Wordless crowd cheers and groans, the wooden gull target clack on the swinging boom, regatta oars and a wooden starting clapper, the arm-wrestling table slam, dice cups |
| **Saltmarch imports** | Sabre: a thinner, higher ring than local steel. Harpoon-spear: a haft thrum. Sharkskin brigandine: a soft rasp, quieter than leather and far quieter than plate. Arrows: **whistling** (a rising shriek; a gameplay-loud lure), **netting** (thwump and a spreading net), **tar** (wet slap), **glass-headed** (shatter; loud enough to tear Hushlings), **grapple** (iron clink and rope pay-out) |
| **Undertow tools** | Smoke pearl pop and hiss, glue-soled boots (a soft sticky peel, quieter than any gait), skeleton-key ring jingle, customs-seal stamp thump, tide-silk rope whisper |
| **Customs House** | Weighing-scale clank, ledger page turn, the strongroom lock (black-steel = hard, §7 style bible), Cray's stamp |

---

## 8. SFX PREAMBLE (verbatim — paste first in every SFX generation prompt)

Used by Claude as the prompt prefix for the ElevenLabs Sound Effects API (and as the search brief when sourcing from CC0 libraries):

```text
Single isolated game sound effect for a stylized fantasy action RPG. Clean, dry, close-miked recording with no music, no speech, no background ambience and no reverb tail unless stated. Starts immediately with no leading silence and ends cleanly. Grounded, tactile and weighty with a slightly exaggerated low-end body and a crisp transient, like high-quality Foley for a hand-crafted medieval world. Acoustic and organic materials: wood, stone, iron, leather, cloth, bone, water, fire. No modern, electronic or sci-fi sounds unless the prompt asks for magic.
```

Per-category add-ons are in `assets/prompts/_templates/sfx.md`.

---

## 9. Pipeline & tooling

### 9.1 Workflow — who does what

All approval decisions are recorded in `assets/approvals.json` (`e37-asset-approval-log`).

**Music (human-in-the-loop, Suno):**
1. Prompt bead: Claude writes the complete Suno prompt from `music-track.md` / `music-stinger.md` — Style
   (preamble + tags), Exclude styles, structure-only Lyrics field, key, BPM, metre, target length.
2. Generate bead (`needs-human`, ≈ 1 min of owner time): the owner pastes the prompt into Suno (paid tier,
   Instrumental on), listens, **picks the take — this is the music approval gate** — and drops the WAV into
   `assets/_incoming/music/<asset-id>.wav`.
3. Integrate bead (Claude): trim, loop points (bar-aligned), loudness normalisation, Opus + AAC encode,
   sidecar JSON, validation, `CREDITS.md` row (Suno tier + date), approval record, wiring into content data.

**SFX (Claude-generated, ElevenLabs Sound Effects API — recommended):**
1. Prompt bead: Claude fills `sfx.md` (SFX PREAMBLE + category add-on) for a sound or round-robin batch.
2. Claude generates via `e38-sfx-gen-client` (key from `ELEVENLABS_API_KEY` env only) into
   `assets/_incoming/<asset-id>/vN.wav`, then runs the import pipeline + validator.
3. **OWNER APPROVAL GATE — SFX batch:** the owner listens to a batch preview page/playlist and approves or
   rejects per sound.
4. Claude commits approved sounds with `CREDITS.md` + approval records.

**Fallback / bulk:** CC0 libraries (Kenney, freesound CC0-only, OpenGameArt CC0) sourced by Claude where they
are better or cheaper (footsteps, UI, doors); same approval gate.

### 9.2 Validation (automated, `e38-audio-validator`)

- Naming matches §6; sidecar JSON present and schema-valid.
- Integrated LUFS and true-peak within §5.1 tolerance for its category.
- Loop seam discontinuity below threshold; loop length is a whole number of bars (± 1 ms) given BPM.
- Leading silence ≤ 10 ms for SFX one-shots.
- Mono for positional SFX.
- `CREDITS.md` entry exists with an allowed licence; final assets have an approval record.

### 9.3 Placeholder policy

Gameplay is never blocked by final audio. Placeholders come from CC0 packs (Kenney etc.) and follow the same
naming, so integration is a file swap.

### 9.4 SFX tool recommendation (input to `e38-sfx-tool-decision`)

**ElevenLabs Sound Effects API as the primary source, CC0 libraries as fallback.**
1. **ElevenLabs Sound Effects (official API)** — lets Claude generate end-to-end from the SFX PREAMBLE and
   template (text → sound, duration and prompt-influence controls), so the owner only listens and approves.
   Best for what libraries lack: 13 schools of magic, Brother Horn's dual-character vocals, goblin gibberish,
   Hushling voice-mimic murmurs, the Vesper Bell, creature state sets. Use a **paid tier** for shipping sounds (free tiers typically require attribution
   and/or restrict commercial use — verify at spike time and record tier/date in `CREDITS.md`).
2. **CC0 libraries as fallback/bulk** — Kenney audio packs, freesound.org filtered to **CC0 only**,
   OpenGameArt CC0: footsteps, UI, doors, generic impacts, ambience beds, where quality/cost is better.
3. **Avoid** "royalty-free, no redistribution" libraries (e.g. many bundle-style licences) for files
   committed to the public repo — the raw files would be redistributed.
4. Editing (trim, layer, pitch, normalise) is scripted in the import pipeline (ffmpeg); no manual DAW work
   is required of the owner.
