// Placeholder boot scene (mw-e00.19): just enough lit geometry that the first frame is visibly
// non-blank. The greybox testbed (mw-e00.21) replaces it with real content.
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three';

export interface BootScene {
  /** Advances the placeholder animation to `timeMs` (render-side time, not sim time). */
  update(timeMs: number): void;
}

export function populateBootScene(scene: Scene, camera: PerspectiveCamera): BootScene {
  scene.background = new Color(0x0b0d14);
  scene.add(new HemisphereLight(0x8090b0, 0x202018, 0.6));
  const sun = new DirectionalLight(0xfff0dd, 2);
  sun.position.set(4, 8, 5);
  scene.add(sun);

  const floor = new Mesh(
    new PlaneGeometry(20, 20),
    new MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const block = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.6 }),
  );
  block.position.set(0, 0.75, 0);
  scene.add(block);

  camera.position.set(3, 2.5, 4);
  camera.lookAt(0, 0.5, 0);

  return {
    update(timeMs) {
      block.rotation.y = timeMs * 0.0005;
    },
  };
}
