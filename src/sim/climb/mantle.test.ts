import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SimClock } from '../clock';
import type { CollisionWorld } from '../character/collision-world';
import {
  controllerParams,
  IDLE_INPUT,
  initialCharacterState,
  SKIN,
  stepCharacter,
  type CharacterInput,
  type CharacterState,
} from '../character/controller';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { impelCharacter } from '../character/impulse';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { at as nth } from '../geom/vec';
import { assignProperty, registerWorldProperties } from '../properties/components';
import { InMemoryColliderSink } from '../physics/static-colliders';
import {
  type KitLookup,
  type KitPieceSpec,
  type LedgeOverrideSpec,
  type ScenePlacementSpec,
  type Triple,
} from '../scene/layout';
import { loadScene, registerSceneComponents, type LoadedScene } from '../scene/loader';
import type { Vec3 } from '../stimulus/shapes';
import { sceneLedges, type LedgeIndex } from './ledges';
import { DEFAULT_LEDGE_TUNING, LEDGE_HANG_CAPABILITY, ledgeSlip, ledgeTraversal } from './mantle';
import { CLIMB_ICE_CAPABILITY } from './surfaces';

/** The mw-e02.2 starting numbers, without a ledge block (the sim's ledge defaults apply). */
const BASE: Frozen<ControllerTuning> = {
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
};
/** The same with the ledge block the shipped profile states. */
const TUNED: Frozen<ControllerTuning> = { ...BASE, ledge: DEFAULT_LEDGE_TUNING };

const HZ = 60;
const DT = 1 / HZ;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const KIT: readonly KitPieceSpec[] = [
  {
    id: 'floor',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [1, 0.2, 1], offset: [0, -0.1, 0], collider: true }],
  },
  {
    id: 'box',
    purpose: 'climbable',
    parts: [{ shape: 'box', size: [1, 1, 1], offset: [0, 0.5, 0], collider: true }],
  },
  {
    id: 'wedge',
    purpose: 'walkable',
    parts: [{ shape: 'wedge', size: [1, 1, 1], offset: [0, 0.5, 0], collider: true }],
  },
];
const kit: KitLookup = (id) => KIT.find((piece) => piece.id === id);

/** A box from `min` to `max` (whole placement: its at is the bottom centre). */
function block(
  min: Triple,
  max: Triple,
  ledges?: readonly LedgeOverrideSpec[],
): ScenePlacementSpec {
  return {
    piece: { id: 'box' },
    at: [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2],
    yaw: 0,
    scale: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    ...(ledges !== undefined && { ledges }),
  };
}

const FLOOR: ScenePlacementSpec = {
  piece: { id: 'floor' },
  at: [0, 0, 0],
  yaw: 0,
  scale: [40, 1, 40],
};

/** Camera yaw looking east (+x): forward runs at the crates, right is +z. */
const EAST = -Math.PI / 2;

interface Keys {
  readonly forward?: number;
  readonly right?: number;
  readonly jump?: boolean;
  readonly crouch?: 'hold' | 'press';
  readonly yaw?: number;
}

function input({ forward = 0, right = 0, jump = false, crouch, yaw = EAST }: Keys = {}) {
  return {
    actions: {
      move: { x: right, y: forward },
      jump: { pressed: jump, held: jump },
      sprint: { pressed: false, held: false },
      crouch: { pressed: crouch === 'press', held: crouch !== undefined },
    },
    cameraYaw: yaw,
  } satisfies CharacterInput;
}

const FORWARD = input({ forward: 1 });
/** The entity the rig's character is, for capabilities. */
const PLAYER = 999 as EntityId;

interface RigOptions {
  readonly feet?: Vec3;
  readonly capabilities?: readonly string[];
  readonly tuning?: Frozen<ControllerTuning>;
}

/** A character in a scene of kit boxes, with the ledge hook, stepped by the controller. */
class Rig {
  readonly world = registerWorldProperties(registerSceneComponents(new World<never>({ seed: 3 })));
  readonly scene: LoadedScene;
  readonly index: LedgeIndex;
  readonly shapes: FakeCollisionWorld;
  /** Set to make the ground under the feet vanish from ray queries. */
  noGround = false;
  readonly collision: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  state: CharacterState;
  readonly trace: CharacterState[] = [];
  private readonly hook;

  constructor(placements: readonly ScenePlacementSpec[], options: RigOptions = {}) {
    const spec = { id: 'mantle', grid: 1, placements: [FLOOR, ...placements], spawns: [] };
    this.scene = loadScene(this.world, spec, kit, new InMemoryColliderSink());
    this.index = sceneLedges(this.scene);
    this.shapes = new FakeCollisionWorld(
      this.scene.layout.parts.flatMap((part) => (part.collider ? [part.collider] : [])),
    );
    const shapes = this.shapes;
    this.collision = {
      sweepCapsule: (...args) => shapes.sweepCapsule(...args),
      overlapCapsule: (...args) => shapes.overlapCapsule(...args),
      bodyVelocity: (body) => shapes.bodyVelocity(body),
      raycast: (origin, direction, distance) =>
        this.noGround ? undefined : shapes.raycast(origin, direction, distance),
    };
    const capabilities = options.capabilities ?? [];
    this.hook = ledgeTraversal({
      world: this.world,
      ledges: this.index,
      capabilities: (entity) => (entity === PLAYER ? capabilities : []),
    });
    this.tuning = options.tuning ?? TUNED;
    this.state = initialCharacterState(options.feet ?? v(0, 0, 0));
    this.step(IDLE_INPUT, 3);
  }

  /** The piece entity of placement `n` (the floor is 0, then the placements in order). */
  piece(n: number): EntityId {
    return nth(this.scene.pieces, n);
  }

  step(tickInput: CharacterInput = IDLE_INPUT, ticks = 1): CharacterState {
    const params = controllerParams(this.tuning, new SimClock(HZ));
    for (let i = 0; i < ticks; i++) {
      this.state = stepCharacter(this.state, tickInput, {
        world: this.collision,
        tuning: this.tuning,
        params,
        hooks: [this.hook],
        entity: PLAYER,
      });
      this.trace.push(this.state);
    }
    return this.state;
  }

  /** Steps with `tickInput` until `done` holds; the ticks taken. */
  until(tickInput: CharacterInput, done: (s: CharacterState) => boolean, limit = 600): number {
    for (let n = 1; n <= limit; n++) {
      if (done(this.step(tickInput))) return n;
    }
    throw new Error('condition never met');
  }

  /** Runs forward until the feet reach `x`, then presses jump (still running). */
  jumpAt(x: number, keys: Keys = { forward: 1 }): CharacterState {
    this.until(input(keys), (s) => s.position.x >= x);
    return this.step(input({ ...keys, jump: true }));
  }

  /** Every traversal mode the trace went through, in order, without repeats. */
  modes(): (string | null)[] {
    const modes: (string | null)[] = [];
    for (const s of this.trace) if (modes.at(-1) !== s.traversal) modes.push(s.traversal);
    return modes;
  }
}

/** A crate `height` tall whose west face is at x = 2 (4 m wide along z, 1 m deep). */
const crate = (height: number, ledges?: readonly LedgeOverrideSpec[]) =>
  block([2, 0, -2], [3, height, 2], ledges);

const HANG = [LEDGE_HANG_CAPABILITY];

/** A wall `height` tall, 4 m along z, west face at x = 2. */
const wall2 = (height: number) => block([2, 0, -2], [3, height, 2]);

describe('mantle (mw-e02.12)', () => {
  it('AC-1: jumping at a 1.4 m crate edge while running mantles onto its top in 0.6 s, grounded on it', () => {
    const rig = new Rig([crate(1.4)]);
    const started = rig.jumpAt(0.8);
    expect(started.traversal).toBe('mantle');
    expect(started.ledge?.path?.then).toBe('stand');
    const ticks = 1 + rig.until(FORWARD, (s) => s.traversal === null);
    expect(Math.abs(ticks * DT - 0.6)).toBeLessThanOrEqual(0.05);
    const top = rig.state;
    expect(top.grounded).toBe(true);
    expect(top.position.y).toBeCloseTo(1.4 + SKIN, 9);
    expect(top.position.x).toBeGreaterThan(2);
    expect(top.velocity).toEqual(v(0, 0, 0));
    expect(top.ledge).toBeUndefined();
    // …and walks on across the top as ordinary locomotion.
    rig.step(FORWARD, 5);
    expect(rig.state.grounded).toBe(true);
    expect(rig.state.position.y).toBeCloseTo(1.4 + SKIN, 9);
    // The move is a sim-driven curve: up the face first, then over the lip, never through it.
    for (const s of rig.trace) {
      if (s.position.y < 1.4) expect(s.position.x).toBeLessThanOrEqual(2 - 0.35 + 1e-9);
    }
  });

  it('AC-1: the same with the sim’s default ledge tuning; standing still, jump looks where the camera does', () => {
    const rig = new Rig([crate(1.4)], { feet: v(1.2, 0, 0), tuning: BASE });
    rig.step(input({ jump: true }));
    expect(rig.state.traversal).toBe('mantle');
    const ticks = 1 + rig.until(IDLE_INPUT, (s) => s.traversal === null);
    expect(ticks).toBe(36);
    expect(rig.state.grounded).toBe(true);
  });

  it('a jump at a low ledge mantles as fast as walking into it; a jump pressed just before landing counts', () => {
    const low = new Rig([crate(0.8)], { feet: v(1.5, 0, 0) });
    low.step(input({ jump: true }));
    expect(low.state.traversal).toBe('mantle');
    expect(low.state.ledge?.path?.ticks).toBe(24);

    const buffered = new Rig([crate(1.4)], { feet: v(1.5, 0, 0) });
    buffered.state = { ...buffered.state, jumpAge: 3 };
    expect(buffered.step(input()).traversal).toBe('mantle');
  });

  it('walking into a ledge up to 1.0 m mantles on its own, faster; a higher one blocks', () => {
    const low = new Rig([crate(0.8)]);
    low.until(FORWARD, (s) => s.traversal === 'mantle');
    const ticks = 1 + low.until(FORWARD, (s) => s.traversal === null);
    expect(ticks).toBe(24);
    expect(low.state.position.y).toBeCloseTo(0.8 + SKIN, 9);

    const high = new Rig([crate(1.2)]);
    high.step(FORWARD, 90);
    expect(high.modes()).toEqual([null]);
    expect(high.state.position.x).toBeCloseTo(2 - 0.35 - SKIN, 6);
  });

  it('a jump press further than the reach ahead jumps as ever; ledges behind or beside are ignored', () => {
    const far = new Rig([crate(1.4)]);
    far.jumpAt(0.2);
    expect(far.state.traversal).toBeNull();
    expect(far.state.grounded).toBe(false);

    // Facing away from the crate, standing right by it.
    const away = new Rig([crate(1.4)], { feet: v(1.6, 0, 0) });
    away.step(input({ jump: true, yaw: Math.PI / 2 }));
    expect(away.state.traversal).toBeNull();

    // Beside the crate's end: the ledge is not in line with the character.
    const beside = new Rig([crate(1.4)], { feet: v(1.6, 0, 2.5) });
    beside.step(input({ jump: true }));
    expect(beside.state.traversal).toBeNull();
  });

  it('AC-2: a ledge with 1.0 m headroom is refused standing; a crouched mantle is taken when the crouched capsule fits', () => {
    // A slab over the crate's top leaves exactly 1.0 m between them.
    const course = [crate(1.2), block([2, 2.2, -2], [4, 2.4, 2])];
    const refused = new Rig(course);
    refused.jumpAt(0.8);
    expect(refused.modes()).not.toContain('mantle');

    const tuning = { ...TUNED, capsule: { ...TUNED.capsule, crouchHeight: 0.9 } };
    const crouched = new Rig(course, { tuning });
    expect(crouched.jumpAt(0.8).ledge?.path?.then).toBe('crouch');
    expect(crouched.state.crouched).toBe(true);
    crouched.until(IDLE_INPUT, (s) => s.traversal === null);
    expect(crouched.state).toMatchObject({ grounded: true, crouched: true });
    expect(crouched.state.position.y).toBeCloseTo(1.2 + SKIN, 9);
    // It stays crouched under the slab.
    crouched.step(IDLE_INPUT, 5);
    expect(crouched.state.crouched).toBe(true);

    // Without the slab the same crate is mantled standing.
    const open = new Rig([crate(1.2)], { tuning });
    expect(open.jumpAt(0.8).ledge?.path?.then).toBe('stand');
  });

  it('refuses a top with no standing room, a steep top, and a path blocked overhead', () => {
    // A 0.2 m wall: nowhere to stand on it.
    const thin = new Rig([block([2, 0, -2], [2.2, 1.4, 2])]);
    thin.jumpAt(0.8);
    expect(thin.modes()).not.toContain('mantle');

    // A 45° wedge on the crate (its edge forced to be a ledge): too steep to stand on.
    const wedge: ScenePlacementSpec = {
      piece: { id: 'wedge' },
      at: [2.5, 1.2, 0],
      yaw: 90,
      scale: [4, 1, 1],
    };
    const steep = new Rig([crate(1.2, [{ side: '-x', ledge: true }]), wedge]);
    steep.jumpAt(0.8);
    expect(steep.modes()).not.toContain('mantle');

    // A beam over the approach: no room to rise.
    const beam = new Rig([crate(1.4), block([1, 2.2, -2], [2, 2.4, 2])]);
    beam.jumpAt(0.8);
    expect(beam.modes()).not.toContain('mantle');
  });

  it('needs something to hold: frozen (without ice tools) and burning ledges are refused', () => {
    const frozen = new Rig([crate(1.4)]);
    assignProperty(frozen.world, frozen.piece(1), 'frozen', true);
    frozen.jumpAt(0.8);
    expect(frozen.modes()).not.toContain('mantle');

    const iceTools = new Rig([crate(1.4)], { capabilities: [CLIMB_ICE_CAPABILITY] });
    assignProperty(iceTools.world, iceTools.piece(1), 'frozen', true);
    expect(iceTools.jumpAt(0.8).traversal).toBe('mantle');

    const burning = new Rig([crate(1.4)]);
    assignProperty(burning.world, burning.piece(1), 'burning', true);
    burning.jumpAt(0.8);
    expect(burning.modes()).not.toContain('mantle');
  });

  it('reads a full diagonal stick as unit length; a hook without capabilities gives none', () => {
    const rig = new Rig([crate(0.8)], { feet: v(1.5, 0, 0) });
    rig.step(input({ forward: 1, right: 0.5 }));
    expect(rig.state.traversal).toBe('mantle');
    const hook = ledgeTraversal({ world: rig.world, ledges: rig.index });
    const params = controllerParams(TUNED, new SimClock(HZ));
    const high = new Rig([wall2(2.1)], { feet: v(1.5, 0, 0) });
    const ctx = {
      state: high.state,
      input: input({ jump: true }),
      world: high.collision,
      tuning: TUNED,
      params,
      entity: PLAYER,
    };
    expect(ledgeTraversal({ world: high.world, ledges: high.index }).shouldEnter(ctx)).toBe(false);
    expect(hook.modes).toEqual(['mantle', 'hang']);
  });

  it('does not start while launched, recovering or in a committed move', () => {
    const rig = new Rig([crate(0.8)], { feet: v(1.6, 0, 0) });
    const rest = rig.state;
    rig.state = { ...rest, recovery: 5 };
    expect(rig.step(FORWARD).traversal).toBeNull();
    rig.state = { ...rest };
    expect(rig.step({ ...FORWARD, motion: v(1, 0, 0) }).traversal).toBeNull();
    rig.state = impelCharacter(rest, { velocity: v(0, 5, 0) });
    expect(rig.step(FORWARD).traversal).toBeNull();
  });

  it('stands a mantled character wherever the ground is, or lets it fall when there is none', () => {
    const rig = new Rig([crate(0.8)]);
    rig.until(FORWARD, (s) => s.traversal === 'mantle');
    rig.noGround = true;
    rig.until(IDLE_INPUT, (s) => s.traversal === null);
    expect(rig.state).toMatchObject({ grounded: false, jumped: true });
  });
});

describe('ledge hang (mw-e02.12)', () => {
  /** A 2.1 m wall block, 4 m along z, west face at x = 2. */
  const wall = (z0 = -2, z1 = 2, height = 2.1) => block([2, 0, z0], [3, height, z1]);

  /** A rig hanging from the west face of `course`'s first block, near z = 0. */
  function hanging(course: readonly ScenePlacementSpec[], options: RigOptions = {}): Rig {
    const rig = new Rig(course, { capabilities: HANG, ...options });
    rig.jumpAt(0.8);
    rig.until(IDLE_INPUT, (s) => s.traversal === 'hang' && s.ledge?.path === undefined);
    return rig;
  }

  it('grabs a 2.1 m ledge with a jump, and hangs with the feet 2.0 m below it', () => {
    const rig = hanging([wall()]);
    expect(rig.state.position.x).toBeCloseTo(2 - 0.35 - 2 * SKIN, 9);
    expect(rig.state.position.y).toBeCloseTo(0.1, 9);
    expect(rig.state.velocity).toEqual(v(0, 0, 0));
    expect(rig.state.grounded).toBe(false);
    // Hanging still, it stays put.
    const at = rig.state.position;
    rig.step(IDLE_INPUT, 30);
    expect(rig.state.position).toEqual(at);
    expect(rig.state.traversal).toBe('hang');
  });

  it('refuses a grab when the hang has no room, or the way there is blocked', () => {
    const OFF = [{ ledge: false }];
    // A thin shelf on the wall where the body would hang.
    const shelf = new Rig([wall(), block([1.9, 1, -2], [2, 1.2, 2], OFF)], {
      capabilities: HANG,
      feet: v(1.5, 0, 0),
    });
    shelf.step(input({ jump: true }));
    expect(shelf.modes()).toEqual([null]);
    // In the air, too.
    const air = new Rig([wall(-2, 2, 3), block([1.9, 2, -2], [2, 2.2, 2], OFF)], {
      capabilities: HANG,
      feet: v(1.5, 0.95, 0),
    });
    air.step(FORWARD, 5);
    expect(air.modes()).toEqual([null]);
    // A beam in the way of the approach, at chest height.
    const beam = new Rig([wall(), block([1.1, 1.5, -2], [1.2, 1.6, 2], OFF)], {
      capabilities: HANG,
      feet: v(0.7, 0, 0),
    });
    beam.step(input({ jump: true }));
    expect(beam.modes()).toEqual([null]);
  });

  it('does not catch in the air a ledge out of reach or that cannot be held', () => {
    const high = new Rig([wall(-2, 2, 3.3)], { capabilities: HANG, feet: v(1.5, 0.95, 0) });
    high.step(FORWARD, 5);
    expect(high.modes()).toEqual([null]);
    const frozen = new Rig([wall(-2, 2, 3)], { capabilities: HANG, feet: v(1.5, 0.95, 0) });
    assignProperty(frozen.world, frozen.piece(1), 'frozen', true);
    frozen.step(FORWARD, 5);
    expect(frozen.modes()).toEqual([null]);
  });

  it('pulls straight up from a grab lower than the hang depth', () => {
    const rig = new Rig([wall(-2, 2, 1.8)], { capabilities: HANG });
    const started = rig.jumpAt(0.8);
    expect(started.traversal).toBe('mantle');
    rig.until(IDLE_INPUT, (s) => s.traversal === null);
    expect(rig.state.position.y).toBeCloseTo(1.8 + SKIN, 9);
  });

  it('AC-3: shimmies at 1.0 m/s across a 0.2 m gap and stops at the end before a 0.6 m gap', () => {
    const rig = hanging([wall(-2, 2), wall(2.2, 3), wall(3.6, 5)]);
    const right = input({ right: 1 });
    rig.step(right);
    expect(rig.state.velocity.z).toBeCloseTo(1, 9);
    expect(rig.state.velocity.x).toBeCloseTo(0, 9);
    expect(rig.state.traversal).toBe('hang');
    const first = rig.state.ledge?.ledge;
    rig.until(right, (s) => s.velocity.z === 0);
    // Over the 0.2 m gap onto the second ledge, stopped a hand’s span (the radius) from its end.
    expect(rig.state.position.z).toBeCloseTo(3 - 0.35, 9);
    expect(rig.state.ledge?.ledge).not.toBe(first);
    expect(rig.state.traversal).toBe('hang');
    rig.step(right, 30);
    expect(rig.state.position.z).toBeCloseTo(3 - 0.35, 9);

    // Back left to the far end of the first ledge.
    const left = input({ right: -1 });
    rig.step(left);
    expect(rig.state.velocity.z).toBeCloseTo(-1, 9);
    rig.until(left, (s) => s.velocity.z === 0);
    expect(rig.state.position.z).toBeCloseTo(-2 + 0.35, 9);
    expect(rig.state.ledge?.ledge).toBe(first);
  });

  it('AC-3: stops at anything in the way, and never onto a ledge whose piece is gone', () => {
    // A post against the wall below the ledge.
    const post = block([1.4, 0, 1], [2, 1, 1.2]);
    const blocked = hanging([wall(), post]);
    const right = input({ right: 1 });
    blocked.until(right, (s) => s.velocity.z === 0);
    expect(blocked.state.position.z).toBeLessThan(1 - 0.35 + 0.02);

    // A ledge of the same height further back is not in line.
    const offset = hanging([wall(), block([4, 0, 2.1], [5, 2.1, 3])]);
    offset.until(right, (s) => s.velocity.z === 0);
    expect(offset.state.position.z).toBeCloseTo(2 - 0.35, 9);

    const gone = hanging([wall(), wall(2.1, 3)]);
    gone.world.destroy(gone.piece(2));
    gone.until(right, (s) => s.velocity.z === 0);
    expect(gone.state.position.z).toBeCloseTo(2 - 0.35, 9);
  });

  it('AC-4: a class without ledge-hang capability jumps at a 2.0 m ledge, grabs nothing and falls back', () => {
    const rig = new Rig([wall(-2, 2, 2)]);
    // Running at it, jump pressed, pushing on into the wall until the top of the jump.
    rig.jumpAt(0.8);
    rig.until(FORWARD, (s) => s.velocity.y <= 0);
    rig.step(IDLE_INPUT, 60);
    expect(rig.modes()).toEqual([null]);
    expect(rig.trace.some((s) => !s.grounded)).toBe(true);
    expect(rig.state.grounded).toBe(true);
    expect(rig.state.position.y).toBeCloseTo(SKIN, 9);
    expect(rig.state.position.x).toBeLessThan(2 - 0.35);
  });

  it('AC-5: a ledge that freezes or catches fire is let go after the 1.0 s grace time', () => {
    for (const property of ['frozen', 'burning'] as const) {
      const rig = hanging([wall()]);
      assignProperty(rig.world, rig.piece(1), property, true);
      rig.step(IDLE_INPUT, 59);
      expect(rig.state.traversal).toBe('hang');
      expect(rig.state.ledge?.slipping).toBe(59);
      rig.step();
      expect(rig.state.traversal).toBeNull();
      expect(rig.state.ledge).toBeUndefined();
      rig.until(IDLE_INPUT, (s) => s.grounded);
      expect(rig.state.position.y).toBeCloseTo(SKIN, 9);
    }
  });

  it('AC-5: the grace time restarts when the ledge can be held again; ice tools hold a frozen ledge', () => {
    const rig = hanging([wall()]);
    assignProperty(rig.world, rig.piece(1), 'frozen', true);
    rig.step(IDLE_INPUT, 40);
    assignProperty(rig.world, rig.piece(1), 'frozen', false);
    rig.step();
    expect(rig.state.ledge?.slipping).toBe(0);
    assignProperty(rig.world, rig.piece(1), 'frozen', true);
    rig.step(IDLE_INPUT, 58);
    expect(rig.state.traversal).toBe('hang');
    // Pulling up needs a hold, too.
    rig.step(input({ jump: true }));
    expect(rig.state.traversal).toBe('hang');

    const ice = hanging([wall()], { capabilities: [...HANG, CLIMB_ICE_CAPABILITY] });
    assignProperty(ice.world, ice.piece(1), 'frozen', true);
    ice.step(IDLE_INPUT, 120);
    expect(ice.state.traversal).toBe('hang');
  });

  it('lets go at once when the ledge’s piece is destroyed, or its ledge is unknown', () => {
    const rig = hanging([wall()]);
    rig.world.destroy(rig.piece(1));
    rig.step();
    expect(rig.state.traversal).toBeNull();

    const lost = hanging([wall()]);
    lost.state = { ...lost.state, ledge: { ledge: 9999, slipping: 0 } };
    expect(lost.step().traversal).toBeNull();
  });

  it('pulls up with jump when the top has room; stays hanging when it has none', () => {
    const rig = hanging([wall()]);
    rig.step(input({ jump: true }));
    expect(rig.state.traversal).toBe('mantle');
    const ticks = 1 + rig.until(IDLE_INPUT, (s) => s.traversal === null);
    expect(ticks).toBe(42);
    expect(rig.state.position.y).toBeCloseTo(2.1 + SKIN, 9);
    expect(rig.state.grounded).toBe(true);

    const low = hanging([wall(), block([2, 2.6, -2], [3, 2.8, 2])]);
    low.step(input({ jump: true }));
    expect(low.state.traversal).toBe('hang');
  });

  it('drops with crouch, and jumps back off the wall when pushing away', () => {
    const drop = hanging([wall()]);
    drop.step(input({ crouch: 'press' }));
    expect(drop.state).toMatchObject({ traversal: null, grounded: false, jumped: true });
    drop.until(IDLE_INPUT, (s) => s.grounded);

    const back = hanging([wall()]);
    back.step(input({ forward: -1, jump: true }));
    expect(back.state.traversal).toBeNull();
    expect(back.state.velocity.x).toBeCloseTo(-4, 9);
    expect(back.state.velocity.y).toBeCloseTo(6, 9);
    back.step();
    expect(back.state.position.x).toBeLessThan(2 - 0.35 - 0.05);
  });

  it('is knocked off by an impulse, keeping the launch', () => {
    const rig = hanging([wall()]);
    rig.state = impelCharacter(rig.state, { velocity: v(-3, 2, 0), stagger: true });
    rig.step();
    expect(rig.state.traversal).toBeNull();
    expect(rig.state.launch).toMatchObject({ stagger: true });
    expect(rig.state.velocity.x).toBe(-3);
  });

  it('catches a ledge in the air when moving into it: hangs from a high one, pulls up onto a low one', () => {
    // Falling beside a 3 m wall, 2.1 m below its top, moving into it.
    const high = new Rig([wall(-2, 2, 3)], { capabilities: HANG, feet: v(1.5, 0.95, 0) });
    high.until(FORWARD, (s) => s.traversal !== null);
    expect(high.state.traversal).toBe('hang');
    high.until(FORWARD, (s) => s.ledge?.path === undefined);
    expect(high.state.position.y).toBeCloseTo(1, 9);

    // A running jump from 3 m out meets the 1.4 m crate on the way down.
    const low = new Rig([crate(1.4)], { capabilities: HANG, feet: v(-2, 0, 0) });
    low.jumpAt(-1.3);
    low.until(FORWARD, (s) => s.traversal !== null);
    expect(low.state.traversal).toBe('mantle');
    low.until(FORWARD, (s) => s.traversal === null);
    expect(low.state.position.y).toBeCloseTo(1.4 + SKIN, 9);

    // Without the capability, or not moving into it, nothing catches.
    const none = new Rig([crate(1.4)], { feet: v(-2, 0, 0) });
    none.jumpAt(-1.3);
    none.step(FORWARD, 60);
    expect(none.modes()).toEqual([null]);
    const drift = new Rig([crate(1.4)], { capabilities: HANG, feet: v(1.5, 0, 0) });
    drift.step(input({ jump: true, yaw: Math.PI / 2 }));
    drift.step(IDLE_INPUT, 60);
    expect(drift.modes()).toEqual([null]);
  });

  it('lowers into a hang when crouch-walking off an edge, then climbs back up', () => {
    const rig = new Rig([wall()], { capabilities: HANG, feet: v(2.5, 2.1, 0) });
    expect(rig.state.grounded).toBe(true);
    // Walking west off the west edge, crouched.
    const west = input({ forward: -1, crouch: 'hold' });
    rig.until(west, (s) => s.traversal === 'hang');
    rig.until(IDLE_INPUT, (s) => s.ledge?.path === undefined);
    expect(rig.state.position.x).toBeCloseTo(2 - 0.35 - 2 * SKIN, 9);
    expect(rig.state.position.y).toBeCloseTo(0.1, 9);
    // Facing the wall again (camera east), jump pulls up.
    rig.step(input({ jump: true }));
    rig.until(IDLE_INPUT, (s) => s.traversal === null);
    expect(rig.state.position.y).toBeCloseTo(2.1 + SKIN, 9);

    // Crouch-walking off without the capability just walks off.
    const plain = new Rig([wall()], { feet: v(2.5, 2.1, 0) });
    plain.until(west, (s) => !s.grounded);
    expect(plain.modes()).toEqual([null]);
  });

  it('hands a traversal mode with no ledge back to locomotion', () => {
    const rig = new Rig([wall()], { capabilities: HANG });
    rig.state = { ...rig.state, traversal: 'hang' };
    expect(rig.step().traversal).toBeNull();
  });
});

describe('ledgeSlip (mw-e02.12)', () => {
  it('names why a ledge cannot be held: gone, burning, slippery; undefined when it can', () => {
    const rig = new Rig([crate(1.4)]);
    const world = rig.world;
    const piece = rig.piece(1);
    expect(ledgeSlip(world, piece, [])).toBeUndefined();
    expect(ledgeSlip(world, undefined, [])).toBe('gone');
    assignProperty(world, piece, 'frozen', true);
    expect(ledgeSlip(world, piece, [])).toBe('slippery');
    expect(ledgeSlip(world, piece, [CLIMB_ICE_CAPABILITY])).toBeUndefined();
    assignProperty(world, piece, 'burning', true);
    expect(ledgeSlip(world, piece, [CLIMB_ICE_CAPABILITY])).toBe('burning');
    world.destroy(piece);
    expect(ledgeSlip(world, piece, [])).toBe('gone');
  });
});
