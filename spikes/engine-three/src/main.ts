// Spike prototype: Three.js + Rapier (mw-e00.13). Not production code.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { gpuString, installBenchHook } from '../../shared/bench-hook.ts';
import modelUrl from '../../shared/models/RobotExpressive.glb?url';
import {
  BARREL,
  BODY_COUNT,
  BOX_HALF,
  BRAZIER,
  CAMERA,
  MODEL_SCALE,
  NPC_COUNT,
  PARTICLE_COUNT,
  PARTICLE_LIFETIME_S,
  PHYSICS_DT,
  PILLAR_HALF,
  PILLARS,
  PLAYER_CLIPS,
  POINT_LIGHT_COUNT,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  ROOM,
  SHADOW_MAP_SIZE,
  bodySpawns,
  impulsesForFrame,
  npcPlacements,
  playerState,
  pointLightState,
} from '../../shared/scene-config.ts';

const hook = installBenchHook();

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(RENDER_WIDTH, RENDER_HEIGHT, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  const camera = new THREE.PerspectiveCamera(55, RENDER_WIDTH / RENDER_HEIGHT, 0.1, 200);
  camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z);

  // Lights: dim ambient, one shadowed directional, eight dynamic point lights (no shadows).
  scene.add(new THREE.HemisphereLight(0x8090b0, 0x202018, 0.3));
  const sun = new THREE.DirectionalLight(0xfff0dd, 1.6);
  sun.position.set(12, 25, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  const pointLights: THREE.PointLight[] = [];
  for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
    const s = pointLightState(i, 0);
    const l = new THREE.PointLight(new THREE.Color(...s.color), s.intensity, s.range, 2);
    scene.add(l);
    pointLights.push(l);
  }

  // Greybox room.
  const grey = new THREE.MeshStandardMaterial({ color: 0x6b6b70, roughness: 0.9 });
  const addBlock = (hx: number, hy: number, hz: number, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), grey);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.castShadow = y > 0;
    scene.add(m);
  };
  const t = ROOM.wallThickness / 2;
  const staticBlocks: [number, number, number, number, number, number][] = [
    [ROOM.halfX, 0.5, ROOM.halfZ, 0, -0.5, 0],
    [ROOM.halfX, ROOM.wallHeight / 2, t, 0, ROOM.wallHeight / 2, -ROOM.halfZ - t],
    [ROOM.halfX, ROOM.wallHeight / 2, t, 0, ROOM.wallHeight / 2, ROOM.halfZ + t],
    [t, ROOM.wallHeight / 2, ROOM.halfZ, -ROOM.halfX - t, ROOM.wallHeight / 2, 0],
    [t, ROOM.wallHeight / 2, ROOM.halfZ, ROOM.halfX + t, ROOM.wallHeight / 2, 0],
    ...PILLARS.map(
      ([x, z]): [number, number, number, number, number, number] => [PILLAR_HALF.x, PILLAR_HALF.y, PILLAR_HALF.z, x, PILLAR_HALF.y, z],
    ),
  ];
  for (const b of staticBlocks) addBlock(...b);

  // Emissive brazier (drives bloom) with the particle emitter above it.
  const brazier = new THREE.Mesh(
    new THREE.CylinderGeometry(BRAZIER.radius, BRAZIER.radius * 0.7, 1, 16),
    new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff6a10, emissiveIntensity: 3 }),
  );
  brazier.position.set(BRAZIER.x, BRAZIER.y, BRAZIER.z);
  scene.add(brazier);

  // Physics (Rapier, one fixed 1/60 step per frame).
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_DT;
  for (const [hx, hy, hz, x, y, z] of staticBlocks) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
  }
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.5, BRAZIER.radius).setTranslation(BRAZIER.x, BRAZIER.y, BRAZIER.z));

  const boxGeo = new THREE.BoxGeometry(BOX_HALF * 2, BOX_HALF * 2, BOX_HALF * 2);
  const barrelGeo = new THREE.CylinderGeometry(BARREL.radius, BARREL.radius, BARREL.halfHeight * 2, 16);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6e2a1e, roughness: 0.6, metalness: 0.2 });
  const bodies: RAPIER.RigidBody[] = [];
  const bodyMeshes: THREE.Mesh[] = [];
  for (const s of bodySpawns()) {
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(s.x, s.y, s.z));
    const cd =
      s.kind === 'box' ? RAPIER.ColliderDesc.cuboid(BOX_HALF, BOX_HALF, BOX_HALF) : RAPIER.ColliderDesc.cylinder(BARREL.halfHeight, BARREL.radius);
    world.createCollider(cd.setMass(1), rb);
    const mesh = new THREE.Mesh(s.kind === 'box' ? boxGeo : barrelGeo, s.kind === 'box' ? boxMat : barrelMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    bodies.push(rb);
    bodyMeshes.push(mesh);
  }

  // Characters: one player blending three clips, 30 cloned skinned NPCs.
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const clip = (name: string): THREE.AnimationClip => {
    const c = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!c) throw new Error(`missing clip ${name}`);
    return c;
  };
  const prepare = (root: THREE.Object3D): void => {
    root.scale.setScalar(MODEL_SCALE);
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(root);
  };
  const player = gltf.scene;
  prepare(player);
  const playerMixer = new THREE.AnimationMixer(player);
  const playerActions = PLAYER_CLIPS.map((n) => {
    const a = playerMixer.clipAction(clip(n));
    a.play();
    return a;
  });
  const mixers: THREE.AnimationMixer[] = [playerMixer];
  for (const p of npcPlacements()) {
    const npc = SkeletonUtils.clone(gltf.scene);
    prepare(npc);
    npc.position.set(p.x, 0, p.z);
    npc.rotation.y = p.rotY;
    const m = new THREE.AnimationMixer(npc);
    m.clipAction(clip(p.clip)).play();
    m.setTime(p.timeOffset);
    mixers.push(m);
  }

  // Particle emitter: CPU-simulated additive points (Three has no built-in particle system).
  const pPos = new Float32Array(PARTICLE_COUNT * 3);
  const pVel = new Float32Array(PARTICLE_COUNT * 3);
  const pAge = new Float32Array(PARTICLE_COUNT);
  let seed = 1;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const respawn = (i: number): void => {
    pPos.set([BRAZIER.x + (rnd() - 0.5) * 0.8, BRAZIER.y + 0.5, BRAZIER.z + (rnd() - 0.5) * 0.8], i * 3);
    pVel.set([(rnd() - 0.5) * 0.6, 1.5 + rnd() * 1.5, (rnd() - 0.5) * 0.6], i * 3);
  };
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    respawn(i);
    pAge[i] = (i / PARTICLE_COUNT) * PARTICLE_LIFETIME_S;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      color: new THREE.Color(4, 1.6, 0.4),
      size: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  particles.frustumCulled = false;
  scene.add(particles);

  // Post-processing: HDR render → bloom → tone map/output.
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(RENDER_WIDTH, RENDER_HEIGHT);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(RENDER_WIDTH, RENDER_HEIGHT), 0.6, 0.4, 0.85));
  composer.addPass(new OutputPass());

  const gl = renderer.getContext();
  hook.attachGpuTimer(gl as WebGL2RenderingContext);
  hook.setInfo({
    prototype: 'three-rapier',
    renderer: 'three',
    physics: 'rapier',
    versions: { three: THREE.REVISION, rapier: RAPIER.version() },
    drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
    gpu: gpuString(gl),
    counts: { npcs: NPC_COUNT, bodies: BODY_COUNT, pointLights: POINT_LIGHT_COUNT, particles: PARTICLE_COUNT },
  });

  let frame = 0;
  const dt = PHYSICS_DT; // fixed scene time per frame so every prototype animates identically
  renderer.setAnimationLoop(() => {
    hook.frameStart();
    const time = frame * dt;

    for (const imp of impulsesForFrame(frame)) {
      const [x, y, z] = imp.impulse;
      bodies[imp.index]?.applyImpulse({ x, y, z }, true);
    }
    world.step();
    for (let i = 0; i < bodies.length; i++) {
      const rb = bodies[i]!;
      const mesh = bodyMeshes[i]!;
      const p = rb.translation();
      const q = rb.rotation();
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }

    const ps = playerState(time);
    player.position.set(ps.x, 0, ps.z);
    player.rotation.y = ps.heading;
    playerActions.forEach((a, i) => a.setEffectiveWeight(ps.weights[i] ?? 0));
    for (const m of mixers) m.update(dt);

    for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
      const s = pointLightState(i, time);
      pointLights[i]!.position.set(s.x, s.y, s.z);
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let age = pAge[i]! + dt;
      if (age >= PARTICLE_LIFETIME_S) {
        age -= PARTICLE_LIFETIME_S;
        respawn(i);
      }
      pAge[i] = age;
      const j = i * 3;
      pPos[j] = pPos[j]! + pVel[j]! * dt;
      pPos[j + 1] = pPos[j + 1]! + pVel[j + 1]! * dt;
      pPos[j + 2] = pPos[j + 2]! + pVel[j + 2]! * dt;
    }
    pGeo.attributes['position']!.needsUpdate = true;

    camera.position.set(ps.x * 0.5 + CAMERA.x, CAMERA.y, ps.z * 0.5 + CAMERA.z);
    camera.lookAt(ps.x, CAMERA.targetY, ps.z);
    composer.render();
    frame++;
    hook.frameEnd();
  });
}

main().catch((e: unknown) => {
  window.__bench.errors.push(String(e));
  throw e;
});
