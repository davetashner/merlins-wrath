// The ?scene= picker (mw-e00.21): which scene the URL asks for. No parameter (or an empty one) means
// the default scene; a name the content does not have is reported with the list of real ones, so the
// page can show them instead of failing.

import { DEFAULT_SCENE } from './scene-loader';

export type SceneRequest =
  | { readonly kind: 'scene'; readonly id: string }
  | {
      readonly kind: 'unknown';
      readonly requested: string;
      readonly available: readonly string[];
    };

/** Resolves the `scene` query parameter of `search` (e.g. `location.search`) against `available`. */
export function resolveSceneRequest(
  search: string,
  available: readonly string[],
  fallback: string = DEFAULT_SCENE,
): SceneRequest {
  const requested = new URLSearchParams(search).get('scene')?.trim() ?? '';
  const id = requested === '' ? fallback : requested;
  return available.includes(id)
    ? { kind: 'scene', id }
    : { kind: 'unknown', requested: id, available: [...available] };
}
