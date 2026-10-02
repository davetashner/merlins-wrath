# ADR-0003: Encumbrance model — weightless inventory, weighted armor, physical carrying

- **Status:** Accepted
- **Date:** 2026-10-02
- **Decider:** Owner
- **Bead:** `mw-e17.1`

## Decision

**The inventory is weightless and uncapped, organized by category tabs. Only equipped armor (body
pieces and shields) has weight, and that weight sets a load class that changes noise, stamina and
movement verbs: the heavy knight is loud, tires sooner and cannot climb ropes; the quiet thief in
leather can. Large world objects (crates, bodies, statues, barrels) are never stored: they are carried,
pushed and thrown physically in the world.** No item in the pack weighs anything, nothing is ever
"full", and no stat or perk raises a carry limit. This is option (b) of the spike, plus physical
carrying of large objects. The owner decided it on 2026-10-02; this ADR records the decision and fixes
the numbers the dependent beads build against.

## Context

E17's outcome forbids inventory busywork: weapons, armor, books, keys, consumables, quest objects and
artifacts must be "manageable without inventory busywork" (`CONSTITUTION.md`, epic table). At the same
time the Thief constitution demands that stealth account for movement, stance and sound, and the Knight
fantasy is "weight, impact and mastery". Weight is useful where it creates a decision (do I wear the
plate tonight?) and harmful where it creates chores (which of these forty potions do I drop?).

The decision blocks the item schema (`mw-e17.2`, which has a `weightClass` field "per encumbrance ADR"),
the inventory core (`mw-e17.3`, which "enforces capacity only as the encumbrance ADR dictates"), the
armor load classes already specified in `mw-e04.16`, the footstep noise rule (`mw-e09.5`,
`mw-e02.10`), body carrying (`mw-e10.5`, `mw-e02.17`) and the ledge pull-up refusal (`mw-e02.34`).
Without it, each of those beads would invent its own weight rule.

## Options considered

### Inventory capacity model

Scores: ++ strongly serves, + serves, 0 neutral, − works against, −− strongly works against.

| Pillar / criterion | (a) Weightless, category tabs | **(b) Weightless + equipped-armor weight** | (c) Light encumbrance, soft cap | (d) Grid / slot inventory |
|---|---|---|---|---|
| E17 outcome: no inventory busywork | ++ | ++ | − (drop/sell runs near the cap) | −− (Tetris and sorting) |
| Classes change possibilities (§2) | 0 (armor is just numbers) | ++ (armor sets which verbs you have) | + | 0 |
| Thief constitution: stealth reads movement and sound | − (plate as quiet as cloth) | ++ (load class feeds noise) | + (total weight, including potions, feeds noise; illegible) | 0 |
| Knight fantasy: weight and impact | − | ++ | + | 0 |
| Anti-grind rule (§3): verbs, not numbers | 0 | + (no "carry weight" stat to grow) | −− (Strength/carry weight becomes a progression stat) | − (bag upgrades become progression) |
| Failure creates stories | 0 | + (overloaded sorcerer in plate can't roll) | − (overencumbered = walk to town) | 0 |
| Keyboard + gamepad parity, readable UI | ++ (tabs) | ++ (tabs + one load readout) | + | − (grid cursoring on gamepad) |
| Implementation and test cost | lowest | low (one derived value, one table) | medium (weights on every item, cap UX) | high (shapes, rotation, packing) |
| **Result** | **Rejected**: armor choice loses its stealth and movement trade-off | **Chosen** | **Rejected**: busywork and a numeric stat for no new verbs | **Rejected**: busywork the epic forbids |

### Large world objects

| Option | Summary | Result |
|---|---|---|
| **Carry physically in the world** | Crates, bodies, statues and barrels are physics objects: lift (`mw-e02.17`), push and pull (`mw-e02.18`), shoulder-carry bodies (`mw-e10.5`), throw. They never enter the inventory. | **Chosen**: every use of them is physical (weigh a plate, stack to a window, hide a body, block a door), so storing them would delete the gameplay |
| Store them as inventory items | "Take Crate" puts a crate in the pack, as in Skyrim's or DOS2's bag of anything. | **Rejected**: a pocketed crate cannot be stacked, hidden or thrown, breaks the property-based world (contract §2) and invites hoarding |

### Reference games

| Game | Model | What we take | What we avoid |
|---|---|---|---|
| *Quest for Glory V* | Weight-limited inventory; carrying too much slows you and items must be left behind | Class identity drives what you carry | Juggling inventory against a weight limit; trips back to stash |
| *Divinity: Original Sin 2* | Per-item weight with Strength-based capacity; bags of junk | Physical world objects you can move, stack and throw (crates on plates, barrels as weapons) | Strength as a carry stat; endless low-value loot sorting |
| *Skyrim* | 300 carry weight, overencumbered = walk only; heavy armor has weight | Heavy armor as a choice; physical bodies you can drag | Selling runs, hoarding, "drop the cheese wheels" busywork |
| *Zelda: Breath of the Wild* | Weightless materials in tabs; weapon/shield/bow slots; physical objects moved in the world | Weightless tabbed pack; world objects stay in the world | Slot-limited weapons with durability management (not our fantasy) |

## The model

### Inventory

- Everything that is an **item** (has an item definition, `mw-e17.2`) goes into a weightless,
  uncapped inventory. The screen groups it in the tabs of `mw-e17.10`: All, Weapons & Armor, Tools,
  Consumables, Books, Keys, Quest & Artifacts. Keys also live on the keyring (`mw-e17.5`).
- Items have **no carried weight**. The item schema's `weightClass` (light, medium, heavy) exists only
  for what an item does *outside* the pack: impact noise and physics when dropped or thrown
  (`mw-e17.7` AC-3). It is never summed.
- There is no carry capacity, no slot count and no per-item carry limit. `maxStack` is display
  chunking only (`mw-e17.3` AC-1 splits 7 into 5 + 2); a full stack starts a new one.
- The only clamps are gold (clamped at the configured maximum with `gold.capped`, `mw-e17.3` AC-5) and
  a technical guard of 9,999 units per definition that exists to bound save size, not as a game rule.
  Content never reaches it; if code does, the pickup is refused with reason `stack-limit` and the world
  entity stays where it was.
- Scarcity comes from supply, not from capacity: special arrows are assembled from limited materials
  (`mw-e19.9`), potions and tools are bought or found.

### Equipped armor: load class

Armor weight is in kilograms so the same number feeds the physics (an armored actor presses harder on a
pressure plate, `mw-e03.19`). Only items in the armor slots (head, body, hands, feet) and a shield in
the off hand count. Weapons, ammo, trinkets and tool-belt items weigh nothing for load; a weapon's heft
lives in its move data (stamina cost, speed, reach) in `mw-e04`.

**Load ratio = equipped armor weight ÷ class armor capacity**, and the load class follows the
thresholds already in `mw-e04.16`.

| Class | Armor capacity (kg) |
|---|---|
| Knight | 30 |
| Archer, thief, sorcerer | 20 |

Armor capacity is class data, not a stat: nothing raises it. It is how armor proficiency is expressed
(`mw-e17.4`'s soft proficiency), so a sorcerer can put on plate and live with the result.

Reference armor weights (content tunes per piece within ±25%):

| Set | Head | Body | Hands | Feet | Set total | Knight (cap 30) | Others (cap 20) |
|---|---|---|---|---|---|---|---|
| Cloth / robes | 0.5 | 2 | 0.5 | 0.5 | 3.5 | 12% Light | 18% Light |
| Leather | 1 | 3 | 1 | 1 | 6 | 20% Light | 30% Light |
| Mail | 2 | 8 | 2 | 2 | 14 | 47% Medium | 70% Medium |
| Plate | 4 | 12 | 3 | 3 | 22 | 73% Heavy | 110% Overloaded |

Shields: buckler 1 kg, wooden shield 3 kg, kite or tower shield 6 kg. Plate with a kite shield is
28 kg, 93% for a knight: Heavy, still able to roll.

| Load class | Load ratio | Typical wearer |
|---|---|---|
| Light | ≤ 30% | Thief in leather, sorcerer in robes, knight in leather |
| Medium | > 30% and ≤ 70% | Knight or archer in mail |
| Heavy | > 70% and ≤ 100% | Knight in plate |
| Overloaded | > 100% | Anyone but a knight in plate |

### What the load class changes

Base values are the existing controller and stamina tuning: run 5.0 m/s, sprint 7.5 m/s, crouch
2.2 m/s; stamina regen 40/s, sprint drain 10/s (`src/sim/combat/stamina.ts`); climbing 5 stamina/s
(`src/sim/climb/climb.ts`).

| Effect | Light | Medium | Heavy | Overloaded |
|---|---|---|---|---|
| **Stealth noise** multiplier on footstep and landing noise | ×1.0 | ×1.3 | ×1.6 | ×1.8 |
| Audible radius of a walk a guard hears at 8 m | 8 m | 10.4 m | 12.8 m | 14.4 m |
| **Stamina** regen multiplier | ×1.0 | ×1.0 | ×0.85 | ×0.7 |
| Sprint stamina drain multiplier | ×1.0 | ×1.15 | ×1.3 | no sprint |
| Climb stamina drain multiplier | ×1.0 | ×1.25 | ×1.5 (ladders only) | ×2.0 (ladders only) |
| **Movement speed**: run / sprint / crouch, m/s | 5.0 / 7.5 / 2.2 | 4.75 / 7.1 / 2.1 | 4.5 / 6.75 / 2.0 | walk only, ≤ 2.4 / none / 2.0 |
| Dodge roll (from `mw-e04.16`) | 3.6 m, 13 i-frames, 36 ticks | 3.0 m, 11, 40 | 2.2 m, 9, 46 | no roll: 20-tick stumble, no i-frames |
| Jump height multiplier | ×1.0 | ×0.95 | ×0.85 | ×0.7 |
| Climbing (ladders, ropes, ivy, rough walls) | all | all, climb speed ×0.85 | ladders only; others refused "Too heavy to climb" | ladders only |
| Pull-up from a ledge hang (`mw-e02.34`) | yes | yes | yes | refused |
| Poise and absorption | per piece (`mw-e04.16`) | | | |

The noise multiplier scales the radius at which a noise is audible, so in a decibel model it is an
offset of 20·log₁₀(m): +2.3 dB for Medium, +4.1 dB for Heavy, +5.1 dB for Overloaded (`mw-3jh`
reconciles the two scales). It is the actor's **load class value**, applied once; armor pieces do not
each carry a `noiseMultiplier`, so four plate pieces are not 1.6⁴. Non-armor items may still carry an
explicit `noiseMultiplier` property that multiplies in (soft boots ×0.7, a bell charm ×1.5), and the
actor's total is clamped to [0.5, 2.0]. The values 1.0, 1.3 and 1.6 are the leather, chain and plate
figures `mw-e04.16` already uses.

Armor weight does **not** change visibility to sight: light, stance, motion and distance do
(`mw-e09`). A lantern or a burning torch does, through the light field.

### Large world objects

- **Item or world object?** If the thing's interesting use is physical (weight on a plate, stacking to
  reach a window, blocking a door, hiding or throwing it), it is a world object and is never an item.
  Otherwise it is an item, even when it is fairly large: the bell's bronze tongue is a quest item
  because the story has the thief pickpocket it from the abbot. No definition is both;
  a crate's contents are items (containers, `mw-e18`).
- **Three carry modes**, all physical and all through world properties:
  - *Hand-carry* (`liftable`, weight ≤ the class carry limit, 25 kg by default in `mw-e02.17`): held
    in front, speed ×0.85, no sprint, jump allowed; attack, block, cast and draw are unavailable.
  - *Shoulder-carry* (`bulky`: bodies and anything flagged so, up to a size class): speed ×0.5, no
    jump, no sprint, no climbing, visibility profile raised (`mw-e10.5`). This one value replaces the
    ×0.6 in `mw-e10.5` AC-1 so bodies handle the same for every class; the thief's edge is *hiding*
    bodies, not carrying them faster.
  - *Push and pull* (`pushable`, heavier than the carry limit: statues, big crates): speed from the
    `mw-e02.18` formula.
- Carry multipliers stack with the load class: a knight in plate shoulder-carrying a body moves at
  4.5 × 0.5 = 2.25 m/s.
- An actor's physical weight on the world (pressure plates, rope bridges, thin ice) is body mass +
  equipped armor kg + anything held. Inventory adds nothing: forty potions do not press a plate.

## Edge cases the model must handle

| Case | Rule |
|---|---|
| **Picking up an item while "full"** | There is no full. Every pickup of an item succeeds (`mw-e17.7` AC-1), auto-stacks and opens a new stack past `maxStack`. The 9,999-unit technical guard refuses with `stack-limit` and leaves the entity in the world; no content can reach it. Gold past its cap clamps and emits `gold.capped`. |
| Picking up a world object while hands are full | Refused with prompt "Hands full"; the held object stays held. Taking a small *item* while carrying is allowed (it goes to the pack). |
| **Quest items** | Weightless and uncapped like everything else; `noDrop` and `noSell` default to true (`mw-e17.2` AC-5); removal only through effects with `force: true` (`mw-e17.3` AC-3). Dropping or selling is refused with reasons `no-drop` / `no-sell`. |
| Quest-critical *world* objects (a statue part, a counterweight) | Carried physically, so they can be dropped, thrown or lost. Each must declare a `recovery` anchor in content; if destroyed or lost out of bounds it returns there and emits `object.recovered`. The validator rejects a quest-critical world object without one. |
| **Stacks** | Stolen and clean units never merge (`mw-e17.3` AC-2); unique items and equipment never stack; removing more than held fails atomically (`mw-e17.3` AC-6). Dropping a stack spawns one world entity carrying the count and instance flags; throwing takes one unit. |
| **Physically carried world objects: damage** | A hit that breaks poise or staggers the carrier drops the object at their feet; a carried object that catches fire forces a drop after 2.0 s (`mw-e02.17` AC-4); a waking body is dropped (`mw-e10.5` AC-5). |
| Physically carried world objects: traversal | Grabbing a ladder, rope, ivy or ledge is refused with "Hands full" while carrying; dodging is unavailable while shoulder-carrying. |
| Physically carried world objects: scene exit | Objects never cross a scene load. Exiting while carrying drops the object at the threshold on the near side. |
| Physically carried world objects: save | A save written while carrying stores the object as a placed world object at the carrier's feet; on load the player is not carrying. |
| Equipping armor that overloads | Allowed (soft proficiency, `mw-e17.4` AC-2). The compare panel (`mw-e17.11`) shows the load class change and warns before Overloaded. |
| Changing armor mid-fight or mid-climb | Armor and shield equip changes are refused while any creature is in Combat with the player (reason `in-combat`) and while climbing, hanging or carrying (reason `busy`). Weapons, ammo and tools still swap anywhere. Out of those states armor swaps are instant. |
| Thrown inventory items | Leave the pack weightless and become physics objects with their world properties; impact noise uses the item's `weightClass`. |
| Losing armor (broken, stolen, removed by an effect) | Load class is recomputed the same tick; the next footstep, regen tick and roll use the new class. |

## Evidence

This is a design decision, not a measurement. What was checked:

- Existing tuning in the repository on 2026-10-02 (`4a838a4`): controller speeds run 5.0, sprint 7.5,
  crouch 2.2 m/s (controller tuning fixtures, e.g. `src/sim/character/controller.test.ts`); stamina profile 100 max, 40/s regen,
  10/s sprint drain (`src/sim/combat/stamina.ts`); climbing 5 stamina/s (`src/sim/climb/climb.ts`);
  `noiseMultiplier` defined as a product over equipment (`src/sim/properties/spec.ts`); footstep audio
  gait weights (`src/sim/character/locomotion.ts`).
- Open beads that already state numbers this ADR adopts or overrides: `mw-e04.16` (load thresholds,
  roll profiles, regen ×0.85, noise 1.0/1.3/1.6), `mw-e02.10` (encumbrance multiplier hook, AC-3),
  `mw-e02.17` (carry limit, throw speeds, body carry 50%), `mw-e10.5` (body carry ×0.6), `mw-e09.5`
  (equipment noise term).
- Not tested: no prototype was built and no playtest has run. All values are first-pass tuning for
  grey-box; content may move them, but not the structure (weightless pack, armor-only load, four
  classes, physical carrying).

## Consequences

- **`mw-e17` (inventory and equipment).** `mw-e17.2` defines `weightClass` for physical behaviour only
  and an armor block with `weightKg`; it adds no capacity fields. `mw-e17.3` has no capacity check
  beyond the gold clamp and the technical guard. `mw-e17.4`'s derived `EquipmentState` exposes
  `loadRatio`, `loadClass` and the load noise multiplier. `mw-e17.10` shows no weight anywhere; the
  paper-doll (`mw-e17.11`) shows the load class and its effects.
- **`mw-e09` (stealth).** `mw-e09.5` and `mw-e02.10` read one load multiplier from the derived
  equipment state instead of summing per-item noise; non-armor `noiseMultiplier` items multiply in.
  Armor does not enter the visibility model.
- **`mw-e10` (thief toolkit).** The thief's quiet comes from staying Light, not from a stealth stat.
  `mw-e10.5` uses the shared shoulder-carry rule (×0.5); its AC-1 value changes from ×0.6.
- **`mw-e04` (knight combat).** `mw-e04.16` computes load ratio from equipped armor only, with the
  capacities above; its noise values become load-class values rather than per-piece multipliers.
- **`mw-e02` (controller).** `mw-e02.34` refuses the pull-up when Overloaded. New follow-up work
  (below) applies the speed, sprint, jump and climb rules and the carried-object edge cases.
- **Costs we accept.** A thief can carry forty potions and three swords without consequence; scarcity
  must come from supply and prices (`mw-e20`). Grid-inventory fans lose a minigame. A knight in plate
  loses rope and ivy routes, so every mandatory knight route must avoid them (`mw-e16` route matrix).
- **Follow-up beads** created with this ADR: `mw-e17.13` (apply load class to movement verbs and
  armor-swap rules) and `mw-e17.14` (carried world objects across damage, traversal, scene exit, save
  and loss).

## Revisit triggers

- Grey-box playtests (`mw-e35.5`) show players hoarding consumables until fights become trivial, in
  two or more of five sessions: consider per-item limits on consumables only.
- More than one mandatory obstacle in the `mw-e16` route matrix needs a knight-in-plate route that the
  climbing restriction blocks.
- Stealth playtests show Heavy is either undetectable on stone at 6 m walking (too quiet) or always
  detected at 15 m crouching (too loud).
- A save-size budget (`mw-e27.11`) is exceeded by inventory instance counts.
