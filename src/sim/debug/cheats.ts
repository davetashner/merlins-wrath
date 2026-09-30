// Cheat state (mw-e33.1): which cheats an entity has on, as a snapshotted component so saves, state
// hashes and replays see it like any other state. Rules that honour a cheat read it through
// `hasCheat`, which is false in worlds that never installed the debug commands (the component is
// not registered there), so the rules cost nothing and hash identically without them.

import type { ComponentType, EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { DamageModifier } from '../combat/damage/model';
import type { DebugCheat } from './commands';

/** The cheats an entity has on. */
export type DebugCheats = Readonly<Record<DebugCheat, boolean>>;

export const DebugCheatsComponent = defineComponent<DebugCheats>('debug.cheats');

/** Every cheat off. */
export const NO_CHEATS: DebugCheats = Object.freeze({ god: false, noclip: false });

/** What `hasCheat` reads. */
export interface CheatView {
  isRegistered(type: ComponentType<unknown>): boolean;
  get<T>(id: EntityId, type: ComponentType<T>): T | undefined;
}

/** Whether `entity` has `cheat` on (false when the debug commands are not installed). */
export function hasCheat(world: CheatView, entity: EntityId, cheat: DebugCheat): boolean {
  return (
    world.isRegistered(DebugCheatsComponent) &&
    world.get(entity, DebugCheatsComponent)?.[cheat] === true
  );
}

/**
 * God mode as a damage modifier: at the armor stage (the last), a god-mode target takes no damage,
 * poise or stamina damage. Registered on the world's DamageModel by `installDebugCommands`.
 */
export const godModeModifier: DamageModifier = {
  name: 'debug-god-mode',
  stage: 'armor',
  apply(hit, { world, target }) {
    if (!hasCheat(world, target, 'god')) return undefined;
    const amounts: Record<string, number> = {};
    for (const type of Object.keys(hit.amounts)) amounts[type] = 0;
    return { ...hit, amounts, poiseDamage: 0, staminaDamage: 0 };
  },
};
