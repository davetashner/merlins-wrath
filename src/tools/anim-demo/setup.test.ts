import { compileMoves, loadGameContent } from '@content/index';
import { RenderSync } from '@game/loop/render-sync';
import {
  ACTION_TIMELINE_COMPONENTS,
  actionTimelineSystem,
  StaminaComponent,
  World,
} from '@sim/index';
import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { compactProbe, playerAnimationProbe, setupAnimationDemo, TESTBED_ANIM_DEMO } from './setup';

/** Steps `world` and the demo for `ticks` ticks; returns each rig's state history. */
function run(
  world: World,
  sync: RenderSync,
  demo: ReturnType<typeof setupAnimationDemo>,
  ticks: number,
) {
  for (let i = 0; i < ticks; i++) {
    world.step();
    sync.capture();
    demo.driver.capture();
    sync.render(0.5);
    demo.driver.frame(0.5, 1 / 60, { x: 0, y: 0, z: 0 });
  }
  return compactProbe(demo.driver.probe());
}

const headless = (
  object: Object3D,
  read: Parameters<Parameters<typeof setupAnimationDemo>[0]['binding']>[1],
) => ({
  object,
  read,
  apply: () => undefined,
  dispose: () => undefined,
});

describe('setupAnimationDemo', () => {
  it('mw-e04.8: shares an action timeline the world already runs (the player’s combat)', () => {
    const world = new World({ seed: 1 }).register(...ACTION_TIMELINE_COMPONENTS, StaminaComponent);
    const content = loadGameContent();
    world.addSystem(actionTimelineSystem({ moves: compileMoves(content.all('move')) }));
    const sync = new RenderSync(world);
    const demo = setupAnimationDemo({
      world,
      sync,
      content,
      binding: headless,
      sharedTimeline: true,
    });
    const probe = run(world, sync, demo, 320);
    for (const rig of ['greybox-humanoid', 'greybox-beast']) {
      expect(probe[rig]?.history).toEqual(expect.arrayContaining(['attack', 'hit-react']));
    }
  });

  it('AC-6: the humanoid and the non-humanoid rig each enter idle → move → attack → hit-react via sim state', () => {
    const world = new World({ seed: 1 });
    const sync = new RenderSync(world);
    const bound: Object3D[] = [];
    const demo = setupAnimationDemo({
      world,
      sync,
      content: loadGameContent(),
      binding: (object, read) => {
        bound.push(object);
        return {
          object,
          read,
          apply: (o, t) => o.position.set(t.position.x, t.position.y, t.position.z),
          dispose: () => undefined,
        };
      },
    });
    expect(demo.entities).toHaveLength(2);
    expect(bound.map((o) => o.name)).toEqual(TESTBED_ANIM_DEMO.map((c) => c.rig));
    for (let i = 0; i < 320; i++) {
      world.step();
      sync.capture();
      demo.driver.capture();
      sync.render(0.5);
      demo.driver.frame(0.5, 1 / 60, { x: 0, y: 0, z: 0 });
    }
    const probe = compactProbe(demo.driver.probe());
    for (const rig of ['greybox-humanoid', 'greybox-beast']) {
      const history = probe[rig]?.history ?? [];
      const order = ['idle', 'move', 'attack', 'hit-react'].map((state, i, all) =>
        history.indexOf(state, i === 0 ? 0 : history.indexOf(all[i - 1] ?? '')),
      );
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
    expect(Object.keys(probe['greybox-beast']?.layers ?? {})).toEqual(['base', 'action', 'hit']);
    // Each rig is a hierarchy of grey-box bones under the entity's object.
    expect(bound[0]?.getObjectByName('sword')?.parent?.name).toBe('forearm-r');
    expect(bound[1]?.getObjectByName('jaw')?.parent?.name).toBe('head');
  });
});

describe('playerAnimationProbe', () => {
  it('publishes each layer’s state and clip with both histories', () => {
    expect(
      playerAnimationProbe({
        rig: 'greybox-humanoid',
        layers: [
          { id: 'base', state: 'move', weights: { move: 1 }, clip: 'anim-humanoid-run' },
          { id: 'action', state: 'none', weights: { none: 1 }, clip: null },
        ],
        history: ['idle', 'move'],
        clipHistory: ['anim-humanoid-idle', 'anim-humanoid-run'],
      }),
    ).toEqual({
      layers: { base: 'move', action: 'none' },
      clips: { base: 'anim-humanoid-run', action: null },
      history: ['idle', 'move'],
      clipHistory: ['anim-humanoid-idle', 'anim-humanoid-run'],
    });
  });
});
