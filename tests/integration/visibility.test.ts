// mw-e09.2: the shipped stealth tuning, loaded and validated like game content, drives the sim's
// visibility model; DEFAULT_VISIBILITY_TUNING (for code without content) must match it exactly.
import { loadGameContent, STEALTH_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { DEFAULT_VISIBILITY_TUNING, visibility } from '@sim/index';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();
const tuning = content.get('stealth', STEALTH_ID).visibility;
const humanoid = content.get('sense', 'humanoid').sight?.darkVision ?? Number.NaN;
const four = (level: number) => [level, level, level, level];

describe('shipped stealth tuning (mw-e09.2)', () => {
  it('the sim default mirrors the shipped table', ({ task }) => {
    markExercised(task, 'stealth', STEALTH_ID);
    expect(DEFAULT_VISIBILITY_TUNING).toEqual(tuning);
  });

  it('AC-1/AC-2: a crouched, still thief in 0.05 light at 10 m ≤ 0.1; a sprinter in 0.9 light ≥ 0.8', ({
    task,
  }) => {
    markExercised(task, 'stealth', STEALTH_ID);
    markExercised(task, 'sense', 'humanoid');
    const guard = { darkVision: humanoid, losFraction: 1, distance: 10 };
    const hidden = { ...guard, lightSamples: four(0.05), stance: 'crouched', speed: 0 } as const;
    const exposed = { ...guard, lightSamples: four(0.9), stance: 'standing', speed: 7.5 } as const;
    expect(visibility(hidden, tuning)).toBeLessThanOrEqual(0.1);
    expect(visibility(exposed, tuning)).toBeGreaterThanOrEqual(0.8);
  });
});
