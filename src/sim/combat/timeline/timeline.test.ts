import type { CancelTarget, MoveTable, MoveVerb, RuntimeMove, TickRange } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../../input/action-frame';
import { hashWorld } from '../../snapshot';
import { ActionRejected, type ActionRejection } from '../actions';
import { giveStamina, StaminaComponent, staminaOf, staminaSystem } from '../stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionInput,
  giveActionTimeline,
} from './components';
import {
  ActionEnded,
  ActionPhaseChanged,
  ActionStarted,
  type ActionEndInfo,
  type ActionPhaseInfo,
  type ActionStartInfo,
} from './events';
import {
  ACTION_BUFFER_TICKS,
  CHAIN_RESET_TICKS,
  actionOf,
  actionTimelineSystem,
  activeHitbox,
  canActNow,
  interruptAction,
  phaseAt,
  requestMove,
  setTimeScale,
  TIME_SCALE_STEPS,
} from './timeline';

interface MoveSpec {
  readonly id: string;
  readonly verb?: MoveVerb;
  readonly frames: readonly [number, number, number];
  readonly cost?: number;
  readonly windows?: readonly (TickRange & {
    readonly into: CancelTarget;
    readonly move?: string;
  })[];
  readonly chainNext?: string;
  readonly hitbox?: boolean;
}

/** A RuntimeMove as compileMove would build it, with only the fields the timeline reads varied. */
function move({
  id,
  verb = 'attack',
  frames,
  cost = 0,
  windows = [],
  chainNext,
  hitbox,
}: MoveSpec) {
  const [startup, active, recovery] = frames;
  const canHit = hitbox ?? verb === 'attack';
  return Object.freeze({
    id,
    verb,
    startup,
    active,
    recovery,
    totalTicks: startup + active + recovery,
    activeFrom: startup,
    recoveryFrom: startup + active,
    staminaCost: cost,
    cancelWindows: windows.map((w) => ({ ...w, move: w.move ?? null })),
    damage: null,
    hitbox: canHit
      ? {
          track: `${id}-track`,
          shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.5 },
          reach: 'short',
          swing: 'horizontal',
        }
      : null,
    parryable: canHit,
    blockable: canHit,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    chainNext: chainNext ?? null,
    charge: null,
    motion: null,
    presentation: { anim: `anim-${id}` },
  } satisfies RuntimeMove);
}

const table = (...moves: RuntimeMove[]): MoveTable => new Map(moves.map((m) => [m.id, m]));

// The knight's light chain shape: 12/4/18 with a dodge cancel from recovery tick 6 (move tick 22).
const light1 = move({
  id: 'light-1',
  frames: [12, 4, 18],
  cost: 12,
  windows: [{ into: 'dodge', from: 22, to: 33 }],
  chainNext: 'light-2',
});
const light2 = move({ id: 'light-2', frames: [10, 4, 20], cost: 14, chainNext: 'light-3' });
const light3 = move({ id: 'light-3', frames: [16, 5, 26], cost: 18 });
const heavy = move({ id: 'heavy', frames: [20, 5, 25], cost: 25 });
const roll = move({
  id: 'roll',
  verb: 'dodge',
  frames: [2, 13, 21],
  cost: 20,
  windows: [{ into: 'attack', from: 28, to: 35 }],
});
const MOVES = table(light1, light2, light3, heavy, roll);

interface Setup {
  readonly world: World<ActionFrame>;
  readonly knight: EntityId;
  readonly started: ActionStartInfo[];
  readonly phases: ActionPhaseInfo[];
  readonly ended: ActionEndInfo[];
  readonly rejected: ActionRejection[];
  steps(n: number, frame?: ActionFrame): void;
  /** Steps until the world is at `tick` (the next tick to simulate). */
  stepTo(tick: number): void;
}

function setup(options: { moves?: MoveTable; stamina?: boolean } = {}): Setup {
  const world = new World<ActionFrame>({ seed: 1 }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    StaminaComponent,
  );
  world
    .addSystem(staminaSystem())
    .addSystem(actionTimelineSystem({ moves: options.moves ?? MOVES }));
  const knight = world.spawn();
  giveActionTimeline(world, knight);
  if (options.stamina ?? true) giveStamina(world, knight);
  const started: ActionStartInfo[] = [];
  const phases: ActionPhaseInfo[] = [];
  const ended: ActionEndInfo[] = [];
  const rejected: ActionRejection[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(ActionPhaseChanged, (e) => phases.push(e));
  world.events.on(ActionEnded, (e) => ended.push(e));
  world.events.on(ActionRejected, (e) => rejected.push(e));
  const steps = (n: number, frame?: ActionFrame) => {
    for (let i = 0; i < n; i++) world.step(frame === undefined ? [] : [frame]);
  };
  const stepTo = (tick: number) => {
    steps(tick - world.tick);
  };
  return { world, knight, started, phases, ended, rejected, steps, stepTo };
}

/** Empties the knight's stamina and keeps regen paused for the rest of the test. */
function emptyStamina(s: Setup): void {
  const pool = staminaOf(s.world, s.knight);
  if (pool === undefined) throw new Error('no pool');
  s.world.set(s.knight, StaminaComponent, { ...pool, current: 0, regenResumesAt: 1000 });
}

/** Requests `id` just before world tick `tick` is simulated. */
function pressAt(s: Setup, tick: number, id: string): void {
  s.stepTo(tick);
  requestMove(s.world, s.knight, id);
}

const phaseTicks = (s: Setup) => s.phases.map((p) => [p.tick, p.move, p.phase]);

describe('action timeline: phases', () => {
  it('AC-1: a 12/4/18 move executed from tick 0 turns active on 12, recovers on 16 and ends on 34', () => {
    const s = setup();
    requestMove(s.world, s.knight, 'light-1');
    s.steps(40);
    expect(s.started).toEqual([
      { tick: 0, entity: s.knight, move: 'light-1', cancelled: null, chained: false },
    ]);
    expect(s.phases).toEqual([
      { tick: 0, entity: s.knight, move: 'light-1', phase: 'startup', moveTick: 0 },
      { tick: 12, entity: s.knight, move: 'light-1', phase: 'active', moveTick: 12 },
      { tick: 16, entity: s.knight, move: 'light-1', phase: 'recovery', moveTick: 16 },
    ]);
    expect(s.ended).toEqual([
      { tick: 34, entity: s.knight, move: 'light-1', reason: 'completed', moveTick: 34 },
    ]);
  });

  it('AC-1: the move tick follows the world tick one for one and the entity is idle after', () => {
    const s = setup();
    requestMove(s.world, s.knight, 'light-1');
    s.steps(1);
    expect(actionOf(s.world, s.knight)).toEqual({ move: 'light-1', tick: 0, startedAt: 0 });
    s.stepTo(20);
    expect(actionOf(s.world, s.knight)?.tick).toBe(19);
    s.stepTo(35);
    expect(actionOf(s.world, s.knight)).toBeUndefined();
    expect(actionOf(s.world, s.world.spawn())).toBeUndefined();
  });

  it('phaseAt maps move ticks to phases, and zero-length phases are skipped', () => {
    expect([0, 11, 12, 15, 16, 33].map((t) => phaseAt(light1, t))).toEqual([
      'startup',
      'startup',
      'active',
      'active',
      'recovery',
      'recovery',
    ]);
    const instant = move({ id: 'instant', verb: 'parry', frames: [0, 0, 3] });
    const s = setup({ moves: table(instant) });
    requestMove(s.world, s.knight, 'instant');
    s.steps(5);
    expect(phaseTicks(s)).toEqual([[0, 'instant', 'recovery']]);
    expect(s.ended.map((e) => e.tick)).toEqual([3]);
  });

  it('spends the stamina cost on the first startup tick; a pool-less entity acts for free', () => {
    const s = setup();
    requestMove(s.world, s.knight, 'light-1');
    s.steps(1);
    expect(staminaOf(s.world, s.knight)?.current).toBe(88);
    const free = setup({ stamina: false });
    requestMove(free.world, free.knight, 'light-1');
    free.steps(1);
    expect(free.started).toHaveLength(1);
  });

  it('refuses a move at 0 stamina with one ActionRejected{stamina} and drops the request', () => {
    const s = setup();
    emptyStamina(s);
    requestMove(s.world, s.knight, 'light-1');
    s.steps(12);
    expect(s.started).toEqual([]);
    expect(s.rejected).toEqual([
      { entity: s.knight, action: 'attack', reason: 'stamina', tick: 0 },
    ]);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.buffer).toBeNull();
  });
});

describe('action timeline: input buffer and chains', () => {
  it('AC-2: attack pressed 8 ticks before recovery ends chains into the next move on that tick', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    pressAt(s, 26, 'light-1');
    s.stepTo(40);
    expect(s.started.map((e) => [e.tick, e.move, e.chained])).toEqual([
      [0, 'light-1', false],
      [34, 'light-2', true],
    ]);
    expect(s.rejected).toEqual([]);
  });

  it('AC-2: attack pressed 12 ticks before recovery ends is dropped', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    pressAt(s, 22, 'light-1');
    s.stepTo(60);
    expect(s.started.map((e) => e.tick)).toEqual([0]);
    expect(s.rejected).toEqual([
      { entity: s.knight, action: 'attack', reason: 'busy', tick: 22 + ACTION_BUFFER_TICKS },
    ]);
  });

  it('AC-2: the buffer lasts exactly 9 ticks: pressed 9 before is kept, 10 before is dropped', () => {
    const kept = setup();
    pressAt(kept, 0, 'light-1');
    pressAt(kept, 34 - ACTION_BUFFER_TICKS, 'light-1');
    kept.stepTo(40);
    expect(kept.started.map((e) => e.tick)).toEqual([0, 34]);
    const dropped = setup();
    pressAt(dropped, 0, 'light-1');
    pressAt(dropped, 34 - ACTION_BUFFER_TICKS - 1, 'light-1');
    dropped.stepTo(40);
    expect(dropped.started.map((e) => e.tick)).toEqual([0]);
  });

  it('the most recent buffered input wins', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    pressAt(s, 28, 'heavy');
    pressAt(s, 30, 'light-1');
    s.stepTo(40);
    expect(s.started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'light-1'],
      [34, 'light-2'],
    ]);
  });

  it('runs a 3-hit chain, then restarts at the root after the last hit', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    pressAt(s, 30, 'light-1'); // light-2 at 34, ends 68
    pressAt(s, 65, 'light-1'); // light-3 at 68, ends 115
    pressAt(s, 110, 'light-1'); // chain over: light-1 again at 115
    s.stepTo(120);
    expect(s.started.map((e) => [e.tick, e.move, e.chained])).toEqual([
      [0, 'light-1', false],
      [34, 'light-2', true],
      [68, 'light-3', true],
      [115, 'light-1', false],
    ]);
  });

  it('a request after the chain lapsed, or for another root, starts fresh', () => {
    const late = setup();
    pressAt(late, 0, 'light-1');
    pressAt(late, 34 + CHAIN_RESET_TICKS, 'light-1');
    late.stepTo(70);
    expect(late.started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'light-1'],
      [34 + CHAIN_RESET_TICKS, 'light-1'],
    ]);
    const other = setup();
    pressAt(other, 0, 'light-1');
    pressAt(other, 30, 'heavy');
    other.stepTo(40);
    expect(other.started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'light-1'],
      [34, 'heavy'],
    ]);
  });

  it('the chain waits 30 idle ticks past recovery: started on E + 29 it continues, on E + 30 it resets', () => {
    expect(CHAIN_RESET_TICKS).toBe(30);
    const kept = setup();
    pressAt(kept, 0, 'light-1'); // ends on 34
    pressAt(kept, 34 + 29, 'light-1');
    kept.stepTo(70);
    expect(kept.started.map((e) => [e.tick, e.move, e.chained])).toEqual([
      [0, 'light-1', false],
      [63, 'light-2', true],
    ]);
    const reset = setup();
    pressAt(reset, 0, 'light-1');
    pressAt(reset, 34 + 30, 'light-1');
    reset.stepTo(70);
    expect(reset.started.map((e) => [e.tick, e.move, e.chained])).toEqual([
      [0, 'light-1', false],
      [64, 'light-1', false],
    ]);
  });

  it('only chain hits are remembered; an interrupt or another move forgets the chain', () => {
    const s = setup();
    pressAt(s, 0, 'heavy'); // no chainNext: nothing to remember
    s.stepTo(51);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.chain).toBeNull();
    pressAt(s, 51, 'light-1'); // ends on 85
    s.stepTo(86);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.chain).toEqual({
      move: 'light-1',
      idle: 0,
    });
    interruptAction(s.world, s.knight);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.chain).toBeNull();
    pressAt(s, 90, 'light-1');
    s.stepTo(91);
    expect(s.started.at(-1)).toMatchObject({ tick: 90, move: 'light-1', chained: false });
    const other = setup();
    pressAt(other, 0, 'light-1');
    pressAt(other, 40, 'heavy'); // forgets light-1
    pressAt(other, 40 + 50 + 1, 'light-1');
    other.stepTo(100);
    expect(other.started.map((e) => e.move)).toEqual(['light-1', 'heavy', 'light-1']);
  });

  it('a timeline without chain memory (older snapshots) and custom or bad chain resets', () => {
    const s = setup();
    const timeline = s.world.get(s.knight, ActionTimelineComponent);
    if (timeline === undefined) throw new Error('no timeline');
    const legacy = Object.fromEntries(Object.entries(timeline).filter(([key]) => key !== 'chain'));
    s.world.set(s.knight, ActionTimelineComponent, legacy as unknown as typeof timeline);
    requestMove(s.world, s.knight, 'light-1');
    s.steps(1);
    expect(s.started.map((e) => e.move)).toEqual(['light-1']);
    const world = new World<ActionFrame>({ seed: 1 }).register(
      ...ACTION_TIMELINE_COMPONENTS,
      StaminaComponent,
    );
    world.addSystem(actionTimelineSystem({ moves: MOVES, chainResetTicks: 0 }));
    const knight = world.spawn();
    giveActionTimeline(world, knight);
    world.step([]);
    requestMove(world, knight, 'light-1');
    for (let i = 0; i < 35; i++) world.step([]); // light-1 ends on tick 35
    requestMove(world, knight, 'light-1'); // tick 36: one idle tick later, already reset
    world.step([]);
    expect(actionOf(world, knight)?.move).toBe('light-1');
    for (const bad of [-1, 1.5]) {
      expect(() => actionTimelineSystem({ moves: MOVES, chainResetTicks: bad })).toThrow(
        RangeError,
      );
    }
  });

  it('a chain that loops back on itself still resolves', () => {
    const a = move({ id: 'a', frames: [1, 1, 1], chainNext: 'b' });
    const b = move({ id: 'b', frames: [1, 1, 1], chainNext: 'a' });
    const c = move({ id: 'c', frames: [1, 1, 1], chainNext: 'b' });
    const s = setup({ moves: table(a, b, c) });
    pressAt(s, 0, 'a');
    pressAt(s, 2, 'a'); // b at 3
    pressAt(s, 5, 'a'); // a at 6
    pressAt(s, 8, 'c'); // c's chain is c → b → a → b…: it contains a, so a's next (b)
    s.stepTo(12);
    expect(s.started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'a'],
      [3, 'b'],
      [6, 'a'],
      [9, 'b'],
    ]);
    const loop = setup({ moves: table(a, b, c) });
    pressAt(loop, 0, 'c');
    pressAt(loop, 2, 'a'); // a's chain (a → b → a…) never reaches c: a starts fresh
    loop.stepTo(5);
    expect(loop.started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'c'],
      [3, 'a'],
    ]);
  });

  it('throws for a move missing from the table', () => {
    const s = setup();
    requestMove(s.world, s.knight, 'nope');
    expect(() => {
      s.steps(1);
    }).toThrow('move "nope" is not in the timeline\'s move table');
  });
});

describe('action timeline: cancel windows', () => {
  it('AC-3: dodge pressed at recovery tick 4 executes on recovery tick 6 (the window start)', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    pressAt(s, 16 + 4, 'roll');
    s.stepTo(40);
    expect(s.started.map((e) => [e.tick, e.move, e.cancelled])).toEqual([
      [0, 'light-1', null],
      [16 + 6, 'roll', 'light-1'],
    ]);
    expect(s.ended[0]).toEqual({
      tick: 22,
      entity: s.knight,
      move: 'light-1',
      reason: 'cancelled',
      moveTick: 22,
    });
    expect(actionOf(s.world, s.knight)).toEqual({ move: 'roll', tick: 17, startedAt: 22 });
  });

  it('a roll cancels into an attack from its tick 28; the newest request is the one taken', () => {
    const s = setup();
    pressAt(s, 0, 'roll');
    pressAt(s, 20, 'light-1');
    pressAt(s, 27, 'heavy');
    s.stepTo(40);
    expect(s.started.map((e) => [e.tick, e.move, e.cancelled])).toEqual([
      [0, 'roll', null],
      [28, 'heavy', 'roll'],
    ]);
  });

  it('a window naming a move starts that move for its kind of request (mw-e04.8 roll attack)', () => {
    const rollAttack = move({ id: 'roll-attack', frames: [10, 4, 20], cost: 14 });
    const roll2 = move({
      ...{ id: 'roll', verb: 'dodge', frames: [2, 13, 21] as const, cost: 20 },
      windows: [{ into: 'attack', from: 28, to: 35, move: 'roll-attack' }],
    });
    const s = setup({ moves: table(light1, light2, light3, heavy, roll2, rollAttack) });
    pressAt(s, 0, 'roll');
    pressAt(s, 26, 'light-1');
    s.stepTo(40);
    expect(s.started.map((e) => [e.tick, e.move, e.cancelled, e.chained])).toEqual([
      [0, 'roll', null, false],
      [28, 'roll-attack', 'roll', false],
    ]);
    // Idle again, the same request starts the requested move.
    pressAt(s, 80, 'light-1');
    s.steps(1);
    expect(s.started.at(-1)?.move).toBe('light-1');
  });

  it('a cancel refused for stamina leaves the current move running', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    s.steps(1);
    emptyStamina(s);
    pressAt(s, 22, 'roll');
    s.stepTo(40);
    expect(s.started.map((e) => e.move)).toEqual(['light-1']);
    expect(s.ended.map((e) => e.reason)).toEqual(['completed']);
    expect(s.rejected.map((e) => e.reason)).toEqual(['stamina']);
  });

  it('canActNow: idle and unlocked, or inside a window of that kind', () => {
    const s = setup();
    expect(canActNow(s.world, s.knight, MOVES, 'block')).toBe(true);
    pressAt(s, 0, 'light-1');
    s.stepTo(22); // move tick 21
    expect(canActNow(s.world, s.knight, MOVES, 'dodge')).toBe(false);
    s.stepTo(23); // move tick 22
    expect(canActNow(s.world, s.knight, MOVES, 'dodge')).toBe(true);
    expect(canActNow(s.world, s.knight, MOVES, 'block')).toBe(false);
    interruptAction(s.world, s.knight, 5);
    expect(canActNow(s.world, s.knight, MOVES, 'block')).toBe(false);
    expect(() => canActNow(s.world, s.world.spawn(), MOVES, 'block')).toThrow(
      'has no action timeline',
    );
  });
});

describe('action timeline: interrupts', () => {
  it('AC-4: interrupted during startup, no hitbox ever spawns and the spent stamina is not refunded', () => {
    const s = setup();
    const hitboxTicks: number[] = [];
    s.world.addSystem({
      name: 'hitbox-probe',
      run: ({ world, tick }) => {
        if (activeHitbox(world, s.knight, MOVES) !== undefined) hitboxTicks.push(tick);
      },
    });
    pressAt(s, 0, 'light-1');
    s.stepTo(6);
    expect(staminaOf(s.world, s.knight)?.current).toBe(88);
    expect(interruptAction(s.world, s.knight)).toBe(true);
    s.stepTo(40);
    expect(hitboxTicks).toEqual([]);
    expect(s.phases.map((p) => p.phase)).toEqual(['startup']);
    expect(s.ended).toEqual([
      { tick: 6, entity: s.knight, move: 'light-1', reason: 'interrupted', moveTick: 5 },
    ]);
    // Regen may refill it later, but nothing gave the 12 points back: at tick 6 (the interrupt)
    // regen was still paused (30 ticks after the spend).
    const pool = staminaOf(s.world, s.knight);
    expect(pool?.regenResumesAt).toBe(30);
  });

  it('AC-4: without an interrupt the same move opens its hitbox on its 4 active ticks only', () => {
    const s = setup();
    const hitboxTicks: [number, number][] = [];
    s.world.addSystem({
      name: 'hitbox-probe',
      run: ({ world, tick }) => {
        const live = activeHitbox(world, s.knight, MOVES);
        if (live !== undefined) hitboxTicks.push([tick, live.moveTick]);
      },
    });
    pressAt(s, 0, 'light-1');
    s.stepTo(40);
    expect(hitboxTicks).toEqual([
      [12, 12],
      [13, 13],
      [14, 14],
      [15, 15],
    ]);
    const roll2 = setup();
    pressAt(roll2, 0, 'roll');
    roll2.stepTo(5);
    expect(activeHitbox(roll2.world, roll2.knight, MOVES)).toBeUndefined(); // no hitbox to open
  });

  it('interrupting drops the buffer and locks the entity for exactly the lock ticks', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    pressAt(s, 5, 'heavy');
    interruptAction(s.world, s.knight, 20);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.buffer).toBeNull();
    pressAt(s, 20, 'roll'); // locked through tick 24; buffered, starts on 25
    s.stepTo(40);
    expect(s.started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'light-1'],
      [25, 'roll'],
    ]);
  });

  it('interrupting an idle entity returns false; bad locks and missing timelines throw', () => {
    const s = setup();
    expect(interruptAction(s.world, s.knight)).toBe(false);
    expect(s.ended).toEqual([]);
    expect(() => interruptAction(s.world, s.knight, -1)).toThrow(RangeError);
    expect(() => interruptAction(s.world, s.knight, 1.5)).toThrow(RangeError);
    expect(() => interruptAction(s.world, s.world.spawn())).toThrow('has no action timeline');
    expect(() => {
      requestMove(s.world, s.world.spawn(), 'light-1');
    }).toThrow('has no action timeline');
  });
});

describe('action timeline: local time', () => {
  it('AC-5: 4 frozen ticks during active resume at the same offset and extend the move by exactly 4', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    s.stepTo(14); // tick 13 was move tick 13 (active)
    setTimeScale(s.world, s.knight, 0, 4);
    s.stepTo(18);
    expect(actionOf(s.world, s.knight)?.tick).toBe(13);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.timeScale).toBe(1);
    s.steps(1);
    expect(actionOf(s.world, s.knight)?.tick).toBe(14);
    s.stepTo(50);
    expect(phaseTicks(s)).toEqual([
      [0, 'light-1', 'startup'],
      [12, 'light-1', 'active'],
      [16 + 4, 'light-1', 'recovery'],
    ]);
    expect(s.ended.map((e) => [e.tick, e.moveTick])).toEqual([[34 + 4, 34]]);
  });

  it('AC-5: a freeze holds until changed without a duration, and the buffer does not age', () => {
    const s = setup();
    pressAt(s, 0, 'light-1');
    s.stepTo(30);
    setTimeScale(s.world, s.knight, 0);
    pressAt(s, 31, 'light-1'); // on move tick 29 (frozen): 5 local ticks before recovery ends
    s.stepTo(100);
    expect(actionOf(s.world, s.knight)?.tick).toBe(29);
    setTimeScale(s.world, s.knight, 1);
    s.stepTo(110);
    expect(s.started.map((e) => [e.tick, e.move])).toEqual([
      [0, 'light-1'],
      [104, 'light-2'],
    ]);
  });

  it('half speed plays a move over twice the ticks; double speed over half', () => {
    const slow = setup();
    setTimeScale(slow.world, slow.knight, 0.5);
    pressAt(slow, 0, 'light-1');
    slow.stepTo(80);
    expect(slow.phases.map((p) => p.tick)).toEqual([1, 1 + 24, 1 + 32]);
    expect(slow.ended.map((e) => e.tick)).toEqual([1 + 68]);
    const fast = setup();
    setTimeScale(fast.world, fast.knight, 2);
    pressAt(fast, 0, 'light-1');
    fast.stepTo(40);
    expect(fast.phases.map((p) => p.tick)).toEqual([0, 6, 8]);
    expect(fast.ended.map((e) => e.tick)).toEqual([17]);
  });

  it('rounds scales to 1/1000 and rejects bad scales and durations', () => {
    const s = setup();
    setTimeScale(s.world, s.knight, 1 / 3);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.timeScale).toBe(0.333);
    expect(TIME_SCALE_STEPS).toBe(1000);
    for (const bad of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => {
        setTimeScale(s.world, s.knight, bad);
      }).toThrow(RangeError);
    }
    for (const bad of [0, -1, 2.5]) {
      expect(() => {
        setTimeScale(s.world, s.knight, 0, bad);
      }).toThrow(RangeError);
    }
    expect(() => {
      setTimeScale(s.world, s.world.spawn(), 0);
    }).toThrow('has no action timeline');
  });
});

describe('action timeline: ActionFrame input', () => {
  const press = (...buttons: ButtonAction[]) =>
    actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: (b) => actionButton(buttons.includes(b), buttons.includes(b), false),
    });
  const hold = (b: ButtonAction) =>
    actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: (x) => actionButton(false, x === b, false),
    });

  it('a press of a bound button requests its move; holds and unbound buttons do nothing', () => {
    const s = setup();
    giveActionInput(s.world, s.knight, { primaryAttack: 'light-1', ability1: 'roll' });
    s.steps(1, hold('primaryAttack'));
    s.steps(1, press('jump'));
    s.steps(1, IDLE_ACTION_FRAME);
    expect(s.started).toEqual([]);
    s.steps(1, press('primaryAttack'));
    expect(s.started.map((e) => [e.tick, e.move])).toEqual([[3, 'light-1']]);
  });

  it('of two presses on one tick the later button in registry order wins', () => {
    const s = setup();
    giveActionInput(s.world, s.knight, { primaryAttack: 'light-1', ability1: 'roll' });
    s.steps(1, press('ability1', 'primaryAttack'));
    expect(s.started.map((e) => e.move)).toEqual(['roll']);
  });

  it('only entities with bindings read the frame', () => {
    const s = setup();
    s.steps(1, press('primaryAttack'));
    expect(s.started).toEqual([]);
  });
});

describe('action timeline: determinism', () => {
  it('the same requests give the same state hash tick by tick, and state round-trips snapshots', () => {
    const run = () => {
      const s = setup();
      const hashes: string[] = [];
      for (let t = 0; t < 120; t++) {
        if (t % 17 === 0) requestMove(s.world, s.knight, t % 34 === 0 ? 'light-1' : 'roll');
        if (t === 50) setTimeScale(s.world, s.knight, 0, 3);
        s.steps(1);
        hashes.push(hashWorld(s.world));
      }
      return { hashes, snapshot: s.world.snapshot() };
    };
    const a = run();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    expect(JSON.parse(JSON.stringify(a.snapshot))).toEqual(a.snapshot);
  });
});
