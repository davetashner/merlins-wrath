// mw-e04.2 AC-6: the greybox testbed with the hit-volume overlay enabled. A training dummy swings
// (its move from content, driven by a socket track) at a target while the game's own loop runs on a
// 144 Hz display; on every rendered frame the overlay's wireframes are exactly the shapes the sim
// tested on its latest tick (equal hashes), and each wireframe sits where its shape is.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { compileMove, loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { createGameLoop, FakeFrames } from '@game/loop/index';
import { createHitVolumeOverlay } from '@render/debug/hit-volumes';
import {
  DAMAGE_COMPONENTS,
  debugShapes,
  giveHitboxes,
  giveHurtboxes,
  hashShapes,
  HIT_VOLUME_COMPONENTS,
  hitboxFromMove,
  HitboxHit,
  hitVolumeDebug,
  hitVolumeSystem,
  noAllies,
  openHitbox,
  PlacementComponent,
  placeEntity,
  simMath,
  type GeomShape,
  type HitboxHitInfo,
  type Pose,
  type SocketTrack,
} from '@sim/index';
import { createTestbedWorld } from '@tools/replay/testbed-player-scenario';
import type { Mesh } from 'three';

const DUMMY_MOVE = 'training-dummy-swing';

/** A 100° horizontal arc over the move's active ticks (key 0 before the first). */
function arcTrack(active: number): SocketTrack {
  const total = (100 * Math.PI) / 180;
  const keys: Pose[] = [];
  for (let k = 0; k <= active; k++) {
    const angle = -total / 2 + (k * total) / active;
    keys.push({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: simMath.sin(angle / 2), z: 0, w: simMath.cos(angle / 2) },
    });
  }
  return { id: 'dummy-swing-arc', keys };
}

/** Where a drawn wireframe's transform puts the shape's centre. */
function centreOf(shape: GeomShape) {
  switch (shape.kind) {
    case 'sphere':
    case 'box':
      return shape.center;
    case 'capsule':
      return {
        x: (shape.from.x + shape.to.x) / 2,
        y: (shape.from.y + shape.to.y) / 2,
        z: (shape.from.z + shape.to.z) / 2,
      };
  }
}

describe('hit-volume overlay (mw-e04.2)', () => {
  it('AC-6: with the overlay enabled, drawn shapes hash-match the sim shapes on every rendered frame of a swing', ({
    task,
  }) => {
    const content = loadGameContent();
    markExercised(task, 'move', DUMMY_MOVE);
    const move = compileMove(content.get('move', DUMMY_MOVE));

    const world = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
    world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS, PlacementComponent);
    world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
    const hits: HitboxHitInfo[] = [];
    world.events.on(HitboxHit, (hit) => hits.push(hit));

    const dummy = world.spawn();
    placeEntity(world, dummy, { x: 0, y: 0, z: 4 }, 0.5);
    giveHitboxes(world, dummy);
    const target = world.spawn();
    placeEntity(world, target, { x: 0, y: 0, z: 5.2 }, 1);
    giveHurtboxes(world, target, {
      boxes: [
        {
          id: 'torso',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: {
            kind: 'capsule',
            from: { x: 0, y: 0.5, z: 0 },
            to: { x: 0, y: 1.3, z: 0 },
            radius: 0.35,
          },
        },
        {
          id: 'head',
          socket: 'root',
          region: 'head',
          armored: false,
          multiplier: 1.5,
          shape: { kind: 'sphere', center: { x: 0, y: 1.65, z: 0 }, radius: 0.2 },
        },
        {
          id: 'pauldron',
          socket: 'root',
          region: 'limb',
          armored: true,
          multiplier: 0.8,
          shape: {
            kind: 'box',
            center: { x: 0.3, y: 1.35, z: 0 },
            halfExtents: { x: 0.1, y: 0.1, z: 0.12 },
          },
        },
      ],
      facing: { x: 0, y: 0, z: -1 },
    });

    const overlay = createHitVolumeOverlay();
    overlay.enabled = true;
    const frames = new FakeFrames(1000);
    const end = world.tick + move.active + 3;
    let opened = false;
    const drawn: { tick: number; sim: string; overlay: string; hitboxes: number }[] = [];
    const { loop } = createGameLoop({
      world,
      sources: { now: frames.now, scheduler: frames, visibility: frames },
      warn: () => undefined,
      draw: () => {
        if (!opened) {
          // The swing's first active tick is the next one.
          openHitbox(
            world,
            dummy,
            hitboxFromMove(move, arcTrack(move.active), { x: 0, y: 0, z: 1 }),
          );
          opened = true;
        }
        overlay.sync(world);
        const debug = hitVolumeDebug(world);
        const shapes = overlay.drawnShapes();
        drawn.push({
          tick: world.tick,
          sim: hashShapes(debugShapes(debug)),
          overlay: hashShapes(shapes),
          hitboxes: debug.hitboxes.length,
        });
        for (const [i, child] of overlay.object.children.entries()) {
          const shape = shapes[i];
          if (shape === undefined) throw new Error('missing shape');
          const c = centreOf(shape);
          const { position } = child as Mesh;
          expect([position.x, position.y, position.z]).toEqual([c.x, c.y, c.z]);
        }
        if (world.tick >= end) loop.stop();
      },
    });
    loop.start();
    while (loop.running) frames.frame(1000 / 144);

    // More frames than ticks (144 Hz display): every one of them matched.
    expect(drawn.length).toBeGreaterThan(2 * move.active);
    for (const frame of drawn) expect(frame.overlay).toBe(frame.sim);
    // The swing was on screen for its whole active window, then gone.
    const swingTicks = new Set(drawn.filter((f) => f.hitboxes > 0).map((f) => f.tick));
    expect(swingTicks.size).toBe(move.active);
    expect(drawn.at(-1)?.hitboxes).toBe(0);
    // And it struck the target once.
    expect(hits.map((h) => h.target)).toEqual([target]);

    overlay.enabled = false;
    expect(overlay.drawnShapes()).toEqual([]);
    overlay.sync(world);
    expect(overlay.drawnShapes()).toEqual([]);
    overlay.dispose();
  });
});
