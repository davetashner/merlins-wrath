import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { interacted } from '../interaction/system';
import { installShopCounters, shopOpenRequested, type ShopOpenRequest } from './counter';

describe('shop counters (mw-ju8.9)', () => {
  const setup = () => {
    const world = new World({ seed: 1 });
    const player = world.spawn();
    const counter = world.spawn();
    const crate = world.spawn();
    const requests: ShopOpenRequest[] = [];
    world.events.on(shopOpenRequested, (request) => requests.push(request));
    const off = installShopCounters(world, [
      { entity: counter, spawn: { merchant: 'marsh-general-store' } },
      { entity: crate, spawn: {} },
    ]);
    const use = (target: number) => {
      world.events.emit(interacted, { actor: player, target, verb: 'use', affordance: 0 });
      world.events.flush();
    };
    return { world, player, counter, crate, requests, off, use };
  };

  it('AC-2: using a counter requests that merchant’s shop, naming who used it', () => {
    const { player, counter, requests, use } = setup();
    use(counter);
    expect(requests).toEqual([
      { tick: 0, actor: player, entity: counter, merchant: 'marsh-general-store' },
    ]);
  });

  it('AC-2: using anything that is not a counter requests nothing', () => {
    const { crate, requests, use } = setup();
    use(crate);
    expect(requests).toEqual([]);
  });

  it('stops listening when removed', () => {
    const { counter, requests, off, use } = setup();
    off();
    use(counter);
    expect(requests).toEqual([]);
  });

  it('installs nothing for a scene without counters', () => {
    const world = new World({ seed: 1 });
    const requests: ShopOpenRequest[] = [];
    world.events.on(shopOpenRequested, (request) => requests.push(request));
    const off = installShopCounters(world, [{ entity: world.spawn(), spawn: {} }]);
    world.events.emit(interacted, { actor: 1, target: 2, verb: 'use', affordance: 0 });
    world.events.flush();
    off();
    expect(requests).toEqual([]);
  });
});
