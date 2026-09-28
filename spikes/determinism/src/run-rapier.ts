// Runs the input script on a Rapier module (deterministic or standard build — same API) and hashes state.
import type RAPIER_NS from '@dimforge/rapier3d-deterministic-compat';
import { BARREL, BOX_HALF } from '../../shared/scene-config.ts';
import { FLOATS_PER_BODY, hashBytes, hashState, type InputScript, type RunResult } from './script.ts';

type Rapier = typeof RAPIER_NS;

export async function runRapier(R: Rapier, engine: string, script: InputScript): Promise<RunResult> {
  await R.init();
  const t0 = performance.now();
  const world = new R.World({ x: script.gravity[0], y: script.gravity[1], z: script.gravity[2] });
  world.timestep = script.dt;
  for (const s of script.statics) {
    world.createCollider(R.ColliderDesc.cuboid(...s.half).setTranslation(...s.at));
  }
  const handles: number[] = [];
  for (const b of script.bodies) {
    const rb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(b.x, b.y, b.z));
    const cd =
      b.kind === 'box'
        ? R.ColliderDesc.cuboid(BOX_HALF, BOX_HALF, BOX_HALF)
        : R.ColliderDesc.cylinder(BARREL.halfHeight, BARREL.radius);
    world.createCollider(cd.setMass(1), rb);
    handles.push(rb.handle);
  }
  const byStep = new Map<number, InputScript['impulses']>();
  for (const imp of script.impulses) byStep.set(imp.step, [...(byStep.get(imp.step) ?? []), imp]);

  const state = new Float64Array(handles.length * FLOATS_PER_BODY);
  const hash = (w: RAPIER_NS.World): string => {
    handles.forEach((h, i) => {
      const rb = w.getRigidBody(h);
      const p = rb.translation();
      const q = rb.rotation();
      const v = rb.linvel();
      const a = rb.angvel();
      state.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, a.x, a.y, a.z], i * FLOATS_PER_BODY);
    });
    return hashState(state);
  };

  let snapshot: Uint8Array | null = null;
  const run = (w: RAPIER_NS.World, from: number): string[] => {
    const checkpoints: string[] = [];
    for (let step = from; step < script.steps; step++) {
      if (step === script.snapshotAt && from === 0) snapshot = w.takeSnapshot();
      for (const imp of byStep.get(step) ?? []) {
        const rb = w.getRigidBody(handles[imp.body]!);
        rb.applyImpulse({ x: imp.impulse[0], y: imp.impulse[1], z: imp.impulse[2] }, true);
        rb.applyTorqueImpulse({ x: imp.torque[0], y: imp.torque[1], z: imp.torque[2] }, true);
      }
      w.step();
      if ((step + 1) % script.checkpointEvery === 0) checkpoints.push(hash(w));
    }
    return checkpoints;
  };

  const checkpoints = run(world, 0);
  const snap = snapshot as Uint8Array | null;
  if (!snap) throw new Error('snapshot was not taken');
  // Restore into a brand-new world and replay the remaining steps; the checkpoints must line up.
  const restored = R.World.restoreSnapshot(snap);
  const restoredCheckpoints = run(restored, script.snapshotAt);
  const tail = checkpoints.slice(checkpoints.length - restoredCheckpoints.length);
  const result: RunResult = {
    engine,
    engineVersion: R.version(),
    steps: script.steps,
    finalHash: checkpoints[checkpoints.length - 1]!,
    checkpoints,
    snapshotBytesHash: hashBytes(snap),
    snapshotBytes: snap.length,
    restoredFinalHash: restoredCheckpoints[restoredCheckpoints.length - 1]!,
    restoredCheckpoints,
    restoreMatches: restoredCheckpoints.every((h, i) => h === tail[i]),
    restoreMethod: `World.takeSnapshot() before step ${String(script.snapshotAt)} → World.restoreSnapshot() into a new world → replay the remaining steps`,
    ms: performance.now() - t0,
  };
  world.free();
  restored.free();
  return result;
}
