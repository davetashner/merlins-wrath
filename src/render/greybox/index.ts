// Greybox rendering (mw-e00.21): turns a scene layout (src/sim/scene) into Three.js objects. Kept
// cheap on purpose (AC-6: ≤ 8 ms p95 on the reference machine): all static parts of one purpose are
// merged into a single mesh, so a whole scene is at most one draw call per purpose (five), lit by a
// hemisphere light and one shadow-casting sun fitted to the scene's bounds. Materials are colour-coded
// by purpose and carry a 1 m world-space grid so distances read at a glance.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright scene smoke (e2e/scenes.spec.ts).

import type { KitPurpose } from '@content/index';
import type { SceneLayout, ScenePart, SceneSpawnPlacement } from '@sim/index';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  Quaternion,
  Vector3,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Greybox colour code by purpose (sRGB). */
export const PURPOSE_COLOURS: Readonly<Record<KitPurpose, number>> = {
  walkable: 0x8c8676,
  blocking: 0x5d6470,
  climbable: 0x4f8f5a,
  interactive: 0x3d7bc4,
  hazard: 0xc4462f,
};

const MARKER_COLOUR = 0xe8c547;
const BACKGROUND = 0x10131c;
/** Direction the sunlight comes from. */
const SUN_DIRECTION = new Vector3(0.45, 1, -0.3).normalize();
const SHADOW_MAP_SIZE = 2048;

/** A standard material with a 1 m world-space grid drawn over it. */
function gridMaterial(colour: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.9 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vGridPos;\nvarying vec3 vGridNormal;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        [
          '#include <project_vertex>',
          'vGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          'vGridNormal = normalize(mat3(modelMatrix) * objectNormal);',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vGridPos;\nvarying vec3 vGridNormal;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec3 gridN = abs(normalize(vGridNormal));',
          'vec3 gridW = max(fwidth(vGridPos) * 1.5, vec3(1e-4));',
          'vec3 gridL = 1.0 - clamp(abs(fract(vGridPos - 0.5) - 0.5) / gridW, 0.0, 1.0);',
          'float grid = max(max(gridL.x * (1.0 - gridN.x), gridL.y * (1.0 - gridN.y)), gridL.z * (1.0 - gridN.z));',
          'diffuseColor.rgb *= 1.0 - 0.3 * grid;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'greybox-grid';
  return material;
}

/** A wedge (ramp) of `size` centred on the origin, rising towards +z; flat-shaded. */
function wedgeGeometry(w: number, h: number, l: number): BufferGeometry {
  const [x0, x1, y0, y1, z0, z1] = [-w / 2, w / 2, -h / 2, h / 2, -l / 2, l / 2];
  const a = [x0, y0, z0];
  const b = [x1, y0, z0];
  const c = [x0, y0, z1];
  const d = [x1, y0, z1];
  const e = [x0, y1, z1];
  const f = [x1, y1, z1];
  // Counter-clockwise seen from outside: slope, bottom, back, left, right.
  const triangles = [a, e, f, a, f, b, a, b, d, a, d, c, c, d, f, c, f, e, a, c, e, b, f, d];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(triangles.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** One part's geometry, placed in world space. Non-indexed, position + normal only, so all merge. */
function partGeometry(part: ScenePart): BufferGeometry {
  const { size, center, rotation } = part;
  let geometry: BufferGeometry;
  if (part.shape === 'wedge') {
    geometry = wedgeGeometry(size.x, size.y, size.z);
  } else {
    const box = new BoxGeometry(size.x, size.y, size.z);
    geometry = box.toNonIndexed();
    box.dispose();
    geometry.deleteAttribute('uv');
  }
  geometry.applyMatrix4(
    new Matrix4().compose(
      new Vector3(center.x, center.y, center.z),
      new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      new Vector3(1, 1, 1),
    ),
  );
  return geometry;
}

export interface GreyboxView {
  /** The scene's static geometry: one merged mesh per purpose, added to the scene. */
  staticGeometry(layout: SceneLayout): Object3D;
  /** The object for one spawn (a prop box, or a marker cone pointing the spawn's way). */
  spawn(spawn: SceneSpawnPlacement): Object3D;
  /** Removes the lights. Scene objects are disposed through their render bindings. */
  dispose(): void;
}

/** Sets up greybox lighting in `scene` and returns the builders for scene objects. */
export function createGreyboxView(renderer: WebGLRenderer, scene: Scene): GreyboxView {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  scene.background = new Color(BACKGROUND);

  const sky = new HemisphereLight(0xc4d2ec, 0x3a3228, 1.4);
  const sun = new DirectionalLight(0xfff1dc, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sky, sun, sun.target);

  /** Points the sun at the layout and fits its shadow camera around it. */
  const fitSun = (parts: readonly ScenePart[]): void => {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const part of parts) {
      min.min(new Vector3(part.min.x, part.min.y, part.min.z));
      max.max(new Vector3(part.max.x, part.max.y, part.max.z));
    }
    const centre = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(1, max.distanceTo(min) / 2);
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(SUN_DIRECTION, radius * 2);
    const camera = sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 0.1;
    camera.far = radius * 4;
    camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  };

  return {
    staticGeometry(layout) {
      const group = new Group();
      group.name = `scene:${layout.id}`;
      const byPurpose = new Map<KitPurpose, BufferGeometry[]>();
      for (const part of layout.parts) {
        const list = byPurpose.get(part.purpose) ?? [];
        list.push(partGeometry(part));
        byPurpose.set(part.purpose, list);
      }
      for (const [purpose, geometries] of byPurpose) {
        const merged = mergeGeometries(geometries);
        for (const geometry of geometries) geometry.dispose();
        const mesh = new Mesh(merged, gridMaterial(PURPOSE_COLOURS[purpose]));
        mesh.name = purpose;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      fitSun(layout.parts);
      scene.add(group);
      return group;
    },

    spawn(spawn) {
      const group = new Group();
      group.name = `spawn:${spawn.id}`;
      let mesh: Mesh;
      if (spawn.prop === undefined) {
        // A marker: a flat cone lying down, pointing the way the spawn faces (+z at yaw 0).
        mesh = new Mesh(
          new ConeGeometry(0.3, 0.8, 12),
          new MeshStandardMaterial({ color: new Color(MARKER_COLOUR), roughness: 0.6 }),
        );
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = 0.3;
      } else {
        mesh = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), gridMaterial(PURPOSE_COLOURS.interactive));
        mesh.position.y = 0.35;
      }
      mesh.name = spawn.prop ?? 'marker';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      scene.add(group);
      return group;
    },

    dispose() {
      sun.shadow.dispose();
      scene.remove(sky, sun, sun.target);
    },
  };
}
