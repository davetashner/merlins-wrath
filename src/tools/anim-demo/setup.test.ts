import { loadGameContent } from '@content/index';
import { RenderSync } from '@game/loop/render-sync';
import { World } from '@sim/index';
import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { compactProbe, setupAnimationDemo, TESTBED_ANIM_DEMO } from './setup';

describe('setupAnimationDemo', () => {
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
