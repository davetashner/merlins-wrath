// Noclip free flight (mw-e33.1): the debug console's `noclip` cheat. While it is on, the character
// ignores collision and gravity and flies where the move stick points (relative to the camera yaw),
// rising while Jump is held and sinking while Crouch is held, at sprint speed (doubled while Sprint
// is held). It is still a pure step on the controller state, so replays reproduce a flight exactly.

import type { ControllerTuning, Frozen } from '@content/index';
import { cos, sin } from '../math';
import type { CharacterInput, CharacterState, ControllerParams } from './controller';
import { add, length, scale, UP, vec, ZERO } from './vec';

/** Speed multiplier while Sprint is held during noclip. */
export const NOCLIP_BOOST = 2;

/** One tick of noclip flight (see the file header). Pure. */
export function stepNoclip(
  state: CharacterState,
  input: CharacterInput,
  tuning: Frozen<ControllerTuning>,
  params: Pick<ControllerParams, 'dt'>,
): CharacterState {
  const { actions } = input;
  const yawSin = sin(input.cameraYaw);
  const yawCos = cos(input.cameraYaw);
  const right = vec(yawCos, 0, -yawSin);
  const forward = vec(-yawSin, 0, -yawCos);
  const rise = (actions.jump.held ? 1 : 0) - (actions.crouch.held ? 1 : 0);
  let direction = add(
    add(scale(right, actions.move.x), scale(forward, actions.move.y)),
    vec(0, rise, 0),
  );
  const size = length(direction);
  if (size > 1) direction = scale(direction, 1 / size);
  const speed = tuning.speeds.sprint * (actions.sprint.held ? NOCLIP_BOOST : 1);
  return {
    ...state,
    position: add(state.position, scale(direction, speed * params.dt)),
    // At rest between ticks: switching noclip off drops the character from where it hovers.
    velocity: ZERO,
    grounded: false,
    groundNormal: UP,
    groundBody: null,
    crouched: false,
    sprinting: false,
    airTicks: 0,
    jumped: false,
    jumpAge: -1,
    traversal: null,
  };
}
