import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  PLAYER_LOCK_ON_ID,
  lockOnSchema,
  lockOnTuningSchema,
  type LockOnDefInput,
} from './lock-on.ts';

const valid = {
  id: 'test',
  name: 'Test',
  notes: 'Test profile.',
  selectRange: 20,
  coneAngle: 60,
  breakRange: 25,
  lostSightMs: 1000,
  switchRange: 10,
  eyeHeight: 1.5,
  minVisibility: 0.5,
  distanceWeight: 0.5,
  priorityWeight: 0.25,
  turnRate: 720,
  flick: { stickThreshold: 0.7, stickRest: 0.3, mouseCounts: 40, mouseRest: 5 },
  framing: { time: 0.2, targetWeight: 0.5, pitchOffset: -10 },
} satisfies LockOnDefInput;

const problems = (value: unknown) =>
  (lockOnSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('lock-on schema (mw-e02.16)', () => {
  it('accepts the bead’s starting numbers; the tuning schema is the same without id fields', () => {
    expect(lockOnSchema.parse(valid)).toEqual(valid);
    const entryFields = new Set(['id', 'name', 'notes']);
    const tuning = Object.fromEntries(Object.entries(valid).filter(([k]) => !entryFields.has(k)));
    expect(lockOnTuningSchema.parse(tuning)).toEqual(tuning);
  });

  it('rejects out-of-range values with the field path', () => {
    expect(
      problems({
        ...valid,
        coneAngle: 0,
        lostSightMs: 1.5,
        framing: { ...valid.framing, targetWeight: 2 },
      }),
    ).toEqual([
      'coneAngle: Too small: expected number to be >0',
      'lostSightMs: Invalid input: expected int, received number',
      'framing.targetWeight: Too big: expected number to be <=1',
    ]);
  });

  it('rejects a break range inside the pick range and flicks that re-arm above their threshold', () => {
    expect(
      problems({
        ...valid,
        breakRange: 15,
        flick: { stickThreshold: 0.5, stickRest: 0.5, mouseCounts: 10, mouseRest: 10 },
      }),
    ).toEqual([
      'breakRange: breakRange must not be lower than selectRange',
      'flick.stickRest: flick.stickRest must be below flick.stickThreshold',
      'flick.mouseRest: flick.mouseRest must be below flick.mouseCounts',
    ]);
  });
});

describeContent(
  'lock-on',
  'is valid and round-trips; the player profile uses the bead’s ranges and grace',
  (entry, content) => {
    expect(lockOnSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
    const player = content.get('lock-on', PLAYER_LOCK_ON_ID);
    expect(player.selectRange).toBe(20);
    expect(player.coneAngle).toBe(60);
    expect(player.breakRange).toBe(25);
    expect(player.lostSightMs).toBe(1000);
    expect(player.switchRange).toBe(10);
  },
);
