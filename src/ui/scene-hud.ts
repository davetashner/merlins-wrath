// Scene overlay text (mw-e00.21): the on-screen scene name and build SHA, the controls and
// debug-camera hints, and the error shown when ?scene= names a scene that does not exist. Pure text;
// src/main.ts puts it in the DOM.

/** The corner label, e.g. `Greybox testbed (testbed) · build 1a2b3c4`. */
export function sceneLabel(scene: { readonly id: string; readonly name: string }, sha: string) {
  return `${scene.name} (${scene.id}) · build ${sha}`;
}

/** The labels the controls hint names, in the current bindings (src/game/input's inputGlyph). */
export interface ControlsHintLabels {
  readonly move: string;
  readonly jump: string;
  readonly sprint: string;
  readonly crouch: string;
  readonly dodge: string;
  readonly attack: string;
  readonly strongAttack: string;
  readonly leftHand: string;
  readonly block: string;
}

/**
 * How to control the player (mw-e02.23), for the device the player last used (mw-e02.9 AC-5): the
 * keyboard + mouse wording (click to take the pointer), or the controller's, which needs no click.
 */
export function playerControlsHint(
  device: 'keyboardMouse' | 'gamepad',
  labels: ControlsHintLabels,
): string {
  const { move, jump, sprint, crouch, dodge, attack, strongAttack, leftHand, block } = labels;
  const combat = `${attack} right-hand attack, ${strongAttack} strong attack, ${leftHand} left-hand action, ${block} block`;
  return device === 'gamepad'
    ? `Controller: ${move} move, right stick look, ${jump} jump, ${sprint} sprint (toggle), ${crouch} crouch (toggle), ${dodge} dodge, ${combat}`
    : `Click to play: ${move} move, mouse look, wheel zoom, ${jump} jump, ${sprint} sprint, ${crouch} crouch, ${dodge} dodge, ${combat}, Esc release`;
}

/** The keyboard + mouse hint in the default bindings. */
export const PLAYER_CONTROLS_HINT = playerControlsHint('keyboardMouse', {
  move: 'WASD',
  jump: 'Space',
  sprint: 'Shift',
  crouch: 'C',
  dodge: 'R',
  attack: 'Left click',
  strongAttack: '1',
  leftHand: '3',
  block: 'Right click',
});

/**
 * Shown after the controller disconnects (mw-e02.9 AC-4). The frame taps the pause action; the pause
 * screen that answers it is mw-e01.3.
 */
export const GAMEPAD_DISCONNECTED_HINT =
  'Controller disconnected: reconnect it, or click to play with keyboard and mouse';

/** Hint for the combat sandbox (mw-e04.9): its keys and where its options live. */
export const SANDBOX_HINT =
  'Combat sandbox: F3 frame data and hitboxes, F4 slow motion (0.25×), ` console (type dummies for spawn and tuning options)';

/** Hint for the debug fly camera. */
export const DEBUG_CAMERA_HINT =
  'F2: fly camera (WASD move, Q/E down/up, Shift fast, drag to look)';

export interface SceneErrorMessage {
  readonly heading: string;
  readonly body: string;
  /** One link per available scene. */
  readonly scenes: readonly { readonly id: string; readonly href: string }[];
}

/** The error for an unknown `?scene=` value, listing the scenes that do exist as links. */
export function sceneErrorMessage(
  requested: string,
  available: readonly string[],
): SceneErrorMessage {
  return {
    heading: `No scene called "${requested}"`,
    body:
      available.length === 0
        ? 'There are no scenes in this build.'
        : 'Pick one of the available scenes:',
    scenes: available.map((id) => ({ id, href: `?scene=${encodeURIComponent(id)}` })),
  };
}
