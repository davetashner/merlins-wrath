import { describe, expect, it } from 'vitest';
import { missingFeatures } from '@game/support';

// Stand-ins: the check only looks at the shape of the globals, never calls them.
const webgl2 = Function.prototype;
const wasm = { instantiate: Function.prototype };

describe('boot feature check (mw-e00.19)', () => {
  it('passes a browser with WebGL 2 and WebAssembly', () => {
    expect(missingFeatures({ WebAssembly: wasm, WebGL2RenderingContext: webgl2 })).toEqual([]);
  });

  it('AC-3: reports WebAssembly missing when it is disabled or stubbed out', () => {
    expect(missingFeatures({ WebGL2RenderingContext: webgl2 })).toEqual(['webassembly']);
    expect(missingFeatures({ WebAssembly: null, WebGL2RenderingContext: webgl2 })).toEqual([
      'webassembly',
    ]);
    expect(missingFeatures({ WebAssembly: {}, WebGL2RenderingContext: webgl2 })).toEqual([
      'webassembly',
    ]);
  });

  it('reports WebGL 2 missing', () => {
    expect(missingFeatures({ WebAssembly: wasm })).toEqual(['webgl2']);
    expect(missingFeatures({})).toEqual(['webgl2', 'webassembly']);
  });
});
