# Changelog

All notable changes that players and site visitors can see are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Playtest builds will be versioned when the
first one ships; until then everything sits under Unreleased.

Engine, tooling, test and infrastructure work with no visible effect is not listed. A PR that touches
`src/{game,ui,render,audio,sim,content}/`, `src/main.ts`, `index.html` or `site/` adds a one-line note
under Unreleased, or carries the `no-changelog` label if nothing visible changes (CI's `changelog`
check enforces this).

## [Unreleased]

### Added

- An inventory screen. Press I (View on a controller) to see everything you carry, sorted newest
  first, with tabs for Weapons & Armor, Tools, Consumables, Books, Keys and Quest & Artifacts. Each
  item has a card with its name, a line or two of flavour text, what it lets you do and what it's
  worth; stolen goods carry a red hand, and hovering or focusing them says whose they were. Pick an
  item to Use, Equip, Drop or Throw it, or put a potion in one of four quick slots, which now sit at
  the bottom of the screen showing what is in them and how many are left. The screen pauses the
  game, works fully with mouse, keyboard or controller, and follows the Text size setting, which
  now applies to the game's menus and HUD text.
- Guards keep routines you can watch and time. A guard can walk a loop, pace back and forth, wander
  between spots at random, or stand at a post sweeping its gaze across an arc. It pauses at each
  stop for a set time, faces a set way, and may lean on a wall or warm its hands while it waits.
  After a search, it heads for whichever stop it can reach soonest, not the next one in line. When a
  locked door cuts off a stop, it skips that stop and carries on.
- An AI debug overlay for debug builds (`ai.debug on` in the console). Each creature shows its sight
  cone tinted by alert state, its hearing range, the route it walks and where it thinks its target
  is, with a label giving its state and how long it has been in it, what it is doing and how aware
  it is of each thing it noticed. Noises ring where they were made. `ai.freeze` holds the game and
  `ai.step` advances it one tick; click a creature or type `ai.debug select` to see everything about
  it. Release builds do not include it.
- Health and stamina bars in the bottom-left corner. When you take a hit, the health you lost stays
  visible in a lighter colour for half a second before it drains away. The health bar pulses when
  you are below a quarter of your health, and the stamina bar flashes when you try something you
  don't have the stamina for. A hit from off screen shows a red arc pointing towards where it came
  from. A new HUD size option under Accessibility scales the bars from 75 % to 200 %.
- Dying now plays a short death beat before the death screen. Your controls stop responding, the
  camera pulls back over your body and the screen fades to dark for a second and a half. Then the
  death screen offers Load last save. Dying in the slice takes you back to your last save.
- The vertical slice has a level to play through, in grey box (`?scene=slice`). Open the wooden door
  out of the spawn room and walk a dim corridor, where ivy in a side alcove climbs to a torchlit
  ledge. The corridor opens into a pillared arena lit by torches and a brazier, with a loot alcove
  raised off one side. The way out is an iron door, and without its key it stays locked ("Locked.").
  Two checkpoints mark your progress on the way in, and stepping through the exit door finishes the
  slice. The skeleton, the key and the loot arrive next.
- Guards react in readable stages. Something catches a guard's eye and it stops to look, then goes
  to check the spot, then searches the area once it has lost you, and fights only when it can
  actually see you. If nothing new turns up for a few seconds, a wary guard relaxes again, so you
  can recover from a slip. A guard that loses you mid-fight searches where it last saw you instead
  of forgetting you. Afterwards it calms down but stays on edge for a while and spots you faster.
  Shoot a guard from the shadows and it raises the alarm and heads toward where the shot came from,
  not straight at you. The Forgotten skeleton follows the same rules.
- Creatures notice you gradually instead of all at once. A glimpse of you at the edge of a guard's
  vision builds its suspicion slowly, while standing in torchlight right in front of it gives you
  away fast, so you have time to back off into the dark. A loud noise puts a guard on edge at once.
  Once nothing more catches its attention, a guard stays wary for a couple of seconds and then slowly
  calms down. Bumping into a guard gives you away instantly, even in pitch darkness. Each creature
  remembers what caught its eye or ear, ready for future on-screen hints about why you were spotted.
- Chests can be looted. Search one to open it and take everything inside. What a chest holds is
  decided the first time anyone opens it and never changes after that, so reloading a save will not
  reroll it, and a looted chest stays empty. A locked chest needs its key or your lockpicks first,
  like a locked door. The testbed has a supply chest to try.
- The class select screen still shows all four classes, but in this build only the Knight can be
  chosen. Archer, Sorcerer and Thief are marked locked with "Not playable in this build yet", so you
  can see what's coming; they unlock in a later build. The Knight is selected first when the screen
  opens.
- Creatures now only know what their senses tell them. A guard sees you only inside its field of
  view, sees you better straight ahead than out of the corner of its eye, and struggles to make you
  out far away, crouched or in shadow. A wall between you hides you completely. Guards hear noises
  from the doorway the sound came through, not from where you really are behind the wall. Some
  creatures have stranger senses: the undead can feel the living through stone. Creatures in the
  game will start using this once their alertness and the game loop are wired up.
- Saves now keep the whole world, not just you: doors you opened, things you picked up and the
  story's facts come back exactly as you left them, and the changes to places you have already left
  are kept for when you return. A save made before a fact was renamed still loads with its value,
  and if part of a save is damaged, only that place starts over as built while the rest of your
  progress loads.
- Choose your class when you start a new game: Knight, Archer, Sorcerer or Thief, each card showing a
  short pitch, three signature verbs and the starting kit. Highlight a class and confirm, by mouse,
  keyboard or gamepad; you start with that class's abilities, gear (worn where it belongs) and gold,
  and a panel in the corner shows what you carry. For now the screen opens in the testbed with
  `?newgame`; the title screen leads to it later.
- Creatures can now find their way around a level. They go through doorways, up ramps and stairs,
  and down ledges. Climbers go up ivy and ladders, but a walker has to take the long way round. A
  locked door keeps them out until it is unlocked and opened, and a wolf cannot open a door at all.
  If you are somewhere a creature cannot reach, it comes as close as it can and stops there. Guards
  will use this once their patrols and searches move them.
- An options menu: settings for controls, camera, display, audio, accessibility and gameplay, one
  tab each, all reachable by keyboard or gamepad. Changes apply at once and are remembered by your
  browser; each tab can be reset to its defaults without touching the others. If your browser blocks
  storage the game still starts, and your settings last for that session. The menu opens from the
  pause menu once that arrives; the individual options take effect as their features land.
- Loot is now checked before the game ships: a chest that names an item or table that doesn't exist,
  tables that roll each other in a loop, or a one-of-a-kind artifact promised in two places fails the
  build instead of leaving you an empty chest or a second copy of a unique treasure.
- Sound now travels like it does in a building. Noise fades with distance, a shut door muffles it,
  an iron door more than a wooden one, and stone walls and floors swallow most of it. Someone in the
  next room hears where it came through the doorway, not where you are. Guards don't listen for it
  yet; their hearing comes next.
- The world can now remember what you did to it: smashed walls, charred crates, boxes you moved,
  doors and levers you left open, looted chests, dead creatures and items you dropped stay that way
  when a level is left and loaded again. Only the changes are kept, not the whole level. You will
  see it once area transitions and saves use it.
- How visible you are now depends on the light on your body, your stance, how fast you move and
  how far away a watcher is. Shadows hide you, sprinting through torchlight gives you away, and a
  dark figure against a bright window stands out.
- Saves keep your pack, gold, equipped gear and quick slots exactly as you left them, stolen goods
  still marked as stolen. If an update removes an item, a save holding it still loads; only that item
  is gone.
- Loot tables: chests and creatures can now be given handcrafted loot, with items that always
  drop plus weighted random finds, finds only some classes get, and unique treasures that never
  turn up twice. Nothing in the world uses them yet; containers and creature drops come next.
- Consumables and four quick slots: drink a draught or throw an oil flask without opening a menu.
  A slot refills from your next stack of the same item and shows as empty when you run out. A
  thrown oil flask lands as flammable oil that a flame sets alight, and the fire spreads from it
  through heat like any other. The slots have no keys yet (1–4 are your abilities).
- Keys work by themselves: walk up to a locked door holding its key and press Interact to unlock and
  open it, with no menu. Without the key the prompt is greyed and says why ("Locked. The key can't be
  far."). Some keys snap when used once; most stay on your keyring. The testbed's east wall now has a
  locked closet whose key lies on the floor nearby.
- Doors, locks, levers, buttons, cranks and wheels. Doors swing, slide, rise or drop open and stop
  against whatever is in their way; a dropping portcullis crushes what is weak and wedges on what is
  not. Wooden doors burn and break, iron ones do not. Locked doors open with the right key from your
  keyring or with lockpicks, and a frozen lever will not budge until it thaws. Try them in the new
  grey-box mechanism room (`?scene=mechanism-room`).
- Items lie in the world as physical objects: walk up to one and press Interact ("Take <name>") to
  put it in your pack, press G to drop the last item you picked up in front of you, or T to throw one
  along your look. Dropped and thrown items fall, bounce and make a noise when they land, louder the
  heavier they are. Quest items, such as keys you need, cannot be dropped or thrown. The testbed has
  a healing draught on the floor to try it with.
- A slow walk for sneaking: hold X to creep at 1.2 m/s, or push the left stick only lightly. It is
  the quietest way to move, standing or crouched. Sprinting while crouched now stands you up and
  sprints, unless a low ceiling keeps you down.
- The first creature: the Forgotten miner, a shambling skeleton with an overhead chop and a two-hit
  slash you can parry and riposte, and a lunging thrust you can only block. Clubs and maces hurt it
  more, arrows and thrusts less, and poison does nothing. It stands in as a grey-box capsule with
  bones until its model arrives.
- Hits, parries, impacts, breaks and fires now show visual effects, driven by the same events as
  their sounds: a clean hit puffs dust and metal on metal or stone throws sparks (both spraying back
  out of the struck surface, bigger for harder hits), a blocked blow sparks, a parry flashes a bright
  ring, a knocked prop or an arrow striking a wall kicks up dust, a breaking crate or wall throws
  shards and dust, and something that catches fire burns with flickering flames until it is put out
  or burns away. Effects use placeholder textures (soft glows, smoke, rings, shards and an animated
  flame) until the final VFX art lands under the same names.
- Creatures now attack by the knight's own rules: their swings can be parried (leaving them stunned
  and open to a riposte, just like the training dummy), blocked and staggered, and every attack
  winds up for at least 0.3 s with a readable telegraph, a sound and a glow on the creature (ember
  for a parryable swing, pale for one only a shield stops, red for one that cannot be blocked).
  The grey-box skeleton's three attacks are in: an overhead chop, a two-hit slash and a slower
  lunging thrust that cannot be parried.
- Movement feel can be tuned live: the debug console's `ctl.get`, `ctl.set runSpeed 6` and `ctl.dump`
  read and change the player's speeds, jump, gravity, ledge and climbing values from the next tick
  and print the edited controller file, and in `pnpm dev` saving that file retunes the player
  without a page reload. Controller data now holds per-class differences too: the thief crouches
  faster (2.6 m/s) once classes can be chosen.
- Dying now opens a death screen. "Load last save" (focused) takes you back to your most recent
  save of any kind, manual, autosave or quicksave, and "Load…" lets you pick an older one. Either
  rebuilds the area and puts you back in play within a few seconds. With no save yet, "Restart area"
  starts the area again from the beginning. A damaged save loads its backup and tells you so. In
  debug builds the console's `save [slot]` command saves the game (`manual-1` by default).
- Things can break: a new `?scene=weak-wall-room` has a cracked old wall the knight smashes with a
  heavy attack (debug console: `act sword-heavy`) to open a passage into the back room, leaving
  stone rubble that clears after a few seconds, and a crate that breaks open and spills a plank.
  Walls, crates and pots break by the kind of hit (blunt, slash, pierce, a blast), so arrows, thrown
  props and falls break fragile things too, and frozen things shatter more easily.
- The knight can shoot a bow in the testbed: press 4 to take the shortbow out, hold the left mouse
  button (RT) to draw and let go to loose an arrow, which flies, drops and sticks in what it hits
  (or glances off stone). The view narrows while you aim. Press 2 (RB) to switch between plain,
  broadhead and blunt arrows; `?frames` shows the selected type and how many are left. The testbed
  room has a wooden target board on its back wall to shoot at.
- You can climb: walk into a ladder, a rope or ivy to grab it and climb (1.2 m/s on a ladder, slower on
  ivy), hold forward at the top to pull yourself up onto the ledge, jump to push off or crouch to let
  go. Ivy that burns away drops you, frozen or burning holds slip after a second, and climbing
  drains stamina, so an empty bar makes you fall. The testbed room has an ivy-covered wall to try it.
- Your hands stay on the wall: dodging, attacking, blocking and drawing the bow do nothing while you
  are mantling, hanging from a ledge or climbing.
- Torches and fires now light the grey-box scenes the way the game's stealth light model sees
  them, with moonlight and ambient light from the scene: the new lighting room
  (`?scene=lighting-room`) shows wall torches, a burning crate and moonlight through a doorway, and
  the debug console's `prop` command changes an object's properties (`prop 12 burning false` puts a
  torch out).
- Debug builds can put creatures into the grey-box scenes from data: the new creature pen
  (`?scene=creature-pen`) places two test hounds, a patrolling guard and a sentinel as placeholder
  capsules, and the debug console spawns any creature by id (`spawn fixture-hound 3`, or
  `at-cursor` to drop them where the view centre looks) and clears them with `despawn all`.
  Creatures can be struck and locked on to; they have no AI yet and stand where they spawn.
- The world can hurt you: falls from more than about 4 m cost health (a 14 m drop is fatal), being
  thrown into a wall hurts the same way, and heavy objects falling on you crush. Blasts now throw the
  knight back and up. In the testbed, `?frames` shows your health and the latest fall or blow the
  world dealt you; with the debug console, `blast` sets one off in front of you.
- You can lock on to the training dummy in the testbed room and to the combat sandbox's dummies
  (including ones the debug console spawns), and the knight's sword swings now turn toward the
  locked target as they wind up. Defeating the room dummy releases the lock.
- The knight can parry: press 3 (LB on a pad) just before a blow lands and a well-timed parry
  (a 10-tick window, about 1/6 s) deflects it with a ringing clang, costs you nothing and leaves
  the attacker reeling for 1.5 s; attack while it reels within 2 m in front of you for a riposte
  that deals triple damage. Mistime it and blows land harder (×1.25) while you recover. The combat
  sandbox's frame-data overlay shows the parry window, the stun and when a riposte is ready.
- Hits have weight: when a blade connects, the attacker and the one struck freeze for a few frames
  (a light hit 3, a heavy 5, a charged heavy 6) while everything else keeps moving. The combat
  sandbox's frame-data overlay shows the freeze counting down in a new Hit-stop column.
- Combat and footsteps sound richer in the testbed: sword, club and point hits sound different on
  flesh, bone, metal, wood and stone; a hit on your raised shield plays a block instead of a hit, a
  guard break clangs, every swing whooshes, a dodged swing whiffs past you, and your footsteps change
  with the ground (stone, wood, earth, shallow water), quieter crouching and louder sprinting, with
  landings that thud harder the further you fall. All still placeholder sounds.
- Climb onto things: walk into a crate up to 1 m high and you pull yourself onto it; jump at a ledge
  up to 1.6 m and you mantle up. In the testbed you can also grab ledges up to 2.2 m, hang, shimmy
  sideways (across small gaps), pull up with jump, jump back off the wall or drop with crouch, and
  crouch-walk off an edge to lower yourself into a hang. A ledge that freezes or catches fire makes
  you let go after a second. Timings are placeholders to tune.
- The testbed has sound: after your first click or key press, sword hits on the training dummy,
  staggers, deaths, running out of stamina and props thudding into things play placeholder sounds
  that come from where they happen and follow the camera. They are simple synthesised stand-ins
  until the real sound effects arrive.
- A combat sandbox for tuning fights: open `?scene=combat-sandbox` for an arena with a training dummy
  and an attacker dummy that swings every 2 s. F3 shows live frame data (move, phase, tick, i-frames,
  hyperarmor, reactions, health, poise, DPS) with hitboxes; F4 plays in 0.25× slow motion; the debug
  console spawns and retunes dummies. The knight can now be hit: blocked hits never flinch you, and a
  guard break plays a one-second stagger.
- The knight can fight in the testbed: left click (RT) swings a three-hit sword chain, and holding
  right click (LT) raises a wooden shield that blocks frontal hits at half walking speed. Running out
  of stamina behind the shield breaks your guard and staggers you. A training dummy stands in front of
  the start to practise on.
- The game page now opens onto a 3D view (a placeholder scene) and loads physics in the background,
  with a "Loading physics…" notice while it downloads. Browsers without WebGL 2 or WebAssembly get a
  readable "this browser cannot run The Vesper Bell" screen instead of a blank page.
- The game now runs its simulation at a fixed 60 steps per second under the 3D view, with smooth
  motion at any display refresh rate. It pauses while the tab is hidden and resumes without a
  fast-forward burst when you come back.
- The game now opens onto a greybox testbed (a room, a corridor and an arena) built from a colour-coded
  level kit, instead of the placeholder scene. Add `?scene=<name>` to the URL to open another scene;
  an unknown name shows the list of scenes to pick from. The scene name and build are shown in the
  corner, and F2 toggles a free-fly debug camera (WASD, Q/E, Shift, drag to look).
- Scenes are now solid: level geometry is loaded into the game's physics simulation, which runs in
  lockstep with the rest of the game rules. The scene appears once physics has loaded, and if physics
  fails to load the page says so instead of breaking.
- You can now walk around the testbed: click the view to take control of a placeholder capsule and
  move it with WASD, turn with the mouse, jump with Space, sprint with Shift and crouch with C (Esc
  lets go). Walls stop you, and a simple camera follows from behind. F2's fly camera still works and
  hands control back when you turn it off.
- The testbed camera is now a proper third-person orbit camera: move the mouse to look around and up
  or down (−70° to +60°), and use the wheel to zoom between 2 and 6 m. It sits over the right
  shoulder, pulls in instantly instead of clipping into walls and pillars, and eases back out once the
  way is clear. The testbed's corridor now has pillars to squeeze past.
- You can now play with a controller (Xbox layout; PlayStation pads work too). The left stick moves
  and the right stick looks around. A jumps, B crouches and a left-stick click toggles sprint, and no
  click is needed to start. Keyboard and mouse still work alongside it, and the on-screen controls
  hint switches to controller buttons when you pick the pad up. Pulling the controller out lets go of
  everything it was holding.
- Add `?hitboxes` to the URL to draw the combat hit volumes as wireframes: each swing's sweep from
  its last pose to its current one, and every body's hit zones coloured by region (weak point, head,
  torso, limb; armored ones in grey). Nothing swings in the testbed yet; knight attacks bring it to life.
- The testbed arena now has two animated grey-box characters: a humanoid with a sword and a
  four-legged beast. Each one loops through standing, walking a circle, attacking and flinching from
  a hit. The game simulation drives their timing, so each attack's swing lands on the move's
  active frame.
- Particle effects are in: sparks, flames, smoke and glowing motes, kept within a particle budget so a
  busy fight can't tank the frame rate. Add `?vfx=demo` to the testbed URL to see twenty test effects
  and a stats overlay (`?vfx` shows the overlay alone).
- The testbed's loose crate and the arena plank are now real physics objects: they rest on the floor
  and fall, tumble and stack like wood, and the player bumps into them instead of walking through.
- Look at an object and press Interact (E, or X on a controller) to use it: a prompt under the view
  names what you can do and shows the key to press. Things you can't use yet stay listed, greyed, with
  the reason ("Locked — needs Iron Key"). The testbed room has a lever to try it on.
- A developer console: press the backtick key (`` ` ``) in a dev build, or add `?debug=1` to the URL
  of a playtest build, to type commands such as `spawn testprop-crate 3`, `god`, `noclip`,
  `tp player-start`, `timescale 0.5`, `scene kit-gallery` and `help`. Tab completes, Up/Down recall
  earlier commands, and Esc closes it. Without the flag nothing loads.
- Crates and other movable props spawned from the developer console are now physics objects like the
  scene's own: `spawn testprop-crate 3` drops three wooden crates that fall, stack and tumble.
- Lock-on: press Q (middle click, or the right-stick click) to lock on to the target nearest the
  centre of the view, shown by a gold ring. While locked you face it and circle it with A/D, and the
  camera frames you both. Tab, a quick mouse swipe or a right-stick flick switches to the next target
  left or right; the lock breaks beyond 25 m or after a second out of sight. The testbed arena has
  three training dummies to practise on.

- The landing page at [thevesperbell.com](https://thevesperbell.com) with the title key art and the
  rest-lamp icon.
- An opt-in main theme player on the landing page: off by default, and nothing downloads until the
  visitor presses play.
- The public backlog at [thevesperbell.com/backlog.html](https://thevesperbell.com/backlog.html),
  rebuilt on every merge, showing each bead's status and the pull requests that close it.
- Dodge: press R (B on a controller) to roll 3 m in the direction you are holding, relative to the
  camera, or to backstep with no direction held. A roll costs 20 stamina and a backstep 12; both
  have short invulnerability windows that attacks pass straight through. On a controller, crouch
  moves to D-pad Down.
- The player in the testbed is now an animated grey-box figure instead of a capsule: it stands
  idle, walks, runs and sprints with its speed, crouches, jumps, falls, lands and rolls, following
  exactly what the game's movement is doing.

### Fixed

- A hinged door you open while standing right up against it now swings open away from you,
  instead of stopping as if something were in its way. A door still stops against anyone standing
  where it swings.
- A wall or other level piece that burns away (an ivy-covered wall, say) no longer leaves an
  invisible wall behind: you can walk and see through where it stood. The debug console's `tp` now
  moves physics props (crates) too, instead of leaving them where they were.
