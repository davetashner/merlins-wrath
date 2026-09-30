import { describe, expect, it } from 'vitest';
import { NO_LOCK_MARKER } from '@ui/index';
import { lockMarkerModel } from './lock-marker';

const lock = { entity: 7, point: { x: 1, y: 2, z: 3 } };

describe('lock marker placement (mw-e02.16)', () => {
  it('maps the projected lock point to HUD pixels (y down)', () => {
    expect(lockMarkerModel(lock, () => ({ x: 0, y: 0, z: 0.5 }), 800, 600)).toEqual({
      target: 7,
      x: 400,
      y: 300,
    });
    expect(lockMarkerModel(lock, () => ({ x: 1, y: 1, z: 0.9 }), 800, 600)).toEqual({
      target: 7,
      x: 800,
      y: 0,
    });
  });

  it('hides with no lock, behind the camera, or past the far plane', () => {
    expect(lockMarkerModel(undefined, () => ({ x: 0, y: 0, z: 0 }), 800, 600)).toBe(NO_LOCK_MARKER);
    expect(lockMarkerModel(lock, () => ({ x: 0, y: 0, z: 1.2 }), 800, 600)).toBe(NO_LOCK_MARKER);
    expect(lockMarkerModel(lock, () => ({ x: 0, y: 0, z: Number.NaN }), 800, 600)).toBe(
      NO_LOCK_MARKER,
    );
  });
});
