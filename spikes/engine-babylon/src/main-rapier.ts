// Babylon.js + Rapier: Babylon has no Rapier plugin, so bodies are synced to meshes by hand
// (the same ~20 lines the Three prototype uses).
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { BARREL, BOX_HALF, PHYSICS_DT } from '../../shared/scene-config.ts';
import { reportFatal, runScene, type PhysicsAdapter } from './scene.ts';

async function start(): Promise<void> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_DT;
  const bodies: RAPIER.RigidBody[] = [];
  const meshes: Mesh[] = [];
  const adapter: PhysicsAdapter = {
    name: 'rapier',
    version: RAPIER.version(),
    enable() {},
    addStaticBox(_mesh, [hx, hy, hz], [x, y, z]) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
    },
    addStaticCylinder(_mesh, halfHeight, radius, [x, y, z]) {
      world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z));
    },
    addBody(mesh, s) {
      const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(s.x, s.y, s.z));
      const cd =
        s.kind === 'box' ? RAPIER.ColliderDesc.cuboid(BOX_HALF, BOX_HALF, BOX_HALF) : RAPIER.ColliderDesc.cylinder(BARREL.halfHeight, BARREL.radius);
      world.createCollider(cd.setMass(1), rb);
      mesh.rotationQuaternion = new Quaternion();
      bodies.push(rb);
      meshes.push(mesh);
    },
    applyImpulse(index, [x, y, z]) {
      bodies[index]?.applyImpulse({ x, y, z }, true);
    },
    step() {
      world.step();
      for (let i = 0; i < bodies.length; i++) {
        const rb = bodies[i]!;
        const m = meshes[i]!;
        const p = rb.translation();
        const q = rb.rotation();
        m.position.set(p.x, p.y, p.z);
        m.rotationQuaternion!.set(q.x, q.y, q.z, q.w);
      }
    },
  };
  await runScene('babylon-rapier', adapter);
}

start().catch(reportFatal);
