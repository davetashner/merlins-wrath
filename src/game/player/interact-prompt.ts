// The Interact prompt's view model (mw-e02.5): the sim's prompt for the player's focus (text,
// availability, reason, hold progress) plus the glyph of the Interact binding on the device last
// used. The HUD widget (src/ui InteractPrompt) only shows it.
import type { InteractionPrompt } from '@sim/index';
import type { InteractPromptModel } from '@ui/index';

/** The prompt to show, or null with nothing in focus. */
export function interactPromptModel(
  prompt: InteractionPrompt | undefined,
  glyph: string,
): InteractPromptModel | null {
  if (prompt === undefined) return null;
  return {
    glyph,
    label: prompt.label,
    available: prompt.available,
    reason: prompt.reason,
    hold: prompt.hold > 0,
    progress: prompt.progress,
  };
}
