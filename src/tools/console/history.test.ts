import { describe, expect, it } from 'vitest';
import { ConsoleHistory, HISTORY_KEY, HISTORY_LIMIT, type HistoryStorage } from './history';

function memoryStorage(initial?: string): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(HISTORY_KEY, initial);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('ConsoleHistory', () => {
  it('persists submitted lines and reloads them (skipping blanks and repeats)', () => {
    const storage = memoryStorage();
    const history = new ConsoleHistory(storage);
    history.add('god');
    history.add('  ');
    history.add('god');
    history.add(' spawn testprop-crate 3 ');
    expect(history.entries).toEqual(['god', 'spawn testprop-crate 3']);
    expect(new ConsoleHistory(storage).entries).toEqual(['god', 'spawn testprop-crate 3']);
  });

  it('walks back and forward like a shell', () => {
    const history = new ConsoleHistory(memoryStorage(JSON.stringify(['a', 'b', 'c'])));
    expect(history.previous()).toBe('c');
    expect(history.previous()).toBe('b');
    expect(history.previous()).toBe('a');
    expect(history.previous()).toBe('a');
    expect(history.next()).toBe('b');
    expect(history.next()).toBe('c');
    expect(history.next()).toBe('');
    expect(history.next()).toBe('');
    expect(new ConsoleHistory().previous()).toBeUndefined();
  });

  it(`keeps the newest ${String(HISTORY_LIMIT)} lines`, () => {
    const history = new ConsoleHistory(memoryStorage());
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) history.add(`line ${String(i)}`);
    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(history.entries[0]).toBe('line 5');
  });

  it('survives corrupt, foreign or failing storage', () => {
    expect(new ConsoleHistory(memoryStorage('{nope')).entries).toEqual([]);
    expect(new ConsoleHistory(memoryStorage('{"a":1}')).entries).toEqual([]);
    expect(new ConsoleHistory(memoryStorage('["ok", 3]')).entries).toEqual(['ok']);
    const failing: HistoryStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const history = new ConsoleHistory(failing);
    history.add('seed');
    expect(history.entries).toEqual(['seed']);
  });
});
