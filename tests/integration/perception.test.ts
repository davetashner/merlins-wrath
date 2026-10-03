// mw-e11.5: creature perception on shipped content. The humanoid sense profile and the shipped
// stealth tuning drive sight; the Forgotten's behaviour tuning says where Suspicious starts; the
// mechanism room's real doors and sound graph route a noise to a guard in the hall, who hears it at
// the doorway rather than at the pot behind the shut door.
import {
  loadGameContent,
  materialPresets,
  STEALTH_ID,
  type ControllerTuning,
  type Frozen,
  type NavAgent,
  type SenseProfile,
} from '@content/index';
import { markExercised } from '@content/testing';
import { startMechanisms } from '@game/mechanisms/index';
import {
  CharacterController,
  CharacterTuning,
  CombatFacingComponent,
  CreatureNavComponent,
  CreatureSensesComponent,
  DEFAULT_STEALTH_TUNING,
  emitNoise,
  FakeSightWorld,
  initialCharacterState,
  InMemoryColliderSink,
  INTERACTION_COMPONENTS,
  installNoisePropagation,
  installStimuli,
  LineOfSight,
  loadScene,
  perceived,
  perceptionSystem,
  placeEntity,
  registerCreatureComponents,
  registerSceneComponents,
  registerWorldProperties,
  soundGraphFromScene,
  stimulusSystem,
  World,
  type EntityId,
  type KitLookup,
  type Percept,
  type Vec3,
} from '@sim/index';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();
const stealth = content.get('stealth', STEALTH_ID);
const { sight, hearing } = content.get('sense', 'humanoid');
const HUMANOID: Frozen<SenseProfile> = { ...(sight && { sight }), ...(hearing && { hearing }) };
const SUSPICIOUS_AT = content.get('behaviour', 'forgotten').tuning['suspiciousAt'] ?? NaN;
const kit: KitLookup = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);
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
const DEG = Math.PI / 180;

function addGuard(world: World<never>, at: Vec3, facing: Vec3): EntityId {
  const guard = world.spawn();
  world.add(guard, CreatureSensesComponent, HUMANOID);
  placeEntity(world, guard, at, 0.4);
  world.add(guard, CombatFacingComponent, { facing });
  world.add(guard, CreatureNavComponent, { height: 1.8, radius: 0.35 } as Frozen<NavAgent>);
  return guard;
}

/** What a humanoid guard at the origin facing +z perceives of the player standing at `feet`. */
function sightOf(feet: Vec3, level: number, crouched = false): Percept[] {
  const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
  world.register(CharacterController, CharacterTuning);
  const found: Percept[] = [];
  world.events.on(perceived, (report) => found.push(...report.percepts));
  world.addSystem(
    perceptionSystem(world, {
      lineOfSight: new LineOfSight({ world: new FakeSightWorld() }),
      light: { levelAt: () => level },
      visibility: stealth.visibility,
    }),
  );
  const player = world.spawn();
  world.add(player, CharacterController, { ...initialCharacterState(feet), crouched });
  world.add(player, CharacterTuning, CONTROLLER);
  addGuard(world, v(0, 0, 0), v(0, 0, 1));
  for (let i = 0; i < 6; i++) world.step();
  return found;
}

describe('creature perception on shipped content (mw-e11.5)', () => {
  it('AC-1: a humanoid sees a fully lit target 10 m away, 20° off-axis, at strength > 0.5', ({
    task,
  }) => {
    markExercised(task, 'sense', 'humanoid');
    markExercised(task, 'stealth', STEALTH_ID);
    expect(sight).toMatchObject({ primaryHalfAngle: 35, farRange: 20 });
    const [seen] = sightOf(v(10 * Math.sin(20 * DEG), 0, 10 * Math.cos(20 * DEG)), 1);
    expect(seen?.kind).toBe('seen-target');
    expect(seen?.strength).toBeGreaterThan(0.5);
  });

  it('AC-2: it does not see the target 120° off-axis', ({ task }) => {
    markExercised(task, 'sense', 'humanoid');
    expect(sightOf(v(10 * Math.sin(120 * DEG), 0, 10 * Math.cos(120 * DEG)), 1)).toEqual([]);
  });

  it('AC-4: a crouched target in deep shadow 15 m away stays under the Forgotten’s Suspicious threshold', ({
    task,
  }) => {
    markExercised(task, 'sense', 'humanoid');
    markExercised(task, 'behaviour', 'forgotten');
    expect(SUSPICIOUS_AT).toBe(0.3);
    const [seen] = sightOf(v(0, 0, 15), 0.03, true);
    expect(seen?.strength).toBeGreaterThan(0);
    expect(seen?.strength).toBeLessThan(SUSPICIOUS_AT);
  });

  it('AC-5: a pot breaking behind the west closet’s shut door is heard at the west doorway', ({
    task,
  }) => {
    markExercised(task, 'sense', 'humanoid');
    markExercised(task, 'scene', 'mechanism-room');
    const world = installStimuli(
      registerWorldProperties(registerSceneComponents(new World<never>({ seed: 9 }))),
    );
    world.register(...INTERACTION_COMPONENTS);
    registerCreatureComponents(world);
    world.addSystem(stimulusSystem());
    const colliders = new InMemoryColliderSink();
    const scene = content.get('scene', 'mechanism-room');
    const loaded = loadScene(world, scene, kit, colliders);
    startMechanisms(world, loaded, {
      content,
      materials: materialPresets(content.all('material')),
      colliders,
      occluders: new InMemoryColliderSink(),
    });
    installNoisePropagation(world, {
      graph: soundGraphFromScene(scene, loaded),
      tuning: stealth.noise,
      doorMaterial: (profile) => content.get('door', profile).material.id,
    });
    const levels: number[] = [];
    world.addSystem(
      perceptionSystem(world, {
        lineOfSight: new LineOfSight({ world: new FakeSightWorld() }),
        light: { levelAt: () => 0 },
        trace: { heard: (_, heard) => levels.push(heard.level) },
      }),
    );
    const guard = addGuard(world, v(0, 0, -2), v(1, 0, 0));
    const found: Percept[] = [];
    world.events.on(perceived, (report) => {
      if (report.agent === guard) found.push(...report.percepts);
    });
    world.step(); // the guard becomes a listener
    const pot = v(-6, 1, 0);
    emitNoise(world, { position: pot, loudness: 75, kind: 'pot' });
    for (let i = 0; i < 6; i++) world.step();
    expect(levels).toHaveLength(1);
    expect(levels[0]).toBeGreaterThan(HUMANOID.hearing?.thresholdDb ?? Infinity);
    expect(found).toEqual([
      expect.objectContaining({
        kind: 'heard-noise',
        source: 'sound:pot',
        position: v(-5, 1, 0),
      }) as Percept,
    ]);
    expect(found[0]?.position).not.toEqual(pot);
  });
});
