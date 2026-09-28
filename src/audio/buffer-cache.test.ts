import { describe, expect, it, vi } from 'vitest';
import { BufferCache, decodedBytes, type LoadedSound } from './buffer-cache.ts';
import { FakeBuffer } from './fake-context.ts';

/** A loader whose sounds are `samples` long mono buffers (4 bytes per sample). */
function loader(sizes: Record<string, number>) {
  return vi.fn((id: string): Promise<LoadedSound> => {
    const samples = sizes[id];
    return samples === undefined
      ? Promise.reject(new Error(`missing ${id}`))
      : Promise.resolve({ buffer: new FakeBuffer(1, samples, 48_000) });
  });
}

describe('BufferCache', () => {
  it('counts decoded bytes as float32 × channels', () => {
    expect(decodedBytes(new FakeBuffer(2, 48_000, 48_000))).toBe(384_000);
  });

  it('shares one load between concurrent requests and serves later ones from memory', async () => {
    const load = loader({ a: 10 });
    const cache = new BufferCache(1000, load);
    expect(cache.status('a')).toBe('absent');
    const [first, second] = [cache.request('a'), cache.request('a')];
    expect(cache.status('a')).toBe('loading');
    expect(await first).toBe(await second);
    expect(cache.status('a')).toBe('ready');
    await cache.request('a');
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.bytes).toBe(40);
  });

  it('evicts least-recently-used sounds past the byte cap', async () => {
    const cache = new BufferCache(100, loader({ a: 10, b: 10, c: 10 })); // 40 bytes each
    await cache.request('a');
    await cache.request('b');
    cache.get('a'); // a is now more recent than b
    await cache.request('c');
    expect(cache.status('b')).toBe('absent');
    expect(cache.status('a')).toBe('ready');
    expect(cache.status('c')).toBe('ready');
    expect(cache.bytes).toBe(80);
    expect(cache.get('b')).toBeUndefined();
  });

  it('returns but does not keep a sound larger than the whole cap', async () => {
    const cache = new BufferCache(100, loader({ small: 10, huge: 1000 }));
    await cache.request('small');
    const huge = await cache.request('huge');
    expect(huge.buffer.length).toBe(1000);
    expect(cache.status('huge')).toBe('absent');
    expect(cache.status('small')).toBe('ready');
  });

  it('marks a failed load and does not retry it', async () => {
    const load = loader({});
    const cache = new BufferCache(100, load);
    await expect(cache.request('x')).rejects.toThrow('missing x');
    expect(cache.status('x')).toBe('failed');
    await expect(cache.request('x')).rejects.toThrow('"x" failed to load');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
