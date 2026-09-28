import { describe, expect, it } from 'vitest';
import { loadGameContent, gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { creatureSchema, type CreatureDefInput } from './creature.ts';
import {
  AREA_REQUIREMENTS,
  LINK_REQUIREMENTS,
  LocomotionResolutionError,
  NAV_AREAS,
  NAV_BITS,
  NAV_CAPABILITIES,
  NAV_LINK_KINDS,
  canEnterArea,
  canTraverseLink,
  capabilityMask,
  deriveNavAgent,
  locomotionProfileSchema,
  locomotionSchema,
  navMask,
  resolveLocomotion,
  type LocomotionDefInput,
  type NavAgent,
} from './locomotion.ts';

const content = loadGameContent();

const walk = {
  speeds: { sneak: 1, walk: 1.5, run: 5 },
  stepHeight: 0.4,
  maxSlope: 45,
  jumpHeight: 0.6,
  maxDrop: 2.5,
  wadeDepth: 1.2,
};
const climb = { speeds: { sneak: 0.4, walk: 0.6, run: 1 }, maxGrade: 2 };
const agent = { radius: 0.35, height: 1.8 };
const profile = {
  id: 'fixture',
  name: 'Fixture',
  notes: 'Test profile.',
  agent,
  modes: { walk },
} satisfies LocomotionDefInput;

/** `path: message` of every issue parsing `value` with `schema`, or [] when it is valid. */
function problems(
  schema: { safeParse(v: unknown): { error?: { issues: Issue[] } } },
  value: unknown,
) {
  return (schema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );
}
interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** A creature file with `locomotion`. */
const creatureFile = (locomotion: CreatureDefInput['locomotion']) =>
  ({
    id: 'fixture-creature',
    family: 'animal',
    stats: { health: 10, poise: 0, mass: 30, size: 'small' },
    senses: 'beast',
    locomotion,
  }) satisfies CreatureDefInput;

/** The resolved locomotion of a creature with `locomotion`, against the game's profiles. */
const resolved = (locomotion: CreatureDefInput['locomotion']) =>
  resolveLocomotion(creatureSchema.parse(creatureFile(locomotion)).locomotion, content);

/** The NavAgent of a complete inline profile. */
const navAgent = (fields: unknown) => deriveNavAgent(locomotionProfileSchema.parse(fields));

/** The NavAgent of a game locomotion profile. */
const agentOf = (id: string) => deriveNavAgent(resolved(id));

const bit = (a: NavAgent, capability: keyof typeof NAV_BITS) =>
  (a.mask & NAV_BITS[capability]) !== 0;

describeContent('locomotion', 'passes the schema, round-trips and explains its values', (entry) => {
  expect(locomotionSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  expect(entry.notes.length).toBeGreaterThan(80); // a real explanation of the numbers
  // Referenced as-is by a creature, it resolves to exactly its fields and every creature can move.
  const fields = resolved(entry.id);
  expect({ id: entry.id, name: entry.name, notes: entry.notes, ...fields }).toEqual(entry);
  const nav = deriveNavAgent(fields);
  expect(nav.mask).not.toBe(0);
  expect(canEnterArea(nav, 'ground')).toBe(true);
});

describe('capability mask', () => {
  it('AC-1: a walk-only creature has the walk bit and no climb, fly or swim bits', () => {
    for (const nav of [agentOf('forgotten'), navAgent({ agent, modes: { walk } })]) {
      expect(bit(nav, 'walk')).toBe(true);
      expect(bit(nav, 'climb')).toBe(false);
      expect(bit(nav, 'fly')).toBe(false);
      expect(bit(nav, 'swim')).toBe(false);
      expect(nav.mask & navMask('climb', 'fly', 'swim', 'burrow', 'wallcrawl')).toBe(0);
    }
  });

  it('AC-2: climb-only links are traversable for a walker-climber and not for a walker', () => {
    const climber = navAgent({ agent, modes: { walk, climb } });
    const walker = navAgent({ agent, modes: { walk } });
    expect(LINK_REQUIREMENTS.climb).toBe(navMask('climb', 'wallcrawl'));
    expect(climber.mask & LINK_REQUIREMENTS.climb).not.toBe(0);
    expect(walker.mask & LINK_REQUIREMENTS.climb).toBe(0);
    expect(canTraverseLink(climber, { kind: 'climb', grade: 2 })).toBe(true);
    expect(canTraverseLink(walker, { kind: 'climb', grade: 1 })).toBe(false);
    // The same holds for the canon profiles: goblins climb after you, Forgotten do not.
    expect(canTraverseLink(agentOf('goblin'), { kind: 'climb', grade: 2 })).toBe(true);
    expect(canTraverseLink(agentOf('forgotten'), { kind: 'climb', grade: 1 })).toBe(false);
  });

  it('derives every bit from modes and flags; stationary is 0', () => {
    expect(NAV_CAPABILITIES.map((c) => NAV_BITS[c])).toEqual(
      NAV_CAPABILITIES.map((_, i) => 1 << i),
    );
    expect(navMask()).toBe(0);
    expect(
      capabilityMask(locomotionProfileSchema.parse({ agent, modes: { stationary: {} } })),
    ).toBe(0);
    const everything = navAgent({
      agent,
      modes: {
        walk,
        climb,
        fly: { speeds: walk.speeds, maxAltitude: 3 },
        swim: { speeds: walk.speeds, dives: true },
        burrow: { speeds: walk.speeds, materials: ['earth'] },
        wallcrawl: { speeds: walk.speeds, ceilings: false },
      },
      squeezes: true,
      opensDoors: true,
    });
    expect(everything.mask).toBe(navMask(...NAV_CAPABILITIES));
    // Wading needs walking with a wade depth above 0.
    expect(bit(navAgent({ agent, modes: { walk: { ...walk, wadeDepth: 0 } } }), 'wade')).toBe(
      false,
    );
    expect(bit(agentOf('humanoid'), 'wade')).toBe(true);
  });

  it('carries the numeric limits navigation checks, 0 for modes it lacks', () => {
    expect(agentOf('goblin')).toEqual({
      mask: navMask('walk', 'climb', 'wade', 'squeeze', 'open-doors'),
      radius: 0.3,
      height: 1.1,
      stepHeight: 0.3,
      maxSlope: 45,
      jumpHeight: 0.8,
      maxDrop: 3,
      wadeDepth: 0.5,
      maxClimbGrade: 2,
      maxAltitude: 0,
      burrowMaterials: [],
      areaCosts: { ground: 1, 'water-shallow': 1, crawlspace: 0.8 },
    });
    expect(agentOf('hushling')).toMatchObject({
      mask: navMask('fly', 'squeeze'),
      stepHeight: 0,
      maxSlope: 0,
      jumpHeight: 0,
      maxDrop: 0,
      wadeDepth: 0,
      maxClimbGrade: 0,
      maxAltitude: 1.5,
      areaCosts: { ground: 1, 'water-shallow': 1, 'water-deep': 1, crawlspace: 1 },
    });
    const mole = navAgent({
      agent: { radius: 0.2, height: 0.3 },
      modes: { burrow: { speeds: { sneak: 0.2, walk: 0.3, run: 0.5 }, materials: ['earth'] } },
    });
    expect(mole.burrowMaterials).toEqual(['earth']);
    expect(mole.areaCosts).toEqual({ ground: 1 });
  });
});

describe('links and areas', () => {
  const walker = navAgent({ agent, modes: { walk } });
  const flier = agentOf('hushling');
  const spider = agentOf('loom-spider');
  const goblin = agentOf('goblin');
  const mole = navAgent({
    agent,
    modes: { burrow: { speeds: walk.speeds, materials: ['earth', 'straw'] } },
  });

  it('jump: walkers up to jumpHeight, fliers up to maxAltitude', () => {
    expect(canTraverseLink(walker, { kind: 'jump', rise: 0.6 })).toBe(true);
    expect(canTraverseLink(walker, { kind: 'jump', rise: 0.7 })).toBe(false);
    expect(canTraverseLink(flier, { kind: 'jump', rise: 1.5 })).toBe(true);
    expect(canTraverseLink(flier, { kind: 'jump', rise: 1.6 })).toBe(false);
    expect(canTraverseLink(mole, { kind: 'jump', rise: 0 })).toBe(false);
  });

  it('drop: walkers up to maxDrop, fliers and wallcrawlers from any height', () => {
    expect(canTraverseLink(walker, { kind: 'drop', fall: 2.5 })).toBe(true);
    expect(canTraverseLink(walker, { kind: 'drop', fall: 3 })).toBe(false);
    expect(canTraverseLink(flier, { kind: 'drop', fall: 30 })).toBe(true);
    expect(canTraverseLink(spider, { kind: 'drop', fall: 30 })).toBe(true);
    expect(canTraverseLink(mole, { kind: 'drop', fall: 0 })).toBe(false);
  });

  it('climb: climbers up to their grade (world property climbable 1–3), wallcrawlers any', () => {
    expect(canTraverseLink(goblin, { kind: 'climb', grade: 2 })).toBe(true);
    expect(canTraverseLink(goblin, { kind: 'climb', grade: 3 })).toBe(false);
    expect(canTraverseLink(agentOf('humanoid'), { kind: 'climb', grade: 2 })).toBe(false);
    expect(canTraverseLink(spider, { kind: 'climb', grade: 3 })).toBe(true);
  });

  it('door, fly and burrow links need their capability (burrow: that material)', () => {
    expect(canTraverseLink(goblin, { kind: 'door' })).toBe(true);
    expect(canTraverseLink(agentOf('briar-wolf'), { kind: 'door' })).toBe(false);
    expect(canTraverseLink(flier, { kind: 'fly' })).toBe(true);
    expect(canTraverseLink(walker, { kind: 'fly' })).toBe(false);
    expect(canTraverseLink(mole, { kind: 'burrow', material: 'straw' })).toBe(true);
    expect(canTraverseLink(mole, { kind: 'burrow', material: 'stone' })).toBe(false);
    expect(canTraverseLink(walker, { kind: 'burrow', material: 'earth' })).toBe(false);
    expect(Object.keys(LINK_REQUIREMENTS)).toEqual([...NAV_LINK_KINDS]);
  });

  it('areas: wading, swimming, flying and squeezing open water and crawlspaces', () => {
    expect(Object.keys(AREA_REQUIREMENTS)).toEqual([...NAV_AREAS]);
    const wolf = agentOf('briar-wolf');
    const forgotten = agentOf('forgotten');
    const horn = agentOf('horn');
    expect(NAV_AREAS.map((area) => canEnterArea(wolf, area))).toEqual([true, true, true, false]);
    expect(NAV_AREAS.map((area) => canEnterArea(forgotten, area))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(canEnterArea(goblin, 'crawlspace')).toBe(true);
    expect(canEnterArea(horn, 'crawlspace')).toBe(false);
    expect(canEnterArea(mole, 'water-shallow')).toBe(false);
  });

  it('area costs: a swimmer that prefers water pays less there', () => {
    const otter = navAgent({
      agent,
      modes: { walk, swim: { speeds: walk.speeds, dives: true } },
      areaCosts: { 'water-deep': 0.5, ground: 1.5 },
    });
    expect(otter.areaCosts).toEqual({ ground: 1.5, 'water-shallow': 1, 'water-deep': 0.5 });
    expect(agentOf('briar-wolf').areaCosts).toEqual({
      ground: 1,
      'water-shallow': 1.5,
      'water-deep': 4,
    });
  });
});

describe('locomotion validation', () => {
  it('AC-3: a run speed lower than the walk speed fails, in files, inline and at resolve', () => {
    const slowRun = { ...walk, speeds: { sneak: 1, walk: 1.5, run: 1.2 } };
    const message =
      'modes.walk.speeds.run: modes.walk.speeds.run (1.2 m/s) must not be lower than modes.walk.speeds.walk (1.5 m/s)';
    expect(problems(locomotionSchema, { ...profile, modes: { walk: slowRun } })).toEqual([message]);
    expect(problems(creatureSchema, creatureFile({ agent, modes: { walk: slowRun } }))).toEqual([
      `locomotion.${message}`,
    ]);
    // An override is only complete once merged, so it is checked when resolved.
    expect(() => resolved({ base: 'humanoid', modes: { walk: { speeds: { run: 1.2 } } } })).toThrow(
      new LocomotionResolutionError(`invalid locomotion based on locomotion:humanoid: ${message}`),
    );
    // Sneaking faster than walking is caught the same way, in every mode.
    expect(
      problems(locomotionSchema, {
        ...profile,
        modes: { walk, climb: { ...climb, speeds: { sneak: 0.8, walk: 0.6, run: 1 } } },
      }),
    ).toEqual([
      'modes.climb.speeds.walk: modes.climb.speeds.walk (0.6 m/s) must not be lower than modes.climb.speeds.sneak (0.8 m/s)',
    ]);
  });

  it('AC-4: no locomotion modes fails; a creature that never moves declares stationary', () => {
    const message =
      'modes: at least one locomotion mode is required; a creature that never moves declares stationary';
    expect(problems(locomotionSchema, { ...profile, modes: {} })).toEqual([message]);
    expect(problems(creatureSchema, creatureFile({ agent, modes: {} }))).toEqual([
      `locomotion.${message}`,
    ]);
    expect(() => resolved({ base: 'forgotten', modes: { walk: null } })).toThrow(message);
    expect(
      problems(creatureSchema, { ...creatureFile('humanoid'), locomotion: undefined }),
    ).toEqual(['locomotion: Invalid input']);
    const still = resolved({ agent, modes: { stationary: {} } });
    expect(still.modes).toEqual({ stationary: {} });
    expect(deriveNavAgent(still).mask).toBe(0);
  });

  it('stationary must be the only mode', () => {
    expect(problems(locomotionSchema, { ...profile, modes: { walk, stationary: {} } })).toEqual([
      'modes.stationary: stationary must be the only mode (also has walk)',
    ]);
  });

  it('a step taller than the agent and a cost for an area it cannot enter fail', () => {
    expect(
      problems(locomotionSchema, {
        ...profile,
        agent: { radius: 0.3, height: 0.3 },
        areaCosts: { 'water-deep': 2, crawlspace: 2 },
      }),
    ).toEqual([
      'modes.walk.stepHeight: modes.walk.stepHeight (0.4 m) must not exceed agent.height (0.3 m)',
      'areaCosts.water-deep: areaCosts.water-deep is set but it cannot enter water-deep',
      'areaCosts.crawlspace: areaCosts.crawlspace is set but it cannot enter crawlspace',
    ]);
  });

  it('rejects out-of-range values with their paths, in profiles and overrides', () => {
    expect(
      problems(locomotionSchema, {
        ...profile,
        agent: { radius: 0, height: -1 },
        modes: {
          walk: { ...walk, maxSlope: 91, speeds: { ...walk.speeds, sneak: 0 } },
          climb: { ...climb, maxGrade: 4 },
          burrow: { speeds: walk.speeds, materials: [] },
        },
        areaCosts: { ground: 0 },
      }).map((p) => p.split(':')[0]),
    ).toEqual([
      'agent.radius',
      'agent.height',
      'modes.walk.speeds.sneak',
      'modes.walk.maxSlope',
      'modes.climb.maxGrade',
      'modes.burrow.materials',
      'areaCosts.ground',
    ]);
    expect(
      problems(
        creatureSchema,
        creatureFile({
          base: 'humanoid',
          modes: { walk: { speeds: { run: -1 } }, hover: {} } as never,
          areaCosts: { lava: 2 } as never,
        }),
      ).map((p) => p.split(':')[0]),
    ).toEqual(['locomotion.modes.walk.speeds.run', 'locomotion.modes', 'locomotion.areaCosts']);
  });

  it('an unknown burrow material or profile id fails at load with the file and pointer', () => {
    const sources = [
      ...gameContentSources(),
      {
        path: 'src/content/data/locomotion/fixture.json',
        text: JSON.stringify({
          ...profile,
          modes: { burrow: { speeds: walk.speeds, materials: ['earth', 'cheese'] } },
        }),
      },
      {
        path: 'src/content/data/creature/fixture-creature.json',
        text: JSON.stringify(creatureFile('centipede')),
      },
    ];
    let error: unknown;
    try {
      loadContent(contentTypes, sources);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ContentLoadError);
    expect((error as ContentLoadError).issues).toEqual([
      expect.objectContaining({
        file: 'src/content/data/creature/fixture-creature.json',
        pointer: '/locomotion',
      }),
      expect.objectContaining({
        file: 'src/content/data/locomotion/fixture.json',
        pointer: '/modes/burrow/materials/1',
      }),
    ]);
  });
});

describe('resolveLocomotion merge rules', () => {
  const goblin = content.get('locomotion', 'goblin');

  it('overrides replace only the named fields, gait by gait', () => {
    const kettleback = resolved({
      base: 'goblin',
      agent: { radius: 0.4 },
      modes: { walk: { speeds: { run: 4 } } },
    });
    expect(kettleback.agent).toEqual({ radius: 0.4, height: goblin.agent.height });
    expect(kettleback.modes.walk).toEqual({
      ...goblin.modes.walk,
      speeds: { ...goblin.modes.walk?.speeds, run: 4 },
    });
    expect(kettleback.modes.climb).toEqual(goblin.modes.climb);
    expect(kettleback.squeezes).toBe(true);
  });

  it('null removes a mode or resets an area cost; flags override', () => {
    const grounded = resolved({
      base: 'goblin',
      modes: { climb: null },
      squeezes: false,
      areaCosts: { crawlspace: null },
    });
    expect(Object.keys(grounded.modes)).toEqual(['walk']);
    expect(grounded.areaCosts).toEqual({});
    expect(grounded.squeezes).toBe(false);
  });

  it('a mode the base lacks must be given in full; lists replace', () => {
    expect(() => resolved({ base: 'forgotten', modes: { climb: { maxGrade: 1 } } })).toThrow(
      'modes.climb.speeds: Invalid input: expected object, received undefined',
    );
    const swimmer = resolved({
      base: 'forgotten',
      modes: { swim: { speeds: walk.speeds, dives: true } },
    });
    expect(Object.keys(swimmer.modes)).toEqual(['walk', 'swim']);
    // A lookup other than GameContent works too: here a burrowing base whose list is replaced.
    const moleProfile = locomotionSchema.parse({
      ...profile,
      modes: { burrow: { speeds: walk.speeds, materials: ['earth', 'straw'] } },
    });
    const parsed = creatureSchema.parse(
      creatureFile({ base: 'fixture', modes: { burrow: { materials: ['straw'] } } }),
    );
    const reDug = resolveLocomotion(parsed.locomotion, { resolve: () => moleProfile });
    expect(deriveNavAgent(reDug).burrowMaterials).toEqual(['straw']);
  });

  it('an inline profile must be complete and its defaults are filled', () => {
    expect(problems(creatureSchema, creatureFile({ modes: { walk } }))).toEqual([
      'locomotion.agent: Invalid input: expected object, received undefined',
    ]);
    expect(resolved({ agent, modes: { walk } })).toEqual({
      agent,
      modes: { walk },
      squeezes: false,
      opensDoors: false,
      areaCosts: {},
    });
    expect(() => resolveLocomotion({ agent, modes: {} }, content)).toThrow(
      /^invalid inline locomotion profile: modes: at least one locomotion mode/,
    );
  });
});

describe('canon', () => {
  it('fits the roster: fast wolves, climbing spiders, drifting Hushlings, huge Horn', () => {
    const runs = ['humanoid', 'forgotten', 'goblin', 'briar-wolf', 'loom-spider', 'horn'].map(
      (id) => resolved(id).modes.walk?.speeds.run ?? 0,
    );
    // Briar Wolves are the fastest walkers; the Forgotten shamble slowest.
    expect(Math.max(...runs)).toBe(resolved('briar-wolf').modes.walk?.speeds.run);
    expect(Math.min(...runs)).toBe(resolved('forgotten').modes.walk?.speeds.run);
    // Loom Spiders climb walls and ceilings; Hushlings drift, never walk.
    expect(resolved('loom-spider').modes.wallcrawl?.ceilings).toBe(true);
    expect(Object.keys(resolved('hushling').modes)).toEqual(['fly']);
    // Goblins climb and squeeze; Horn is the biggest agent and fits nowhere small.
    expect(agentOf('goblin').mask & navMask('climb', 'squeeze')).toBe(navMask('climb', 'squeeze'));
    const ids = content.all('locomotion').map((entry) => entry.id);
    const radii = ids.map((id) => content.get('locomotion', id).agent.radius);
    expect(Math.max(...radii)).toBe(content.get('locomotion', 'horn').agent.radius);
    expect(content.get('locomotion', 'horn').squeezes).toBe(false);
  });
});
