// Scene overlay text (mw-e00.21): the on-screen scene name and build SHA, the debug-camera hint, and
// the error shown when ?scene= names a scene that does not exist. Pure text; src/main.ts puts it in
// the DOM.

/** The corner label, e.g. `Greybox testbed (testbed) · build 1a2b3c4`. */
export function sceneLabel(scene: { readonly id: string; readonly name: string }, sha: string) {
  return `${scene.name} (${scene.id}) · build ${sha}`;
}

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
