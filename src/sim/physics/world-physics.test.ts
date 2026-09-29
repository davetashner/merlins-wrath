// The World owns and steps its physics port and carries its state in snapshots (mw-e03.35). A tiny
// fake port keeps these engine-free; rapier.test.ts runs the same paths on the real engine.
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { World, type WorldSnapshot } from '../core/world';
import { parseReplay, serializeReplay, type Replay } from '../replay/format';
import {
  diffSnapshots,
  encodeCanonical,
  encodeSnapshot,
  hashSnapshot,
  hashWorld,
} from '../snapshot';
import { decodeBase64, encodeBase64 } from './base64';
import { PhysicsStateError, type PhysicsPort, type PhysicsState } from './port';
import { InMemoryColliderSink } from './static-colliders';

/** Counts time: its whole state is the seconds stepped and the colliders it holds. */
class ClockPhysics extends InMemoryColliderSink implements PhysicsPort {
  seconds = 0;
  readonly steps: number[] = [];

  step(dt: number): void {
    this.steps.push(dt);
    this.seconds += dt;
  }

  snapshot(): PhysicsState {
    return { engine: 'clock@1', data: { seconds: this.seconds } };
  }

  restore(state: PhysicsState): void {
    if (state.engine !== 'clock@1') throw new PhysicsStateError(`not mine: ${state.engine}`);
    this.seconds = (state.data as { seconds: number }).seconds;
  }
}

describe('World physics (mw-e03.35)', () => {
  it('steps physics once per tick by 1 / hz, before any system runs', () => {
    const physics = new ClockPhysics();
    const world = new World({ seed: 1, hz: 50, physics });
    const seen: number[] = [];
    world.addSystem({
      name: 'reader',
      run: () => {
        seen.push(physics.steps.length);
      },
    });
    world.step();
    world.step();
    expect(physics.steps).toEqual([0.02, 0.02]);
    expect(seen).toEqual([1, 2]);
    expect(world.physics).toBe(physics);
    expect(new World({ seed: 1 }).physics).toBeUndefined();
  });

  it('puts physics state in snapshots and hashes, and restores it', () => {
    const physics = new ClockPhysics();
    const world = new World({ seed: 1, physics });
    const before = hashWorld(world);
    world.step();
    const snapshot = world.snapshot();
    expect(snapshot.physics).toEqual({ engine: 'clock@1', data: { seconds: 1 / 60 } });
    expect(hashWorld(world)).not.toBe(before);

    const copy = new ClockPhysics();
    const restored = new World({ seed: 1, physics: copy });
    restored.restore(snapshot);
    expect(copy.seconds).toBe(1 / 60);
    expect(hashWorld(restored)).toBe(hashWorld(world));
  });

  it('refuses a snapshot whose physics does not match the world', () => {
    const withPhysics = new World({ seed: 1, physics: new ClockPhysics() });
    const without = new World({ seed: 1 });
    expect(() => {
      without.restore(withPhysics.snapshot());
    }).toThrow('invalid snapshot: it has physics state but this world has no physics');
    expect(() => {
      withPhysics.restore(without.snapshot());
    }).toThrow('invalid snapshot: this world has physics but the snapshot has none');
    expect(() => {
      withPhysics.restore({ ...without.snapshot(), physics: { engine: 'other@2', data: null } });
    }).toThrow(PhysicsStateError);
  });

  it('encodes physics like any other field and names it in diffs', () => {
    const physics = new ClockPhysics();
    const world = new World({ seed: 1, physics, difficulty: { damageTaken: 2 } });
    world.facts.set('bell.rung', true);
    const a = world.snapshot();
    expect(encodeSnapshot(a)).toEqual(new Uint8Array([0x56, 0x42, 0x53, 1, ...encodeCanonical(a)]));
    world.step();
    const b: WorldSnapshot = { ...world.snapshot(), clock: a.clock };
    expect(diffSnapshots(a, b)).toEqual({
      section: 'physics',
      path: 'physics.data.seconds',
      field: 'data.seconds',
      a: 0,
      b: 1 / 60,
    });
    const withoutPhysics: WorldSnapshot = { ...b };
    delete (withoutPhysics as { physics?: unknown }).physics;
    expect(diffSnapshots(a, withoutPhysics)).toMatchObject({ section: 'physics', field: '' });
    expect(hashSnapshot(withoutPhysics)).not.toBe(hashSnapshot(b));
  });

  it('keeps physics state in replay checkpoints', () => {
    const world = new World({ seed: 1, physics: new ClockPhysics() });
    const state = world.snapshot();
    const replay: Replay = {
      formatVersion: 1,
      snapshotEncoding: 1,
      scenario: 'physics',
      buildSha: 'x',
      contentHash: null,
      seed: 1,
      stepHz: 60,
      ticks: 0,
      checkpointInterval: 60,
      inputs: [],
      checkpoints: [{ tick: 0, hash: hashSnapshot(state), state }],
      finalHash: hashSnapshot(state),
    };
    expect(parseReplay(JSON.parse(serializeReplay(replay))).checkpoints[0]?.state?.physics).toEqual(
      state.physics,
    );
  });

  it('adds and removes colliders through the port like any static collider sink', () => {
    const physics = new ClockPhysics();
    const handle = physics.add(box({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }));
    physics.remove(handle);
    expect(physics.count()).toBe(0);
  });
});

describe('base64 (mw-e03.35)', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it.each<[Uint8Array, string]>([
    [bytes(), ''],
    [bytes(0x66), 'Zg=='],
    [bytes(0x66, 0x6f), 'Zm8='],
    [bytes(0x66, 0x6f, 0x6f), 'Zm9v'],
    [bytes(0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72), 'Zm9vYmFy'],
    [bytes(0xfb, 0xff, 0xbf), '+/+/'],
  ])('encodes %s as %j and decodes it back (RFC 4648 vectors)', (raw, text) => {
    expect(encodeBase64(raw)).toBe(text);
    expect(decodeBase64(text)).toEqual(raw);
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(decodeBase64(encodeBase64(all))).toEqual(all);
  });

  it('refuses text that is not padded base64', () => {
    expect(() => decodeBase64('Zm9')).toThrow('base64 length must be a multiple of 4');
    expect(() => decodeBase64('Zm9$')).toThrow('invalid base64 character at 3');
    expect(() => decodeBase64('Z=9v')).toThrow('invalid base64 character at 1');
    expect(() => decodeBase64('Zg==Zm9v')).toThrow('invalid base64 character at 2');
  });
});
