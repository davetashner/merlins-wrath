// mw-e04.9 / mw-e04.31: the combat sandbox scene through the game's own wiring (the sim's Rapier
// physics, scene loader, debug commands with the sandbox's spawners, the sandbox rules before the
// player, the player with sword and shield, startTestbedCombat), headless. The debug console runs
// against it exactly as in the page: typed lines become sim commands fed to the next step.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { frameDataView, sandboxFrameData } from '@game/combat/index';
import { ActionSampler } from '@game/input/index';
import { CommandQueue } from '@game/loop/index';
import {
  ActionStarted,
  AttackerDummyComponent,
  checkSandboxCommand,
  checkSandboxSpawn,
  DamageApplied,
  Died,
  drainStamina,
  HitReaction,
  LockOnComponent,
  PoiseComponent,
  ResistancesComponent,
  SandboxDummyComponent,
  TargetableComponent,
  teleportCommand,
  type ActionStartInfo,
  type DamageResult,
  type EntityId,
  type HitReactionInfo,
  type World,
} from '@sim/index';
import { registerBuiltins, type ConsoleHost } from '@tools/console/builtins';
import { createGameHost } from '@tools/console/host';
import { CommandRegistry } from '@tools/console/registry';
import { registerSandboxCommands } from '@tools/console/sandbox';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const SANDBOX = 'combat-sandbox';

function sandbox() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: SANDBOX });
  const { world, combat } = game;
  const queue = new CommandQueue<unknown>();
  const host = createGameHost({
    world: world,
    submit: (command) => {
      queue.push(command);
    },
    player: () => game.player,
    spawnables: ['attacker-dummy', 'dummy'],
    checkSpawn: (content, options) =>
      checkSandboxSpawn(combat.sandbox, content, options, world.clock.hz),
    bookmarks: () => new Map(),
    scenes: [SANDBOX],
    loadScene: () => undefined,
    loop: { timeScale: 1 },
  });
  const console = new CommandRegistry<ConsoleHost>(host);
  registerBuiltins(console);
  registerSandboxCommands(console, (command) =>
    checkSandboxCommand(combat.sandbox, command, world.clock.hz),
  );
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step(queue.drain());
  };
  const dummies = (attackers: boolean): EntityId[] => {
    const ids: EntityId[] = [];
    world.query(SandboxDummyComponent).forEach((id) => {
      if (world.has(id, AttackerDummyComponent) === attackers) ids.push(id);
    });
    return ids;
  };
  return { ...game, console, queue, steps, dummies };
}

describe('combat sandbox (mw-e04.9)', () => {
  it('the scene spawns the knight, a training dummy and an attacker dummy', ({ task }) => {
    markExercised(task, 'scene', SANDBOX);
    markExercised(task, 'sandbox', SANDBOX);
    markExercised(task, 'move', 'training-dummy-swing');
    const s = sandbox();
    expect(s.combatants.sandboxDummies).toHaveLength(2);
    expect(s.dummies(false)).toHaveLength(1);
    expect(s.dummies(true)).toHaveLength(1);
    // Deterministic for e2e and replays: the same seed gives the same world.
    const other = sandbox();
    s.steps(200);
    other.steps(200);
    expect(JSON.stringify(s.world.snapshot())).toBe(JSON.stringify(other.world.snapshot()));
  });

  it('AC-1: `spawn dummy --poise 60 --resist slash=0.5` puts that dummy in sim state', () => {
    const s = sandbox();
    const before = new Set(s.dummies(false));
    expect(s.console.execute('spawn dummy --poise 60 --resist slash=0.5')).toEqual({
      ok: true,
      lines: ['spawning 1 × dummy --poise 60 --resist slash=0.5'],
    });
    s.steps(1);
    const [spawned] = s.dummies(false).filter((id) => !before.has(id));
    if (spawned === undefined) throw new Error('no dummy spawned');
    expect(s.world.get(spawned, PoiseComponent)?.max).toBe(60);
    expect(s.world.get(spawned, ResistancesComponent)?.multipliers).toEqual({ slash: 0.5 });
    // Bad options are refused up front and never reach the sim.
    expect(s.console.execute('spawn dummy --resist ice=2').ok).toBe(false);
    expect(s.queue.size).toBe(0);
  });

  it('AC-2: at the 2.0 s metronome, 10 s run exactly 5 swings, each on a tick multiple of 120', () => {
    const s = sandbox();
    const [attacker] = s.dummies(true);
    const swings: ActionStartInfo[] = [];
    s.world.events.on(ActionStarted, (e) => {
      if (e.entity === attacker) swings.push(e);
    });
    s.steps(600);
    expect(swings.map((e) => e.tick)).toEqual([0, 120, 240, 360, 480]);
    expect(swings.every((e) => e.tick % 120 === 0 && e.move === 'training-dummy-swing')).toBe(true);
    // The console retunes it: every 1.0 s, unblockable.
    s.console.execute('attacker --every 1 --unblockable on');
    s.steps(120);
    expect(swings.slice(5).map((e) => [e.tick, e.move])).toEqual([
      [600, 'training-dummy-swing:parryable:unblockable'],
      [660, 'training-dummy-swing:parryable:unblockable'],
    ]);
  });

  it('AC-5: 10,000 damage never kills the infinite dummy; its health display resets after 3 s', () => {
    const s = sandbox();
    const [dummy] = s.dummies(false);
    if (dummy === undefined) throw new Error('no dummy');
    const died: unknown[] = [];
    s.world.events.on(Died, (e) => died.push(e));
    const health = () =>
      frameDataView(sandboxFrameData(s.world as World<never>, { moves: s.combat.moves })).rows.find(
        (row) => row.key === String(dummy),
      )?.health;
    expect(health()).toBe('1000/1000');
    let dealt = 0;
    s.world.addSystem({
      name: 'test-blows',
      run: ({ world }) => {
        if (dealt >= 10_000) return;
        const w = world as World<never>;
        dealt += s.combat.damage.apply(w, dummy, { amounts: { blunt: 500 } })?.total ?? 0;
      },
    });
    s.steps(20);
    expect(dealt).toBe(10_000);
    const lastHit = s.world.get(dummy, SandboxDummyComponent)?.lastHitAt ?? Number.NaN;
    expect(health()).toBe('1/1000');
    expect(died).toEqual([]);
    s.steps(lastHit + 179 - s.world.tick + 1);
    expect(health()).toBe('1/1000');
    s.steps(1);
    expect(health()).toBe('1000/1000');
  });
});

describe('the knight takes hits and blocks them (mw-e04.31)', () => {
  /** A sandbox with the knight a step in front of the attacker dummy. */
  function facingTheAttacker() {
    const s = sandbox();
    const [attacker] = s.dummies(true);
    if (attacker === undefined) throw new Error('no attacker');
    s.steps(1);
    s.world.step([teleportCommand(s.player, { x: 2, y: 0, z: 0 })]); // the attacker stands at (2, 0, 1)
    const hits: DamageResult[] = [];
    const reactions: HitReactionInfo[] = [];
    s.world.events.on(DamageApplied, (e) => {
      if (e.target === s.player) hits.push(e);
    });
    s.world.events.on(HitReaction, (e) => {
      if (e.entity === s.player) reactions.push(e);
    });
    return { ...s, attacker, hits, reactions };
  }

  /** Steps with the shield held (right mouse button), like a player. */
  function holdShield(s: ReturnType<typeof facingTheAttacker>, ticks: number): void {
    const sampler = new ActionSampler();
    sampler.down('Mouse2');
    for (let i = 0; i < ticks; i++) s.world.step([sampler.sample(), ...s.queue.drain()]);
  }

  it('AC-1: a blocked swing lands tagged blocked and causes no reaction', () => {
    const s = facingTheAttacker();
    holdShield(s, 30);
    expect(s.hits.map((h) => [h.tick, h.tags, h.poiseDamage])).toEqual([[18, ['blocked'], 0]]);
    expect(s.hits[0]?.total).toBeCloseTo(15 * 0.15); // the wood shield absorbs 85% of slash
    expect(s.reactions).toMatchObject([{ tick: 18, reaction: 'none', suppressed: 'blocked' }]);
  });

  it('AC-2: a block that empties stamina is a guard break: a 60-tick stagger', () => {
    const s = facingTheAttacker();
    holdShield(s, 10);
    drainStamina(s.world, s.player, 95); // 5 left: the next block needs 8
    holdShield(s, 20);
    expect(s.hits.map((h) => [h.tick, h.tags])).toEqual([[18, ['blocked', 'guard-break']]]);
    expect(s.reactions.map((r) => [r.tick, r.reaction, r.ticks, r.suppressed])).toEqual([
      [18, 'stagger', 60, null],
      [18, 'none', 0, 'blocked'],
    ]);
  });

  it('an unguarded knight is struck by the swing and flinches', () => {
    const s = facingTheAttacker();
    s.steps(160); // the swings at ticks 0 and 120 turn active on 18 and 138
    expect(s.hits.map((h) => [h.tick, h.healthBefore, h.total, h.tags])).toEqual([
      [18, 100, 15, []],
      [138, 85, 15, []],
    ]);
    // 15 poise each: the second empties the knight's 30 and staggers.
    expect(s.reactions.map((r) => [r.tick, r.reaction])).toEqual([
      [18, 'flinch'],
      [138, 'stagger'],
    ]);
  });
});

describe('lock-on in the combat sandbox (mw-e02.32)', () => {
  it('the scene’s dummies and console-spawned ones are lock-on targets', () => {
    const s = sandbox();
    const sampler = new ActionSampler();
    const press = (code: string) => {
      sampler.down(code);
      s.world.step([...s.queue.drain(), ...sampler.sampleCommands(s.world.tick)]);
      sampler.up(code);
      s.steps(1);
    };
    s.steps(30); // settle
    for (const id of s.combatants.sandboxDummies) {
      expect(s.world.has(id, TargetableComponent)).toBe(true);
    }
    press('KeyQ');
    const locked = s.world.get(s.player, LockOnComponent)?.target;
    expect(s.combatants.sandboxDummies).toContain(locked);
    const before = new Set(s.dummies(false));
    s.console.execute('spawn dummy');
    s.steps(1);
    const [spawned] = s.dummies(false).filter((id) => !before.has(id));
    if (spawned === undefined) throw new Error('no dummy spawned');
    expect(s.world.has(spawned, TargetableComponent)).toBe(true);
  });
});
