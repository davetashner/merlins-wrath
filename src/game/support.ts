// Boot-time feature check (mw-e00.19): the minimum the game needs before it creates a renderer or
// fetches the physics WASM. The full capability matrix and preset choice are mw-e32.5.
import type { MissingFeature } from '@ui/unsupported';

/** The globals the check reads; pass globalThis in the browser, a plain object in tests. */
export interface SupportEnv {
  readonly WebAssembly?: unknown;
  readonly WebGL2RenderingContext?: unknown;
}

export function missingFeatures(env: SupportEnv): MissingFeature[] {
  const missing: MissingFeature[] = [];
  if (typeof env.WebGL2RenderingContext !== 'function') missing.push('webgl2');
  const wasm = env.WebAssembly as { instantiate?: unknown } | null | undefined;
  if (typeof wasm !== 'object' || wasm === null || typeof wasm.instantiate !== 'function') {
    missing.push('webassembly');
  }
  return missing;
}
