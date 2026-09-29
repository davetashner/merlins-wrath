// Remappable key and mouse bindings (mw-e02.1). A Bindings value maps every bindable action to up to
// MAX_SLOTS input codes: KeyboardEvent.code for keys ("KeyW", "Space") and "Mouse<button>" for mouse
// buttons. Bindings are immutable; `rebind` returns a new set or a conflict and never half-applies.
// `serializeBindings` / `deserializeBindings` are the seam the settings store (mw-e02.22) persists
// through: plain JSON out, validated and conflict-checked on the way back in.

import { ACTIONS, BUTTON_ACTIONS, type ActionContext, type ButtonAction } from '@sim/index';

/** The four directions of the move vector, bound like buttons. */
export const MOVE_DIRECTIONS = ['moveForward', 'moveBack', 'moveLeft', 'moveRight'] as const;
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/** Anything a key or mouse button can be bound to. Look always comes from mouse movement. */
export type BindableAction = MoveDirection | ButtonAction;

/** Every bindable action: move directions first, then buttons in registry order. */
export const BINDABLE_ACTIONS: readonly BindableAction[] = Object.freeze([
  ...MOVE_DIRECTIONS,
  ...BUTTON_ACTIONS,
]);

/** Codes per action (primary, secondary). */
export const MAX_SLOTS = 2;

/** An input code: KeyboardEvent.code, or `Mouse<n>` for MouseEvent.button n. */
export type InputCode = string;

/** The code for a mouse button (0 left, 1 middle, 2 right, 3 back, 4 forward). */
export function mouseCode(button: number): InputCode {
  return `Mouse${String(button)}`;
}

export type Bindings = Readonly<Record<BindableAction, readonly InputCode[]>>;

/** Default keyboard + mouse layout. */
export const DEFAULT_BINDINGS: Bindings = freezeBindings({
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft'],
  crouch: ['KeyC'],
  interact: ['KeyE'],
  lockOn: ['KeyQ', mouseCode(1)],
  cycleTarget: ['Tab'],
  primaryAttack: [mouseCode(0)],
  secondaryAttack: [mouseCode(2)],
  ability1: ['Digit1'],
  ability2: ['Digit2'],
  ability3: ['Digit3'],
  ability4: ['Digit4'],
  inventory: ['KeyI'],
  pause: ['Escape', 'KeyP'],
});

function freezeBindings(bindings: Bindings): Bindings {
  const frozen: Partial<Record<BindableAction, readonly InputCode[]>> = {};
  for (const action of BINDABLE_ACTIONS) frozen[action] = Object.freeze([...bindings[action]]);
  return Object.freeze(frozen) as Bindings;
}

/** The input context a bindable action belongs to. */
export function contextOf(action: BindableAction): ActionContext {
  return (MOVE_DIRECTIONS as readonly string[]).includes(action)
    ? ACTIONS.move.context
    : ACTIONS[action as ButtonAction].context;
}

/** Whether a code on both actions would clash: same context, or either one global. */
function sharesContext(a: BindableAction, b: BindableAction): boolean {
  const ca = contextOf(a);
  const cb = contextOf(b);
  return ca === cb || ca === 'global' || cb === 'global';
}

/** Two actions claiming the same code. */
export interface BindingConflict {
  readonly code: InputCode;
  /** The action being rebound, then the action that already holds the code. */
  readonly actions: readonly [BindableAction, BindableAction];
}

export type RebindResult =
  | { readonly ok: true; readonly bindings: Bindings }
  | { readonly ok: false; readonly conflict: BindingConflict };

/**
 * Binds `code` to `action` in `slot` (0 primary, 1 secondary; a slot past the action's last code
 * appends). If another action in a clashing context already uses the code, returns that conflict and
 * `bindings` is left as it was. Binding a code the action already has in another slot moves it.
 */
export function rebind(
  bindings: Bindings,
  action: BindableAction,
  code: InputCode,
  slot = 0,
): RebindResult {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
    throw new RangeError(`binding slot must be 0–${String(MAX_SLOTS - 1)}, got ${String(slot)}`);
  }
  if (code === '') throw new RangeError('input code must not be empty');
  for (const other of BINDABLE_ACTIONS) {
    if (other !== action && sharesContext(action, other) && bindings[other].includes(code)) {
      return { ok: false, conflict: { code, actions: [action, other] } };
    }
  }
  const codes = bindings[action].filter((existing) => existing !== code);
  if (slot < codes.length) codes[slot] = code;
  else codes.push(code);
  return { ok: true, bindings: freezeBindings({ ...bindings, [action]: codes }) };
}

/** Removes the code in `slot` from `action` (no-op when the slot is empty). */
export function unbind(bindings: Bindings, action: BindableAction, slot = 0): Bindings {
  const codes = bindings[action];
  if (slot < 0 || slot >= codes.length) return bindings;
  return freezeBindings({ ...bindings, [action]: codes.filter((_, i) => i !== slot) });
}

/** Every clash in a bindings set (each pair once, in BINDABLE_ACTIONS order). */
export function findConflicts(bindings: Bindings): BindingConflict[] {
  const conflicts: BindingConflict[] = [];
  BINDABLE_ACTIONS.forEach((action, i) => {
    const clashing = BINDABLE_ACTIONS.slice(i + 1).filter((other) => sharesContext(action, other));
    for (const other of clashing) {
      for (const code of bindings[action]) {
        if (bindings[other].includes(code)) conflicts.push({ code, actions: [action, other] });
      }
    }
  });
  return conflicts;
}

/** The actions bound to each code: what the sampler looks up. */
export function actionsByCode(
  bindings: Bindings,
): ReadonlyMap<InputCode, readonly BindableAction[]> {
  const map = new Map<InputCode, BindableAction[]>();
  for (const action of BINDABLE_ACTIONS) {
    for (const code of bindings[action]) {
      const list = map.get(code);
      if (list) list.push(action);
      else map.set(code, [action]);
    }
  }
  return map;
}

/** The persisted form of a bindings set (JSON). */
export interface BindingsData {
  readonly version: typeof BINDINGS_DATA_VERSION;
  readonly actions: Readonly<Partial<Record<BindableAction, readonly InputCode[]>>>;
}

export const BINDINGS_DATA_VERSION = 1;

/** Plain JSON for the settings store. */
export function serializeBindings(bindings: Bindings): BindingsData {
  const actions: Partial<Record<BindableAction, InputCode[]>> = {};
  for (const action of BINDABLE_ACTIONS) actions[action] = [...bindings[action]];
  return { version: BINDINGS_DATA_VERSION, actions };
}

export interface DeserializedBindings {
  readonly bindings: Bindings;
  /** Problems found; entries they affect fall back to the defaults. Empty when the data was clean. */
  readonly issues: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCodes(value: unknown): value is InputCode[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SLOTS &&
    value.every((code) => typeof code === 'string' && code !== '') &&
    new Set(value).size === value.length
  );
}

/**
 * Reads persisted bindings. Unknown actions are ignored and missing or malformed ones keep their
 * default codes, each noted in `issues`. If the result would contain a conflict, or the data is not
 * a version-1 bindings object at all, the defaults are returned whole.
 */
export function deserializeBindings(
  data: unknown,
  defaults: Bindings = DEFAULT_BINDINGS,
): DeserializedBindings {
  if (!isRecord(data) || data['version'] !== BINDINGS_DATA_VERSION || !isRecord(data['actions'])) {
    return { bindings: defaults, issues: ['not version 1 bindings data; using defaults'] };
  }
  const stored = data['actions'];
  const issues: string[] = [];
  const merged: Partial<Record<BindableAction, readonly InputCode[]>> = {};
  for (const action of BINDABLE_ACTIONS) {
    const codes = stored[action];
    if (validCodes(codes)) {
      merged[action] = codes;
    } else {
      if (codes !== undefined) issues.push(`${action}: invalid codes; using defaults`);
      merged[action] = defaults[action];
    }
  }
  for (const key of Object.keys(stored)) {
    if (!(BINDABLE_ACTIONS as readonly string[]).includes(key)) {
      issues.push(`${key}: unknown action ignored`);
    }
  }
  const bindings = freezeBindings(merged as Bindings);
  const conflicts = findConflicts(bindings);
  if (conflicts.length > 0) {
    const list = conflicts.map((c) => `${c.code} (${c.actions.join(', ')})`).join('; ');
    return {
      bindings: defaults,
      issues: [...issues, `conflicting bindings ${list}; using defaults`],
    };
  }
  return { bindings, issues };
}
