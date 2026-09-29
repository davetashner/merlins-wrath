// Minimal unsupported-browser screen text (mw-e00.19). The full capability matrix is mw-e32.5.

/** Browser features the game cannot start without. */
export type MissingFeature = 'webassembly' | 'webgl2';

export interface UnsupportedMessage {
  readonly heading: string;
  readonly body: string;
  /** One line per missing feature, in a stable order. */
  readonly details: readonly string[];
}

const DETAIL: Record<MissingFeature, string> = {
  webgl2: 'WebGL 2 is unavailable, so the game cannot draw its world.',
  webassembly: 'WebAssembly is unavailable, so the game cannot run its physics.',
};
const ORDER: readonly MissingFeature[] = ['webgl2', 'webassembly'];

export function unsupportedMessage(missing: readonly MissingFeature[]): UnsupportedMessage {
  return {
    heading: 'This browser cannot run The Vesper Bell',
    body: 'Please use a current version of Chrome, Edge, Firefox or Safari with hardware acceleration and WebAssembly enabled.',
    details: ORDER.filter((feature) => missing.includes(feature)).map((feature) => DETAIL[feature]),
  };
}

/** Text shown while the physics module downloads and compiles. */
export const PHYSICS_LOADING_TEXT = 'Loading physics…';
export const PHYSICS_FAILED_TEXT = 'The physics module failed to load. Please reload the page.';
