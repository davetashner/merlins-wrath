// The replay-file schema of an ActionFrame command (mw-e02.23), shared by every scenario whose
// commands are the player's ActionFrames (the testbed player, the action timeline golden).

import { z } from 'zod';
import { ACTION_FRAME_COMMAND, BUTTON_ACTIONS, type ActionFrame } from '@sim/index';

const button = z.strictObject({ pressed: z.boolean(), held: z.boolean(), released: z.boolean() });
const vector = z.strictObject({ x: z.number(), y: z.number() });

/** One tick's ActionFrame, as stored in replay files. */
export const actionFrameCommand = z.strictObject({
  kind: z.literal(ACTION_FRAME_COMMAND),
  move: vector,
  look: vector,
  lookStick: vector,
  ...Object.fromEntries(BUTTON_ACTIONS.map((action) => [action, button])),
}) as unknown as z.ZodType<ActionFrame>;
