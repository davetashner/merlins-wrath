// Applies debug commands inside the tick (mw-e33.1). `installDebugCommands` registers the cheat
// component and adds the system; install it right after creating the world, before other systems,
// so a teleport or a cheat toggle is what every later system of that tick sees. Structural changes
// follow the world's usual rule: entities a spawn command creates, and a first cheat component, go
// live at the end of the tick, i.e. they exist from the next tick.
//
// The system trusts nothing it is fed: a replay may carry a command for content this build no longer
// has, or for an entity that is gone, so such commands are skipped rather than failing the tick. The
// console checks the same things up front and tells the developer instead.

import { initialCharacterState } from '../character/controller';
import { CharacterController } from '../character/system';
import { HealthComponent } from '../combat/damage/components';
import { Died } from '../combat/damage/events';
import type { DamageModel } from '../combat/damage/model';
import type { ComponentType, EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { SceneSpawnComponent, SceneTransformComponent } from '../scene/loader';
import type { Vec3 } from '../stimulus/shapes';
import { DebugCheatsComponent, godModeModifier, NO_CHEATS, type DebugCheats } from './cheats';
import { isDebugCommand, type CheatCommand, type DebugCommand } from './commands';

/** Distance between the entities one spawn command creates, metres along +x. */
export const SPAWN_SPACING = 1;

/** The tag every debug-spawned prop carries in its SceneSpawn component. */
export const DEBUG_SPAWN_TAG = 'debug-spawn';

/** Creates one entity of some content at `at` (code, not state: the same on every run). */
export type Spawner = <TInput>(world: World<TInput>, at: Vec3) => EntityId;

export interface DebugCommandOptions {
  /** Spawnable id → spawner; `spawn` commands for other ids are skipped. */
  readonly spawners: ReadonlyMap<string, Spawner>;
  /** The world's damage model, if it has one: god mode registers on it. */
  readonly damage?: DamageModel;
}

const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/**
 * A spawner for a grey-box test prop: a scene-spawn entity (the scene components must be
 * registered) that the renderer draws like the scene's own props, tagged DEBUG_SPAWN_TAG.
 */
export function propSpawner(prop: string): Spawner {
  return (world, at) => {
    const id = world.spawn();
    world.add(
      id,
      SceneTransformComponent,
      Object.freeze({ position: Object.freeze({ ...at }), rotation: IDENTITY }),
    );
    world.add(
      id,
      SceneSpawnComponent,
      Object.freeze({ id: `${DEBUG_SPAWN_TAG}-${prop}`, prop, tags: [DEBUG_SPAWN_TAG] }),
    );
    return id;
  };
}

/** Spawners for test props, keyed `testprop-<id>`. */
export function testPropSpawners(ids: readonly string[]): Map<string, Spawner> {
  return new Map(ids.map((id) => [`testprop-${id}`, propSpawner(id)]));
}

/** `type` of `id`, or undefined also when the world does not register `type`. */
function read<T>(world: World, id: EntityId, type: ComponentType<T>): T | undefined {
  return world.isRegistered(type) ? world.get(id, type) : undefined;
}

function teleport<TInput>(world: World<TInput>, target: EntityId, to: Vec3): void {
  if (read(world, target, CharacterController) !== undefined) {
    world.set(target, CharacterController, initialCharacterState(to));
    return;
  }
  const placed = read(world, target, SceneTransformComponent);
  if (placed !== undefined) {
    world.set(target, SceneTransformComponent, Object.freeze({ ...placed, position: to }));
  }
}

function kill<TInput>(world: World<TInput>, target: EntityId, tick: number): void {
  const health = read(world, target, HealthComponent);
  if (health !== undefined) {
    if (health.current === 0) return;
    world.set(target, HealthComponent, Object.freeze({ ...health, current: 0 }));
    world.events.emit(Died, { tick, target, killer: null, source: null, tags: ['debug'] });
    return;
  }
  // No health: remove it, unless it is a character (the player is never simply deleted).
  if (read(world, target, CharacterController) === undefined) world.destroy(target);
}

/** The system applying this tick's debug commands in input order (see the file header). */
export function debugCommandSystem<TInput>(options: DebugCommandOptions): System<TInput> {
  const { spawners } = options;
  return {
    name: 'debug-commands',
    run({ world, inputs, tick }) {
      const commands = (inputs as readonly unknown[]).filter(isDebugCommand);
      if (commands.length === 0) return;
      // Cheat toggles accumulate per entity, so two toggles in one tick both count even while the
      // first component add is still queued.
      const cheats = new Map<EntityId, DebugCheats>();
      const toggle = ({ target, cheat, on }: CheatCommand): void => {
        const current = cheats.get(target) ?? world.get(target, DebugCheatsComponent) ?? NO_CHEATS;
        cheats.set(target, Object.freeze({ ...current, [cheat]: on }));
      };
      for (const command of commands as readonly DebugCommand[]) {
        if (command.op === 'spawn') {
          const spawn = spawners.get(command.content);
          if (spawn === undefined) continue;
          for (let i = 0; i < command.count; i++) {
            const { x, y, z } = command.at;
            spawn(world, { x: x + i * SPAWN_SPACING, y, z });
          }
          continue;
        }
        if (!world.isAlive(command.target)) continue;
        if (command.op === 'cheat') toggle(command);
        else if (command.op === 'teleport') teleport(world, command.target, command.to);
        else kill(world, command.target, tick);
      }
      for (const [target, value] of cheats) {
        if (world.has(target, DebugCheatsComponent)) world.set(target, DebugCheatsComponent, value);
        else world.add(target, DebugCheatsComponent, value);
      }
    },
  };
}

/**
 * Makes `world` accept debug commands: registers the cheat component, adds the debug command system
 * and, when given the world's damage model, registers god mode on it. Once per world, at setup.
 */
export function installDebugCommands<TInput>(
  world: World<TInput>,
  options: DebugCommandOptions,
): void {
  world.register(DebugCheatsComponent);
  world.addSystem(debugCommandSystem<TInput>(options));
  options.damage?.register(godModeModifier);
}
