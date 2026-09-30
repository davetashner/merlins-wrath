import { describe, expect, it } from 'vitest';
import { CommandQueue } from './command-queue';

describe('CommandQueue', () => {
  it('hands queued commands to the next sampled step only, after the sampled ones', () => {
    const queue = new CommandQueue<string>();
    const sample = queue.sampler((tick) => [`frame${String(tick)}`]);
    expect(sample(0)).toEqual(['frame0']);
    queue.push('spawn');
    queue.push('god');
    expect(queue.size).toBe(2);
    expect(sample(1)).toEqual(['frame1', 'spawn', 'god']);
    expect(queue.size).toBe(0);
    expect(sample(2)).toEqual(['frame2']);
  });

  it('drain empties the queue', () => {
    const queue = new CommandQueue<number>();
    queue.push(1);
    expect(queue.drain()).toEqual([1]);
    expect(queue.drain()).toEqual([]);
  });
});
