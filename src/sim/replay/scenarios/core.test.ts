import { describe, expect, it } from 'vitest';
import {
  coreCommand,
  coreComponents,
  coreScenario,
  replayScenarios,
  Rng,
  type CoreCommand,
} from '@sim/index';

const { Health, Position, Velocity } = coreComponents;

const world = () => coreScenario.create({ seed: 7, hz: 60 });
const spawn: CoreCommand = { type: 'spawn', x: 0, y: 0 };

describe('core replay scenario', () => {
  it('is registered under its name and builds a content-free world at tick 0 with four bodies', () => {
    expect(replayScenarios['core']).toBe(coreScenario);
    expect(coreScenario.usesContent).toBe(false);
    const w = world();
    expect(w.tick).toBe(0);
    expect(w.entityCount).toBe(4);
  });

  it('spawns bodies on command, up to twelve at a time', () => {
    const w = world();
    for (let i = 0; i < 20; i++) w.step([spawn]);
    expect(w.entityCount).toBe(12);
  });

  it('pushes the targeted body (index modulo the live count)', () => {
    const w = world();
    const target = w.query(Velocity).ids()[1] ?? 0;
    w.step([{ type: 'push', target: 5, dx: 30, dy: -30 }]);
    const v = w.get(target, Velocity);
    expect(v?.x).toBeGreaterThan(25);
    expect(v?.y).toBeLessThan(-25);
  });

  it('kills a body once however many hits land in the same tick', () => {
    const w = world();
    const target = w.query(Health).ids()[0] ?? 0;
    const hit: CoreCommand = { type: 'hit', target: 0, amount: 50 };
    w.step([hit, hit, hit]);
    expect(w.isAlive(target)).toBe(false);
    expect([3, 5]).toContain(w.entityCount); // it may split into two
  });

  it('ignores hits and pushes when no body is alive', () => {
    const w = world();
    const hit: CoreCommand = { type: 'hit', target: 0, amount: 50 };
    for (let i = 0; i < 200 && w.entityCount > 0; i++) w.step([hit]);
    expect(w.entityCount).toBe(0);
    const before = w.snapshot();
    w.step([hit, { type: 'push', target: 0, dx: 1, dy: 1 }]);
    expect(w.snapshot().components).toEqual(before.components);
  });

  it('keeps bodies inside the arena by bouncing them off every wall', () => {
    const w = world();
    const ids = w.query(Position).ids();
    const pushes: CoreCommand[] = ids.map((_, target) => ({
      type: 'push',
      target,
      dx: target % 2 === 0 ? 400 : -400,
      dy: target < 2 ? 400 : -400,
    }));
    w.step(pushes);
    for (let i = 0; i < 30; i++) w.step();
    w.query(Position).forEach((_id, { x, y }) => {
      expect(Math.abs(x)).toBeLessThanOrEqual(10);
      expect(Math.abs(y)).toBeLessThanOrEqual(10);
    });
  });

  it('decays every body by 1 hp every 30 ticks', () => {
    const w = world();
    const id = w.query(Health).ids()[0] ?? 0;
    const hp = w.get(id, Health)?.hp ?? 0;
    for (let i = 0; i < 29; i++) w.step();
    expect(w.get(id, Health)?.hp).toBe(hp - 0);
    w.step();
    expect(w.get(id, Health)?.hp).toBe(hp - 1);
  });

  it('drives a spawn, push or hit on about one tick in twenty', () => {
    const w = world();
    const rng = Rng.create(1);
    const commands = Array.from({ length: 2000 }, (_, tick) =>
      coreScenario.drive({ tick, world: w, rng }),
    ).flat();
    expect(commands.length).toBeGreaterThan(50);
    expect(commands.length).toBeLessThan(150);
    expect(new Set(commands.map((c) => c.type))).toEqual(new Set(['spawn', 'push', 'hit']));
    for (const command of commands) expect(coreCommand.safeParse(command).success).toBe(true);
  });

  it('rejects malformed commands', () => {
    expect(coreCommand.safeParse({ type: 'spawn', x: 11, y: 0 }).success).toBe(false);
    expect(coreCommand.safeParse({ type: 'hit', target: -1, amount: 1 }).success).toBe(false);
  });
});
