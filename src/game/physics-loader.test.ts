import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { bootPhysics, type PhysicsLoadState, type PhysicsModule } from '@game/physics-loader';

describe('physics boot (mw-e00.19, mw-e03.35)', () => {
  it('reports loading, then ready, and resolves with the module and a sim physics port', async () => {
    const states: PhysicsLoadState[] = [];
    let seenWhileImporting: PhysicsLoadState[] = [];
    const boot = await bootPhysics(
      () => {
        seenWhileImporting = [...states];
        return Promise.resolve(RAPIER);
      },
      (state) => states.push(state),
    );

    expect(seenWhileImporting).toEqual(['loading']);
    expect(states).toEqual(['loading', 'ready']);
    if (!boot.ok) throw new Error('expected physics to boot');
    expect(boot.module.version()).toBe('0.21.0');
    expect(boot.physics.count()).toBe(0);
    expect(boot.physics.engine).toBe('rapier3d-deterministic@0.21.0');
  });

  it('AC-5: a failed WASM load reports failed and resolves with the error instead of throwing', async () => {
    const states: PhysicsLoadState[] = [];
    const failure = new Error('wasm fetch failed');
    const boot = await bootPhysics(
      () => Promise.reject(failure),
      (state) => states.push(state),
    );
    expect(boot).toEqual({ ok: false, error: failure });
    expect(states).toEqual(['loading', 'failed']);
  });

  it('AC-5: a module that cannot create a physics world is a failed load too', async () => {
    const states: PhysicsLoadState[] = [];
    const broken = { version: () => '0.21.0' } as unknown as PhysicsModule;
    const boot = await bootPhysics(
      () => Promise.resolve(broken),
      (state) => states.push(state),
    );
    expect(boot.ok).toBe(false);
    expect(boot.ok ? undefined : boot.error).toBeInstanceOf(TypeError);
    expect(states).toEqual(['loading', 'failed']);
  });
});
