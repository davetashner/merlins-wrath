import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  PLAYER_CAMERA_ID,
  cameraSchema,
  cameraTuningSchema,
  type CameraDefInput,
} from './camera.ts';

const valid = {
  id: 'test',
  name: 'Test',
  notes: 'Test rig.',
  fov: 70,
  near: 0.1,
  pivotHeight: 1.5,
  shoulder: 0.5,
  distance: { min: 2, max: 6, initial: 3.5, step: 0.5 },
  pitch: { min: -70, max: 60, initial: -15 },
  mouseSensitivity: 0.003,
  stick: { deadzone: 0.15, exponent: 2, yawRate: 240, pitchRate: 160 },
  invertY: false,
  collisionRadius: 0.26,
  recoveryTime: 0.3,
} satisfies CameraDefInput;

const problems = (value: unknown) =>
  (cameraSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('camera schema (mw-e02.4)', () => {
  it('accepts the mw-e02.4 starting numbers; the tuning schema is the same without id fields', () => {
    expect(cameraSchema.parse(valid)).toEqual(valid);
    const entryFields = new Set(['id', 'name', 'notes']);
    const tuning = Object.fromEntries(Object.entries(valid).filter(([k]) => !entryFields.has(k)));
    expect(cameraTuningSchema.parse(tuning)).toEqual(tuning);
  });

  it('rejects out-of-range values with the field path', () => {
    expect(
      problems({
        ...valid,
        fov: 20,
        pitch: { min: 10, max: 60, initial: 0 },
        recoveryTime: 0,
      }),
    ).toEqual([
      'fov: Too small: expected number to be >=30',
      'pitch.min: Too big: expected number to be <=0',
      'recoveryTime: Too small: expected number to be >0',
    ]);
  });

  it('rejects inconsistent zoom, pitch and collision radius, naming each field', () => {
    expect(
      problems({
        ...valid,
        distance: { min: 4, max: 3, initial: 3.5, step: 0.5 },
        pitch: { min: -70, max: 60, initial: 61 },
        collisionRadius: 0.05,
      }),
    ).toEqual([
      'distance.max: distance.max must not be lower than distance.min',
      'pitch.initial: pitch.initial must be between pitch.min and pitch.max',
      'collisionRadius: collisionRadius must be at least near',
    ]);
    expect(problems({ ...valid, distance: { min: 2, max: 6, initial: 7, step: 0.5 } })).toEqual([
      'distance.initial: distance.initial must be between distance.min and max',
    ]);
    expect(problems({ ...valid, pitch: { min: -70, max: 60, initial: -71 } })).toEqual([
      'pitch.initial: pitch.initial must be between pitch.min and pitch.max',
    ]);
  });
});

describeContent(
  'camera',
  'AC-1: is valid and round-trips; the player rig clamps pitch to −70°..+60°',
  (entry, content) => {
    expect(cameraSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
    const player = content.get('camera', PLAYER_CAMERA_ID);
    expect(player.pitch.min).toBe(-70);
    expect(player.pitch.max).toBe(60);
    expect(player.distance.min).toBe(2);
    expect(player.distance.max).toBe(6);
  },
);
