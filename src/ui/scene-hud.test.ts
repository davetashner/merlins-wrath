import { describe, expect, it } from 'vitest';
import { DEBUG_CAMERA_HINT, sceneErrorMessage, sceneLabel } from './scene-hud';

describe('scene overlay text (mw-e00.21)', () => {
  it('labels the scene with its name, id and the build SHA', () => {
    expect(sceneLabel({ id: 'testbed', name: 'Greybox testbed' }, '1a2b3c4')).toBe(
      'Greybox testbed (testbed) · build 1a2b3c4',
    );
    expect(DEBUG_CAMERA_HINT).toMatch(/^F2: fly camera/);
  });

  it('AC-4: the unknown-scene error names the request and links every available scene', () => {
    expect(sceneErrorMessage('does-not-exist', ['kit-gallery', 'testbed'])).toEqual({
      heading: 'No scene called "does-not-exist"',
      body: 'Pick one of the available scenes:',
      scenes: [
        { id: 'kit-gallery', href: '?scene=kit-gallery' },
        { id: 'testbed', href: '?scene=testbed' },
      ],
    });
    expect(sceneErrorMessage('x', []).body).toBe('There are no scenes in this build.');
  });
});
