// mw-e17.5: the keyring in the testbed as the game wires it (createGameWorld: Rapier physics, the
// player with interaction and an inventory, the scene's item spawns and its mechanisms), driven by
// ActionFrames. The east closet's wooden door carries the testbed-closet lock; its key lies on the
// floor at (3.5, 0, 3). Taking the key and pressing Interact on the door opens it: no menu, no
// choosing a key, just the two presses.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  actionButton,
  actionFrame,
  actionVector,
  doorStatus,
  interacted,
  interactionPrompt,
  inventoryOf,
  lockOpened,
  PlayerLook,
  SceneSpawnComponent,
  teleportCommand,
  World,
  type ActionFrame,
  type EntityId,
  type Interaction,
  type LockOpened,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(...pressed: string[]): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (pressed.includes(action) ? DOWN : UP),
  });
}
const IDLE = frame();
const INTERACT = frame('interact');

/** Yaws: 0 faces −z, −π/2 faces +x. */
const FACE_NORTH = 0;
const FACE_EAST = -Math.PI / 2;

/** The testbed with the player standing at (3.5, 0, 4), just inside the closet door. */
function atTheCloset() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60 });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const spawn = (id: string): EntityId => {
    const found = world
      .query(SceneSpawnComponent)
      .ids()
      .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
    if (found === undefined) throw new Error(`no testbed spawn ${id}`);
    return found;
  };
  const door = spawn('closet-door');
  const key = spawn('closet-key');
  world.step([teleportCommand(player, { x: 3.5, y: 0, z: 4 })]);
  const settle = (yaw: number): void => {
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    for (let i = 0; i < 10; i++) world.step([IDLE]);
  };
  const interactions: Interaction[] = [];
  const opened: LockOpened[] = [];
  world.events.on(interacted, (e) => interactions.push(e));
  world.events.on(lockOpened, (e) => opened.push(e));
  const pack = () => inventoryOf(sim, player)?.items.map((item) => item.defId);
  return { world, sim, player, door, key, settle, interactions, opened, pack };
}

describe('the keyring in the testbed (mw-e17.5)', () => {
  it('AC-4: take the key nearby, Interact on the closet door: it opens with no menu', () => {
    const t = atTheCloset();
    // Locked to start with: the prompt is greyed with the lock's hint.
    t.settle(FACE_EAST);
    expect(doorStatus(t.sim, t.door)).toBe('locked');
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: t.door,
      verb: 'unlock',
      available: false,
      reason: "Locked. The key can't be far.",
    });

    // Take the key from the floor.
    t.settle(FACE_NORTH);
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({ target: t.key, available: true });
    t.world.step([INTERACT]);
    expect(t.pack()).toEqual(['testbed-closet-key']);
    expect(t.world.isAlive(t.key)).toBe(false);

    // Face the door: Unlock is available, and one press opens it.
    t.settle(FACE_EAST);
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: t.door,
      verb: 'unlock',
      available: true,
    });
    t.world.step([INTERACT]);
    expect(t.opened).toEqual([
      expect.objectContaining({
        entity: t.door,
        lock: 'testbed-closet',
        keyId: 'testbed-closet-key',
        actor: t.player,
        consumed: false,
      }),
    ]);
    for (let i = 0; i < 90; i++) t.world.step([IDLE]);
    expect(doorStatus(t.sim, t.door)).toBe('open');
    // Two presses, two interactions (take, unlock), nothing in between: no menu, no key choice.
    expect(t.interactions.map((e) => [e.verb, e.target])).toEqual([
      ['pick-up', t.key],
      ['unlock', t.door],
    ]);
    // The reusable key stays on the keyring.
    expect(t.pack()).toEqual(['testbed-closet-key']);
  });
});
