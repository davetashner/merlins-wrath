// The water HUD's game glue (mw-e02.14): what the breath meter shows and which sim events make the
// HUD speak. The widget (src/ui/water-hud.ts) holds no rules and reads no sim state; this file reads
// the player's breath once per drawn frame, and turns the Sinking event (armor dragging the player
// down) into the notice "Your armour drags you under." on the next frame it draws.

import type { ControllerTuning, Frozen } from '@content/index';
import {
  breathFraction,
  CharacterBreath,
  characterTuning,
  DEFAULT_WATER_TUNING,
  Sinking,
  type EntityId,
  type World,
} from '@sim/index';
import { WATER_HUD_TEXT, type WaterHud, type WaterHudModel } from '@ui/index';

/** The meter's model for `player`, or null while it has no breath (no water in the scene). */
export function waterHudModel(
  world: World<never>,
  player: EntityId,
  tuning: Frozen<ControllerTuning>,
): WaterHudModel | null {
  if (!world.isRegistered(CharacterBreath)) return null;
  const breath = world.get(player, CharacterBreath);
  if (breath === undefined) return null;
  const water = characterTuning(world, player, tuning).water ?? DEFAULT_WATER_TUNING;
  return { breath: breathFraction(breath, water, world.clock.hz) };
}

export interface WaterHudGlueOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly hud: WaterHud;
  /** The player's controller tuning (the breath's length). */
  readonly tuning: Frozen<ControllerTuning>;
}

export interface WaterHudGlue {
  /** Call once per drawn frame, after the sim stepped, with the frame's time. */
  frame(nowMs: number): void;
  /** Stops listening to the sim. */
  dispose(): void;
}

/** Wires `hud` to the player's breath and the sinking warning (see the file header). */
export function attachWaterHud(options: WaterHudGlueOptions): WaterHudGlue {
  const { world, player, hud, tuning } = options;
  let sinking = false;
  const off = world.events.on(Sinking, (event) => {
    if (event.entity === player) sinking = true;
  });
  return {
    frame(nowMs) {
      const model = waterHudModel(world, player, tuning);
      if (model === null) return;
      if (sinking) {
        sinking = false;
        hud.announce(WATER_HUD_TEXT.sinking, nowMs);
      }
      hud.update(model, nowMs);
    },
    dispose: off,
  };
}
