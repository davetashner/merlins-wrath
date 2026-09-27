# Gameplay asset needs (collected from wave-1 planning reports)

Environment, character, creature, location-music and ambience needs come from the world group in
`plan/world-asset-needs.md`. This file covers gameplay systems, UI, VFX and SFX.

## Magic (mw-e06/e07/e08/e21)
Spells: ember, firebolt, flame-jet, fire-wall, frostglass, wellspring, gust, thunderclap, arc-lash,
mage-hand, telekinetic-throw, blink, arcane-sight, levitate, gravity-well, mirror-self, wisp-light,
prism-ray, snuff, grasping-vines, animate-bones, polymorph, stasis.
- Every spell: `icon-spell-<slug>` and `ui-book-cover-<slug>`.
- VFX/SFX phases (ids `vfx-spell-<slug>-<phase>`, `sfx-spell-<slug>-<phase>`):
  - ember: VFX cast/travel/impact; SFX cast/impact
  - firebolt: VFX cast/travel/impact; SFX cast/impact
  - flame-jet: VFX channel; SFX loop
  - fire-wall: VFX spawn/loop/end; SFX spawn/loop
  - frostglass: VFX cast/travel/impact/ice-sheet; SFX cast/impact/shatter
  - wellspring: VFX cast/burst/puddle; SFX cast/splash
  - gust: VFX cone; SFX whoosh
  - thunderclap: VFX wave; SFX boom
  - arc-lash: VFX beam/chain; SFX crackle
  - mage-hand: VFX tether/grab; SFX grab/hold-loop/release
  - telekinetic-throw: VFX launch/catch; SFX launch/catch
  - blink: VFX depart/arrive; SFX depart/arrive
  - levitate: VFX loop; SFX loop
  - gravity-well: VFX loop/collapse; SFX loop/collapse
  - mirror-self: VFX spawn/shimmer/dispel; SFX spawn/dispel
  - arcane-sight: VFX overlay; SFX cast
  - wisp-light: VFX orb; SFX spawn/hum-loop
  - prism-ray: VFX beam/reflect; SFX loop
  - snuff: VFX pulse; SFX hush
  - grasping-vines: VFX erupt/hold/wither; SFX erupt/creak
  - animate-bones: VFX assemble/crumble; SFX assemble/rattle/crumble
  - polymorph: VFX poof-in/poof-out; SFX poof/critter-cluck
  - stasis: VFX lock/release; SFX lock/release
- Per school (13 schools: fire, frost, storm, arcane, illusion, alteration, conjuration, necromancy, nature, light, shadow, gravity, time): default placeholder VFX + SFX, miscast VFX.
- Aiming reticle, ground-target marker, revealed-hidden-object outline.
- Models: polymorph critter, vine entity, wisp orb.
- UI: hotbar frame, quick-select wheel, mana bar, cooldown sweep, grimoire book UI (school tabs, locked-verb silhouettes), two-page reader with parchment/torn-page/garbled-text styles, bookshop shelf UI, placeholder covers in school colours, forbidden and "already known" markers.

## Combat (mw-e04/e05/e28/e29)
- Knight SFX: sword-swing-light, sword-swing-heavy, block-wood-shield, block-metal-shield, parry-metal, guard-break, riposte, shield-bash, kick, dodge-roll-cloth, dodge-roll-armor, charge-ready, stamina-exhausted, wall-recoil-clang.
- Impact SFX: blade-flesh, blade-bone, metal-metal, blunt-wood, claw, stone. Destruction: stone-wall, wood-crate.
- Bow SFX: draw-creak-loop, release-twang, focused-chime, arrow-flyby, arrow-impact wood/stone/flesh/metal, ricochet-metal, pickup, fire-ignite, water-splash, rope-unfurl, noise-rattle, blunt-thud.
- Footsteps: stone, wood, dirt, grass, water, metal, rug, gravel ×4 variants; armor chain/plate layers; land light/heavy.
- Skeleton SFX: idle-rattle-loop, alert, attack-telegraph, unblockable-telegraph, hurt-bone, poise-break, collapse.
- UI SFX: lockon, low-health-heartbeat-loop.
- Impulse responses: cave, stone-hall, wood-interior, forest, open-field.
- Ambience placeholders: dungeon-drips-loop, forest-day-loop, wind-gust (final ambience comes from the world list).
- VFX: hit-spark-metal, hit-splinter-wood, hit-bone-dust, hit-ichor-puff, hit-stone-chips, block-spark, parry-flash, guard-break-shatter, critical-burst, weapon-trail-default, charge-glow, charge-ready-burst, debris-dust-cloud, crack-stage-1/2, fire-flame small/large, smoke-plume, steam-puff, frost-crust, wet-drips, electric-arc, gas-fog, arrow-trail, arrow-trail-focused, water-burst, rope-unfurl, noise-ring, deflect-sparks, awareness-indicator-set, noise-ripple, extinguish-puff, dissolve-death, spell templates (cast-windup, projectile head/trail, impact, area-ring, beam), dust-motes, torch-embers, fireflies, falling-leaves, fog-volume.
- Decals: scorch, frost, wet, arrow-hole. Base VFX textures: soft circle, spark streak, smoke noise, ring, shard, flame flipbook.
- HUD: health/stamina bars, lock-on reticle, damage feedback.

## Stealth / thief / AI (mw-e09/e10/e11/e12)
- HUD: light gem (5 bands), noise ring, stance/gait indicator, awareness chevrons (6 state shapes) + eye/ear/hand glyphs, last-known-position ghost silhouette shader, lockpicking in-world overlay, pickpocket list UI, throw trajectory arc + landing marker, trap placement preview.
- Item icons: lockpick, coin, bottle, smoke-bomb, noisemaker trap, tripwire trap, caltrops, water-flask, sap.
- VFX: smoke-bomb cloud, flash-powder burst, trap reveal highlight, extinguish puff, attack telegraph cues.
- SFX: stealth stingers (suspicious, alerted, combat, lost), footsteps extra surfaces (creaky wood, carpet, metal grate, shallow water, leaves, glass shards), lockpick pin click/fail/break, pickpocket rustle, takedown choke, backstab, body drop thud, coin impact, bottle shatter, splash, candle snuff, torch douse, alarm bell, guard shout, cough in smoke, trap triggers.
- Models/props: hiding props (wardrobe, barrel, tall grass, curtain alcove), traps (bear trap/caltrops, tripwire, noisemaker), throwables, rope, disguise uniform recolour.
- Animations: climb, carry body, takedowns, lean/peek, pick lock, guard idle actions, look-up scan.

## RPG systems UI (mw-e17/e18/e19/e20/e22/e23)
- Inventory: category icons (weapon, armor, shield, ammo, book, key, consumable, tool, quest, artifact, currency, misc), gold coin icon, stolen-item marker, quick-slot frame, inventory panel frame.
- Equipment: slot silhouettes (head, body, hands, feet, main-hand, off-hand, trinket, ammo, tool), compare up/down arrows.
- Loot: container window frame, pickup toast frame, artifact discovery banner.
- Class select: 4 class card illustrations/portraits (knight, archer, sorcerer, thief), 4 class emblems.
- Capabilities: verb icons per class, "new verb learned" banner frame, input glyph set (KB/M + gamepad).
- Shop: shop panel frame, merchant portrait frame, specialty badge, buyback icon.
- Dialogue: dialogue box frame, portrait frame, generic silhouette portrait, class tag icons, persuasion approach icons (persuade, intimidate, deceive, charm), locked-option icon, subtitle plate, off-screen direction chevron.
- Journal: parchment frame, tab icons (quest, rumour, note), quest state icons (active, resolved, failed), new-entry toast.
- Wayfinding: compass nudge glyph, objective marker.
- UI SFX (implied): menu open/close, hover, confirm, cancel, page turn, coin, item pickup, equip, quest update, verb learned fanfare.

## Global
- Title screen key art, logo (after title decision `e39-title-decision`), loading screen art.
- Four player-class character models (knight, archer, sorcerer, thief) + reference sheets.
- Weapons: sword, shield (wood, metal), bow, arrows (standard + trick variants), daggers, staff/focus.
