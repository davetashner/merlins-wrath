import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { registerWorldProperties } from '../properties/components';
import { DEFAULT_STIMULUS_LOG_CAPACITY, recordStimulusLog } from './log';
import { applyStimulus, installStimuli, resolveStimuli } from './stimulus';

const world = () => installStimuli(registerWorldProperties(new World<string>({ seed: 1 })));

function light(w: World<string>, intensity: number): void {
  applyStimulus(w, {
    shape: { kind: 'point', at: { x: 0, y: 0, z: 0 } },
    element: 'light',
    intensity,
  });
}

describe('stimulus log', () => {
  it('keeps the latest resolutions up to its capacity, oldest first', () => {
    const w = world();
    const log = recordStimulusLog(w, 2);
    for (const intensity of [1, 2, 3]) light(w, intensity);
    resolveStimuli(w);
    w.events.flush();
    expect(log.entries.map((entry) => entry.amount)).toEqual([2, 3]);
  });

  it('stops recording, keeping what it has', () => {
    const w = world();
    const log = recordStimulusLog(w);
    light(w, 1);
    resolveStimuli(w);
    w.events.flush();
    log.stop();
    light(w, 2);
    resolveStimuli(w);
    w.events.flush();
    expect(log.entries.map((entry) => entry.amount)).toEqual([1]);
    expect(DEFAULT_STIMULUS_LOG_CAPACITY).toBe(256);
  });

  it('rejects a capacity that is not a positive integer', () => {
    expect(() => recordStimulusLog(world(), 0)).toThrow(RangeError);
    expect(() => recordStimulusLog(world(), 1.5)).toThrow(RangeError);
  });
});
