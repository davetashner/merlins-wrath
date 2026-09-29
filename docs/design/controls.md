# Controls

Keyboard + mouse and gamepad are equal first-class inputs (CONSTITUTION §10). Both feed the same
per-tick `ActionFrame` (`src/sim/input/action-frame.ts`) through the `ActionSampler`
(`src/game/input/sampler.ts`), are live at the same time, and are remapped with the same functions and
conflict rules (`src/game/input/bindings.ts`). Prompts show the glyphs of the device used last.

## Default layout

The gamepad layout is the W3C "standard" mapping, labelled for an Xbox controller (the owner's test
device; Xbox glyphs are the default). The same positions work on a PlayStation pad (A = Cross,
B = Circle, X = Square, Y = Triangle). Defaults: `DEFAULT_BINDINGS` and `DEFAULT_PAD_BINDINGS`.

| Action           | Xbox controller                    | Keyboard + mouse         |
| ---------------- | ---------------------------------- | ------------------------ |
| Move             | Left stick                         | W A S D (or arrows)      |
| Look             | Right stick                        | Mouse                    |
| Jump             | A                                  | Space                    |
| Crouch           | D-pad Down                         | C                        |
| Dodge            | B                                  | R                        |
| Interact         | X                                  | E                        |
| Sprint           | LS click (toggle)                  | Left Shift (hold)        |
| Lock on          | RS click                           | Q, middle click          |
| Cycle target     | (unbound; lock-on bead)            | Tab                      |
| Primary attack   | RT                                 | Left click               |
| Secondary / block | LT                                | Right click              |
| Ability 1        | Y, D-pad Up                        | 1                        |
| Ability 2        | RB, D-pad Right                    | 2                        |
| Ability 3        | LB                                 | 3                        |
| Ability 4        | D-pad Left                         | 4                        |
| Inventory        | View                               | I                        |
| Pause            | Menu                               | Esc, P                   |

B is the souls-like dodge button (mw-e04.8), which moved crouch to D-pad Down; the rest of the d-pad
mirrors the number row (abilities 1, 2 and 4), and Y, RB and LB reach abilities 1–3 without taking
the thumb off the face buttons or the stick. On the keyboard, R dodges: F stays free (it is the
remapping example) and Ctrl or Alt would trip browser shortcuts (Ctrl+W closes the tab).

**Dodge.** A dodge with a direction held rolls that way (relative to the camera, or to the lock-on
target once lock-on exists); with no direction held it backsteps. Timing and i-frames:
`src/content/data/move/dodge-roll.json` and `backstep.json`; the rules: `src/sim/combat/dodge`. Cycle target has no pad default: flicking the right stick
while locked on is the usual convention and belongs to the lock-on work.

**Sprint toggle.** On the pad, clicking the left stick latches sprint on; it stays on until the stick
comes back to centre or is clicked again (`GamepadSettings.sprintToggle`, default on). Off, sprint is
held like the Shift key.

## Sticks

- **Move (left stick):** rescaled radial deadzone, 0.15 by default (`GamepadSettings.moveDeadzone`).
  Deflection at or below the deadzone is no movement; the live range maps linearly onto 0–1 in the
  same direction, so 0.575 moves at half speed and full deflection at full speed.
- **Look (right stick):** rate-based. The frame carries the raw deflection as `lookStick`; the sim's
  `lookTurn` applies the look deadzone (0.15), a squared response curve and the turn rates (240°/s yaw,
  160°/s pitch at full deflection) from `src/content/data/camera/player.json`.
- **Triggers** count as pressed past 30% pull (`GamepadSettings.triggerThreshold`).

**Keyboard + pad in the same tick:** the longer move vector wins whole (never a sum, so the length
stays ≤ 1); buttons on the same action OR together; mouse look and stick look add up.

## Replays and quantisation

Every stick value in an `ActionFrame` (the left stick's `move` after the deadzone, and `lookStick`) is
quantised by `stickVector` to **thousandths of full deflection**: each axis becomes `k / 1000` for an
integer `k`, computed as `Math.round(v * 1000) / 1000`. IEEE-754 makes that the double nearest
`k / 1000` on every engine, so the value is short in JSON (`0.575`) and parses back to exactly the same
double: a recorded replay steps the sim with bit-identical input. Input longer than 1 is scaled back to
the unit circle first, and if rounding to the nearest step would push the length past 1, both axes
round towards zero instead. A thousandth is finer than pad hardware reports, so it is not felt.
Keyboard movement is not quantised (its values are the exact constants 0, ±1 and ±√½).

## Hot-plug and focus

The pad is polled once per sim tick (`src/game/input/gamepad-dom.ts`); the first connected pad with the
standard mapping is used. It needs no click or pointer lock, only page focus; without focus it reads
idle. When the pad being read disconnects, the next frame releases every action the pad held and, per
`GamepadSettings.pauseOnDisconnect` (default on), taps the `pause` action. The pause screen that
answers it is mw-e01.3; until then the testbed says "Controller disconnected".

## Persisting bindings

`serializeBindings(keyboard, gamepad)` writes version 2 data with both sets; `deserializeBindings`
reads version 2 and version 1 (keyboard only, with the default pad layout). Each set is validated on
its own: keyboard sets take no pad codes, pad sets only pad codes (`PadA`…`PadGuide`), and a set with
a conflict falls back to its defaults. The settings store wiring is mw-e02.22.
