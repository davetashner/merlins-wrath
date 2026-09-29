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

- The landing page at [thevesperbell.com](https://thevesperbell.com) with the title key art and the
  rest-lamp icon.
- An opt-in main theme player on the landing page: off by default, and nothing downloads until the
  visitor presses play.
- The public backlog at [thevesperbell.com/backlog.html](https://thevesperbell.com/backlog.html),
  rebuilt on every merge, showing each bead's status and the pull requests that close it.
