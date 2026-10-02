// mw-e11.2: the behaviour runtime running the frozen fixture guard's behaviour content on creatures
// spawned by the creature spawner (mw-e12.4). The ADR-0005 scenario: the guard patrols its square,
// hears a noise (awareness and a stimulus written to its blackboard, as perception will), climbs the
// ladder Unaware → Suspicious → Investigating, sneaks to the spot, looks around, calls it off and
// walks back onto its route. Run twice with one seed it hashes identically tick by tick, and a save
// taken mid-investigation continues identically after loading into a fresh world.
import { describe, expect, it } from 'vitest';
import { compileCreatures } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import {
  AiCuePlayed,
  AlertStateChanged,
  brainOf,
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  hashWorld,
  installAi,
  installFactions,
  introspectBrain,
  PlacementComponent,
  registerCreatureComponents,
  spawnCreature,
  World,
  writeBlackboard,
  type AlertStateChange,
  type EntityId,
  type Vec3,
  type WorldSnapshot,
} from '@sim/index';

const content = loadFixtureContent();
const creatures = compileCreatures(content.all('creature'), content);
const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));
const behaviours = compileBehaviours(content.all('behaviour'));

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
    const { world, guard, changes } = build();
    const cues: string[] = [];
    world.events.on(AiCuePlayed, ({ cue }) => cues.push(cue));
    play(world, guard, 0, NOISE_TICK);
    expect(introspectBrain(world, guard)?.path).toEqual(['unaware', 'patrol', '0:follow-route']);
    expect(introspectBrain(world, guard)?.scores[0]?.activity).toBe('patrol');
    play(world, guard, NOISE_TICK, NOISE_TICK + 12);
    expect(changes.map((c) => [c.from, c.to, c.cause])).toEqual([
      ['unaware', 'suspicious', 'input:awareness'],
      ['suspicious', 'investigating', 'input:awareness'],
    ]);
    // It sneaks to the noise, then looks around there.
    let tick = NOISE_TICK + 12;
    while (introspectBrain(world, guard)?.primitive !== 'look-around' && tick < NOISE_TICK + 900) {
      play(world, guard, tick, ++tick);
    }
    expect(introspectBrain(world, guard)?.path).toEqual([
      'investigating',
      'investigate',
      '1:look-around',
    ]);
    const there = world.get(guard, PlacementComponent);
    expect(Math.hypot((there?.x ?? 0) - NOISE.x, (there?.z ?? 0) - NOISE.z)).toBeLessThanOrEqual(
      0.5,
    );
    play(world, guard, tick, NOISE_TICK + 900);
    const at = world.get(guard, PlacementComponent);
    expect(changes.slice(2).map((c) => [c.from, c.to, c.cause])).toEqual([
      ['investigating', 'unaware', 'done:investigate'],
    ]);
    expect(brainOf(world, guard)?.blackboard).toMatchObject({ awareness: 0, stimulus: null });
    // It has walked back toward its route since.
    expect(at?.z).toBeGreaterThan(there?.z ?? 0);
    play(world, guard, NOISE_TICK + 900, NOISE_TICK + 1500);
    expect(introspectBrain(world, guard)?.activity).toBe('patrol');
    expect(cues).toEqual([]);
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
