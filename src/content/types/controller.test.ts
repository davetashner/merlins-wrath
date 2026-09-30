import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  MAX_COYOTE_MS,
  MAX_JUMP_BUFFER_MS,
  PLAYER_CONTROLLER_ID,
  controllerSchema,
  controllerTuningSchema,
  type ControllerDefInput,
} from './controller.ts';

const valid = {
  id: 'test',
  name: 'Test',
  notes: 'Test profile.',
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
} satisfies ControllerDefInput;

const problems = (value: unknown) =>
  (controllerSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('controller schema', () => {
  it('accepts the mw-e02.2 starting numbers; the tuning schema is the same without id fields', () => {
    expect(controllerSchema.parse(valid)).toEqual(valid);
    const entryFields = new Set(['id', 'name', 'notes']);
    const tuning = Object.fromEntries(Object.entries(valid).filter(([k]) => !entryFields.has(k)));
    expect(controllerTuningSchema.parse(tuning)).toEqual(tuning);
  });

  it('caps coyote time at 120 ms and the jump buffer at 150 ms, in whole ms', () => {
    expect(MAX_COYOTE_MS).toBe(120);
    expect(MAX_JUMP_BUFFER_MS).toBe(150);
    expect(problems({ ...valid, coyoteMs: 121, jumpBufferMs: 150.5 })).toEqual([
      'coyoteMs: Too big: expected number to be <=120',
      'jumpBufferMs: Invalid input: expected int, received number',
    ]);
  });

  it('rejects out-of-range values with the field path', () => {
    expect(problems({ ...valid, gravity: -9.8, slopeLimit: 90, airControl: 1.5 })).toEqual([
      'airControl: Too big: expected number to be <=1',
      'gravity: Too small: expected number to be >0',
      'slopeLimit: Too big: expected number to be <90',
    ]);
  });

  it('rejects inconsistent capsule, speeds and step height, naming each field', () => {
    expect(
      problems({
        ...valid,
        capsule: { radius: 0.5, height: 0.9, crouchHeight: 0.95 },
        speeds: { run: 5, sprint: 4, crouch: 6 },
        stepHeight: 0.95,
      }),
    ).toEqual([
      'capsule.height: capsule.height (0.9 m) must be at least 2 × radius',
      'capsule.crouchHeight: capsule.crouchHeight (0.95 m) must be between 2 × radius and height',
      'speeds.sprint: speeds.sprint must not be lower than speeds.run',
      'speeds.crouch: speeds.crouch must not be higher than speeds.run',
      'stepHeight: stepHeight must be lower than capsule.crouchHeight',
    ]);
    expect(
      problems({ ...valid, capsule: { radius: 0.35, height: 1.8, crouchHeight: 0.5 } }),
    ).toEqual([
      'capsule.crouchHeight: capsule.crouchHeight (0.5 m) must be between 2 × radius and height',
    ]);
  });

  it('mw-e02.6: takes optional gait thresholds, landing and footstep spacing; run above walk', () => {
    const gait = {
      walkFrom: 0.2,
      runFrom: 2.5,
      landingMs: 150,
      hardLanding: 6,
      footstep: { walk: 0.7, run: 1, sprint: 1.25, crouch: 0.5 },
    };
    expect(controllerSchema.parse({ ...valid, gait }).gait).toEqual(gait);
    expect(problems({ ...valid, gait: { ...gait, runFrom: 0.2 } })).toEqual([
      'gait.runFrom: gait.runFrom must be higher than gait.walkFrom',
    ]);
    expect(problems({ ...valid, gait: { ...gait, landingMs: 1.5 } })).toEqual([
      'gait.landingMs: Invalid input: expected int, received number',
    ]);
  });
});

describeContent(
  'controller',
  'AC-1: is valid and round-trips; the player profile exists',
  (entry, content) => {
    expect(controllerSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
    expect(content.has('controller', PLAYER_CONTROLLER_ID)).toBe(true);
  },
);
