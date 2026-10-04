import { describe, expect, it } from 'vitest';
import {
  InputPlayer,
  InputRecorder,
  type InputEvent,
  type InputTarget,
  type RecordableInput,
} from './input-log';

function fakeInput(): RecordableInput & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    down: (code) => calls.push(`down ${code}`),
    up: (code) => calls.push(`up ${code}`),
    look: (x, y) => calls.push(`look ${String(x)},${String(y)}`),
    releaseAll: () => calls.push('releaseAll'),
  };
}

describe('InputRecorder', () => {
  it('stamps events with ticks counted from the first sample and passes them on', () => {
    let now = 40;
    const recorder = new InputRecorder(() => now);
    const input = fakeInput();
    recorder.tap(input);
    // Before the first sample: stamped 0, however early.
    input.down('KeyW');
    recorder.sampled(40);
    recorder.sampled(41);
    now = 45;
    input.look(3, -2);
    input.up('KeyW');
    now = 50;
    input.releaseAll();
    recorder.record({ op: 'command', command: { type: 'kill' } });
    recorder.record({ op: 'save', slot: 'manual-1' });
    expect(recorder.events).toEqual([
      { op: 'down', code: 'KeyW', t: 0 },
      { op: 'look', x: 3, y: -2, t: 5 },
      { op: 'up', code: 'KeyW', t: 5 },
      { op: 'releaseAll', t: 10 },
      { op: 'command', command: { type: 'kill' }, t: 10 },
      { op: 'save', slot: 'manual-1', t: 10 },
    ]);
    expect(input.calls).toEqual(['down KeyW', 'look 3,-2', 'up KeyW', 'releaseAll']);
    expect(recorder.segment()).toEqual({ events: recorder.events, startTick: 40 });
  });

  it('leaves out the events skip names, still passing them on', () => {
    const recorder = new InputRecorder(() => 0);
    const input = fakeInput();
    recorder.tap(input, (op) => op.op === 'down' && op.code === 'Backquote');
    input.down('Backquote');
    input.down('KeyW');
    expect(recorder.events).toEqual([{ op: 'down', code: 'KeyW', t: 0 }]);
    expect(input.calls).toEqual(['down Backquote', 'down KeyW']);
  });

  it('never stamps a negative tick', () => {
    let now = 10;
    const recorder = new InputRecorder(() => now);
    recorder.sampled(10);
    now = 4;
    recorder.record({ op: 'releaseAll' });
    expect(recorder.events[0]?.t).toBe(0);
  });
});

describe('InputPlayer', () => {
  const events: InputEvent[] = [
    { op: 'down', code: 'KeyW', t: 0 },
    { op: 'look', x: 1, y: 2, t: 2 },
    { op: 'up', code: 'KeyW', t: 2 },
    { op: 'releaseAll', t: 3 },
    { op: 'command', command: 'c', t: 3 },
    { op: 'save', slot: 'manual-2', t: 4 },
  ];

  it('plays each event at its tick, counted from the first advance, in order', () => {
    const played: string[] = [];
    const target: InputTarget = {
      down: (code) => played.push(`down ${code}`),
      up: (code) => played.push(`up ${code}`),
      look: (x, y) => played.push(`look ${String(x)},${String(y)}`),
      releaseAll: () => played.push('releaseAll'),
      command: (command) => played.push(`command ${String(command)}`),
      save: (slot) => played.push(`save ${slot}`),
    };
    const player = new InputPlayer({ events }, target);
    expect(player.remaining).toBe(6);
    expect(player.startTick).toBeUndefined();
    player.advance(100);
    expect(player.startTick).toBe(100);
    expect(played).toEqual(['down KeyW']);
    player.advance(101);
    expect(played).toEqual(['down KeyW']);
    player.advance(102);
    expect(played.slice(1)).toEqual(['look 1,2', 'up KeyW']);
    player.advance(103);
    expect(player.done).toBe(false);
    player.advance(110);
    expect(played.slice(3)).toEqual(['releaseAll', 'command c', 'save manual-2']);
    expect(player.done).toBe(true);
    player.advance(111);
    expect(played).toHaveLength(6);
  });
});
