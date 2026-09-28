import { describe, expect, it } from 'vitest';
import { ComponentStore, defineComponent } from './component';

interface Position {
  x: number;
  y: number;
}

describe('defineComponent', () => {
  it('rejects an empty name', () => {
    expect(() => defineComponent('')).toThrow(RangeError);
  });

  it('defaults to structuredClone hooks, so snapshot data never aliases live values', () => {
    const Position = defineComponent<Position>('Position');
    const live = { x: 1, y: 2 };
    const data = Position.serialize(live);
    live.x = 99;
    expect(data).toEqual({ x: 1, y: 2 });
    const back = Position.deserialize(data);
    expect(back).toEqual({ x: 1, y: 2 });
    expect(back).not.toBe(data);
  });

  it('uses supplied snapshot hooks', () => {
    const Tag = defineComponent<Set<string>>('Tags', {
      serialize: (tags) => [...tags].sort(),
      deserialize: (data) => new Set(data as string[]),
    });
    expect(Tag.serialize(new Set(['b', 'a']))).toEqual(['a', 'b']);
    expect(Tag.deserialize(['a'])).toEqual(new Set(['a']));
  });
});

describe('ComponentStore', () => {
  const make = () => new ComponentStore(defineComponent<number>('N'));

  it('inserts, replaces and reads values by entity id', () => {
    const store = make();
    expect(store.put(1, 10)).toBe(true);
    expect(store.put(1, 11)).toBe(false);
    expect(store.has(1)).toBe(true);
    expect(store.get(1)).toBe(11);
    expect(store.slot(1)).toBe(0);
    expect(store.has(2)).toBe(false);
    expect(store.get(2)).toBeUndefined();
    expect(store.slot(2)).toBeUndefined();
    expect(store.size).toBe(1);
  });

  it('swap-removes, reporting whether anything was removed', () => {
    const store = make();
    for (const id of [1, 2, 3]) store.put(id, id * 10);
    expect(store.delete(9)).toBe(false);
    expect(store.delete(3)).toBe(true); // last slot: nothing moves
    expect(store.ids).toEqual([1, 2]);
    expect(store.delete(1)).toBe(true); // moves the last entry into slot 0
    expect(store.ids).toEqual([2]);
    expect(store.values).toEqual([20]);
    expect(store.get(2)).toBe(20);
  });

  it('restores ascending id order after out-of-order inserts and swap-removes', () => {
    const store = make();
    for (const id of [5, 3, 8, 1]) store.put(id, id);
    store.sort();
    expect(store.ids).toEqual([1, 3, 5, 8]);
    expect(store.values).toEqual([1, 3, 5, 8]);
    store.delete(1);
    expect(store.ids).toEqual([8, 3, 5]);
    store.sort();
    expect(store.ids).toEqual([3, 5, 8]);
    expect(store.get(8)).toBe(8);
    store.sort(); // already sorted: no-op
    expect(store.ids).toEqual([3, 5, 8]);
  });

  it('clears everything', () => {
    const store = make();
    store.put(2, 2);
    store.put(1, 1);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.has(1)).toBe(false);
    store.put(4, 4);
    expect(store.ids).toEqual([4]);
  });
});
