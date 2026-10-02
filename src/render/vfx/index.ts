// Three.js drawing of VFX particles (mw-e29.1). The runtime (src/game/vfx) simulates particles on the
// CPU and fills one instance buffer per batch (texture × blend × flipbook grid); this draws each batch
// as one instanced mesh of camera-facing quads, uploading only the used part of the buffer each frame.
// The instance buffer IS the runtime's Float32Array, so nothing is copied and nothing is allocated
// per frame once a batch's mesh exists. Dev-build markers for unknown effects are drawn as small
// magenta diamonds.
//
// Textures load by asset id from the URL the caller resolves (the texture manifest, mw-e29.2: the
// generated placeholders until approved art lands), once per texture and only when a batch first
// draws. Until a file has loaded, or for an id the manifest lacks, the batch samples a procedural
// soft dot per flipbook cell, so nothing is requested that is not there.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright VFX smoke (e2e/vfx.spec.ts) and the opt-in perf run (e2e/vfx-perf.spec.ts).

import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DataTexture,
  DynamicDrawUsage,
  TextureLoader,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OctahedronGeometry,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  type Scene,
  type Texture,
} from 'three';

/** One draw batch, as src/game/vfx's VfxBatch provides it. */
export interface VfxDrawBatch {
  readonly key: string;
  /** Texture asset id. */
  readonly texture: string;
  readonly blend: 'additive' | 'alpha';
  readonly cols: number;
  readonly rows: number;
  /** count × (x, y, z, size, r, g, b, a, frame). */
  readonly data: Float32Array;
  readonly count: number;
}

/** Markers for unknown effects: count × (x, y, z). */
export interface VfxDrawMarkers {
  readonly data: Float32Array;
  readonly count: number;
}

export interface VfxRenderer {
  /** Brings the scene's particle meshes up to date with this frame's batches and markers. */
  draw(batches: readonly VfxDrawBatch[], markers: VfxDrawMarkers): void;
  /** Removes every VFX object from the scene and frees GPU resources. */
  dispose(): void;
}

/** Floats per instance, matching VFX_INSTANCE_FLOATS in src/game/vfx. */
const FLOATS = 9;
/** Pixels per placeholder flipbook cell. */
const CELL = 32;
const MARKER_COLOUR = 0xff00ff;
const MARKER_SIZE = 0.35;
const MAX_MARKERS = 16;

/** `items[index]` for an index known to be in range. */
const at = <T>(items: ArrayLike<T>, index: number): T => items[index] as T;

const VERTEX = /* glsl */ `
attribute vec3 offset;
attribute float size;
attribute vec4 tint;
attribute float frame;
uniform vec2 grid;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 view = modelViewMatrix * vec4(offset, 1.0);
  view.xy += position.xy * size;
  gl_Position = projectionMatrix * view;
  float column = mod(frame, grid.x);
  float row = floor(frame / grid.x);
  vUv = (vec2(column, grid.y - 1.0 - row) + uv) / grid;
  vTint = tint;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float additive;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 texel = texture2D(map, vUv);
  float alpha = vTint.a * texel.a;
  if (alpha < 0.002) discard;
  // Colours are authored in sRGB and written as-is. Additive batches premultiply by alpha.
  gl_FragColor = vec4(vTint.rgb * texel.rgb * mix(1.0, alpha, additive), alpha);
}
`;

/** Placeholder sheet: a soft dot per cell, shrinking a little frame to frame so flipbooks animate. */
function placeholderTexture(cols: number, rows: number): DataTexture {
  const width = cols * CELL;
  const height = rows * CELL;
  const pixels = new Uint8Array(width * height * 4);
  const frames = cols * rows;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const column = Math.floor(x / CELL);
      const row = rows - 1 - Math.floor(y / CELL);
      const frame = row * cols + column;
      const radius = 0.5 - (0.2 * frame) / Math.max(1, frames - 1);
      const dx = (x % CELL) / CELL - 0.5 + 0.5 / CELL;
      const dy = (y % CELL) / CELL - 0.5 + 0.5 / CELL;
      const d = Math.hypot(dx, dy) / radius;
      const alpha = d >= 1 ? 0 : (1 - d) * (1 - d);
      const i = (y * width + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A texture file loading (or loaded) for the batches that use it. */
interface TextureFile {
  texture?: Texture;
  ready: boolean;
  /** Materials still sampling the stand-in. */
  readonly waiting: ShaderMaterial[];
}

/** Points a batch material at a loaded texture. */
function setMap(material: ShaderMaterial, texture: Texture | undefined): void {
  const uniform = material.uniforms['map'];
  if (uniform !== undefined && texture !== undefined) uniform.value = texture;
}

interface BatchMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly buffer: InstancedInterleavedBuffer;
}

export interface VfxRendererOptions {
  /** URL of a texture asset id, or undefined to keep the procedural stand-in. */
  readonly textureUrl?: (textureId: string) => string | undefined;
}

export function createVfxRenderer(scene: Scene, options: VfxRendererOptions = {}): VfxRenderer {
  const meshes = new Map<string, BatchMesh>();
  const textures = new Map<string, DataTexture>();
  const files = new Map<string, TextureFile>();
  const loader = new TextureLoader();
  let disposed = false;
  let markerMesh: InstancedMesh | undefined;
  const matrix = new Matrix4();

  const textureFor = (cols: number, rows: number): DataTexture => {
    const key = `${String(cols)}x${String(rows)}`;
    let texture = textures.get(key);
    if (texture === undefined) {
      texture = placeholderTexture(cols, rows);
      textures.set(key, texture);
    }
    return texture;
  };

  /** Starts loading a batch's texture file (once per URL); each material gets it once it arrives. */
  const loadTexture = (batch: VfxDrawBatch, material: ShaderMaterial): void => {
    const url = options.textureUrl?.(batch.texture);
    if (url === undefined) return;
    let file = files.get(url);
    if (file === undefined) {
      const entry: TextureFile = { ready: false, waiting: [] };
      file = entry;
      files.set(url, entry);
      entry.texture = loader.load(
        url,
        () => {
          entry.ready = true;
          if (disposed) return;
          for (const m of entry.waiting) setMap(m, entry.texture);
          entry.waiting.length = 0;
        },
        undefined,
        () => undefined, // a missing file keeps the stand-in
      );
      entry.texture.magFilter = LinearFilter;
    }
    if (file.ready) setMap(material, file.texture);
    else file.waiting.push(material);
  };

  const meshFor = (batch: VfxDrawBatch): BatchMesh => {
    let entry = meshes.get(batch.key);
    if (entry !== undefined) return entry;
    const geometry = new InstancedBufferGeometry();
    // A unit quad centred on the origin, facing the camera (the vertex shader works in view space).
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const buffer = new InstancedInterleavedBuffer(batch.data, FLOATS, 1);
    buffer.setUsage(DynamicDrawUsage);
    geometry.setAttribute('offset', new InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('size', new InterleavedBufferAttribute(buffer, 1, 3));
    geometry.setAttribute('tint', new InterleavedBufferAttribute(buffer, 4, 4));
    geometry.setAttribute('frame', new InterleavedBufferAttribute(buffer, 1, 8));
    const additive = batch.blend === 'additive';
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        map: { value: textureFor(batch.cols, batch.rows) },
        grid: { value: [batch.cols, batch.rows] },
        additive: { value: additive ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    loadTexture(batch, material);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false; // particles spread anywhere; the budget already culls by distance
    mesh.renderOrder = additive ? 11 : 10; // smoke first, glow over it
    mesh.name = `vfx:${batch.key}`;
    scene.add(mesh);
    entry = { mesh, buffer };
    meshes.set(batch.key, entry);
    return entry;
  };

  const drawMarkers = (markers: VfxDrawMarkers): void => {
    if (markers.count === 0 && markerMesh === undefined) return;
    if (markerMesh === undefined) {
      markerMesh = new InstancedMesh(
        new OctahedronGeometry(MARKER_SIZE),
        new MeshBasicMaterial({ color: new Color(MARKER_COLOUR) }),
        MAX_MARKERS,
      );
      markerMesh.name = 'vfx:missing-markers';
      markerMesh.frustumCulled = false;
      scene.add(markerMesh);
    }
    const count = Math.min(markers.count, MAX_MARKERS);
    for (let m = 0; m < count; m++) {
      const x = at(markers.data, m * 3);
      const y = at(markers.data, m * 3 + 1);
      const z = at(markers.data, m * 3 + 2);
      markerMesh.setMatrixAt(m, matrix.makeTranslation(x, y, z));
    }
    markerMesh.count = count;
    markerMesh.instanceMatrix.needsUpdate = true;
  };

  return {
    draw(batches, markers) {
      for (const batch of batches) {
        const existing = meshes.get(batch.key);
        if (batch.count === 0) {
          if (existing) existing.mesh.visible = false;
          continue;
        }
        const { mesh, buffer } = existing ?? meshFor(batch);
        mesh.visible = true;
        mesh.geometry.instanceCount = batch.count;
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(0, batch.count * FLOATS);
        buffer.needsUpdate = true;
      }
      drawMarkers(markers);
    },
    dispose() {
      disposed = true;
      for (const file of files.values()) file.texture?.dispose();
      files.clear();
      for (const { mesh } of meshes.values()) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      meshes.clear();
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
      if (markerMesh) {
        scene.remove(markerMesh);
        markerMesh.geometry.dispose();
        (markerMesh.material as MeshBasicMaterial).dispose();
        markerMesh.dispose();
        markerMesh = undefined;
      }
    },
  };
}
