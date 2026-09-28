# World asset needs (from the world planning group)

Source plan: `plan/world.json` (mw-e01, mw-e13, mw-e14, mw-e16, mw-e24, mw-e25, mw-e26).
This file lists environment, location, character, creature, location-music, ambience and set-piece
needs. Gameplay-system, UI, VFX and generic SFX needs are in `plan/gameplay-asset-needs.md` — they are
not repeated here.

Conventions: asset IDs follow `docs/art/style-bible.md` §15.1 and `docs/audio/audio-bible.md`
(`<category>-<subject>-<variant>`, lower-kebab-case, two-digit variants). Palettes per location come
from style bible §2.2. Music IDs reuse the audio-bible track list where it already exists (marked
"(bible)"); new ones are marked "(new)". Each line names the consuming world bead key(s) so the
asset-prompt agent can wire `integrate` beads to block them (contract §6: prompt → generate → approve →
integrate). **Gameplay never waits on these**; grey-box/placeholder stand-ins come from
`e37-greybox-asset-kit` and `e38-placeholder-audio-kit`.

Canon notes the prompts must respect (story bible):
- The labyrinth's "heart-chamber" exception in style bible §2.2 (warm moss, flowers, skylight) maps to
  **the Fold** (sleepers' vault) — the visual reveal that Horn is not a monster. **The Cradle** is the
  Nightjar's chamber: cold, dreamlike, faces turned inward.
- Hornfolk statues cover their ears; Vesperine statues sing with mouths open.
- Brother Horn: nine feet, grey-muzzled, horns chipped and bound in bronze wire, stone-headed axe
  carved with his name.
- No gore; dread is quiet and specific.

---

## 1. Environment concepts (one per location; `env-`)

| Asset ID | Subject | Consumers |
|---|---|---|
| `env-briar-glen-market-green-01` | Market Green with notice board, Sleeping Ox, leaning Lamplit Stacks against Brand's Forge, Vane House on the rise behind | e24-town-greybox, e24-town-art-dress |
| `env-briar-glen-night-01` | Same town at night: lit windows, lamp posts, Tansy sleepwalking up the street | e24-first-night, e24-town-lighting-audio |
| `env-sleeping-ox-common-room-01` | Inn common room: hearth, bar, lending shelf, beams | e24-sleeping-ox |
| `env-lamplit-stacks-interior-01` | Three-storey crooked bookshop: red shelf, curtained restricted shelf, reading nook, Mortimer's rare shelf | e24-lamplit-stacks |
| `env-lamplit-stacks-back-room-01` | Mirela's back room with *Nine Sleeps* on a locked lectern | e24-stacks-back-room |
| `env-brand-forge-interior-01` | Forge with hearth, anvil, bell mould on the wall | e24-trade-row |
| `env-fenn-fletchery-interior-01` | Fletchery & Simples: arrows, drying herbs, salves | e24-trade-row |
| `env-pell-bakery-interior-01` | Bakery at 4 a.m., flour, window onto the street | e24-trade-row |
| `env-watch-house-jail-01` | Watch House desk, missing-persons list, one cell with loose drain stone | e24-watch-house-jail |
| `env-vane-house-exterior-01` | Vane House on the rise: balcony, coal chute, hedged garden | e24-vane-house |
| `env-vane-house-study-01` | Study with strongbox, city letters, silver ornaments | e24-vane-house |
| `env-glen-well-cistern-01` | Well shaft with loose rung descending to flooded Vesperine cistern | e24-glen-well-cistern |
| `env-lychgate-cemetery-01` | Lychgate, Vesperine graves, Mooring family plot | e24-cemetery-schoolhouse |
| `env-schoolhouse-empty-01` | Empty schoolroom, rhyme on the slate, Tansy's reading corner | e24-cemetery-schoolhouse |
| `env-briarwood-trail-01` | Old oak/holly/bramble forest trail, dappled light | e25-briarwood-greybox, e25-wilds-art-dress |
| `env-sleepers-path-night-01` | Line of trampled ferns under moonlight | e25-sleepers-path |
| `env-standing-horn-clearing-01` | Hornfolk menhir with hands over its ears | e25-standing-horn |
| `env-wolf-den-hollow-01` | Den hollow with rocky overlooks and bramble cover | e25-wolf-den |
| `env-millpond-drowned-lane-01` | Millpond, sluice, flooded lane, woodcutter's hut at the edge | e25-millpond-drowned-lane |
| `env-moorings-watch-exterior-01` | Watchtower on the spur, goblin lookout below, signal mirror on the roof | e25-mooring-watch-greybox |
| `env-moorings-watch-armour-hall-01` | Armour stands with names chalked on them (Hollow Sentinels) | e25-mooring-watch-encounters |
| `env-deepworks-gate-01` | Boarded mine gate, Bell Line rule carved above, winch pulley, vent chimney | e25-mine-gate-approach |
| `env-deepworks-winch-house-01` | Winch house and cage lift | e26-deepworks-greybox |
| `env-deepworks-goblin-hall-01` | Old glenstone cutting hall turned goblin camp: square pillars, half-cut blocks in the walls, kettle throne, hammocks, Duggan's crate | e26-deepworks-encounters |
| `env-deepworks-sealed-gallery-01` | Vane's gallery 9: pried Hornfolk carvings, the breach | e26-vane-gallery-breach |
| `env-bellwater-nave-01` | Roofless nave, god-rays, ivy | e26-priory-greybox |
| `env-bellwater-choir-01` | Choir of singing-monk statues, hidden choir door | e26-priory-choir |
| `env-bellwater-scriptorium-01` | Ruined scriptorium, candle store, lecterns | e26-priory-scriptorium |
| `env-bellwater-belfry-01` | Belfry with the cracked, tongueless Vesper Bell over the Sounding Shaft | e26-priory-belfry, e26-vesper-bell-finale |
| `env-bellwater-garden-pear-01` | Priory garden with the dead pear tree (and a bloom variant) | e26-priory-greybox |
| `env-knot-outer-ring-01` | Rune-banded basalt corridors, loom-spider webs copying runes | e26-knot-outer-greybox, e26-art-dress-knot |
| `env-knot-ossuary-01` | Bone galleries, Clatter's pale mushroom garden | e26-ossuary-galleries |
| `env-knot-chapel-echoes-01` | Echoing chapel, bells, portcullis with counterweight | e26-chapel-of-echoes |
| `env-knot-horns-hall-01` | Horn's Hall arena outside the Fold | e26-horns-hall-fold |
| `env-knot-the-fold-01` | The Fold: warm moss beds, sleepers, goblin bread, chalk tallies, skylight | e26-horns-hall-fold |
| `env-knot-sounding-shaft-01` | Vertical shaft with bell-ropes, counterweights, ledges | e26-sounding-shaft-climb |
| `env-knot-cradle-01` | The Cradle: round chamber, carved faces turned inward, dream-leak | e26-cradle-arena |
| `env-grey-box-slice-01` | Optional mood reference for the m1 slice (not required) | e01-slice-greybox-level |

## 2. Tilesets, textures and skies (`tex-`, `sky-`)

- Town: `tex-stone-cobble-briar-01`, `tex-plaster-timber-briar-01`, `tex-thatch-briar-01`,
  `tex-roof-slate-briar-01`, `tex-roof-loose-tile-01` (visibly different, noisy roof), `tex-wood-floor-inn-01`,
  `tex-bookshop-shelves-trim-01`. Consumers: e24-town-art-dress, e24-rooftops-thief-routes.
- Forest: `tex-forest-floor-moss-01`, `tex-bark-oak-01`, `tex-fern-trampled-decal-01` (Sleepers' Path),
  `tex-bramble-wall-01`, `tex-mud-lane-wet-01`, `tex-pond-water-01`. Consumers: e25-wilds-art-dress, e25-sleepers-path.
- Watchtower: `tex-stone-weathered-lichen-01`, `tex-banner-faded-01`. Consumer: e25-wilds-art-dress.
- Mine: `tex-rock-mine-01`, `tex-timber-shoring-01`, `tex-rail-iron-01`, `tex-carved-bell-line-01`.
  Consumer: e26-art-dress-mine-priory.
- Priory: `tex-sandstone-priory-01`, `tex-marble-grey-01`, `tex-fresco-faded-01`, `tex-stained-glass-01`.
  Consumer: e26-art-dress-mine-priory.
- Knot: `tex-basalt-knot-01`, `tex-bronze-worn-01`, `tex-rune-band-hornfolk-01..04` (legible, distinct
  follow/ignore runes), `tex-bone-niche-01`, `tex-moss-fold-01`, `tex-cradle-dream-01` (shader mask).
  Consumers: e26-art-dress-knot, e26-knot-rune-navigation.
- Skies: `sky-briar-glen-golden-hour-01`, `sky-briar-glen-night-01`, `sky-briarwood-overcast-01`,
  `sky-valley-dawn-01` (ending). Consumers: e24-town-lighting-audio, e25-wilds-lighting-audio, e26-ending-states.

## 3. Prop sets (`prop-`)

| Asset ID | Contents | Consumers |
|---|---|---|
| `prop-town-market-set-01` | Stalls (breakable), crates, barrels (hiding), hay cart, water trough, washing line | e24-town-systemic-objects |
| `prop-town-lighting-set-01` | Lamp posts, window lanterns, lamplighter pole | e24-town-systemic-objects |
| `prop-town-notice-board-01` | Notice board + bounty poster (500 → 800 crowns) | e24-town-greybox |
| `prop-inn-set-01` | Bar, tables, hearth, beds, lending shelf, cellar kettle | e24-sleeping-ox |
| `prop-bookshop-set-01` | Crooked shelves, red shelf, curtain, lectern, biscuit tin, ladder | e24-lamplit-stacks |
| `prop-forge-set-01` | Anvil, bellows, weapon racks, Vesper Bell mould | e24-trade-row |
| `prop-fletchery-set-01` | Arrow bins, herb racks, salve jars, snares | e24-trade-row |
| `prop-bakery-set-01` | Ovens, dough troughs, bread (also sleeper feed), family Bible | e24-trade-row |
| `prop-watch-house-set-01` | Desk, maps, missing-persons list, cell bars, drain stone, evidence chest | e24-watch-house-jail |
| `prop-vane-house-set-01` | Strongbox, fine furniture, ledger desk, balcony railings | e24-vane-house |
| `prop-cemetery-set-01` | Lychgate, Vesperine headstones, Mooring plot | e24-cemetery-schoolhouse |
| `prop-school-set-01` | Desks, slate with rhyme, children's books | e24-cemetery-schoolhouse |
| `prop-forest-set-01` | Oak/holly/bramble (instanced LODs), ferns, logs, hollow oak, rocks | e25-wilds-art-dress |
| `prop-standing-horn-01` | Hornfolk menhir (single hero prop) | e25-standing-horn |
| `prop-millpond-set-01` | Sluice gate, drowned cart, woodcutter's hut contents, lost lantern | e25-millpond-drowned-lane |
| `prop-watchtower-set-01` | Armour stands, bell cord and bell, signal mirror (rotatable), keeper's log, goblin lookout junk | e25-mooring-watch-greybox, e25-signal-mirror |
| `prop-mine-shoring-set-01` | Supports (breakable), rails, carts, winch, cage lift, oil lamps, rubble | e26-deepworks-greybox, e25-supply-tunnel |
| `prop-goblin-camp-set-01` | Kettle throne, hammocks, alarm pots, Duggan's crate, junk piles, trinkets | e26-deepworks-encounters |
| `prop-priory-set-01` | Singing-monk statues (rotatable/topple), pews, altar, candle racks, bell frame | e26-priory-choir, e26-priory-belfry |
| `prop-scriptorium-set-01` | Lecterns, loose pages, candle store, bookshelves | e26-priory-scriptorium |
| `prop-knot-set-01` | Hornfolk ear-covering statues, carved landmark faces, rune pillars, portcullis + counterweight, chapel bells | e26-knot-outer-greybox, e26-chapel-of-echoes |
| `prop-ossuary-set-01` | Bone piles (physics), niches, holy-water font, pale mushrooms | e26-ossuary-galleries |
| `prop-fold-set-01` | Moss beds, goblin bread, chalk tally walls, horn-key door | e26-horns-hall-fold |
| `prop-cradle-set-01` | Anchor lanterns (4), dream-leak floating debris | e26-cradle-arena |
| `prop-vesper-bell-01` | Hero prop: cracked bell with/without tongue, mended variant | e26-vesper-bell-finale |
| `prop-puzzle-reskins-01` | Area reskins of e15 prefabs: mirrors, statues, scales plates, braziers, chimes, water basin | e26-dungeon-puzzles |
| `prop-ending-variants-01` | Bread basket at the mine gate, epilogue lantern, rebuilt mine headframe | e26-ending-states |

Key story items needing icons/models (world-placed): `icon-item-vesperine-hours-01`,
`icon-item-horn-coin-01`, `icon-item-horn-ring-01`, `icon-item-vesper-bell-tongue-01`,
`icon-item-deepworks-ledger-01`, `icon-item-rusted-watch-key-01`, `icon-item-tansy-ribbon-01`,
`icon-item-psalter-anselm-01`, `icon-item-mortimer-tooth-01`, `icon-item-goblin-kettle-helm-01`,
`icon-item-friend-below-note-01`, `icon-item-gallery-key-01` (m1 slice), `icon-item-fold-horn-key-01`,
`icon-item-hornfolk-fragment-01`, `icon-item-mine-key-vane-01`, `icon-item-horn-of-horn-01`.

## 4. NPCs: portraits + 3D characters (`portrait-npc-`, `char-`, `model-npc-`)

One portrait, one reference sheet and one model per named NPC (models may be kit-based with bespoke
heads per `e37-3d-pipeline-decision`).

| NPC | Portrait | Reference sheet / model | Consumers |
|---|---|---|---|
| Mirela Thorne (bookseller) | `portrait-npc-mirela-bookseller` | `char-npc-mirela-01` / `model-npc-mirela-01` | e24-lamplit-stacks, e24-npc-schedules |
| Captain Brannoc Hale | `portrait-npc-hale-captain` | `char-npc-hale-01` / `model-npc-hale-01` | e24-watch-house-jail |
| Harrow Vane | `portrait-npc-vane-mine-owner` | `char-npc-vane-01` / `model-npc-vane-01` | e24-vane-house |
| Odette "Dot" Farrow | `portrait-npc-dot-innkeeper` | `char-npc-dot-01` / `model-npc-dot-01` | e24-sleeping-ox |
| Hollis Pell | `portrait-npc-hollis-baker` | `char-npc-hollis-01` / `model-npc-hollis-01` | e24-trade-row |
| Tansy Pell (12) | `portrait-npc-tansy-pell` | `char-npc-tansy-01` / `model-npc-tansy-01` (+ sleepwalk anim) | e24-first-night, e26-horns-hall-fold |
| Juniper Fenn | `portrait-npc-juniper-fletcher` | `char-npc-juniper-01` / `model-npc-juniper-01` | e24-trade-row |
| Oswin Brand | `portrait-npc-oswin-smith` | `char-npc-oswin-01` / `model-npc-oswin-01` | e24-trade-row |
| Duggan Marl | `portrait-npc-duggan-foreman` | `char-npc-duggan-01` / `model-npc-duggan-01` | e14-mother-kettleback |
| The six missing (Moss Greaves, Ettie Lark, Rowan Tate, Harlan Burr, Mina Coles, Fitch) | `portrait-npc-<first>-sleeper` ×6 | kit variants `model-npc-sleeper-<first>-01` ×6 (sleeping poses) | e26-horns-hall-fold |
| Generic townsfolk | — | `model-npc-townsfolk-set-01` (8–12 recolour variants) | e24-npc-schedules |
| Two watch teenagers | — | `model-npc-watch-recruit-set-01` | e24-npc-schedules |
| Brother Horn | `portrait-npc-horn-warden` | `creature-minotaur-base-01` / `model-creature-minotaur-01` (hero, ≤ 20k tris) | e13-horn-moveset, e14-horn-befriend-help |
| Clatter (Brother Anselm Hobb) | `portrait-npc-clatter-skeleton` | `creature-skeleton-clatter-01` / `model-creature-skeleton-clatter-01` (rotted habit) | e14-clatter |
| Mother Kettleback | `portrait-npc-kettleback-matriarch` | `creature-goblin-kettleback-01` / `model-creature-goblin-kettleback-01` | e14-mother-kettleback |
| Snig | `portrait-npc-snig-goblin` | `creature-goblin-snig-01` / `model-creature-goblin-snig-01` | e14-snig |
| Mortimer (tame book mimic) | `portrait-npc-mortimer-mimic` | `creature-mimic-mortimer-01` / `model-creature-mimic-mortimer-01` | e14-mortimer |
| The Sleepless Abbot (Corvin Ashgrove) | `portrait-npc-abbot-corvin` | `creature-wraith-abbot-01` / `model-creature-wraith-abbot-01` (fog shader body) | e13-abbot-wraith |
| Historical (Aldric Mooring, Ysolde Thorne) | `portrait-npc-mooring-sergeant`, `portrait-npc-ysolde-novice` (painted-portrait props, optional) | — | e25-mooring-watch-encounters, e24-lamplit-stacks |

## 5. Creatures: concepts + models (`creature-`, `model-creature-`, `anim-`)

| Creature | Concept / reference sheet | Models | Animation needs | Consumers |
|---|---|---|---|---|
| The Forgotten — miner | `creature-skeleton-miner-01` | `model-creature-skeleton-miner-01` | 3-move set (chop, 2-hit slash, lunge), collapse/reassemble, habit idles (hauling) | e13-forgotten-skeleton, e13-forgotten-reassembly |
| The Forgotten — monk | `creature-skeleton-monk-01` | `model-creature-skeleton-monk-01` (+ staff, censer) | staff sweep, censer swing, sweeping/praying idles | e13-forgotten-habits |
| Rootcellar goblins | `creature-goblin-scavenger-01`, `creature-goblin-slinger-01` | two models + kettle-helm variants | sling, net throw, flee, alarm | e13-rootcellar-goblins |
| Brother Horn | `creature-minotaur-base-01` | `model-creature-minotaur-01` | axe sweep, charge, grab-throw, stomp, yield kneel, circle-walk, rest-one-eye, carry sleeper | e13-horn-moveset, e13-horn-encounter |
| Loom Spiders | `creature-spider-loom-01` | `model-creature-spider-loom-01` | wall/ceiling crawl, bite, web spit, flee | e13-loom-spiders |
| Briar Wolves | `creature-wolf-briar-01` | `model-creature-wolf-briar-01` | pack trot, lunge, eat, back away from fire (no howl until ending) | e13-briar-wolves |
| Hushlings | `creature-hushling-01` | `model-creature-hushling-01` (fog shader) | drift, grasp, dissipate | e13-hushlings |
| Tallow Ooze | `creature-ooze-tallow-01` | `model-creature-ooze-tallow-01` (+ small, puddle, frozen) | crawl, engulf, split | e13-tallow-ooze |
| Mimics | `creature-mimic-book-01`, `creature-mimic-lectern-01`, `creature-mimic-chest-01` | three models | disguised breathing tell, bite, eat paper, flee | e13-mimics |
| Hollow Sentinels | `creature-sentinel-armour-01` | `model-creature-sentinel-armour-01` | halberd sweep, shield charge, salute + fall still | e13-hollow-sentinels |
| The Sleepless Abbot | `creature-wraith-abbot-01` | `model-creature-wraith-abbot-01` | singing/conducting, drift, stagger, fury | e13-abbot-wraith, e13-abbot-encounter |

## 6. Location music cues (`music-`)

| Asset ID | Use | Consumers |
|---|---|---|
| `music-title-main-theme` (bible) | Title screen | e01-title-new-game-flow |
| `music-briar-glen-day` (bible) | Town day family | e24-town-lighting-audio |
| `music-briar-glen-night` (bible) | Town night family | e24-town-lighting-audio |
| `music-briar-glen-tavern` (bible) | Sleeping Ox interior | e24-sleeping-ox |
| `music-briar-glen-bookshop` (bible) | Lamplit Stacks interior | e24-lamplit-stacks |
| `music-first-night-sleepwalk` (new) | Following Tansy on night one (hummed melody motif) | e24-first-night |
| `music-forest` (bible) | Briarwood family | e25-wilds-lighting-audio |
| `music-watchtower` (bible) | Mooring's Watch family | e25-wilds-lighting-audio |
| `music-old-mine` (bible) | Deepworks family | e26-dungeon-lighting-audio |
| `music-monastery` (bible) | Bellwater Priory family | e26-dungeon-lighting-audio |
| `music-labyrinth` (bible) | The Knot family | e26-dungeon-lighting-audio |
| `music-labyrinth-stem-song` (new) | Nightjar song layer driven by song.intensity (0–3) | e13-song-intensity, e26-dungeon-lighting-audio |
| `music-labyrinth-heart` (bible) | The Fold reveal (warm) | e26-horns-hall-fold |
| `music-boss-minotaur` (bible) | Horn's Hall fight | e13-horn-encounter |
| `music-boss-abbot` (new) | Cradle confrontation | e13-abbot-encounter, e26-cradle-arena |
| `music-sounding-shaft-climb` (new) | Climb / chase | e26-sounding-shaft-climb |
| `music-vespers-finale` (new) | Bell rung → the song falters | e26-vesper-bell-finale |
| `music-ending-vespers-rung`, `music-ending-last-warden`, `music-ending-hirelings-silence`, `music-ending-long-vespers` (new) | Epilogue beds per ending | e26-ending-states |
| `music-credits` (bible) | Credits | e26-ending-states |
| `music-stinger-horn-sighting` (new) | Distant Horn sighting in the Outer Ring | e26-outer-ring-encounters |
| `music-stinger-fold-reveal` (new) | Entering the Fold | e26-horns-hall-fold |
| `music-stinger-sour-bell` (new) | Early tongueless bell strike | e26-priory-belfry |
| `music-hymn-vesper-hum` (new, diegetic, short loopable melody) | Player humming the Vesper hymn; reused by Clatter/Mirror Self | e14-hum-vesper-hymn |

## 7. Ambience loops (`amb-`)

- Town: `amb-briar-glen-day-market-01`, `amb-briar-glen-night-01` (crickets, distant dog, no wolves),
  `amb-sleeping-ox-murmur-01`, `amb-brand-forge-hammering-01`, `amb-lamplit-stacks-quiet-01`
  (clock, pages, Mortimer rustle), `amb-glen-well-cistern-drips-01`, `amb-cemetery-wind-01`.
  Consumers: e24-town-lighting-audio and per-building items.
- Wilderness: `amb-briarwood-day-01`, `amb-briarwood-night-silent-01` (the wolves' silence),
  `amb-briarwood-night-howls-01` (ending variant only), `amb-millpond-water-01`,
  `amb-drowned-lane-night-01` (with faint mimic whisper), `amb-standing-horn-hum-01`,
  `amb-moorings-watch-wind-01`, `amb-deepworks-gate-exterior-01`. Consumers: e25-wilds-lighting-audio.
- Dungeon: `amb-old-mine-drips-01`, `amb-old-mine-creaks-01`, `amb-goblin-camp-01`,
  `amb-priory-nave-wind-01`, `amb-scriptorium-candles-01`, `amb-belfry-wind-01`, `amb-knot-hum-01`,
  `amb-ossuary-bones-01`, `amb-chapel-echoes-01`, `amb-fold-breathing-01` (sleepers, warm),
  `amb-sounding-shaft-updraft-01`, `amb-cradle-dream-01`. Consumers: e26-dungeon-lighting-audio.

## 8. Set-piece and location SFX (`sfx-`)

(Generic combat/stealth/UI SFX are in `plan/gameplay-asset-needs.md`.)

- Bells: `sfx-vesper-bell-sour-01` (tongueless strike), `sfx-vesper-bell-ring-01` (cracked, wrong and
  beautiful), `sfx-vesper-bell-ring-true-01` (mended), `sfx-bell-tongue-hang-01`,
  `sfx-watchtower-bell-watch-ended-01`, `sfx-chapel-chime-01..05` (Chimes puzzle notes).
  Consumers: e26-priory-belfry, e26-vesper-bell-finale, e25-mooring-watch-encounters, e26-chapel-of-echoes.
- Creatures (vocals/foley beyond generic skeleton set): `sfx-forgotten-reassemble-01`,
  `sfx-forgotten-sweep-loop-01`, `sfx-goblin-alarm-pot-01`, `sfx-goblin-chatter-01..04`,
  `sfx-horn-bellow-charge-01`, `sfx-horn-footstep-heavy-01..04`, `sfx-horn-grab-01`,
  `sfx-loom-spider-skitter-loop-01`, `sfx-loom-spider-web-spit-01`, `sfx-wolf-pack-pant-01`,
  `sfx-hushling-whisper-grasp-01`, `sfx-hushling-dissipate-01`, `sfx-tallow-ooze-squelch-01`,
  `sfx-tallow-ooze-melt-01`, `sfx-mimic-breath-tell-01`, `sfx-mimic-bite-01`,
  `sfx-sentinel-armour-clank-01`, `sfx-sentinel-salute-01`, `sfx-abbot-sing-loop-01`,
  `sfx-abbot-interrupt-01`, `sfx-mortimer-snap-01`. Consumers: the matching e13/e14 creature items.
- Places/mechanisms: `sfx-mine-cage-lift-01`, `sfx-mine-support-collapse-01`, `sfx-mine-gas-explosion-01`,
  `sfx-mine-gate-boards-break-01`, `sfx-sluice-gate-01`, `sfx-well-stone-double-land-01`,
  `sfx-jail-drain-stone-01`, `sfx-signal-mirror-rotate-01`, `sfx-portcullis-drop-01`,
  `sfx-knot-loop-shift-01` (subtle cue when runes loop you back), `sfx-shortcut-door-unbar-01`,
  `sfx-fold-door-horn-key-01`, `sfx-breach-seal-01`, `sfx-statue-rotate-stone-01`, `sfx-cradle-dream-pulse-01`.
  Consumers: e26-deepworks-*, e25-*, e24-glen-well-cistern, e24-watch-house-jail, e26-knot-rune-navigation,
  e26-shortcuts-loops, e26-vane-gallery-breach, e26-priory-choir, e26-cradle-arena.
- Story beats: `sfx-tansy-hum-sleepwalk-loop-01`, `sfx-sleepers-wake-01`, `sfx-death-beat-01`
  (m1 death sequence), `sfx-wake-in-fold-01`. Consumers: e24-first-night, e26-vesper-bell-finale,
  e01-death-respawn-loop, e01-contextual-respawn.

## 9. World VFX not covered by the gameplay list (`vfx-`)

`vfx-dream-leak-loop-01` (Cradle), `vfx-hushling-fog-body-01`, `vfx-abbot-fog-body-01`,
`vfx-abbot-lantern-anchor-link-01`, `vfx-song-intensity-motes-01`, `vfx-signal-mirror-beam-01`,
`vfx-rune-glow-follow-01`, `vfx-sentinel-binding-dispel-01`, `vfx-bell-soundwave-01`,
`vfx-pear-tree-bloom-01`. Consumers: e26-cradle-arena, e13-hushlings, e13-abbot-wraith,
e13-song-intensity, e25-signal-mirror, e26-knot-rune-navigation, e13-hollow-sentinels,
e26-vesper-bell-finale, e26-priory-greybox.

---

## River & Wendmouth

Added for the owner extension (story bible v0.2, §3.1, §3.5, §3.6, §5.13, §6.1 quests 6–8, rumours 13–18).
Consumers are `e25-*` river items and `mw-e40` Wendmouth Harbor items in `plan/world.json`. Wendmouth is
optional in the story but in the MVP scope (core P1, extras P2). Water is standing water only (no flowing
river sim); barge travel is a narrated ride. **No new creature types** (roster stays at 10); gulls and rats are
ambient life. Suggested palette additions for the style bible: River (tarred timber, brown water, heron grey,
lock-gate green) and Harbour (salt-bleached planks, tar black, sail canvas, gull white, Saltmarch lacquer red).
Story canon v1 (§3.1, §3.2, §3.6) makes the valley's trade stone first: stone barges carry dressed glenstone
down the Wend, Briar Glen Quay sits at the foot of the **Stone Stair**, and Wendmouth is a monumental glenstone
harbour (colossal stepped quays, a breakwater of mason-marked reject blocks, vaulted stone warehouses, a
columned Customs House, treadwheel cranes on stone piers, block yards) with timber lofts and sheds perched on
the stone. The style bible §2.2 River Wend and Wendmouth rows are the palette and wording reference.

### R1. Environment concepts (`env-`)

| Asset ID | Subject | Consumers |
|---|---|---|
| `env-briar-glen-quay-01` | Briar Glen Quay with the stone barge *Patient Ann*, dressed blocks on timber cradles, crane, the Stone Stair slipway descending from the hill | e25-quay-stone-stair, e25-river-art-audio |
| `env-millweir-sluice-walk-01` | Vesperine-built weir with narrow sluice walk, gates, two water levels | e25-millweir-sluice-walk |
| `env-weeping-adit-mouth-01` | Adit mouth where the Wend springs from the hill; flooded tunnel with air pockets, empty stone barge winched back up | e25-weeping-adit |
| `env-towpath-valley-01` | Towpath along the Wend down the valley | e25-towpath-kestrel-lock |
| `env-kestrel-lock-01` | Kestrel Lock gates, chamber, beam walk, toll board, Old Reed's cottage | e25-towpath-kestrel-lock |
| `env-barge-ride-card-01` | Narrated ride card art: *Patient Ann* on the river at morning (down) and towed (up) | e25-barge-travel |
| `env-wendmouth-harbour-01` | Establishing view: monumental glenstone harbour (stepped quays, mason-marked block breakwater, vaulted warehouses, columned Customs House, treadwheel cranes), timber net lofts perched on the stone, pool with the Gilded Tern | e40-harbor-greybox, e40-harbor-art-dress |
| `env-wendmouth-night-01` | Harbour at night: dock lanterns pooling on wet flagstones, ship lamps, lighthouse sweep | e40-harbor-lighting-audio |
| `env-wendmouth-stone-wharf-tidefair-01` | Stone Wharf on market day: great stepped quay, treadwheel cranes, cargo nets, block yards, Tidefair flagstones, crowds, the gated Silver Quay at the far end | e40-stone-wharf, e40-tidefair-strength |
| `env-wendmouth-customs-house-01` | Columned glenstone Customs House: Lantern Court flag, cargo scale, Cray's office with the well-read shelf, strongroom | e40-customs-house |
| `env-wendmouth-bonded-warehouse-01` | Vaulted stone Bonded Warehouse interior: sealed bays, bay nine, skylights, hoist beams, manifest desk | e40-bonded-warehouse |
| `env-drowned-gull-interior-01` | The Drowned Gull: arm-wrestling table, dice, trapdoor | e40-drowned-gull |
| `env-wendmouth-tidemarket-01` | Covered import market: Tereza's arms stall, foreign book cart, spice/silk/oddities | e40-tidemarket |
| `env-wendmouth-undertow-01` | Smugglers' block-vaults under the fish market, tunnels, black-market stalls | e40-undertow |
| `env-wendmouth-rooftops-net-lofts-01` | Continuous roof and net-loft route above the waterfront | e40-rooftops-net-lofts |
| `env-gilded-tern-deck-01` | The Tern's deck and rigging | e40-gilded-tern |
| `env-gilded-tern-hold-cabin-01` | Hold with crates (shanghai wake), Hesketh's cabin, the locked berth | e40-gilded-tern |
| `env-wendmouth-breakwater-01` | Breakwater of mason-marked reject blocks, sunken figurehead underwater, smugglers' sea-door, low/high tide | e40-breakwater-sea-door |

### R2. Textures (`tex-`)

`tex-timber-tarred-01`, `tex-planks-salt-bleached-01`, `tex-rope-hawser-trim-01`, `tex-net-cargo-alpha-01`
(climbable/flammable legibility), `tex-sailcloth-01`, `tex-stone-breakwater-01` (salt-weathered glenstone blocks with mason's marks, also quays and warehouse walls), `tex-water-river-brown-01`,
`tex-water-harbour-grey-01`, `tex-lock-gate-green-01`, `tex-roof-tin-harbour-01` (loud) vs
`tex-roof-tar-harbour-01` (quiet). Consumers: e25-river-art-audio, e40-harbor-art-dress, e40-rooftops-net-lofts.

### R3. Props and hero models (`prop-`, `model-`)

| Asset ID | Contents | Consumers |
|---|---|---|
| `model-barge-patient-ann-01` | Flat-bottomed stone barge with dressed blocks on timber cradles (hero-ish; also the winched Adit barge variant `model-barge-stone-adit-01`) | e25-barge-travel, e25-weeping-adit |
| `prop-river-quay-set-01` | Bollards, dressed-block stacks on timber cradles, quay crane, toll shed, Stone Stair slipway segments | e25-quay-stone-stair |
| `prop-river-weir-lock-set-01` | Sluice gates, lock gates, paddles, beam walk, toll board, cottage interior | e25-millweir-sluice-walk, e25-towpath-kestrel-lock |
| `prop-adit-set-01` | Drainage timbering, winch, air-pocket rock shelves | e25-weeping-adit |
| `model-ship-gilded-tern-01` | **Hero model:** three-masted merchantman, climbable rigging, interior hold/cabin/berth sections, "sailed" absence variant | e40-gilded-tern |
| `prop-harbour-wharf-set-01` | Treadwheel cranes on stone piers (jib + winch), cargo nets, crate stacks, block-yard stacks, Tidefair markers, Lantern Court notice | e40-stone-wharf |
| `prop-harbour-customs-set-01` | Cargo scale, desks, strongroom shelves, Cray's romance-novel shelf | e40-customs-house |
| `prop-harbour-warehouse-set-01` | Bay doors with customs-seal entity (intact/broken/re-sealed), hoist beams, manifest desk, Quell's office, the relic crate and ballast | e40-bonded-warehouse, e40-crate-heist |
| `prop-harbour-tavern-set-01` | Arm-wrestling table, dice table, tankards, trapdoor | e40-drowned-gull |
| `prop-harbour-market-set-01` | Market stalls, spice sacks, silk bolts, foreign book cart, weapon racks | e40-tidemarket |
| `prop-harbour-undertow-set-01` | Smuggler crates, lantern hooks, sea-door, fence counter | e40-undertow |
| `prop-harbour-rooftop-set-01` | Net lofts, plank bridges, drying nets, gull hoard nests | e40-rooftops-net-lofts, e40-harbor-ambient-life |
| `prop-tidefair-set-01` | Swinging boom with wooden gulls, prize ribbons, regatta rowing boats, bunting | e40-tidefair-shoot-pockets, e40-tidefair-regatta |
| `prop-breakwater-figurehead-01` | Sunken serpent-like figurehead (the "sea serpent") | e40-breakwater-sea-door |

Item icons: `icon-item-name-stone-hornfolk-01`, `icon-item-manifest-bay-nine-01`, `icon-item-manifest-honest-01`,
`icon-item-foundry-invoice-01`, `icon-item-mr-s-letter-01`, `icon-item-customs-seal-stamp-01`,
`icon-item-writ-lantern-court-01`, `icon-item-dockhand-disguise-01`, `icon-item-tide-silk-rope-01`,
`icon-item-glue-soled-boots-01`, `icon-item-smoke-pearl-01`, `icon-item-skeleton-key-ring-01`,
`icon-item-saltmarch-sabre-01`, `icon-item-harpoon-spear-01`, `icon-item-lacquered-round-shield-01`,
`icon-item-sharkskin-brigandine-01`, `icon-item-arrow-whistling-01`, `icon-item-arrow-grapple-01`,
`icon-item-prize-ribbon-01`, `icon-item-barge-fare-token-01`. Foreign spellbook covers go through the
gameplay list's `ui-book-cover-*` pattern.

### R4. NPC portraits + models

Portrait IDs follow the `portrait-npc-<first>-<role>` pattern used for the Briar Glen cast.

| NPC | Portrait | Reference sheet / model | Consumers |
|---|---|---|---|
| Mags Oakum (bargewoman) | `portrait-npc-mags-bargewoman` | `char-npc-mags-01` / `model-npc-mags-01` | e25-barge-travel |
| Nell Gannet (Drowned Gull, Low Tide Company) | `portrait-npc-nell-gull-keeper` | `char-npc-nell-01` / `model-npc-nell-01` | e40-drowned-gull, e40-undertow |
| Inspector Prudence Cray | `portrait-npc-cray-inspector` | `char-npc-cray-01` / `model-npc-cray-01` | e40-customs-house |
| Tereza Maelo (import merchant, duellist) | `portrait-npc-tereza-merchant` | `char-npc-tereza-01` / `model-npc-tereza-01` (+ sabre duel set) | e40-tidemarket, e40-tereza-duel |
| Jasper Quell (shipping agent) | `portrait-npc-jasper-shipping-agent` | `char-npc-jasper-01` / `model-npc-jasper-01` | e40-bonded-warehouse, e40-crate-heist |
| Big Oona (dockhand champion) | `portrait-npc-oona-dockhand` | `model-npc-oona-01` | e40-tidefair-strength, e40-drowned-gull |
| Old Reed (Kestrel Lock keeper) | `portrait-npc-reed-lock-keeper` | `model-npc-reed-01` | e25-towpath-kestrel-lock |
| Captain Hesketh (Gilded Tern) | `portrait-npc-hesketh-captain` | `model-npc-hesketh-01` | e40-gilded-tern |
| "Mr. S—'s agent" (veiled, never leaves the berth) | `portrait-npc-agent-veiled` (silhouette) | — (not seen in MVP) | e40-gilded-tern |
| Harbour watch / Low Tide Company / Tern crew | — | kit sets `model-npc-harbour-watch-set-01`, `model-npc-low-tide-smuggler-set-01`, `model-npc-tern-crew-set-01` | e40-harbor-opposition |
| Harbour crowd | — | `model-npc-harbour-crowd-set-01` (10–14 recolour variants: dockhands, fishwives, sailors, merchants) | e40-harbor-crowds |

Animations: arm-wrestle loop/win/lose, brawl punches/knockout, rowing, crane-operating, net-hauling, drinking,
dice throw, sabre duel set (Tereza), deck-swabbing and rigging-climb idles (`anim-humanoid-*`).

Ambient life (not creature types): `model-ambient-gull-01` (idle, fly, snatch, hoard), `model-ambient-rat-01`
(scurry, flee light); consumers e40-harbor-ambient-life, e40-tidefair-shoot-pockets (live gull).

### R5. Music (`music-`, all new; register in the audio bible track list)

| Asset ID | Use | Consumers |
|---|---|---|
| `music-river-wend` | River family (quay, towpath, lock): explore, tension | e25-river-art-audio |
| `music-barge-ride` | Narrated ride card (down/up variants) | e25-barge-travel |
| `music-wendmouth-day` | Harbour day family: explore, tension, combat (brawl) | e40-harbor-lighting-audio |
| `music-wendmouth-night` | Harbour night family: explore, stealth, tension | e40-harbor-lighting-audio |
| `music-drowned-gull-tavern` | Diegetic shanty-band loop in the Gull | e40-drowned-gull |
| `music-tidefair` | Contest-day loop + win/lose stingers (`music-stinger-tidefair-win`, `music-stinger-tidefair-lose`) | e40-tidefair-strength, e40-tidefair-shoot-pockets |
| `music-heist-bay-nine` | Heist tension family for the warehouse | e40-crate-heist |
| `music-undertow` | Black-market cellar loop | e40-undertow |
| `music-stinger-customs-confiscate` | Cray confiscates a book | e40-customs-house |
| `music-stinger-heist-perfect` | Perfect heist completed | e40-crate-heist |
| `music-stinger-tern-sails` | The Tern departs (Act III) | e40-gilded-tern |

### R6. Ambience loops (`amb-`)

`amb-river-quay-01`, `amb-river-flow-bank-01` (audio only — no flow sim), `amb-millweir-spill-01`,
`amb-weeping-adit-drip-hum-01` (humming at night — rumour 16), `amb-towpath-day-01` (herons, reeds),
`amb-kestrel-lock-01`, `amb-wendmouth-harbour-day-01` (crowd, gulls, rigging creak, surf),
`amb-wendmouth-harbour-night-01`, `amb-drowned-gull-murmur-01`, `amb-tidemarket-bustle-01`,
`amb-undertow-cellar-01`, `amb-bonded-warehouse-night-01`, `amb-gilded-tern-hold-01`, `amb-breakwater-surf-01`,
`amb-gulls-loop-01`, `amb-wharf-rats-scurry-01`. Consumers: e25-river-art-audio, e40-harbor-lighting-audio.

### R7. Set-piece SFX (`sfx-`)

- River: `sfx-stone-stair-slide-01`, `sfx-sluice-gate-heavy-01`, `sfx-lock-paddle-01`, `sfx-lock-gate-strain-01`,
  `sfx-lock-chamber-fill-loop-01`, `sfx-adit-current-push-loop-01`, `sfx-adit-winch-barge-01`, `sfx-barge-horn-01`.
- Harbour: `sfx-crane-winch-loop-01`, `sfx-crane-jib-swing-01`, `sfx-cargo-net-drop-splash-01`,
  `sfx-customs-stamp-01`, `sfx-customs-seal-break-01`, `sfx-customs-seal-restamp-01`, `sfx-strongroom-door-01`,
  `sfx-skylight-open-01`, `sfx-hoist-beam-creak-01`, `sfx-trapdoor-gull-01`, `sfx-sea-door-01`,
  `sfx-watch-whistle-01`, `sfx-smuggler-whistle-01`, `sfx-thrown-off-pier-splash-01`, `sfx-surface-gasp-01`,
  `sfx-tern-anchor-chain-01`, `sfx-tern-sails-unfurl-01`, `sfx-tide-change-01`.
- Contests: `sfx-arm-wrestle-strain-loop-01`, `sfx-arm-wrestle-slam-01`, `sfx-brawl-punch-01..04`,
  `sfx-crowd-cheer-01`, `sfx-crowd-groan-01`, `sfx-wooden-gull-hit-01`, `sfx-regatta-oars-loop-01`,
  `sfx-regatta-start-bell-01`, `sfx-dice-roll-01`, `sfx-tankard-slam-01`.
- Ambient life: `sfx-gull-cry-01..04`, `sfx-gull-snatch-01`, `sfx-rat-squeal-startle-01`.
  Consumers: the matching e25 river and e40 items.

### R8. VFX (`vfx-`)

`vfx-water-splash-large-01` (net drop, pier throw), `vfx-adit-current-foam-01`, `vfx-lock-fill-churn-01`,
`vfx-lighthouse-sweep-01`, `vfx-regatta-sail-gust-01`, `vfx-harbour-pool-freeze-sheet-01`. Consumers:
e40-stone-wharf, e25-weeping-adit, e25-towpath-kestrel-lock, e40-harbor-lighting-audio, e40-tidefair-regatta,
e40-gilded-tern.
