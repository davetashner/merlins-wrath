// mw-e02.3 AC-4: live controller tuning end to end. The debug console's `ctl.set runSpeed 6` goes
// through the command queue to the next tick, where the shipped player (src/content/data/controller/
// player.json, through installPlayer) runs at 6.0 m/s; `ctl.dump` then prints a file that loads.
import { describe, expect, it } from 'vitest';
import {
  controllerSchema,
  controllerTuningFor,
  loadContent,
  loadGameContent,
  PLAYER_CONTROLLER_ID,
} from '@content/index';
import { contentTypes } from '@content/registry';
import { markExercised } from '@content/testing';
import { CommandQueue } from '@game/loop/command-queue';
import {
  actionButton,
  actionFrame,
  actionVector,
  CharacterController,
  CharacterTuning,
  FakeCollisionWorld,
  installDebugCommands,
  installPlayer,
  layoutScene,
  registerSceneComponents,
  World,
  type ActionFrame,
  type DebugCommand,
} from '@sim/index';
import { TEST_SCENE, testKit } from '@sim/scene/fixtures';
import { registerBuiltins, type ConsoleHost } from '@tools/console/builtins';
import { registerControllerCommands } from '@tools/console/controller';
import { characterTuningOf, createGameHost } from '@tools/console/host';
import { CommandRegistry } from '@tools/console/registry';

const profile = loadGameContent().get('controller', PLAYER_CONTROLLER_ID);
const FORWARD: ActionFrame = actionFrame({
  move: actionVector(0, 1),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});

describe('live controller tuning (mw-e02.3)', () => {
  it('AC-4: ctl.set runSpeed 6 runs the next tick at 6.0 m/s; ctl.dump prints a valid file', ({
    task,
  }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
    const world = registerSceneComponents(new World<ActionFrame | DebugCommand>({ seed: 11 }));
    installDebugCommands(world, { spawners: new Map() });
    const layout = layoutScene(TEST_SCENE, testKit);
    const collision = new FakeCollisionWorld(layout.parts.flatMap((part) => part.collider ?? []));
    const player = installPlayer(world, {
      spawns: layout.spawns,
      collision,
      tuning: controllerTuningFor(profile),
    });
    const queue = new CommandQueue<ActionFrame | DebugCommand>();
    const sim = world as unknown as World<never>; // the console only reads
    const registry = new CommandRegistry<ConsoleHost>(
      createGameHost({
        world: sim,
        submit: (command) => {
          queue.push(command as DebugCommand);
        },
        player: () => player,
        spawnables: [],
        bookmarks: () => new Map(),
        scenes: [],
        loadScene: () => undefined,
        loop: { timeScale: 1 },
      }),
    );
    registerBuiltins(registry);
    registerControllerCommands(registry, {
      profile,
      tuning: (entity) => characterTuningOf(sim, entity),
    });
    const speed = () => {
      const v = world.get(player, CharacterController)?.velocity ?? { x: 0, y: 0, z: 0 };
      return Math.sqrt(v.x * v.x + v.z * v.z);
    };
    const tick = () => {
      world.step([...queue.drain(), FORWARD]);
    };

    for (let i = 0; i < 30; i++) tick();
    expect(speed()).toBeCloseTo(profile.speeds.run, 9); // 5.0 m/s, shipped

    expect(registry.execute('ctl.set runSpeed 6')).toEqual({
      ok: true,
      lines: ['speeds.run = 6 (was 5)'],
    });
    tick(); // the next tick
    expect(world.get(player, CharacterTuning)?.speeds.run).toBe(6);
    // It already accelerates past 5 toward the new top speed, at the new run / accelTime.
    expect(speed()).toBeCloseTo(5 + 6 / profile.accelTime / 60, 9);
    for (let i = 0; i < 30; i++) tick();
    expect(speed()).toBeCloseTo(6, 9);

    const dump = registry.execute('ctl.dump');
    expect(dump.ok).toBe(true);
    const text = dump.lines.join('\n');
    // The dumped file loads through the game's own loader, as src/content/data/controller/player.json.
    const loaded = loadContent(contentTypes, [
      { path: 'src/content/data/controller/player.json', text },
    ]).get('controller', PLAYER_CONTROLLER_ID);
    expect(loaded.speeds.run).toBe(6);
    expect(controllerSchema.parse({ ...loaded })).toEqual({
      ...profile,
      speeds: { ...profile.speeds, run: 6 },
    });
  });
});
