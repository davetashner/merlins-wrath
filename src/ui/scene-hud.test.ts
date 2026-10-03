import { describe, expect, it } from 'vitest';
import {
  DEBUG_CAMERA_HINT,
  GAMEPAD_DISCONNECTED_HINT,
  PLAYER_CONTROLS_HINT,
  playerControlsHint,
  SANDBOX_HINT,
  sceneErrorMessage,
  sceneLabel,
} from './scene-hud';

describe('scene overlay text (mw-e00.21)', () => {
  it('labels the scene with its name, id and the build SHA', () => {
    expect(sceneLabel({ id: 'testbed', name: 'Greybox testbed' }, '1a2b3c4')).toBe(
      'Greybox testbed (testbed) · build 1a2b3c4',
    );
    expect(DEBUG_CAMERA_HINT).toMatch(/^F2: fly camera/);
    expect(SANDBOX_HINT).toMatch(/^Combat sandbox: F3 frame data and hitboxes, F4 slow motion/);
  });

  it('tells the player how to take control (mw-e02.23)', () => {
    expect(PLAYER_CONTROLS_HINT).toBe(
      'Click to play: WASD move, mouse look, wheel zoom, Space jump, Shift sprint, C crouch, R dodge, Left click right-hand attack, 1 strong attack, 3 left-hand action, Right click block, Esc release',
    );
  });

  it('AC-5 (mw-e02.9): names the controller buttons once the pad was used last', () => {
    const labels = {
      move: 'Left stick',
      jump: 'A',
      sprint: 'LS',
      crouch: 'RS',
      dodge: 'B',
      attack: 'RB',
      strongAttack: 'RT',
      leftHand: 'LB',
      block: 'LT',
    };
    expect(playerControlsHint('gamepad', labels)).toBe(
      'Controller: Left stick move, right stick look, A jump, LS sprint (toggle), RS crouch (toggle), B dodge, RB right-hand attack, RT strong attack, LB left-hand action, LT block',
    );
    expect(playerControlsHint('keyboardMouse', { ...labels, move: 'ESDF' })).toMatch(
      /^Click to play: ESDF move, mouse look, wheel zoom, A jump/,
    );
    expect(GAMEPAD_DISCONNECTED_HINT).toMatch(/^Controller disconnected/);
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
