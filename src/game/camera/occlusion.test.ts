import { describe, expect, it } from 'vitest';
import { anyHiddenByBody, BODY_HALF_WIDTH, bodyHides, FADE_RANGE } from './occlusion';

const camera = { x: 0, y: 2, z: 3.5 };
const player = { x: 0, y: 1, z: 0 };

describe('player body occlusion', () => {
  it('a foe straight behind the player seen from the camera is hidden', () => {
    expect(bodyHides(camera, player, { x: 0, y: 1, z: -2 })).toBe(true);
  });

  it('a foe well to the side is not', () => {
    expect(bodyHides(camera, player, { x: 3, y: 1, z: -2 })).toBe(false);
    expect(bodyHides(camera, player, { x: BODY_HALF_WIDTH * 3, y: 1, z: -2 })).toBe(false);
  });

  it('a foe between the camera and the player is not hidden', () => {
    expect(bodyHides(camera, player, { x: 0, y: 1.5, z: 2 })).toBe(false);
  });

  it('a foe far past the player is not worth fading for', () => {
    expect(bodyHides(camera, player, { x: 0, y: 1, z: -FADE_RANGE - 1 })).toBe(false);
  });

  it('a camera inside the player hides nothing', () => {
    expect(bodyHides(player, player, { x: 0, y: 1, z: -2 })).toBe(false);
  });

  it('any of several foes hiding is enough', () => {
    const behind = { x: 0, y: 1, z: -2 };
    const aside = { x: 4, y: 1, z: -2 };
    expect(anyHiddenByBody(camera, player, [aside])).toBe(false);
    expect(anyHiddenByBody(camera, player, [aside, behind])).toBe(true);
    expect(anyHiddenByBody(camera, player, [])).toBe(false);
  });
});
