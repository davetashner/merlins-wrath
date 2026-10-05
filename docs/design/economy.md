# Economy design

Gold income, meaningful sinks, price bands and the target gold curve (mw-e20.1). The numbers here are
the single reference for the merchant validator (`src/content/types/merchant.ts`, mw-e20.2), the price
model (`src/sim/economy`, mw-e20.3) and the later balance tool (mw-e20 balance bead). The constants
the code reads live in `src/sim/economy/bands.ts`; change a band here and there together, and the
tests that name the doc's numbers will tell you what else moved.

Owner direction (2026-10-04): the valley is a grand open area whose enemy skeletons, of several types,
carry the gold and gear that fund purchases at the village shops. This is a design target, not tuned
content: the existing placeholder item values (a leather jerkin at 30, a mail hauberk at 120) will be
re-based onto the bands below by the balance tool.

## Currency

The currency is the inventory's `gold` counter (ADR-0003; `src/sim/inventory`), a number on the actor,
not an item in the weightless pack. The story bible calls the imperial coin **crowns**; in the game's
data and code the id stays `gold`, and UI text and dialogue say "crowns" (a localisation concern, not
an id change). All prices below are in gold, whole numbers, never below 1.

## What the player can buy

The shop categories the valley's villages carry: clothes, staves, swords, armor, helmets, gloves,
knives, bows, arrows, food, spell scrolls, potions (buy and use only; brewing comes later), potion
ingredients, breakable potion jars and an inn bed. Services (trainers, bookshop, thief tools, bribes
and donations) round out the sinks.

## Income

Per-source ranges, gold per unit. "Drop" is the coins a creature or container yields; gear that drops
is sold to a merchant at the buy rate (below), so its gold value is its base value x buy rate.

| Source | Per unit | Notes |
| --- | --- | --- |
| Skeleton, tier 1 (rank and file: miner, shambler) | 1-4 gold | the bulk of kills; 40% also drop a scrap item worth 5-15 |
| Skeleton, tier 2 (armed: warrior, archer) | 3-8 gold | 30% drop a weapon or armor piece, base value 20-60 |
| Skeleton, tier 3 (elite: captain, knight) | 8-20 gold | 50% drop a gear piece, base value 40-120, 5% a fine one |
| Skeleton, tier 4 (valley boss, one per region) | 30-80 gold | guaranteed fine or better item, handcrafted |
| Chest, common | 8-25 gold | plus a consumable roll |
| Chest, fine | 25-70 gold | handcrafted guarantees (treasure guide, mw-e18.9) |
| Chest, superior | 70-180 gold | one per major dungeon room |
| Chest, masterwork | 180-450 gold | hidden or puzzle-gated; at most a handful per region |
| Selling gear | base value x 0.3-0.6 (default 0.4) | the merchant's buy rate; x1.1-1.3 for a specialty |
| Selling stolen goods | sell price x 0.5-0.8 (default 0.6) | fences only |
| Quest rewards | 40-300 gold | cannot be farmed; reserved for story beats |

Kill rate is the lever behind the curve below: about one kill a minute including walking, mixed
60% tier 1, 30% tier 2 and 10% tier 3 for the valley's roaming population.

## Item tiers

Every item has a tier that scales its base value against the common baseline of its kind.

| Tier | Value multiplier | Where it comes from |
| --- | --- | --- |
| common | x1.0 | shops, tier 1-2 drops, common chests |
| fine | x2.5 | shops (one or two per village), tier 3 drops, fine chests |
| superior | x6 | rare shop stock, bosses, superior chests |
| masterwork | x15 | quest rewards, masterwork chests, never in a general shop |

The price of a fine weapon is therefore about 2.5 times a common one of the same kind.

## Sinks and price bands

Base values (before merchant markup) in gold. A shop's buy price is base x markup, 1.1-1.5.

| Sink | Base value band | Notes |
| --- | --- | --- |
| Food (bread, stew, rations) | 2-6 | restores a little stamina; a gold sink for volume |
| Potions, minor / standard / greater | 15-30 / 30-60 / 60-120 | buy and use only until brewing lands |
| Potion ingredients | 3-15 | per unit; for the later brewing system |
| Breakable potion jars | 4-12 | thrown or smashed (world properties), per jar |
| Arrows, standard / special | 1-3 / 3-8 | per arrow, sold in stacks of ten or more |
| Knives | 25-60 | |
| Gloves | 25-45 | clothes-class light; armor-class by weight below |
| Clothes | 20-80 | cosmetic or light protection |
| Swords, staves, bows (common) | 60-140 | fine x2.5, superior x6, masterwork x15 |
| Helmets, light / medium / heavy | 35-60 / 70-120 / 120-200 | |
| Body armor, light / medium / heavy | 90-140 / 180-300 / 350-600 | |
| Gloves and boots (armor), light / medium / heavy | 25-45 / 50-90 / 90-150 | |
| Spell scrolls | 40-150 | circle one 40-80; rarer ones up to 150 |
| Inn bed | 8-15 per night | a service: fixed by the innkeeper, no markup applied |
| Trainers (one technique) | 100-400 | ADR-0004 training; the price rises with the technique's tier |
| Bookshop books | 150-600 | premium spellbooks 350-450 base (about 455-585 to buy) |
| Thief tools (lockpicks, picks kits) | 15-60 | single-use picks at the low end |
| Bribes and donations | 20-200 | the player names the sum; the price bands set the sensible range |

Full armor sets, for reference: a light set (body, helmet, gloves, boots) is 175-290 base, centre
about 245, and costs about 320 at the default 1.3 markup. Medium centres near 540 base (about 700
bought); heavy near 850 base (about 1,100 bought).

## Target gold curve

Anchor: about 45 minutes of valley skeleton hunting affords a full light armor set (about 320 gold)
or one fine weapon (about 325 gold at default markup).

| Source (per 45 minutes) | Gold |
| --- | --- |
| Coins from about 45 kills (27 tier 1, 14 tier 2, 4 tier 3) | about 200 |
| Gear drops sold (about 6 pieces at the 0.4 buy rate) | about 110 |
| Chests found (about 3 common) | about 45 |
| Total | about 355 |

That is roughly 470 gold per hour. The valley is built for about 8 hours of play, so the player
obtains about 3,800 gold over the region.

**Obtainable : sink ratio.** The balance tool compares gold obtainable in a region with the cost of
what the region would like the player to buy. The target band is **0.6-0.8** (below 0.6 the player is
starved and the shops feel pointless; above 0.8 the player buys everything and gold stops being a
decision). For the valley:

| Valley wanted list (buy prices) | Gold |
| --- | --- |
| Light and medium armor sets | 1,020 |
| One fine and one superior weapon | 1,125 |
| A bow and arrows | 300 |
| Knives, gloves, clothes | 250 |
| Two spell scrolls | 250 |
| Consumables (potions, food, jars, ingredients) | 1,200 |
| Two trainer techniques | 600 |
| One premium bookshop book | 500 |
| Inn nights (about 10) | 120 |
| Total sink cost | 5,365 |

3,800 obtainable / 5,365 sink = **0.71**, inside the band. First bookshop visit (about 90 minutes in,
about 700 gold earned): one of three premium books is affordable, as the book beads expect.

## Merchant modifiers

| Modifier | Range | Default | Meaning |
| --- | --- | --- | --- |
| Markup | 1.1-1.5 | 1.3 | buy price = base x markup |
| Buy rate | 0.3-0.6 | 0.4 | sell price = base x buy rate |
| Specialty bonus | 1.1-1.3 | 1.2 | extra multiplier on the buy rate for a merchant's specialty categories |
| Stolen / fence factor | 0.5-0.8 | 0.6 | multiplier on the sell price of stolen goods; only a fence (`isFence` and `buysStolen`) buys them, every other merchant refuses |
| Haggle | -5% to +10% | 0 | buy price x (1 - h), sell price x (1 + h); a failed haggle is negative; clamped |
| World | x0.8-x1.25 | 1.0 | a regional event (famine, festival) on every price |

**Disposition bands.** Disposition tracking is mw-e22.4 and does not exist yet; the price model takes
a band, defaulting to neutral (1.0), and e22.4 maps its score to one.

| Band | Player buys at | Player sells at |
| --- | --- | --- |
| hostile | refused | refused |
| cold | x1.15 | x0.85 |
| neutral | x1.0 | x1.0 |
| friendly | x0.92 | x1.08 |
| devoted | x0.85 | x1.15 |

## Rules the price model enforces

- Prices are whole gold, rounded half up, never below 1.
- A merchant's sell price for an item never exceeds its buy price for the same item, whatever the
  disposition, specialty or haggle (the sell is capped).
- Quest items and `noSell` items are unsellable; bound items cannot be traded; stolen goods go only
  to a fence that buys them.
- A merchant refuses to buy categories it does not list in `buysCategories`.
- The breakdown lists the base value and each modifier that changed the price, for the shop UI.

## Open questions for the owner

- UI wording: "gold" or "crowns" on the shop screens (the doc assumes "crowns" in text, `gold` in data).
- ~~Whether the inn bed should heal fully or only restore stamina.~~ Decided 2026-10-04 (owner): a night at the inn fully restores health, stamina and mana, and sleeping passes time to morning (mw-ju8.6).
