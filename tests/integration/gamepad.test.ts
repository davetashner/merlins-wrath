// mw-e02.9: a virtual Xbox pad plays the greybox testbed through the game's own wiring: the Gamepad
// API adapter polled from the ActionSampler once per tick, the testbed player (sim Rapier physics,
// setupTestbedPlayer) and the controls hint text. Tick-based, headless.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { ActionSampler, attachGamepadInput, inputGlyph, type GamepadLike } from '@game/input/index';
import { fakePad, type FakePadOptions } from '@game/input/fake-gamepad';
import {
  CharacterController,
  hashWorld,
  isActionFrame,
  PlayerLook,
  type ActionFrame,
} from '@sim/index';
import { createTestbedWorld } from '@tools/replay/testbed-player-scenario';
import { playerControlsHint } from '@ui/scene-hud';

/** The testbed with a pad plugged into a sampler; `hold` sets the pad for the following ticks. */
function padTestbed() {
  const world = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
  const [player] = world.query(PlayerLook).ids();
  if (player === undefined) throw new Error('no player');
  let pads: (GamepadLike | null)[] = [];
  const events: string[] = [];
  const sampler = new ActionSampler();
  attachGamepadInput(sampler, {
    navigator: { getGamepads: () => pads },
    hasFocus: () => true,
    onConnect: () => events.push('connect'),
    onDisconnect: () => events.push('disconnect'),
  });
  const frames: ActionFrame[] = [];
  const run = (ticks: number, pad?: FakePadOptions | null): ActionFrame => {
    pads = pad === null ? [] : [fakePad(pad)];
    let frame = sampler.lastFrame;
    for (let i = 0; i < ticks; i++) {
      frame = sampler.sample();
      frames.push(frame);
      world.step([frame]);
    }
    return frame;
  };
  const state = () => {
    const value = world.get(player, CharacterController);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  const look = () => {
    const value = world.get(player, PlayerLook);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  const hint = () => {
    const device = sampler.lastDevice;
    const bindings = { keyboardMouse: sampler.bindings, gamepad: sampler.padBindings };
    const glyph = (action: 'move' | 'jump' | 'sprint' | 'crouch') =>
      inputGlyph(action, device, bindings);
    return playerControlsHint(device, {
      move: glyph('move'),
      jump: glyph('jump'),
      sprint: glyph('sprint'),
      crouch: glyph('crouch'),
    });
  };
  return { world, sampler, run, state, look, hint, events, frames };
}

describe('a virtual Xbox pad in the testbed (mw-e02.9)', () => {
  it('left stick forward for 60 ticks moves the player at least 4 m, the way it faces', () => {
    const t = padTestbed();
    t.run(30); // settle
    const before = t.state().position;
    t.run(60, { left: [0, 1] });
    t.run(15, {}); // coast to a stop
    const after = t.state().position;
    expect(after.z - before.z).toBeGreaterThanOrEqual(4);
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.05);
    expect(t.events).toEqual(['connect']);
  });

  it('the right stick turns the camera look; A jumps', () => {
    const t = padTestbed();
    t.run(30);
    const yaw = t.look().yaw;
    t.run(30, { right: [1, 0] });
    expect(t.look().yaw).toBeLessThan(yaw - 1); // 240°/s for half a second, turning right
    t.run(2, {});
    expect(t.state().grounded).toBe(true);
    t.run(1, { pressed: ['PadA'] });
    t.run(10, {});
    expect(t.state().grounded).toBe(false);
    expect(t.state().position.y).toBeGreaterThan(0.3);
  });

  it('AC-4: the pad disconnecting mid-sprint releases sprint on the next frame and taps pause', () => {
    const t = padTestbed();
    t.run(30);
    t.run(1, { pressed: ['PadLS'], left: [0, 1] });
    t.run(30, { left: [0, 1] });
    expect(t.state().sprinting).toBe(true);
    const next = t.run(1, null);
    expect(next.sprint).toEqual({ pressed: false, held: false, released: true });
    expect(next.move).toEqual({ x: 0, y: 0 });
    expect(next.pause).toEqual({ pressed: true, held: false, released: true });
    expect(t.state().sprinting).toBe(false);
    expect(t.events).toEqual(['connect', 'disconnect']);
  });

  it('AC-5: after gamepad input the controls hint shows the Xbox glyphs; after a key, the keys', () => {
    const t = padTestbed();
    expect(t.hint()).toMatch(/^Click to play: WASD move, .*Space jump/);
    t.run(1, { pressed: ['PadA'] });
    expect(t.sampler.lastDevice).toBe('gamepad');
    expect(t.hint()).toBe(
      'Controller: Left stick move, right stick look, A jump, LS sprint (toggle), B crouch',
    );
    t.sampler.down('KeyW');
    t.run(1, {});
    expect(t.hint()).toMatch(/^Click to play: WASD move/);
  });

  it('pad-driven frames are plain JSON and replay to the same state hash', () => {
    const t = padTestbed();
    t.run(20, { left: [0.3, 0.8], right: [-0.45, 0.2] });
    t.run(1, { pressed: ['PadLS', 'PadA'], left: [0.1, 0.95] });
    t.run(40, { left: [-0.62, 0.7], right: [0.777, -0.1] });
    const live = hashWorld(t.world);
    const stored = JSON.parse(JSON.stringify(t.frames)) as unknown[];
    expect(stored).toEqual(t.frames);
    expect(stored.every(isActionFrame)).toBe(true);
    const replayed = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
    for (const frame of stored.filter(isActionFrame)) replayed.step([frame]);
    expect(hashWorld(replayed)).toBe(live);
  });
});
