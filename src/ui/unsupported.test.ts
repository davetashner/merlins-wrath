import { describe, expect, it } from 'vitest';
import { PHYSICS_FAILED_TEXT, PHYSICS_LOADING_TEXT, unsupportedMessage } from '@ui/unsupported';

describe('unsupported-browser screen text (mw-e00.19)', () => {
  it('AC-3: explains a missing WebAssembly in readable words', () => {
    const message = unsupportedMessage(['webassembly']);
    expect(message.heading).toMatch(/cannot run The Vesper Bell/);
    expect(message.body).toMatch(/WebAssembly enabled/);
    expect(message.details).toEqual([
      'WebAssembly is unavailable, so the game cannot run its physics.',
    ]);
  });

  it('lists every missing feature once, in a stable order', () => {
    expect(unsupportedMessage(['webassembly', 'webgl2', 'webassembly']).details).toEqual([
      'WebGL 2 is unavailable, so the game cannot draw its world.',
      'WebAssembly is unavailable, so the game cannot run its physics.',
    ]);
  });

  it('has loading and failure text for the physics loading state', () => {
    expect(PHYSICS_LOADING_TEXT).toMatch(/Loading physics/);
    expect(PHYSICS_FAILED_TEXT).toMatch(/reload/);
  });
});
