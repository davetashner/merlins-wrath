I’d structure this around one core promise: a browser RPG where choosing a class genuinely changes how you interact with the world—not merely your combat stats.

Project Constitution

1. Product vision

Build a desktop-first, browser-based fantasy action RPG centered on discovery, experimentation, exploration, and expressive class gameplay.

The player enters a handcrafted fantasy world as one of four archetypes:

* Sorcerer — discovers magic primarily through spellbooks, experimentation, and magical knowledge.
* Knight — masters timing, positioning, blocking, parrying, weapons, armor, and physical interaction with the world.
* Archer — controls space through precision, mobility, trick shots, specialized arrows, traps, and environmental interaction.
* Thief — manipulates awareness, shadows, locks, traps, disguises, distractions, pickpocketing, and alternate routes.

The game should create frequent moments of:

“Wait… I can do that?”

That is more important than having enormous maps, hundreds of quests, or dozens of numerical progression systems.

2. Design pillars

Classes change possibilities. A locked tower isn’t simply “requires level 8.” The thief might climb through a window. The sorcerer might levitate onto a balcony. The archer might shoot a distant mechanism. The knight might discover that an old wall can simply be smashed apart.

Magic should feel magical. Spells aren’t primarily “+14 fire damage.” They should create spectacular, useful, surprising effects. Magic can freeze water, illuminate darkness, throw enemies through furniture, summon creatures, reveal secrets, manipulate objects, deceive enemies, open traversal opportunities, and occasionally cause chaos.

The world rewards curiosity. Interesting-looking places should usually contain something interesting. Bookshelves can contain books. Wells can conceal tunnels. Strange statues may actually do something. NPC rumors can lead somewhere.

Combat is intrinsically fun. Fighting a skeleton should be enjoyable even when the player doesn’t need XP or loot.

Enemies are creatures, not target dummies. Creatures have behaviors, relationships, weaknesses, fears and personalities. Some creatures can be avoided, tricked, helped, befriended, angered, robbed, frightened or fought.

Problems support multiple solutions. Combat, puzzles, infiltration and quests should frequently permit class-specific and systemic solutions.

Failure creates stories. Failed stealth, botched spells and triggered traps should often create new situations rather than an immediate reload screen.

Depth before breadth. One fantastic dungeon with interconnected systems beats ten generic dungeons.

3. The anti-grind rule

Progression should unlock new verbs, not merely larger numbers.

Good progression:

Firebolt → Flame Jet → Fire Wall → Fireball → Conflagration
Telekinesis → stronger manipulation → throwing creatures → catching projectiles
Sneak → distractions → shadow movement → disguises → environmental takedowns

Weak progression:

Firebolt I → Firebolt II (+12%) → Firebolt III (+17%)

Stat improvements can exist, but they should support rather than define progression.

4. Sorcerer constitution

Magic is learned primarily from books.

Bookshops should therefore be genuinely exciting destinations.

Different settlements can have different magical inventories, specialties and rare books. Some books are expensive. Others are stolen, forbidden, hidden, damaged, untranslated, won from characters, found in ruins or carried by enemies.

Potential schools include Fire, Frost, Storm, Arcane, Illusion, Alteration, Conjuration, Necromancy, Nature, Light, Shadow, Gravity and Time.

Spells should include combat, utility and world interaction.

Examples:

Ember — ignite candles, ropes, oil and enemies.

Frostglass — freeze a target or create temporary ice surfaces.

Gust — blast enemies backward, clear poisonous gas or propel objects.

Mage Hand — manipulate distant objects.

Blink — teleport several meters.

Mirror Self — create an illusion that attracts attention.

Grasping Vines — roots burst from the earth and restrain creatures.

Animate Bones — assemble nearby skeletal remains into a temporary servant.

Gravity Well — pull creatures and loose objects toward a point.

Polymorph — temporarily transform a creature.

Thunderclap — violent short-range shockwave with substantial environmental effects.

The constitution should explicitly permit spells that designers worry are “too useful.” Finding ridiculous combinations is part of the fantasy.

5. Thief constitution

Stealth cannot be crouching + an eye icon.

The stealth simulation should account for:

* light and darkness
* visibility
* distance
* movement speed
* stance
* sound propagation
* surfaces
* doors
* line of sight
* enemy alertness
* last-known position
* distractions
* hiding places
* verticality

Enemies should distinguish between:

Unaware → Suspicious → Investigating → Searching → Alerted → Combat

They shouldn’t magically know the player’s position after losing sight.

Thief gameplay should eventually include things like lockpicking, pickpocketing, traps, thrown distractions, extinguishing lights, climbing, hiding bodies, disguises, silent movement, backstabs and escape tools.

A perfectly executed infiltration should feel every bit as satisfying as winning a difficult fight.

6. Combat constitution

Every class receives a distinct combat fantasy.

Knight: weight, impact and mastery. Blocking, parrying, dodging, shield bashes, charged attacks, weapon reach, armor and stagger.

Archer: precision and movement. Weak points, headshots, moving targets, elevation, draw timing, trick arrows and environmental shots.

Sorcerer: spectacular battlefield manipulation and combinations.

Thief: opportunistic combat. Ambushes, mobility, poison, traps, dirty tricks, evasions and disengagement.

Enemy encounters should reward understanding behavior rather than simply reducing HP.

7. Creature constitution

The bestiary should mix familiar fantasy creatures with original ones.

Skeletons, goblins, wolves, giant spiders, trolls, minotaurs, ogres, wraiths, slimes, harpies, basilisks, mimics, animated armor, dragons and stranger creatures can coexist.

But not everything exists solely to be killed.

A minotaur guarding an ancient labyrinth might be fought, tricked, befriended or helped.

A goblin camp might actually have people to talk to.

A skeleton might remember fragments of its previous life.

Some monsters should become memorable characters.

8. Puzzle constitution

Puzzles should primarily involve the world’s systems, rather than separate minigames.

Examples include redirecting light, freezing water, weighing pressure plates, manipulating statues, interpreting books, following sounds, moving objects, navigating darkness, discovering hidden mechanisms and exploiting creature behaviors.

Whenever practical, puzzles should support several solutions.

9. World structure

Do not begin by building a giant open world.

Build a dense interconnected region containing a settlement, wilderness and dungeon network, joined by a river to a harbour.

A useful MVP world might contain:

The town of Briar Glen → surrounding forest → abandoned watchtower → old mine → ruined monastery → underground labyrinth

The River Wend → the harbour town of Wendmouth

The river carries the valley's stone, and now the empire's silver, down to the sea for shipping to faraway lands. Wendmouth is a dock and harbour level where shenanigans ensue: sneakiness is richly rewarded, the other classes get up to hijinks, and every class can equip itself better than in the valley. It is optional to the main quest but part of the MVP.

Paths loop together and reveal shortcuts as players acquire abilities.

Think small world with surprising density, rather than enormous map.

10. Technical constitution

Desktop browser is the MVP target.

Keyboard + mouse comes first, gamepad second. Mobile comes after the MVP establishes that the game itself is fun.

Technical decisions should favor:

* rapid iteration
* deterministic game systems where practical
* data-driven spells/items/creatures
* reusable interaction systems
* good browser performance
* save-game stability
* automated testing of core rules
* developer tooling
* fast content creation

Avoid building infrastructure for hypothetical massive scale before the game proves itself.

⸻

Epic-level backlog

Epic	Outcome
E00 — Project Foundation	Repo, CI, coverage gates, deterministic sim core, content pipeline, engine decision and the published backlog.
E01 — Playable Vertical Slice	Player can enter the game, explore, fight, loot, die/save/reload and complete a small adventure.
E02 — Core Character Controller	Movement, camera, jumping, interaction, targeting, animation and responsive controls feel excellent.
E03 — Systemic Interaction Engine	Doors, switches, movable objects, breakables, fire, water, light, physics and triggers form a reusable world simulation.
E04 — Knight Combat	Sword/shield gameplay supports attack chains, blocks, parries, dodges, stagger, heavy attacks and satisfying hit reactions.
E05 — Archery	Bows feel excellent; arrows have physical presence, weak points matter, and specialized arrows enable creative combat/world interaction.
E06 — Magic Framework	Data-driven spell architecture supports projectiles, AoEs, beams, summons, buffs, transformations, physics and environmental effects.
E07 — Spellbook & Magical Learning	Spells are discovered through books, shops, exploration, quests and secrets rather than automatically appearing on level-up.
E08 — Spell Catalogue	Build a diverse initial library across several magical schools emphasizing qualitatively different effects.
E09 — Systemic Stealth	Visibility, lighting, sound, suspicion, searching, last-known-position and hiding work as coherent systems.
E10 — Thief Toolkit	Lockpicking, pickpocketing, distractions, traps, climbing, stealth attacks and escape tools produce a complete thief fantasy.
E11 — Enemy AI	Enemies patrol, perceive, investigate, communicate, fight, retreat, search and return to believable routines.
E12 — Creature Framework	Creatures can have unique senses, locomotion, attacks, vulnerabilities, dispositions and interactions.
E13 — Bestiary	Populate the game with diverse mundane, magical, undead and intelligent creatures.
E14 — Social Creatures	Selected creatures support dialogue, intimidation, feeding, helping, befriending or other noncombat relationships.
E15 — Puzzle Framework	Designers can construct systemic puzzles from reusable world objects instead of custom-coding every puzzle.
E16 — Class-Specific Solutions	Encounters deliberately contain multiple routes exploiting knight, archer, sorcerer and thief capabilities.
E17 — Inventory & Equipment	Weapons, armor, books, keys, consumables, quest objects and unusual artifacts are manageable without inventory busywork.
E18 — Loot & Treasure	Exploration produces interesting discoveries rather than endless statistically interchangeable equipment.
E19 — Progression	Character advancement primarily unlocks capabilities, specialization and new play styles.
E20 — Economy & Shops	Gold has meaningful uses and merchants have identities, inventories and specialties.
E21 — Bookshops	Magical bookstores become major progression/exploration destinations with rotating, regional, rare and secret inventory.
E22 — NPC & Dialogue System	Characters support conversations, disposition, choices, rumors and lightweight state tracking.
E23 — Quest Framework	Quests support branching objectives and multiple resolutions without requiring bespoke scripting everywhere.
E24 — Briar Glen	Build the first dense settlement with merchants, bookshop, NPCs, secrets, rooftops and class-specific opportunities.
E25 — Wilderness Region	Create the interconnected wilderness surrounding the settlement.
E26 — First Dungeon	Deliver one exceptional multi-route dungeon combining combat, stealth, puzzles, creatures and secrets.
E27 — Dynamic World State	Doors opened, characters helped, creatures befriended, treasures stolen and other meaningful actions persist.
E28 — Audio & Combat Feedback	Weapons, spells, footsteps, creatures and environments have satisfying positional audio and feedback.
E29 — VFX & Magical Spectacle	Magic, impacts, destruction, stealth feedback and environmental effects establish the game’s visual identity.
E30 — Save/Load	Browser-safe saves reliably preserve character and world state.
E31 — Accessibility & Settings	Remapping, text sizing, subtitles, camera options, difficulty assists and other foundational accessibility features.
E32 — Performance & Browser Compatibility	Stable frame pacing and reasonable loading across targeted desktop browsers/hardware.
E33 — Developer/Content Tools	Rapid creation/debugging of spells, enemies, loot, encounters, dialogue and puzzles.
E34 — Telemetry & Playtesting	Measure deaths, abandoned encounters, spell usage, puzzle completion and other signals without replacing direct observation of players.
E35 — MVP Fun Validation	External players demonstrate that combat, magic, stealth and exploration are intrinsically enjoyable.
E36 — Mobile Adaptation	Only after MVP validation: touch UX, performance profiles, interface redesign and mobile browser support.
E37 — Art Direction & Asset Pipeline	A style bible and prompt templates keep every generated image and model consistent; assets are generated by tools and approved by the owner.
E38 — Audio Direction & Asset Pipeline	An audio bible and prompt templates keep music and sound effects consistent; every cue is approved by the owner.
E39 — Story & Narrative	A story bible, dialogue, quests, books and lore that make the world worth exploring.
E40 — Wendmouth Harbor	An optional harbour level at the river mouth: heists, contests, smugglers and better gear.

MVP boundary

I’d make the first real milestone substantially smaller than the complete vision.

The MVP should have one town, one wilderness region, one major dungeon, the river connecting them to one harbour town (optional to the main quest), four playable classes, ~15–20 spells, ~8–10 enemy/creature types, one excellent bookshop, ~6 meaningful puzzles, a handful of NPCs/quests, and multiple approaches through the dungeon.

Critically, I would not require all four classes to contain equal amounts of content initially. They need enough mechanics to prove their respective fantasies.

The MVP’s defining scenario could be something like:

The Labyrinth Beneath Briar Glen

Something has begun stealing townspeople at night. The trail leads through abandoned mines into a much older labyrinth occupied by skeletons, goblins and a seemingly hostile minotaur.

The knight can force his way through dangerous areas. The thief discovers hidden passages and infiltrates occupied sections. The archer manipulates distant mechanisms and dominates open chambers. The sorcerer uses magic to alter the dungeon itself.

Eventually the player discovers the minotaur isn’t necessarily the monster the townspeople believe it to be.

That single adventure could exercise virtually the entire constitution.

And there’s one architectural principle I’d put above nearly everything else: spells, thief abilities, arrows, creatures and puzzles should interact with the same underlying world systems. If Fireball burns a rope because designers specifically scripted “Fireball + Rope,” the eventual combinatorial workload will kill the project. If ropes have flammable=true and fire spells produce heat/fire interactions, you’ve built the foundation for the emergent “I didn’t know I could do that” gameplay this concept needs.
