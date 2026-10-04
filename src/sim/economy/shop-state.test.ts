import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { merchantStoreOf, type MerchantState } from './shop-state';

const state = (gold: number): MerchantState => ({
  gold,
  nextId: 3,
  stock: [{ id: 1, defId: 'sword', count: 2, flags: { stolen: true }, entry: 0 }],
  buyback: [{ id: 2, defId: 'apple', count: 1, flags: {}, unitPrice: 2 }],
});

describe('merchant state store (mw-e20.4)', () => {
  it('is one store per world, captured in merchant id order, and restore replaces everything', () => {
    const world = new World({ seed: 1 });
    const store = merchantStoreOf(world);
    expect(merchantStoreOf(world)).toBe(store);
    expect(merchantStoreOf(new World({ seed: 1 }))).not.toBe(store);
    expect(store.get('b')).toBeUndefined();
    store.set('b', state(5));
    store.set('a', state(9));
    expect(Object.keys(store.capture())).toEqual(['a', 'b']);
    store.restore({ c: state(1) });
    expect(store.get('a')).toBeUndefined();
    expect(store.capture()).toEqual({ c: state(1) });
  });
});
