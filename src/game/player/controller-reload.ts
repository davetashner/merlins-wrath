// Hot reload of controller data in dev (mw-e02.3). Saving a file under src/content/data/controller/
// does not reload the page: the dev server's plugin (vite.config.ts) sends the file's text on
// CONTROLLER_HOT_EVENT, and the game validates it here and, when it is valid, retunes the player with
// a recorded debug command, so the change applies from the next tick like the console's ctl.set. A
// file that fails validation changes nothing and says why (the field path and the problem).

import {
  controllerSchema,
  controllerTuningFor,
  dottedPath,
  withoutSchemaKey,
  type ControllerTuning,
  type Frozen,
  type PlayerClass,
} from '@content/index';

/** The dev server's custom HMR event carrying a saved controller file. */
export const CONTROLLER_HOT_EVENT = 'vesper:controller';

/** What the dev server sends on CONTROLLER_HOT_EVENT. */
export interface ControllerHotUpdate {
  /** Repo-relative path of the saved file. */
  readonly file: string;
  /** Its new text. */
  readonly text: string;
}

/** A saved controller file, read: its tuning, or why it cannot be used. */
export type ControllerReload =
  | { readonly ok: true; readonly id: string; readonly tuning: Frozen<ControllerTuning> }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Reads a saved controller file's text: the tuning a character of `playerClass` (none: the base
 * profile) moves with, or every problem as `<file>: <field.path>: <message>`.
 */
export function readControllerFile(
  update: ControllerHotUpdate,
  playerClass?: PlayerClass,
): ControllerReload {
  let json: unknown;
  try {
    json = JSON.parse(update.text);
  } catch (error) {
    return { ok: false, problems: [`${update.file}: invalid JSON: ${(error as Error).message}`] };
  }
  const parsed = controllerSchema.safeParse(withoutSchemaKey(json));
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(
        (issue) => `${update.file}: ${dottedPath(issue.path) || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, id: parsed.data.id, tuning: controllerTuningFor(parsed.data, playerClass) };
}
