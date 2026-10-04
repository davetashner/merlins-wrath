// Outdoor environment of a scene (mw-ju8.1): flat sky colour, distance fog and a painted backdrop
// layer. The backdrop is one image on an open cylinder arc around the camera, drawn first with no
// depth test and no lighting, so it costs one draw call, two triangles per segment and one texture,
// whatever the level in front of it. It follows the camera in x/z (`follow`), so it never parallaxes
// at 1 and slides gently below 1. Not tiled: the image is stretched once over the arc, so there are
// no seams to hide, at the price of a fixed vista (docs/design/valley-spike.md).
//
// Backdrop images stay under assets/_incoming until the owner approves them, so they are not part
// of a production build. The layer therefore loads only in dev builds (`load: true`) and a missing
// or failing image leaves the flat sky colour: nothing throws.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright scene smoke (e2e/scenes.spec.ts) and the perf notes in docs/design/valley-spike.md.

import type { SceneBackdropDef, SceneEnvironmentDef } from '@content/index';
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Fog,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type PerspectiveCamera,
  type Scene,
} from 'three';

/** Where dev serves the unapproved backdrop images from (Vite serves the project root). */
export const BACKDROP_DEV_ROOT = '/assets/_incoming/';

export interface EnvironmentView {
  /** The backdrop card once its image has loaded (undefined: none, still loading, or missing). */
  backdrop(): Mesh | undefined;
  /** Removes the fog and backdrop and frees their GPU resources. */
  dispose(): void;
}

export interface EnvironmentOptions {
  /** Load the backdrop image. False in production builds, where the unapproved images are absent. */
  readonly load: boolean;
  /** Overrides the image root (tests, a future approved-asset path). */
  readonly root?: string;
}

/** Applies `environment` to `scene`; the flat sky and fog are immediate, the backdrop follows its image. */
export function applyEnvironment(
  scene: Scene,
  environment: SceneEnvironmentDef | undefined,
  options: EnvironmentOptions,
): EnvironmentView {
  if (environment === undefined) return { backdrop: () => undefined, dispose: () => undefined };
  if (environment.sky !== undefined) scene.background = new Color(environment.sky);
  if (environment.fog !== undefined) {
    scene.fog = new Fog(environment.fog.color, environment.fog.near, environment.fog.far);
  }
  let card: Mesh | undefined;
  let cancelled = false;
  if (options.load && environment.backdrop !== undefined) {
    const def = environment.backdrop;
    const texture = new TextureLoader().load(
      `${options.root ?? BACKDROP_DEV_ROOT}${def.image}`,
      (loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }
        card = backdropCard(def, loaded.image);
        (card.material as MeshBasicMaterial).map = loaded;
        (card.material as MeshBasicMaterial).needsUpdate = true;
        scene.add(card);
      },
      undefined,
      () => {
        console.info(`Backdrop ${def.image} not found; keeping the flat sky colour.`);
      },
    );
    texture.colorSpace = SRGBColorSpace;
    // Viewed from inside the cylinder, u runs right to left: mirror it back.
    texture.wrapS = RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  return {
    backdrop: () => card,
    dispose() {
      cancelled = true;
      scene.fog = null;
      if (card !== undefined) {
        scene.remove(card);
        card.geometry.dispose();
        (card.material as MeshBasicMaterial).map?.dispose();
        (card.material as MeshBasicMaterial).dispose();
        card = undefined;
      }
    },
  };
}

/** The card for `def`: an open cylinder arc sized so the image keeps its aspect ratio. */
function backdropCard(def: SceneBackdropDef, image: { width: number; height: number }): Mesh {
  const arc = MathUtils.degToRad(def.arc);
  const height = (def.radius * arc * image.height) / image.width;
  const start = MathUtils.degToRad(def.bearing) - arc / 2;
  const geometry = new CylinderGeometry(def.radius, def.radius, height, 32, 1, true, start, arc);
  const material = new MeshBasicMaterial({
    fog: false,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide, // faces the inside, whichever way the winding falls
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'backdrop';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.position.y = def.centreY;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const view = camera as PerspectiveCamera;
    mesh.position.x = view.position.x * def.follow;
    mesh.position.z = view.position.z * def.follow;
    mesh.updateMatrixWorld();
  };
  return mesh;
}
