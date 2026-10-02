# ADR-0004: Progression model — in-world capability unlocks, no XP, no respec

- **Status:** Accepted
- **Date:** 2026-10-02
- **Decider:** Owner
- **Bead:** `mw-e19.1`

## Decision

**There is no XP and there are no levels. Every new capability comes from a source in the world: the
sorcerer reads books, the knight learns techniques from trainers, the archer finds fletching
schematics and learns trick shots, the thief acquires tools and learns tricks from contacts, and
anyone can earn a capability through a notable deed. Three supporting stats (health, stamina, mana)
grow in fixed +10 steps from one-time shrines and found boon items, up to hard caps. Capabilities are
additive and never taken back by the player, so there is no respec. A class may learn another class's
*simple* capabilities through the same in-world source (a knight can read an easy spellbook); the
rule for "simple" is defined below and enforced by the content validator.** The owner decided this on
2026-10-02; this ADR records it, answers the spike's five questions and fixes the data rules that
`mw-e19.2` onward build against.

## Context

The anti-grind rule (`CONSTITUTION.md` §3) says progression unlocks new verbs, not larger numbers, and
that stat improvements support rather than define it. §4 says magic is learned primarily from books
and bookshops are exciting destinations. E19's outcome is advancement that "primarily unlocks
capabilities, specialization and new play styles". The capability registry (`mw-e19.2`), the unlock
engine (`mw-e19.3`), class data (`mw-e19.4`), stats (`mw-e19.6`), every class channel (`mw-e19.7`–
`mw-e19.11`) and the economy design (`mw-e20.1`) are blocked until the model is fixed, because class,
loot and shop data would otherwise be authored against guesses.

## Options considered

### Q1 — XP and levels

| Option | Summary | Result |
|---|---|---|
| **In-world acquisitions only** | Each capability is granted by a thing or person in the world: a book, a trainer, a schematic, a tool, a trick, a deed. Kills give nothing. | **Chosen** |
| XP and levels with skill points (*Skyrim* perks, *DOS2* levels) | Kill and quest XP fill levels; points buy unlocks. | **Rejected**: rewards killing over avoiding, tricking or befriending (§7 creatures), and invites +% perks |
| Use-based skill growth (*QfG5*, *Skyrim* skills) | Skills rise by repetition. | **Rejected**: the definition of grind — jumping in place, casting at walls |
| Milestone levels on quest completion | Quests award a level; levels gate unlocks. | **Rejected**: a level is a number between the player and a verb; the quest can grant the verb directly as a deed |

### Q2 — Supporting stats

| Option | Summary | Result |
|---|---|---|
| **Three pools (health, stamina, mana) that grow from shrines and found items** | Class start values, +10 steps, hard caps, every source one-time. | **Chosen** |
| No stats at all | Fixed pools for the whole game. | **Rejected**: removes the *Zelda* heart-container joy of a rare find and leaves no reward for some secrets |
| Attribute set (Strength, Dexterity, Intelligence…) | *QfG5*/*DOS2* attributes that scale damage and carry weight. | **Rejected**: numbers that define play, the opposite of §3; carry weight is gone per ADR-0003 |

### Q3 — How each class earns verbs

| Option | Summary | Result |
|---|---|---|
| **One channel per class fantasy, plus shared deeds and equipment** | Books, trainers, schematics and trick shots, tools and tricks (table below). | **Chosen** |
| One shared skill tree for every class | Each class picks from the same tree. | **Rejected**: classes would differ in numbers, not in the fiction of how they grow |

### Q4 — Cross-class learning

| Option | Summary | Result |
|---|---|---|
| **Simple capabilities only, through the same in-world source** | A knight can read an easy spellbook, a sorcerer can learn a basic shield bash from a trainer. The chain stops at its first step. | **Chosen** |
| None | Class capabilities are locked to their class. | **Rejected**: kills "Wait… I can do that?" moments and makes a knight reading a book a dead end |
| Full (classless) | Anyone learns anything. | **Rejected**: erodes class identity, which the §2 pillar "classes change possibilities" depends on |

### Q5 — Respec

| Option | Summary | Result |
|---|---|---|
| **None: capabilities are additive** | Nothing learned is ever exclusive, so there is nothing to undo. All known capabilities are always available; hotbar and quick-select are free UI choices anywhere. | **Chosen** |
| Loadout slots swapped at rest points | Prepared spells or equipped techniques, swappable at lamps. | **Rejected**: a slot limit makes learned verbs unusable most of the time and adds a rest-point chore; there are no exclusive choices to manage |
| Paid retraining (*DOS2* Magic Mirror) | Spend gold to unlearn and relearn. | **Rejected**: only needed when choices are exclusive or points are scarce; neither exists here |

## The model

### Capabilities and sources

A capability is a registry entry (`verb.*`, `spell.*`, `arrow.*`, `tool.*`, `trick.*`, `technique.*`,
`sense.*`, `mw-e19.2`). The player has it while at least one **source** grants it. Learned sources
(`book`, `trainer`, `schematic`, `trick`, `deed`) are permanent. Item sources (`equipment:<id>`, a
tool on the belt) last while the item is equipped or carried, so a broken lockpick or a lost lantern
takes its verb with it: that is the item leaving, not a respec. Class starting capabilities are a
permanent `class` source.

### Per-class unlock channels and verb chains

Each step is a new verb or a new way to use one, following *Ember → Firebolt → Flame Jet → Fire Wall*
(§3), never a stronger copy of the step before.

| Class | Primary channel | Other channels | Example verb chains |
|---|---|---|---|
| **Sorcerer** | **Books**: bought (the Lamplit Stacks, the Tidemarket book cart), found, stolen, won, translated, restored (`mw-e07`, `mw-e21`) | Insights and mastery from experiment (`mw-e07.7`, `mw-e07.8`); deeds; forbidden teachers (the abbot's *Lull*) | 1. Ember (ignite candles, ropes, oil) → Firebolt (a burning projectile) → Flame Jet (a held cone) → Fire Wall (a burning barrier) <br> 2. Mage Hand (pull a lever at range) → Telekinesis (lift and carry objects) → Telekinetic Throw (hurl objects and creatures) → Catch Projectiles <br> 3. Frostglass (freeze a target) → Ice Sheet (a slippery floor that topples walkers) → Ice Bridge (freeze water into a walkable span) <br> 4. Gust (blast back, clear gas) → Updraft (lift self or objects upward) → Thunderclap (a shockwave that breaks and scatters) |
| **Knight** | **Trainers** teaching techniques for gold, a favour or a test (`mw-e19.8`): e.g. Captain Hale, Tereza Maelo in Wendmouth | Deeds (the Trial of Horns, relieving the Hollow Sentinels); equipment (shield types grant shield verbs) | 1. Shield Bash (stagger a guard) → Shield Charge (run through a line) → Shield Vault (spring off a braced shield to a ledge) <br> 2. Parry → Riposte (critical after a parry) → Disarm (take the weapon from the parried hand) <br> 3. Shoulder Barge (burst rotten boards) → Wall Breaker (smash weakened masonry) → Ground Slam (knock down everything around you and topple loose pillars) |
| **Archer** | **Fletching schematics** (found, bought from Juniper Fenn) that teach an arrow type, assembled from simple materials at rest points (`mw-e19.9`) | **Trick-shot techniques** from trainers and contests (the Tidefair Gull Shoot); deeds | 1. Rope Arrow (anchor a climbable rope) → Line Shot (a second anchor makes a crossing line) → Haul Shot (pull a lever, crate or net from range by the line) <br> 2. Water Arrow (douse a torch or fire) → Soak Burst (a wet patch: slippery and conductive) → Frost Arrow (freeze the patch; post-MVP data, `mw-e05.18`) <br> 3. Pinning Shot (pin a creature or cloth to a wall) → Ricochet Shot (bank off stone around cover) → Severing Shot (cut a strap: drop a shield, a lantern or a cargo net) |
| **Thief** | **Tools** carried on the tool belt grant their verb (`mw-e19.10`): lockpicks, grapples, smoke, disguises; from Brand, Dot, the Undertow | **Tricks** learned from contacts and notes (Dot, Nell Gannet); deeds | 1. Lockpicks (open locks) → Jam Lock (lock a door behind you so pursuers detour) → Rearm Trap (reset a disarmed trap for your pursuers) <br> 2. Throw Distraction (a bottle draws a guard) → Coin Lure (a guard pockets the coin and leaves the post) → Throw Voice (a sound from where you are not) <br> 3. Pickpocket → Plant (slip an item into a pocket: evidence, a forged manifest) → Lift Mid-Fight (pick an alerted target's pocket) <br> 4. Sneak → Shadow Step (dash between shadows) → Disguise (pass as a dockhand) → Environmental Takedown (§3) |
| **All** | Deeds (`mw-e19.11`) and equipment grants (`mw-e17.9`) | | A deed grants one capability once: befriending Brother Horn, surviving the fall into the Deepworks. Equipment: a lantern grants light, soft boots quiet steps, a climbing hook anchors |

### Supporting stats

Three stats; poise, carry limit and armor capacity are class constants (ADR-0003), not stats, and
nothing raises them.

| Stat | Knight | Archer | Thief | Sorcerer | Step | Cap |
|---|---|---|---|---|---|---|
| Health | 120 | 100 | 90 | 80 | +10 | 200 |
| Stamina | 100 | 100 | 110 | 80 | +10 | 200 |
| Mana | 20 | 30 | 30 | 100 | +10 | 200 |

- Regeneration rates (stamina 40/s, `mw-e04.5`; mana 5/s, `mw-e06.3`) are class or profile data and do
  not grow.
- **Growth sources:** a *shrine* is a one-time discovery that offers the player a choice of +10 health,
  stamina or mana (stats at cap are shown but unavailable); a *found boon item* grants one fixed stat
  step when used. Both are one-time. Deeds grant capabilities, not stats.
- **MVP budget:** 8 shrines and 6 found boon items (14 steps, +140 in total), placed behind
  exploration, secrets and optional challenges, never behind kill counts. A player who finds all of
  them can reach a cap in at most one stat.
- At cap, a boon item is not consumed and returns `at-cap` (`mw-e19.6` AC-2).
- Equipment may modify stats only as a trade-off attached to a verb (a heavy pauldron that grants
  Shoulder Barge and costs 10 stamina), never as a bare bonus.
- Story names for shrines and boon items come from the story bible (`mw-e39`); "relic" is taken by
  Vane's shipments and must not be reused.

### Cross-class learning: the "simple" rule

A capability with a class affinity can be learned by a player of another class only when **all** hold:

1. **First step.** It has no prerequisites: it is the root of its chain. Off-class learners never
   progress past the root.
2. **Flagged.** Its unlock definition sets `crossClass: true`. Authors opt in; the default is
   class-only.
3. **Within the channel bound:**

   | Channel | Simple only if |
   |---|---|
   | Book (spell) | book `comprehensionDifficulty` ≤ 0.3, spell mana cost ≤ 20, and a licensed school (Fire, Frost, Storm, Light, Nature, Alteration, Arcane) |
   | Trainer (technique) | stamina cost ≤ 25, no shield or weapon proficiency required by the move |
   | Schematic (arrow) | materials are sold in shops, and the arrow is fired from any bow |
   | Trick | requires no tool and no other trick |
   | Tool | the tool's own data marks its grant `crossClass: true` (e.g. a crowbar's Pry, never lockpicks) |

4. **Not a signature.** It is not in its class's signature list (class data, `mw-e19.4`), the
   capabilities that define the fantasy and are never shared: e.g. the sorcerer's whole chains past
   their roots, the knight's Parry, the archer's Rope Arrow, the thief's Lockpicks and Pickpocket.

Off-class learning uses the same source, price and conditions as for the home class: a knight still
has to find or buy the book and study it, and learns it with the normal comprehension rules
(`mw-e07.3`). A refused attempt explains itself in the fiction ("The runes swim before your eyes.",
`mw-e19.7` AC-2) and the book or schematic is not consumed. Non-sorcerers' 20–30 mana is enough for
one simple spell at a time; shrine choices let a curious knight grow it.

### No respec

- Learned capabilities are never removed by the player and no unlock excludes another, so nothing
  needs undoing. All known capabilities are usable at all times.
- An unlock that *replaces* a capability (`mw-e19.3` AC-4) must subsume it: the new verb still does
  everything the old one did (Telekinesis still pulls levers like Mage Hand).
- The hotbar and quick-select wheel (`mw-e06.16`) are UI and can be rearranged anywhere, any time.
- Story choices with lasting consequences (accepting the abbot's *Lull* marks you a dreamer) are world
  state, not progression, and are not respecs.

## Content validation rules

The content validator (`pnpm content:check`) rejects progression data that breaks the model. Each rule
names the file, entry and rule id.

| Rule | Rejects |
|---|---|
| **P1 — no pure numeric unlocks** | An unlock, chain step, deed, trainer offering or item grant whose only effect is a change to numbers (damage, cost, range, duration, cooldown, stat max, resistance) of an existing capability, unless it is flagged `supporting: true`. |
| **P2 — supporting is narrow** | `supporting: true` anywhere except a stat step of exactly +10 to health, stamina or mana from a `shrine` or `boon-item` source; a supporting entry that targets a capability (no "Firebolt II"). |
| **P3 — each step is a new verb** | A chain step whose delivery, op types, emitted world-property stimuli and granted affordances all equal its predecessor's (generalizes `mw-e07.8` AC-3 to techniques, arrows, tools and tricks). |
| **P4 — no XP** | Any `xp`, `level`, `skillPoints` or kill-count source; a deed whose condition counts more than 3 of the same event without `allowRepetition` (`mw-e19.11` AC-3). |
| **P5 — one-time growth** | A stat source without `once: true`; a stat step other than +10; base values or caps that differ from the stats table; MVP placements over 8 shrines and 6 boon items. |
| **P6 — simple cross-class** | `crossClass: true` on an entry that fails the simple rule (has prerequisites, exceeds the channel bound, or is in its class's signature list). |
| **P7 — additive only** | Any `excludes` / mutually exclusive unlock; a replacing unlock that does not declare the capability it subsumes. |
| **P8 — reachable** | A capability with no source in content (no book, trainer, schematic, tool, trick, deed, item or class grants it), and a class with no unlock channel (`mw-e19.4` AC-3). |

## Evidence

This is a design decision, not a measurement. What was checked on 2026-10-02 (`4a838a4`):

- Existing beads whose numbers this ADR adopts: stamina 100 max, 40/s regen (`mw-e04.5`,
  `src/sim/combat/stamina.ts`); mana 100 and 5/s regen as the sorcerer example (`mw-e06.3`);
  comprehension difficulty 0–1 and unstable spells (`mw-e07.1`, `mw-e07.3`); chain anti-numeric
  validator (`mw-e07.8`); deed repetition limit (`mw-e19.11`); placeholder player health 100 in the
  combat sandbox (`src/content/data/sandbox/combat-sandbox.json`).
- Story canon for trainers, merchants and class beats: `docs/narrative/story-bible.md` §3.3, §4.3,
  §5.
- Not tested: no prototype and no playtest. Stat values and the MVP budget are first-pass; the
  structure (no XP, in-world sources, three stats, simple cross-class, no respec) is the decision.

## Consequences

- **`mw-e19.2`** capability schema gains `classAffinity`, `crossClass` and `supporting`; **`mw-e19.3`**
  learn API enforces prerequisites and the cross-class rule for every channel; **`mw-e19.4`** class
  data adds `signature` capabilities, armor capacity and stat start values from this ADR;
  **`mw-e19.6`** implements exactly three stats with the table above and drops deeds as a stat source.
- **`mw-e19.7`** (books) and **`mw-e19.9`** (schematics) test their cross-class cases against the
  simple rule; **`mw-e19.8`** and **`mw-e19.10`** gain the same cases.
- **`mw-e19.13`** (respec/loadout) has nothing to implement: no loadout slots and no retraining. It
  should be closed as superseded by this ADR, and the loadout-swap rest action in `mw-e27.13` dropped.
- **`mw-e20.1`** economy: gold buys verbs (books, training, tools, schematic materials), not levels or
  respecs; trainers and booksellers are major sinks.
- **`mw-e18`** loot: no item is a bare stat stick; boon items are the only supporting items.
- **Costs we accept.** No number goes up after a fight, so combat must be rewarding in itself (§2).
  Content must place enough books, trainers, schematics, tools and deeds that each class gets at least
  three chains of three steps in the MVP. Players cannot correct a "bad build" because there are none.
- **Follow-up beads** created with this ADR: `mw-e19.15` (validator rules P1–P8 beyond what
  `mw-e19.3` AC-6 covers), `mw-e19.16` (cross-class simple rule in the shared learn API) and
  `mw-e19.17` (shrine boon choice).

## Revisit triggers

- Grey-box or MVP playtests (`mw-e35`) where two or more of five players say they fought creatures
  "for nothing" or skipped combat because it gives no reward.
- A class has fewer than three three-step chains placed in MVP content at m3.
- A designer needs an exclusive choice (two capabilities that cannot coexist): reopen respec.
- More than 25% of off-class learning attempts in playtests are refused and players report confusion
  about why.
