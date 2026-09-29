// Abstract player actions and the per-tick ActionFrame (mw-e02.1). The sim never sees keys or mouse
// buttons: src/game/input maps them through remappable bindings to one ActionFrame per fixed tick,
// fed to `World.step` among that tick's commands. A frame is plain, frozen JSON data (no tick number,
// so identical idle ticks run-length encode in replays), and it satisfies the controller's
// MovementActions structurally: `{ actions: frame, cameraYaw }` is a CharacterInput.

import type { ButtonState } from '../character/controller';

/** Which input context an action belongs to; bindings only conflict within a context (or global). */
export type ActionContext = 'gameplay' | 'global';

/** One entry of the action registry. */
export interface ActionDef {
  /** `button`: digital with edges; `vector`: 2D analog. */
  readonly kind: 'button' | 'vector';
  /** Player-facing name (the remapping UI, mw-e31, shows it). */
  readonly label: string;
  /** Global actions conflict with a binding in any context. */
  readonly context: ActionContext;
}

/** The action registry: every abstract action the game reacts to, in display order. */
export const ACTIONS = {
  move: { kind: 'vector', label: 'Move', context: 'gameplay' },
  look: { kind: 'vector', label: 'Look', context: 'gameplay' },
  jump: { kind: 'button', label: 'Jump', context: 'gameplay' },
  sprint: { kind: 'button', label: 'Sprint', context: 'gameplay' },
  crouch: { kind: 'button', label: 'Crouch', context: 'gameplay' },
  interact: { kind: 'button', label: 'Interact', context: 'gameplay' },
  lockOn: { kind: 'button', label: 'Lock on', context: 'gameplay' },
  cycleTarget: { kind: 'button', label: 'Cycle target', context: 'gameplay' },
  primaryAttack: { kind: 'button', label: 'Primary attack', context: 'gameplay' },
  secondaryAttack: { kind: 'button', label: 'Secondary attack', context: 'gameplay' },
  ability1: { kind: 'button', label: 'Ability 1', context: 'gameplay' },
  ability2: { kind: 'button', label: 'Ability 2', context: 'gameplay' },
  ability3: { kind: 'button', label: 'Ability 3', context: 'gameplay' },
  ability4: { kind: 'button', label: 'Ability 4', context: 'gameplay' },
  inventory: { kind: 'button', label: 'Inventory', context: 'gameplay' },
  pause: { kind: 'button', label: 'Pause', context: 'global' },
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;

/** The digital actions (every registry entry of kind `button`). */
export type ButtonAction = {
  [K in ActionId]: (typeof ACTIONS)[K]['kind'] extends 'button' ? K : never;
}[ActionId];

/** Every button action, in registry order. */
export const BUTTON_ACTIONS: readonly ButtonAction[] = Object.freeze(
  (Object.keys(ACTIONS) as ActionId[]).filter(
    (id): id is ButtonAction => ACTIONS[id].kind === 'button',
  ),
);

/** A digital action this tick: the controller's ButtonState plus the release edge. */
export interface ActionButton extends ButtonState {
  /** Went up this tick. A tap inside one tick reports pressed and released, with held false. */
  readonly released: boolean;
}

/** A 2D vector. `move`: x right, y forward, length ≤ 1. `look`: mouse counts, x right, y up. */
export interface ActionVector {
  readonly x: number;
  readonly y: number;
}

/** The command `kind` that marks an ActionFrame among a tick's commands. */
export const ACTION_FRAME_COMMAND = 'input.actions' as const;

/** Every action's state for one sim tick. */
export type ActionFrame = {
  readonly kind: typeof ACTION_FRAME_COMMAND;
  readonly move: ActionVector;
  /** Look delta since the previous tick, raw mouse counts (sensitivity is applied downstream). */
  readonly look: ActionVector;
} & Readonly<Record<ButtonAction, ActionButton>>;

const button = (pressed: boolean, held: boolean, released: boolean): ActionButton =>
  Object.freeze({ pressed, held, released });
const pair = (pressed: boolean, held: boolean) =>
  [button(pressed, held, false), button(pressed, held, true)] as const;

// Eight frozen values, indexed [pressed][held][released], cover every combination, so frames
// allocate no button objects.
const BUTTONS = [
  [pair(false, false), pair(false, true)],
  [pair(true, false), pair(true, true)],
] as const;

/** The shared frozen ActionButton for these edges. */
export function actionButton(pressed: boolean, held: boolean, released: boolean): ActionButton {
  return BUTTONS[pressed ? 1 : 0][held ? 1 : 0][released ? 1 : 0];
}

/** Everything a frame carries besides its kind. */
export interface ActionFrameParts {
  readonly move: ActionVector;
  readonly look: ActionVector;
  readonly buttons: (action: ButtonAction) => ActionButton;
}

const ZERO: ActionVector = Object.freeze({ x: 0, y: 0 });

/** A frozen vector; -0 becomes 0 so frames survive a JSON round trip (replays reject -0). */
export function actionVector(x: number, y: number): ActionVector {
  if (x === 0 && y === 0) return ZERO;
  return Object.freeze({ x: x + 0, y: y + 0 });
}

/** Builds a frozen ActionFrame. */
export function actionFrame(parts: ActionFrameParts): ActionFrame {
  const frame: Record<string, unknown> = {
    kind: ACTION_FRAME_COMMAND,
    move: parts.move,
    look: parts.look,
  };
  for (const action of BUTTON_ACTIONS) frame[action] = parts.buttons(action);
  return Object.freeze(frame) as ActionFrame;
}

const UP = actionButton(false, false, false);

/** No input: stick centred, no look, every button up. */
export const IDLE_ACTION_FRAME: ActionFrame = actionFrame({
  move: ZERO,
  look: ZERO,
  buttons: () => UP,
});

/** True for an ActionFrame among arbitrary step inputs. */
export function isActionFrame(input: unknown): input is ActionFrame {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === ACTION_FRAME_COMMAND
  );
}

/** The tick's ActionFrame (the first, if several), or undefined when none was sampled. */
export function actionFrameOf(inputs: readonly unknown[]): ActionFrame | undefined {
  return inputs.find(isActionFrame);
}
