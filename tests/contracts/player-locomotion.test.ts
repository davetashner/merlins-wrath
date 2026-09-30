// mw-e02.6: the shipped player (src/content/data/controller/player.json and the knight's moves)
// publishes the locomotion states and events the bead documents. The sim's unit tests pin the rules
// with fixture numbers; this re-checks them through installPlayer against the data files, so a retune
// that moves a threshold fails here. Content may import the sim only as types, so this cross-layer
// check lives outside src/.
import { describe, expect, it } from 'vitest';
import { compileMoves, loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  box,
  FakeCollisionWorld,
  IDLE_ACTION_FRAME,
  installPlayer,
  LocomotionEvents,
  locomotionOf,
  World,
  type ActionFrame,
  type ButtonAction,
  type LocomotionEvent,
  type SceneSpawnPlacement,
} from '@sim/index';

const content = loadGameContent();
const tuning = content.get('controller', PLAYER_CONTROLLER_ID);

/** A player start at the origin facing −z (scene yaw 180). */
const START: SceneSpawnPlacement = {
  id: 'player-start',
  position: { x: 0, y: 0, z: 0 },
  yaw: 180,
  rotation: { x: 0, y: 1, z: 0, w: 0 },
  prop: undefined,
  tags: ['player-start'],
};

const frame = (move: [number, number], pressed: ButtonAction[] = []): ActionFrame =>
  actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (action) => actionButton(pressed.includes(action), pressed.includes(action), false),
  });

function player() {
  const world = new World<ActionFrame>({ seed: 2 });
  const id = installPlayer(world, {
    spawns: [START],
    collision: new FakeCollisionWorld([box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 })]),
    tuning,
    combat: { moves: compileMoves(content.all('move')) },
  });
  const events: LocomotionEvent[] = [];
  world.events.on(LocomotionEvents, (e) => events.push(e));
  const step = (f: ActionFrame = IDLE_ACTION_FRAME) => {
    world.step([f]);
    const snapshot = locomotionOf(world, id);
    if (snapshot === undefined) throw new Error('no locomotion');
    return snapshot;
  };
  return { step, events };
}

describe('shipped player locomotion (mw-e02.6)', () => {
  it('AC-1: the player profile documents the thresholds: walk from 0.2 m/s, run from 2.5 m/s', () => {
    expect(tuning.gait).toMatchObject({ walkFrom: 0.2, runFrom: 2.5 });
    const { step } = player();
    const samples = [step(), step()];
    for (let i = 0; i < 30; i++) samples.push(step(frame([0, 1])));
    for (const s of samples) {
      expect(s.state).toBe(s.speed < 0.2 ? 'idle' : s.speed < 2.5 ? 'walk' : 'run');
    }
    expect(samples.map((s) => s.state).filter((s, i, all) => s !== all[i - 1])).toEqual([
      'idle',
      'walk',
      'run',
    ]);
  });

  it('a jump starts, lands hard (the landing state) and the player runs on; footsteps while running', () => {
    const { step, events } = player();
    step();
    for (let i = 0; i < 30; i++) step(frame([0, 1]));
    const states = [step(frame([0, 1], ['jump'])).state];
    for (let i = 0; i < 60; i++) states.push(step(frame([0, 1])).state);
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'jumpStart')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'land')).toHaveLength(1);
    expect(kinds).toContain('footstep');
    expect(states.filter((s, i, all) => s !== all[i - 1])).toEqual(['airborne', 'landing', 'run']);
  });

  it('a backstep with no direction held counts as moving (root motion), then the player is idle', () => {
    const { step } = player();
    step();
    const states = [step(frame([0, 0], ['dodge'])).state];
    for (let i = 0; i < 40; i++) states.push(step().state);
    expect(states.some((s) => s === 'run' || s === 'walk')).toBe(true);
    expect(states.at(-1)).toBe('idle');
  });
});
