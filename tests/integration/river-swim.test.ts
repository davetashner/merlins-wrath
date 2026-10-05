// mw-e02.14: the River Wend as the valley scenes author it (src/content/data/scene/valley-02.json and
// valley-03.json, regions tagged water), walked headless with the controller and the water rules.
// Falling off the Miners' Bridge in heavy armor must be survivable: the character sinks 4 m to the
// bed, walks it to the ramp built up each bank, and is out of the water well inside the 20 s of
// breath; a light-armored character swims to the same ramp. Valley-02's river is a 1 m ford.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  CharacterBreath,
  CharacterController,
  characterControllerSystem,
  DEFAULT_WATER_TUNING,
  Drowning,
  FakeCollisionWorld,
  giveBreath,
  horizontalSpeed,
  layoutScene,
  spawnCharacter,
  waterSystem,
  waterTraversal,
  waterVolumes,
  World,
  type CharacterInput,
  type LoadClass,
  type Vec3,
} from '@sim/index';
import { controllerTuningFor, PLAYER_CONTROLLER_ID } from '@content/index';

const HZ = 60;
const content = loadGameContent();
const tuning = controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID));
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function valley(id: string, feet: Vec3, load: LoadClass) {
  const layout = layoutScene(content.get('scene', id), (kit) =>
    content.has('kit', kit) ? content.get('kit', kit) : undefined,
  );
  const volumes = waterVolumes(layout.regions);
  const world = new World<CharacterInput>({ seed: 7, hz: HZ });
  world.register(CharacterController, CharacterBreath);
  const entity = spawnCharacter(world, feet);
  giveBreath(world, entity, tuning.water ?? DEFAULT_WATER_TUNING, HZ);
  world.addSystem(
    characterControllerSystem<CharacterInput>({
      collision: new FakeCollisionWorld(layout.parts.flatMap((part) => part.collider ?? [])),
      tuning,
      hooks: [waterTraversal({ volumes, loadClass: () => load })],
      input: (inputs) => inputs[0],
    }),
  );
  world.addSystem(waterSystem<CharacterInput>({ volumes, tuning, loadClass: () => load }));
  let drownings = 0;
  world.events.on(Drowning, () => drownings++);
  const state = () => {
    const s = world.get(entity, CharacterController);
    if (s === undefined) throw new Error('no character');
    return s;
  };
  const air = () => world.get(entity, CharacterBreath)?.air ?? 0;
  /** Steers towards `to` (yaw so that forward points at it). */
  const toward = (to: Vec3): CharacterInput => {
    const { x, z } = state().position;
    return {
      actions: {
        move: { x: 0, y: 1 },
        jump: { pressed: false, held: false },
        sprint: { pressed: false, held: true },
        crouch: { pressed: false, held: false },
      },
      cameraYaw: Math.atan2(-(to.x - x), -(to.z - z)),
    };
  };
  const idle = toward(v(0, 0, 0));
  return {
    world,
    state,
    air,
    toward,
    idle: { ...idle, actions: { ...idle.actions, move: { x: 0, y: 0 } } },
    drownings: () => drownings,
  };
}

/** Walks the waypoints in turn (each within 0.3 m of it counts), up to `seconds`; returns seconds used. */
function follow(
  s: ReturnType<typeof valley>,
  waypoints: readonly Vec3[],
  until: () => boolean,
  seconds: number,
): { time: number; lowestAir: number } {
  let leg = 0;
  let lowestAir = Infinity;
  for (let tick = 0; tick < seconds * HZ; tick++) {
    if (until()) return { time: tick / HZ, lowestAir };
    const to = waypoints[leg] ?? waypoints[waypoints.length - 1] ?? v(0, 0, 0);
    const { x, z } = s.state().position;
    if (Math.hypot(to.x - x, to.z - z) < 0.3 && leg < waypoints.length - 1) leg++;
    s.world.step([s.toward(waypoints[leg] ?? to)]);
    lowestAir = Math.min(lowestAir, s.air());
  }
  return { time: seconds, lowestAir };
}

// The bridge deck runs along z at x -4.5..4.5; the ramps rise towards the near bank (z = 30) at
// x = 5.5..7.5 and -7.5..-5.5. Falling past the rail lands in the river at x 5, z 38.
const FALL_FROM = v(5, 0.5, 38);
const RAMP_FOOT = v(6.5, 0, 45.2);
const BANK = v(6.5, 0, 28.5);
const onBank = (s: ReturnType<typeof valley>) => () =>
  s.state().position.z < 30.5 && s.state().position.y > -0.2 && s.state().grounded;

describe('falling into the River Wend (mw-e02.14)', () => {
  it('a heavy-armored knight sinks, walks the bed to the ramp and climbs out inside the breath', () => {
    const s = valley('valley-03', FALL_FROM, 'heavy');
    // Sinks first: still on the bed after a few seconds with no input.
    for (let i = 0; i < 4 * HZ; i++) s.world.step([s.idle]);
    expect(s.state().swim?.sinking).toBe(true);
    expect(s.state().position.y).toBeCloseTo(-6, 1);
    // Then walks out.
    const out = follow(s, [RAMP_FOOT, BANK], onBank(s), 20);
    expect(onBank(s)()).toBe(true);
    expect(4 + out.time).toBeLessThan(20);
    expect(s.drownings()).toBe(0);
    expect(s.air()).toBeGreaterThan(0);
    expect(s.state().traversal).toBeNull();
  });

  it('a light-armored ranger swims to the ramp and wades out', () => {
    const s = valley('valley-03', FALL_FROM, 'light');
    for (let i = 0; i < 2 * HZ; i++) s.world.step([s.idle]);
    expect(s.state().swim).toEqual({ surface: -2, sinking: false, diving: false });
    expect(s.state().position.y).toBeLessThan(-3.2); // feet 1.2 m or more below the surface
    expect(s.state().position.y).toBeGreaterThan(-3.4);
    const out = follow(s, [RAMP_FOOT, BANK], onBank(s), 20);
    expect(onBank(s)()).toBe(true);
    expect(out.time).toBeLessThan(12);
    expect(s.drownings()).toBe(0);
    expect(out.lowestAir).toBe(20 * HZ);
  });

  it('is the same walk on the other bank and the same every time', () => {
    const run = () => {
      const s = valley('valley-03', v(-5, 0.5, 38), 'heavy');
      const out = follow(s, [v(-6.5, 0, 45.2), v(-6.5, 0, 28.5)], onBank(s), 20);
      return { out, at: s.state().position };
    };
    const first = run();
    expect(first.out.time).toBeLessThan(16);
    expect(first.at.z).toBeLessThan(30.5);
    expect(run()).toEqual(first);
  });

  it('valley-02 is a 1 m ford: everyone wades it at 60% of the run speed', () => {
    for (const load of ['light', 'heavy'] as const) {
      const s = valley('valley-02', v(-20, -3 + 0.01, 6), load);
      for (let i = 0; i < 3 * HZ; i++) s.world.step([s.toward(v(-20, -3, 40))]);
      expect(s.state().traversal).toBeNull();
      expect(horizontalSpeed(s.state())).toBeCloseTo(3, 6);
    }
  });
});
