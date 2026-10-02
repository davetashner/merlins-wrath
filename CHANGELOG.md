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

- A wall or other level piece that burns away (an ivy-covered wall, say) no longer leaves an
  invisible wall behind: you can walk and see through where it stood. The debug console's `tp` now
  moves physics props (crates) too, instead of leaving them where they were.
