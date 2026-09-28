// Spike prototype: Babylon.js scene shared by the Havok and Rapier variants (mw-e00.13). Not production code.
// Deep (side-effecting) imports keep the bundle tree-shaken the way a production build would be.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/core/Animations/animatable';
import '@babylonjs/loaders/glTF/2.0';
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
  radialSprite,
  type BodySpawn,
} from '../../shared/scene-config.ts';

/** What each physics backend must provide. Static blocks are axis-aligned boxes (half extents + centre). */
export interface PhysicsAdapter {
  name: string;
  version: string;
  enable(scene: Scene): void;
  addStaticBox(mesh: Mesh, half: readonly [number, number, number], at: readonly [number, number, number]): void;
  addStaticCylinder(mesh: Mesh, halfHeight: number, radius: number, at: readonly [number, number, number]): void;
  addBody(mesh: Mesh, spawn: BodySpawn): void;
  applyImpulse(index: number, impulse: readonly [number, number, number]): void;
  /** Called once per frame before render; backends stepped by the scene itself can make this a no-op. */
  step(): void;
}

export async function runScene(prototype: string, physics: PhysicsAdapter): Promise<void> {
  const hook = installBenchHook();
  hook.deferReady();
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const engine = new Engine(canvas, false, {
    powerPreference: 'high-performance',
    adaptToDeviceRatio: false,
    stencil: true,
  });
  engine.setSize(RENDER_WIDTH, RENDER_HEIGHT);

  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // match glTF and Three.js
  scene.clearColor = new Color4(0.02, 0.024, 0.04, 1);
  scene.useConstantAnimationDeltaTime = true; // fixed 16 ms animation step, like the Three prototype
  const camera = new FreeCamera('cam', new Vector3(CAMERA.x, CAMERA.y, CAMERA.z), scene);
  camera.fov = (55 * Math.PI) / 180;
  camera.minZ = 0.1;
  camera.maxZ = 200;

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.3;
  hemi.diffuse = Color3.FromHexString('#8090b0');
  hemi.groundColor = Color3.FromHexString('#202018');
  const sun = new DirectionalLight('sun', new Vector3(-12, -25, -8).normalize(), scene);
  sun.position = new Vector3(12, 25, 8);
  sun.intensity = 1.6;
  sun.diffuse = Color3.FromHexString('#fff0dd');
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 60;
  // Fixed shadow frustum, like the Three prototype. Babylon's default re-fits it to every caster's
  // bounding box each frame (~6% of frame CPU in a profile of this scene).
  sun.autoUpdateExtends = false;
  sun.orthoLeft = -24;
  sun.orthoRight = 24;
  sun.orthoTop = 24;
  sun.orthoBottom = -24;
  const shadows = new ShadowGenerator(SHADOW_MAP_SIZE, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  const pointLights: PointLight[] = [];
  for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
    const s = pointLightState(i, 0);
    const l = new PointLight(`pl${String(i)}`, new Vector3(s.x, s.y, s.z), scene);
    l.diffuse = new Color3(...s.color);
    l.intensity = s.intensity;
    l.range = s.range;
    l.shadowEnabled = false;
    pointLights.push(l);
  }

  const mat = (name: string, hex: string, roughness: number, metallic = 0): PBRMaterial => {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
    m.roughness = roughness;
    m.metallic = metallic;
    return m;
  };

  physics.enable(scene);

  // Greybox room.
  const grey = mat('grey', '#6b6b70', 0.9);
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
  staticBlocks.forEach(([hx, hy, hz, x, y, z], i) => {
    const m = CreateBox(`block${String(i)}`, { width: hx * 2, height: hy * 2, depth: hz * 2 }, scene);
    m.position.set(x, y, z);
    m.material = grey;
    m.receiveShadows = true;
    if (y > 0) shadows.addShadowCaster(m);
    physics.addStaticBox(m, [hx, hy, hz], [x, y, z]);
  });

  const brazier = CreateCylinder('brazier', { diameterTop: BRAZIER.radius * 2, diameterBottom: BRAZIER.radius * 1.4, height: 1, tessellation: 16 }, scene);
  brazier.position.set(BRAZIER.x, BRAZIER.y, BRAZIER.z);
  const brazierMat = mat('brazier', '#331100', 0.8);
  brazierMat.emissiveColor = Color3.FromHexString('#ff6a10').toLinearSpace();
  brazierMat.emissiveIntensity = 3;
  brazier.material = brazierMat;
  physics.addStaticCylinder(brazier, 0.5, BRAZIER.radius, [BRAZIER.x, BRAZIER.y, BRAZIER.z]);

  // 200 dynamic bodies: separate meshes sharing geometry (no instancing, same as the Three prototype).
  const boxTemplate = CreateBox('boxT', { size: BOX_HALF * 2 }, scene);
  boxTemplate.material = mat('box', '#8a5a2b', 0.8);
  const barrelTemplate = CreateCylinder('barrelT', { diameter: BARREL.radius * 2, height: BARREL.halfHeight * 2, tessellation: 16 }, scene);
  barrelTemplate.material = mat('barrel', '#6e2a1e', 0.6, 0.2);
  boxTemplate.setEnabled(false);
  barrelTemplate.setEnabled(false);
  bodySpawns().forEach((s, i) => {
    const m = (s.kind === 'box' ? boxTemplate : barrelTemplate).clone(`body${String(i)}`);
    m.setEnabled(true);
    m.position.set(s.x, s.y, s.z);
    m.receiveShadows = true;
    shadows.addShadowCaster(m);
    physics.addBody(m, s);
  });

  // Characters: one player blending three clips, 30 NPC instances of the same skinned glTF.
  const container = await LoadAssetContainerAsync(modelUrl, scene, { pluginExtension: '.glb' });
  const instantiate = (name: string, x: number, z: number, rotY: number) => {
    const holder = new TransformNode(name, scene);
    holder.position.set(x, 0, z);
    holder.rotation.y = rotY;
    holder.scaling.setAll(MODEL_SCALE);
    const entries = container.instantiateModelsToScene((n) => `${name}_${n}`, false, { doNotInstantiate: true });
    for (const root of entries.rootNodes) root.parent = holder;
    for (const m of holder.getChildMeshes()) {
      m.receiveShadows = true;
      shadows.addShadowCaster(m, false);
    }
    for (const g of entries.animationGroups) g.stop();
    const group = (clip: string) => {
      const g = entries.animationGroups.find((a) => a.name.endsWith(`_${clip}`) || a.name === clip);
      if (!g) throw new Error(`missing clip ${clip}`);
      return g;
    };
    return { holder, group };
  };
  const player = instantiate('player', 0, 0, 0);
  const playerGroups = PLAYER_CLIPS.map((c) => {
    const g = player.group(c);
    g.weight = 1 / 3;
    g.start(true);
    return g;
  });
  npcPlacements().forEach((p, i) => {
    const npc = instantiate(`npc${String(i)}`, p.x, p.z, p.rotY);
    const g = npc.group(p.clip);
    g.start(true);
    g.goToFrame(g.from + ((p.timeOffset * 60) % Math.max(1, g.to - g.from)));
  });
  // Babylon's PBR default of 4 lights per material would silently drop point lights; the scene has 10.
  for (const m of scene.materials) {
    if (m instanceof PBRMaterial) m.maxSimultaneousLights = 12;
  }

  // Particle emitter (Babylon's stock CPU particle system).
  const size = 32;
  const sprite = RawTexture.CreateRGBATexture(radialSprite(size), size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  const ps = new ParticleSystem('fire', PARTICLE_COUNT, scene);
  ps.particleTexture = sprite;
  ps.emitter = new Vector3(BRAZIER.x, BRAZIER.y + 0.5, BRAZIER.z);
  ps.minEmitBox = new Vector3(-0.4, 0, -0.4);
  ps.maxEmitBox = new Vector3(0.4, 0, 0.4);
  ps.direction1 = new Vector3(-0.3, 1.5, -0.3);
  ps.direction2 = new Vector3(0.3, 3, 0.3);
  ps.minLifeTime = ps.maxLifeTime = PARTICLE_LIFETIME_S;
  ps.emitRate = PARTICLE_COUNT / PARTICLE_LIFETIME_S;
  ps.minSize = ps.maxSize = 0.12;
  ps.color1 = ps.color2 = new Color4(4, 1.6, 0.4, 1);
  ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  ps.preWarmCycles = 120;
  ps.start();

  // Post-processing: HDR pipeline with bloom and ACES tone mapping.
  const pipeline = new DefaultRenderingPipeline('pp', true, scene, [camera]);
  pipeline.samples = 1;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.6;
  pipeline.bloomKernel = 64;
  pipeline.bloomScale = 0.5;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

  const gl = (engine as unknown as { _gl: WebGL2RenderingContext })._gl;
  hook.attachGpuTimer(gl);
  hook.setInfo({
    prototype,
    renderer: 'babylon',
    physics: physics.name,
    versions: { babylon: Engine.Version, [physics.name]: physics.version },
    drawingBuffer: { width: engine.getRenderWidth(), height: engine.getRenderHeight() },
    gpu: gpuString(gl),
    counts: { npcs: NPC_COUNT, bodies: BODY_COUNT, pointLights: POINT_LIGHT_COUNT, particles: PARTICLE_COUNT },
  });

  // Babylon compiles shaders in parallel and skips meshes whose effects are not ready yet.
  scene.executeWhenReady(() => hook.contentReady());

  let frame = 0;
  engine.runRenderLoop(() => {
    hook.frameStart();
    const time = frame * PHYSICS_DT;
    for (const imp of impulsesForFrame(frame)) physics.applyImpulse(imp.index, imp.impulse);
    physics.step();

    const st = playerState(time);
    player.holder.position.set(st.x, 0, st.z);
    player.holder.rotation.y = st.heading;
    playerGroups.forEach((g, i) => (g.weight = st.weights[i] ?? 0));

    for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
      const s = pointLightState(i, time);
      pointLights[i]!.position.set(s.x, s.y, s.z);
    }
    camera.position.set(st.x * 0.5 + CAMERA.x, CAMERA.y, st.z * 0.5 + CAMERA.z);
    camera.setTarget(new Vector3(st.x, CAMERA.targetY, st.z));
    scene.render();
    frame++;
    hook.frameEnd();
  });
}

export function reportFatal(e: unknown): never {
  window.__bench.errors.push(String(e));
  throw e;
}
