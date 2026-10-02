// mw-e11.2: the behaviour runtime running the frozen fixture guard's behaviour content on creatures
// spawned by the creature spawner (mw-e12.4). The ADR-0005 scenario, on the AI scenario harness
// (mw-e11.3, fixtures/ai-scenarios/guard-patrol.json): the guard patrols its square, hears a thrown
// stone, climbs the ladder Unaware → Suspicious → Investigating, sneaks to the spot, looks around,
// calls it off and walks back onto its route. Run twice with one seed it hashes identically tick by
// tick (the noise written straight to its blackboard, as perception will), and a save taken
// mid-investigation continues identically after loading into a fresh world.
import { describe, expect, it } from 'vitest';
import { compileCreatures, controllerTuningFor, PLAYER_CONTROLLER_ID } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import {
  aiScenario,
  AlertStateChanged,
  brainOf,
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  hashWorld,
  installAi,
  installFactions,
  introspectBrain,
  registerCreatureComponents,
  spawnCreature,
  World,
  writeBlackboard,
  type AlertStateChange,
  type EntityId,
  type ScenarioDeps,
  type Vec3,
  type WorldSnapshot,
} from '@sim/index';
import guardPatrol from './fixtures/ai-scenarios/guard-patrol.json';

const content = loadFixtureContent();
const creatures = compileCreatures(content.all('creature'), content);
const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));
const behaviours = compileBehaviours(content.all('behaviour'));
const scenarioDeps: ScenarioDeps = {
  creatures,
  factions,
  behaviours,
  controller: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
};

const route: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 8, y: 0, z: 0 },
  { x: 8, y: 0, z: 8 },
  { x: 0, y: 0, z: 8 },
];
const NOISE_TICK = 600;
const NOISE: Vec3 = { x: 4, y: 0, z: -10 };

function build(seed = 7) {
  const world = installFactions(registerCreatureComponents(new World<never>({ seed })));
  installAi(world, { behaviours });
  const spawn = (creature: string, at: Vec3) => {
    const result = spawnCreature(world, { creatures, factions }, { creature, at, patrol: route });
    if (!result.ok) throw new Error(`spawn failed: ${result.error.kind}`);
    return result.entity;
  };
  const guard = spawn('fixture-guard', { x: 0, y: 0, z: 0 }); // the route's first waypoint
  const hound = spawn('fixture-hound', { x: 20, y: 0, z: 20 });
  const changes: AlertStateChange[] = [];
  world.events.on(AlertStateChanged, (change) => changes.push(change));
  return { world, guard, hound, changes };
}

/** Steps ticks [from, to): the noise is heard on NOISE_TICK. */
function play(world: World<never>, guard: EntityId, from: number, to: number, hashes?: string[]) {
  for (let tick = from; tick < to; tick++) {
    if (tick === NOISE_TICK) writeBlackboard(world, guard, { awareness: 0.7, stimulus: NOISE });
    world.step();
    hashes?.push(hashWorld(world));
  }
}

describe('behaviour runtime on the fixture guard', () => {
  it('spawned creatures get a brain when AI knows their behaviour profile, and none otherwise', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    const { world, guard, hound } = build();
    expect(brainOf(world, guard)).toMatchObject({
      behaviour: 'fixture-guard',
      state: 'unaware',
      traits: { curiosity: 0.5, diligence: 0.5 },
      gaits: { walk: expect.any(Number) as number },
    });
    expect(brainOf(world, guard)?.gaits.walk).toBeGreaterThan(0);
    expect(brainOf(world, hound)).toBeUndefined();
  });

  it('patrols, investigates a noise up the alert ladder, calls it off and returns to its route', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    // On the scenario harness (mw-e11.3): the player stands far out of sight and hearing and throws a
    // stone that lands 10 m off the square at 10 s; the guard hears it through the stand-in senses.
    const scenario = aiScenario(
      {
        name: 'guard-patrol',
        layout: guardPatrol,
        player: [{ wait: 10 }, { throw: [NOISE.x, NOISE.y, NOISE.z], db: 70 }],
        duration: 35,
      },
      scenarioDeps,
    );
    scenario.during(0, 10).expect('guard').state('unaware');
    scenario.during(0.1, 10).expect('guard').doing('patrol'); // from its first think
    const ladder = scenario.during(10, 10.25).expect('guard');
    ladder.enters('suspicious', 'unaware');
    ladder.enters('investigating', 'suspicious');
    // It sneaks to the noise, then looks around there, calls it off and walks back onto its route.
    scenario.at(22).expect('guard').doing('investigate');
    scenario.at(22).expect('guard').near([NOISE.x, NOISE.y, NOISE.z], 0.5);
    scenario.during(14, 26).expect('guard').enters('unaware', 'investigating');
    scenario.at(35).expect('guard').doing('patrol');
    scenario.during(0, 35).expect('guard').notState('combat');
    const result = scenario.check();
    expect(
      result.timeline.flatMap((e) => (e.kind === 'state' ? [[e.from, e.to, e.cause]] : [])),
    ).toEqual([
      ['unaware', 'suspicious', 'input:awareness'],
      ['suspicious', 'investigating', 'input:awareness'],
      ['investigating', 'unaware', 'done:investigate'],
    ]);
  });

  it('is deterministic: identical hashes every tick for one seed, and a mid-investigation save resumes identically', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    const first: string[] = [];
    const a = build();
    play(a.world, a.guard, 0, 1200, first);
    const second: string[] = [];
    const b = build();
    play(b.world, b.guard, 0, 1200, second);
    expect(second).toEqual(first);

    const saved = build();
    play(saved.world, saved.guard, 0, NOISE_TICK + 200);
    expect(introspectBrain(saved.world, saved.guard)?.state).toBe('investigating');
    const snapshot = JSON.parse(JSON.stringify(saved.world.snapshot())) as WorldSnapshot;
    const loaded = build();
    loaded.world.restore(snapshot);
    play(loaded.world, loaded.guard, NOISE_TICK + 200, 1200);
    expect(hashWorld(loaded.world)).toBe(first[first.length - 1]);
  });
});
