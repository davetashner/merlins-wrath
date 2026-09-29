// Runs the same input script on Havok through Babylon's Physics V2 API (NullEngine, no rendering).
// Havok has no world snapshot API, so "restore" here copies every body's transform and velocities into a
// freshly built world — the best a game could do — and we record whether the continuation still matches.
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody.js';
import { PhysicsShapeBox, PhysicsShapeCylinder } from '@babylonjs/core/Physics/v2/physicsShape.js';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent.js';
import { BARREL, BOX_HALF } from '../../shared/scene-config.ts';
import { FLOATS_PER_BODY, hashState, type InputScript, type RunResult } from './script.ts';

interface World {
  scene: Scene;
  plugin: HavokPlugin;
  bodies: PhysicsBody[];
  dispose(): void;
}

function build(hk: unknown, script: InputScript, state: Float64Array | null): World {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const plugin = new HavokPlugin(false, hk);
  scene.enablePhysics(new Vector3(...script.gravity), plugin);
  scene.getPhysicsEngine()!.setTimeStep(script.dt);
  const material = { friction: 0.5, restitution: 0 };
  script.statics.forEach((s, i) => {
    const node = new TransformNode(`s${String(i)}`, scene);
    node.position.set(...s.at);
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
    body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(...s.half).scale(2), scene);
    body.shape.material = material;
  });
  const bodies = script.bodies.map((b, i) => {
    const node = new TransformNode(`b${String(i)}`, scene);
    const o = i * FLOATS_PER_BODY;
    node.position.set(...(state ? ([state[o]!, state[o + 1]!, state[o + 2]!] as const) : ([b.x, b.y, b.z] as const)));
    node.rotationQuaternion = state
      ? new Quaternion(state[o + 3]!, state[o + 4]!, state[o + 5]!, state[o + 6]!)
      : Quaternion.Identity();
    const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, scene);
    body.shape =
      b.kind === 'box'
        ? new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(1, 1, 1).scale(BOX_HALF * 2), scene)
        : new PhysicsShapeCylinder(new Vector3(0, -BARREL.halfHeight, 0), new Vector3(0, BARREL.halfHeight, 0), BARREL.radius, scene);
    body.shape.material = material;
    body.setMassProperties({ mass: 1 });
    if (state) {
      body.setLinearVelocity(new Vector3(state[o + 7]!, state[o + 8]!, state[o + 9]!));
      body.setAngularVelocity(new Vector3(state[o + 10]!, state[o + 11]!, state[o + 12]!));
    }
    return body;
  });
  return {
    scene,
    plugin,
    bodies,
    dispose() {
      scene.dispose();
      engine.dispose();
    },
  };
}

function capture(w: World, out: Float64Array): Float64Array {
  const v = new Vector3();
  const a = new Vector3();
  w.bodies.forEach((b, i) => {
    const n = b.transformNode;
    const q = n.rotationQuaternion!;
    b.getLinearVelocityToRef(v);
    b.getAngularVelocityToRef(a);
    out.set([n.position.x, n.position.y, n.position.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, a.x, a.y, a.z], i * FLOATS_PER_BODY);
  });
  return out;
}

export function runHavok(hk: unknown, version: string, script: InputScript): RunResult {
  const t0 = performance.now();
  const byStep = new Map<number, InputScript['impulses']>();
  for (const imp of script.impulses) byStep.set(imp.step, [...(byStep.get(imp.step) ?? []), imp]);
  const state = new Float64Array(script.bodies.length * FLOATS_PER_BODY);
  let snapshot: Float64Array | null = null;
  const run = (w: World, from: number): string[] => {
    const checkpoints: string[] = [];
    for (let step = from; step < script.steps; step++) {
      if (step === script.snapshotAt && from === 0) snapshot = capture(w, new Float64Array(state.length));
      for (const imp of byStep.get(step) ?? []) {
        const b = w.bodies[imp.body]!;
        b.applyImpulse(new Vector3(...imp.impulse), b.transformNode.position.clone());
        b.applyAngularImpulse(new Vector3(...imp.torque));
      }
      w.plugin.executeStep(script.dt, w.bodies);
      if ((step + 1) % script.checkpointEvery === 0) checkpoints.push(hashState(capture(w, state)));
    }
    return checkpoints;
  };
  const world = build(hk, script, null);
  const checkpoints = run(world, 0);
  world.dispose();
  const snap = snapshot as Float64Array | null;
  if (!snap) throw new Error('snapshot was not taken');
  const restored = build(hk, script, snap);
  const restoredCheckpoints = run(restored, script.snapshotAt);
  restored.dispose();
  const tail = checkpoints.slice(checkpoints.length - restoredCheckpoints.length);
  return {
    engine: 'havok',
    engineVersion: version,
    steps: script.steps,
    finalHash: checkpoints[checkpoints.length - 1]!,
    checkpoints,
    snapshotBytesHash: null,
    snapshotBytes: null,
    restoredFinalHash: restoredCheckpoints[restoredCheckpoints.length - 1]!,
    restoredCheckpoints,
    restoreMatches: restoredCheckpoints.every((h, i) => h === tail[i]),
    restoreMethod: `No snapshot API: copied transforms + velocities before step ${String(script.snapshotAt)} into a new world, then replayed`,
    ms: performance.now() - t0,
  };
}
