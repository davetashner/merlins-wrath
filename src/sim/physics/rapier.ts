// The Rapier implementation of the sim's physics port (ADR-0001, mw-e03.35), on the deterministic
// build of Rapier (@dimforge/rapier3d-deterministic, the non-compat package with a separate .wasm).
//
// The sim never imports Rapier at runtime: WASM has to be fetched and compiled asynchronously, and the
// sim is synchronous. The game loads the module (src/game/physics-loader.ts) and injects it here,
// exactly like the clock and the RNG seed; this file only imports Rapier's types.
//
// Colliders come from greybox shapes (src/sim/character/greybox.ts). A box is a cuboid; a ramp is the
// convex hull of its six wedge corners. Shapes without a velocity become fixed colliders; a shape
// with one is a kinematic, velocity-based body (a moving platform) that Rapier moves every step.
// Handles are this port's own small integers (1, 2, 3… never reused), mapped to Rapier's handles.
//
// State: `snapshot()` is Rapier's own world snapshot (bit-exact: restoring it and stepping on gives
// the same bytes as never stopping) as base64, plus the handle table. It is part of every
// WorldSnapshot, so the sim state hash covers physics.

import type * as Rapier from '@dimforge/rapier3d-deterministic';
import type { GreyboxShape } from '../character/greybox';
import type { Vec3 } from '../stimulus/shapes';
import { decodeBase64, encodeBase64 } from './base64';
import { PhysicsStateError, type PhysicsPort, type PhysicsState } from './port';
import type { ColliderHandle } from './static-colliders';

/** The loaded @dimforge/rapier3d-deterministic module, injected by the game or by test setup. */
export type RapierModule = typeof Rapier;

export interface RapierPhysicsOptions {
  /** Gravity, m/s²; defaults to 9.81 straight down. */
  readonly gravity?: Vec3;
}

/** Standard gravity, m/s², pointing down. */
export const DEFAULT_GRAVITY: Vec3 = Object.freeze({ x: 0, y: -9.81, z: 0 });

/** One collider this port added: Rapier's collider handle and, for a moving one, its body's. */
interface Entry {
  readonly collider: number;
  readonly body: number | undefined;
}

type HandleRow = readonly [number, number] | readonly [number, number, number];

/** `data` of a Rapier PhysicsState. */
interface RapierStateData {
  /** Rapier's world snapshot, base64. */
  readonly world: string;
  /** The next handle `add` will issue. */
  readonly next: number;
  /** [handle, Rapier collider handle] or [handle, Rapier collider handle, Rapier body handle]. */
  readonly colliders: readonly HandleRow[];
}

const AXES = ['x', 'y', 'z'] as const;

/** Throws unless the shape has volume on every axis. */
function checkShape(shape: GreyboxShape): void {
  for (const axis of AXES) {
    if (!(shape.max[axis] > shape.min[axis])) {
      throw new RangeError(`greybox ${shape.kind}: max.${axis} must be above min.${axis}`);
    }
  }
}

/** The six corners of a ramp's wedge, relative to the centre of its box. */
function wedgeCorners(shape: GreyboxShape & { kind: 'ramp' }, centre: Vec3): Float32Array {
  const along = shape.rises === '+x' || shape.rises === '-x' ? 'x' : 'z';
  const across = along === 'x' ? 'z' : 'x';
  const high = shape.rises.startsWith('+') ? shape.max[along] : shape.min[along];
  const corner = (a: number, y: number, c: number): number[] => {
    const p = { x: 0, y, z: 0, [along]: a, [across]: c } as Vec3;
    return [p.x - centre.x, p.y - centre.y, p.z - centre.z];
  };
  const { min, max } = shape;
  return new Float32Array([
    ...corner(min[along], min.y, min[across]),
    ...corner(min[along], min.y, max[across]),
    ...corner(max[along], min.y, min[across]),
    ...corner(max[along], min.y, max[across]),
    ...corner(high, max.y, min[across]),
    ...corner(high, max.y, max[across]),
  ]);
}

const isHandleRow = (row: unknown): row is HandleRow =>
  Array.isArray(row) &&
  (row.length === 2 || row.length === 3) &&
  row.every((n) => typeof n === 'number');

/** `data` checked as RapierStateData, with the world snapshot decoded. */
function stateData(data: unknown): RapierStateData & { readonly bytes: Uint8Array } {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Partial<RapierStateData>;
  if (
    typeof d.world !== 'string' ||
    !Number.isSafeInteger(d.next) ||
    !Array.isArray(d.colliders) ||
    !d.colliders.every(isHandleRow)
  ) {
    throw new PhysicsStateError('malformed Rapier physics state');
  }
  try {
    return { ...(d as RapierStateData), bytes: decodeBase64(d.world) };
  } catch (error) {
    throw new PhysicsStateError('malformed Rapier physics state', { cause: error });
  }
}

/** The sim's physics port on Rapier's deterministic build. */
export class RapierPhysics implements PhysicsPort {
  /** `rapier3d-deterministic@<version>`, written into every snapshot. */
  readonly engine: string;
  private world: Rapier.World;
  private readonly entries = new Map<ColliderHandle, Entry>();
  private next = 1;

  constructor(
    private readonly rapier: RapierModule,
    options: RapierPhysicsOptions = {},
  ) {
    this.engine = `rapier3d-deterministic@${rapier.version()}`;
    this.world = new rapier.World({ ...(options.gravity ?? DEFAULT_GRAVITY) });
  }

  add(shape: GreyboxShape): ColliderHandle {
    checkShape(shape);
    const { rapier, world } = this;
    const { min, max } = shape;
    const centre = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const desc =
      shape.kind === 'box'
        ? rapier.ColliderDesc.cuboid((max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2)
        : new rapier.ColliderDesc(new rapier.ConvexPolyhedron(wedgeCorners(shape, centre)));
    let body: Rapier.RigidBody | undefined;
    if (shape.velocity === undefined) {
      desc.setTranslation(centre.x, centre.y, centre.z);
    } else {
      const { x, y, z } = shape.velocity;
      body = world.createRigidBody(
        rapier.RigidBodyDesc.kinematicVelocityBased()
          .setTranslation(centre.x, centre.y, centre.z)
          .setLinvel(x, y, z),
      );
    }
    const collider = world.createCollider(desc, body);
    const handle = this.next++ as ColliderHandle;
    this.entries.set(handle, { collider: collider.handle, body: body?.handle });
    return handle;
  }

  remove(handle: ColliderHandle): void {
    const entry = this.entries.get(handle);
    if (entry === undefined) throw new Error(`collider ${String(handle)} is not in this sink`);
    const { world } = this;
    world.removeCollider(world.getCollider(entry.collider), false);
    if (entry.body !== undefined) world.removeRigidBody(world.getRigidBody(entry.body));
    this.entries.delete(handle);
  }

  /** Colliders in the Rapier world (not just in this port's table). */
  count(): number {
    return this.world.colliders.len();
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  snapshot(): PhysicsState {
    const data: RapierStateData = {
      world: encodeBase64(this.world.takeSnapshot()),
      next: this.next,
      colliders: [...this.entries].map(([handle, { collider, body }]) =>
        body === undefined ? [handle, collider] : [handle, collider, body],
      ),
    };
    return { engine: this.engine, data };
  }

  restore(state: PhysicsState): void {
    if (state.engine !== this.engine) {
      throw new PhysicsStateError(
        `physics state from ${state.engine} cannot be restored into ${this.engine}`,
      );
    }
    const data = stateData(state.data);
    // restoreSnapshot is typed as always returning a World, but gives null for bytes it cannot read.
    const world = this.rapier.World.restoreSnapshot(data.bytes) as Rapier.World | null;
    if (world === null) throw new PhysicsStateError('Rapier could not read the physics state');
    const missing = data.colliders.find(
      ([, collider, body]) =>
        !world.colliders.contains(collider) || (body !== undefined && !world.bodies.contains(body)),
    );
    if (missing !== undefined) {
      world.free();
      throw new PhysicsStateError(`physics state has no collider for handle ${String(missing[0])}`);
    }
    this.world.free();
    this.world = world;
    this.next = data.next;
    this.entries.clear();
    for (const [handle, collider, body] of data.colliders) {
      this.entries.set(handle as ColliderHandle, { collider, body });
    }
  }

  /** Releases the Rapier world's WASM memory; the port is unusable afterwards. */
  dispose(): void {
    this.world.free();
  }
}
