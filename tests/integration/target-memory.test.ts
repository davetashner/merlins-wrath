// mw-e11.8 AC-5: target memory with real perception (mw-e11.5), awareness (mw-e11.6) and the frozen
// fixture guard's behaviour (mw-e11.2/mw-e11.7). The guard, at its post south of a one-storey block,
// sees the player in full light and closes in; the player sprints north along the block's west
// face, breaks line of sight around its north-west corner heading east, and climbs onto the roof,
// where a parapet hides it from the ground. The guard hunts the bounded prediction from where it
// last saw the player, arrives, and searches there: its memory holds nothing of the roof. Only when
// the parapet comes down and it sees the player up there does its memory move to the ledge.
import { compileCreatures, type ControllerTuning, type Frozen } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import {
  AlertStateChanged,
  straightLineNavigation,
  type AiNavigation,
  box,
  brainOf,
  buildFactionTable,
  CharacterController,
  CharacterTuning,
  compileBehaviours,
  DEFAULT_MEMORY_TUNING,
  DEFAULT_STEALTH_TUNING,
  entitySource,
  factionSpecFromDef,
  FakeSightWorld,
  initialCharacterState,
  installAi,
  installAwareness,
  installFactions,
  LineOfSight,
  perceptionSystem,
  perceptSourcePresent,
  PlacementComponent,
  recallTarget,
  registerCreatureComponents,
  spawnCreature,
  World,
  type AlertStateChange,
  type Vec3,
} from '@sim/index';
import { describe, expect, it } from 'vitest';

const content = loadFixtureContent();
const HZ = 60;
const CONTROLLER: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
  stealth: DEFAULT_STEALTH_TUNING,
};
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const flat = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

/** The block (x 3–9, z 2–8, 3 m tall) and its roof parapet (to 5 m), which hides the roof. */
const BLOCK = box(v(3, 0, 2), v(9, 3, 8));
const PARAPET = [
  box(v(3, 3, 7.7), v(9, 5, 8)), // north
  box(v(8.7, 3, 2), v(9, 5, 8)), // east
  box(v(3, 3, 2), v(9, 5, 2.3)), // south
  box(v(3, 3, 2), v(3.3, 5, 8)), // west
];
/** Where the player ends up: the middle of the roof. */
const LEDGE = v(6, 3, 5);
/**
 * How the guard moves: straight lines, except that a leg through the block (with room for its
 * body) goes by a point off the block's north-west corner first (a navmesh stand-in).
 */
const ROUND_BLOCK = new FakeSightWorld([box(v(2.5, 0, 1.5), v(9.5, 3, 8.5))]);
const CORNER = v(2.2, 0, 8.8);
const roundTheBlock: AiNavigation = {
  travel(world, entity, request) {
    const here = world.get(entity, PlacementComponent);
    const through =
      here !== undefined &&
      ROUND_BLOCK.firstCrossing(v(here.x, 1, here.z), v(request.goal.x, 1, request.goal.z)) !==
        undefined;
    if (!through) return straightLineNavigation.travel(world, entity, request);
    const status = straightLineNavigation.travel(world, entity, {
      ...request,
      goal: CORNER,
      within: 0.1,
    });
    return status === 'failure' ? status : 'running';
  },
};
/** The player sprints at 6 m/s. */
const SPRINT = 6;

/** The player's path after it is seen: north past the block's corner, then east. */
const PATH: readonly Vec3[] = [v(1.5, 0, 0), v(1.5, 0, 10), v(6, 0, 10)];

describe('target memory without omniscience (mw-e11.8)', () => {
  it('AC-5: the player breaks line of sight around a corner and climbs to a ledge; at the last-known position the guard knows nothing of the ledge until it sees the player there', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    const world = installFactions(
      registerCreatureComponents(new World<never>({ seed: 3, hz: HZ })),
    );
    world.register(CharacterController, CharacterTuning);
    const sight = new FakeSightWorld([BLOCK, ...PARAPET]);
    const parapet = PARAPET.map((_, i) => i + 2); // body ids, after the block's 1

    // The player: stands in view for 2 s, then sprints along PATH and climbs onto the roof.
    const player = world.spawn();
    world.add(player, CharacterTuning, CONTROLLER);
    world.add(player, CharacterController, initialCharacterState(at(PATH, 0)));
    const climbed = { tick: -1 };
    world.addSystem({
      name: 'player-script',
      run({ tick }) {
        const feet = playerAt(tick);
        if (feet === LEDGE && climbed.tick < 0) climbed.tick = tick;
        world.add(player, CharacterController, initialCharacterState(feet));
      },
    });
    world.addSystem(
      perceptionSystem(world, {
        lineOfSight: new LineOfSight({ world: sight }),
        light: { levelAt: () => 1 },
        targets: () => [player],
      }),
    );
    installAi(world, {
      behaviours: compileBehaviours(content.all('behaviour')),
      navigation: roundTheBlock,
    });
    const playerSource = entitySource(player);
    installAwareness(world, {
      present: (source) => perceptSourcePresent(world, source),
      target: (source) => (source === playerSource ? player : undefined),
    });
    const spawned = spawnCreature(
      world,
      {
        creatures: compileCreatures(content.all('creature'), content),
        factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
      },
      { creature: 'fixture-guard', at: v(0, 0, -8), facing: v(0, 0, 1) },
    );
    if (!spawned.ok) throw new Error('the guard did not spawn');
    const guard = spawned.entity;
    const changes: AlertStateChange[] = [];
    world.events.on(AlertStateChanged, (c) => changes.push(c));
    const brain = () => {
      const b = brainOf(world, guard);
      if (b === undefined) throw new Error('the guard has no brain');
      return b;
    };
    const guardAt = (): Vec3 => {
      const p = world.get(guard, PlacementComponent);
      if (p === undefined) throw new Error('the guard has no placement');
      return p;
    };

    // It sees the player and closes in; the player runs and climbs out of its sight.
    for (let i = 0; i < 6 * HZ; i++) world.step();
    expect(changes.some((c) => c.to === 'combat')).toBe(true);
    expect(climbed.tick).toBeGreaterThan(0);
    const memory = recallTarget(world, guard);
    if (memory === undefined) throw new Error('the guard remembers nothing of the player');
    expect(memory.origin).toBe('own');
    expect(memory.seenTick).toBeLessThan(climbed.tick); // last seen before the climb
    // Last seen on the ground near the corner, heading east.
    expect(memory.lkp.y).toBe(0);
    expect(memory.lkp.z).toBeCloseTo(10, 0);
    expect(memory.velocity.x).toBeGreaterThan(0);

    // It hunts the prediction, gives up the chase, and searches there.
    for (let i = 0; i < 20 * HZ; i++) world.step();
    expect(brain().state).toBe('searching');
    const searched = recallTarget(world, guard);
    if (searched === undefined) throw new Error('the guard forgot the player too soon');
    expect(searched.lkp).toEqual(memory.lkp); // nothing new since
    const cap = DEFAULT_MEMORY_TUNING.predictS * SPRINT + 0.5;
    expect(flat(searched.predicted, searched.lkp)).toBeLessThanOrEqual(cap);
    expect(flat(guardAt(), searched.predicted)).toBeLessThan(1.6); // it arrived at the LKP
    // No knowledge of the ledge: not in its memory, not where it searches, not on the blackboard.
    expect(flat(searched.predicted, LEDGE)).toBeGreaterThan(4);
    expect(brain().memory.every((r) => r.lkp.y < 1)).toBe(true);
    expect(brain().blackboard.lkp).toEqual(memory.lkp);
    expect(changes.filter((c) => c.to === 'combat')).toHaveLength(1); // it never saw the player again

    // Control: the parapet comes down; once it sees the player on the roof, it knows the ledge.
    for (const body of parapet) sight.remove(body);
    let seenOnLedge = false;
    for (let i = 0; i < 30 * HZ && !seenOnLedge; i++) {
      world.step();
      seenOnLedge = (recallTarget(world, guard)?.lkp.y ?? 0) > 2;
    }
    expect(seenOnLedge).toBe(true);
    expect(recallTarget(world, guard)?.lkp).toEqual(LEDGE);
  });
});

/** Where the player's feet are on `tick`: 2 s in view, then the sprint, then the roof. */
function playerAt(tick: number): Vec3 {
  let metres = Math.max(0, tick / HZ - 2) * SPRINT;
  for (let i = 1; i < PATH.length; i++) {
    const from = at(PATH, i - 1);
    const to = at(PATH, i);
    const leg = flat(from, to);
    if (metres <= leg) {
      const t = metres / leg;
      return v(from.x + (to.x - from.x) * t, 0, from.z + (to.z - from.z) * t);
    }
    metres -= leg;
  }
  return LEDGE; // the climb itself is not the subject: it happens out of everyone's sight
}

function at<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new Error(`no item ${String(i)}`);
  return item;
}
