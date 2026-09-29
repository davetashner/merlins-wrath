import { describe, expect, it } from 'vitest';
import { loadPhysics, type PhysicsLoadState, type PhysicsModule } from '@game/physics-loader';

const fakeModule = { version: () => '0.21.0' } as unknown as PhysicsModule;

describe('lazy physics loader (mw-e00.19)', () => {
  it('reports loading, then ready, and resolves with the module', async () => {
    const states: PhysicsLoadState[] = [];
    let seenWhileImporting: PhysicsLoadState[] = [];
    const physics = await loadPhysics(
      () => {
        seenWhileImporting = [...states];
        return Promise.resolve(fakeModule);
      },
      (state) => states.push(state),
    );

    expect(seenWhileImporting).toEqual(['loading']);
    expect(states).toEqual(['loading', 'ready']);
    expect(physics.version()).toBe('0.21.0');
  });

  it('reports failed and rethrows when the import fails', async () => {
    const states: PhysicsLoadState[] = [];
    const failure = new Error('wasm fetch failed');
    await expect(
      loadPhysics(
        () => Promise.reject(failure),
        (state) => states.push(state),
      ),
    ).rejects.toBe(failure);
    expect(states).toEqual(['loading', 'failed']);
  });
});
