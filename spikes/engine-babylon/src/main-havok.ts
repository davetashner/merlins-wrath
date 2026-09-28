// Babylon.js + Havok (Physics V2 aggregates; Babylon steps the world inside scene.render()).
import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import type { Scene } from '@babylonjs/core/scene';
import { PHYSICS_DT } from '../../shared/scene-config.ts';
import { reportFatal, runScene, type PhysicsAdapter } from './scene.ts';

async function start(): Promise<void> {
  const hk = await HavokPhysics({ locateFile: () => havokWasmUrl });
  // false = fixed world step (PHYSICS_DT) per frame, matching the Rapier prototypes.
  const plugin = new HavokPlugin(false, hk);
  let scene: Scene | null = null;
  const bodies: PhysicsAggregate[] = [];
  const adapter: PhysicsAdapter = {
    name: 'havok',
    version: '@babylonjs/havok 1.3.14',
    enable(s) {
      scene = s;
      s.enablePhysics(new Vector3(0, -9.81, 0), plugin);
      s.getPhysicsEngine()?.setTimeStep(PHYSICS_DT);
    },
    addStaticBox(mesh) {
      new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0 }, scene!);
    },
    addStaticCylinder(mesh) {
      new PhysicsAggregate(mesh, PhysicsShapeType.CYLINDER, { mass: 0 }, scene!);
    },
    addBody(mesh, spawn) {
      const shape = spawn.kind === 'box' ? PhysicsShapeType.BOX : PhysicsShapeType.CYLINDER;
      bodies.push(new PhysicsAggregate(mesh, shape, { mass: 1, friction: 0.5, restitution: 0 }, scene!));
    },
    applyImpulse(index, [x, y, z]) {
      const a = bodies[index];
      if (a) a.body.applyImpulse(new Vector3(x, y, z), a.transformNode.getAbsolutePosition());
    },
    step() {
      // Stepped by scene.render().
    },
  };
  await runScene('babylon-havok', adapter);
}

start().catch(reportFatal);
