// The benchmark scene, described once so every prototype builds exactly the same thing (mw-e00.13).
// Everything here is plain data or pure functions of the frame number: no engine types, no wall clock,
// no Math.random. Each prototype only translates this description into its own engine.

/** Fixed render resolution (1440p-equivalent, contract §1 High preset), independent of devicePixelRatio. */
export const RENDER_WIDTH = 2560;
export const RENDER_HEIGHT = 1440;

export const ROOM = { halfX: 20, halfZ: 20, wallHeight: 6, wallThickness: 1 } as const;
export const PILLARS: readonly (readonly [number, number])[] = [
  [-10, -10],
  [10, -10],
  [-10, 10],
  [10, 10],
  [0, -14],
  [0, 14],
];
export const PILLAR_HALF = { x: 0.8, y: ROOM.wallHeight / 2, z: 0.8 } as const;

export const NPC_COUNT = 30;
export const BODY_COUNT = 200;
export const POINT_LIGHT_COUNT = 8;
export const PARTICLE_COUNT = 2000;
export const PARTICLE_LIFETIME_S = 2;
export const SHADOW_MAP_SIZE = 2048;
/** One physics step of 1/60 s per rendered frame in every prototype, so physics cost per frame is equal. */
export const PHYSICS_DT = 1 / 60;

export const BOX_HALF = 0.4;
export const BARREL = { radius: 0.35, halfHeight: 0.5 } as const;

/** Player animation clips blended by weight (RobotExpressive clip names). */
export const PLAYER_CLIPS = ['Idle', 'Walking', 'Running'] as const;
export const NPC_CLIPS = ['Walking', 'Dance', 'Idle', 'Wave', 'Running', 'Punch'] as const;
export const MODEL_SCALE = 0.45;

export const BRAZIER = { x: 0, y: 0.5, z: 0, radius: 0.6 } as const;

export interface BodySpawn {
  kind: 'box' | 'barrel';
  x: number;
  y: number;
  z: number;
}

/** 200 bodies in a loose 10×10 grid, two layers, alternating boxes and barrels, dropped from height. */
export function bodySpawns(): BodySpawn[] {
  const out: BodySpawn[] = [];
  for (let i = 0; i < BODY_COUNT; i++) {
    const layer = Math.floor(i / 100);
    const cell = i % 100;
    const gx = cell % 10;
    const gz = Math.floor(cell / 10);
    out.push({
      kind: i % 2 === 0 ? 'box' : 'barrel',
      x: -13.5 + gx * 3 + (layer ? 0.7 : 0),
      y: 3 + layer * 2.5 + (cell % 3) * 0.4,
      z: -13.5 + gz * 3 + (layer ? 0.7 : 0),
    });
  }
  return out;
}

export interface NpcPlacement {
  x: number;
  z: number;
  rotY: number;
  clip: (typeof NPC_CLIPS)[number];
  timeOffset: number;
}

/** 30 NPCs on a ring round the room, each playing a clip with a phase offset. */
export function npcPlacements(): NpcPlacement[] {
  const out: NpcPlacement[] = [];
  for (let i = 0; i < NPC_COUNT; i++) {
    const a = (i / NPC_COUNT) * Math.PI * 2;
    const r = 16 - (i % 2) * 1.5;
    out.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      rotY: -a - Math.PI / 2,
      clip: NPC_CLIPS[i % NPC_CLIPS.length] ?? 'Idle',
      timeOffset: (i * 0.37) % 2,
    });
  }
  return out;
}

export interface PointLightState {
  x: number;
  y: number;
  z: number;
  color: readonly [number, number, number];
  intensity: number;
  range: number;
}

const LIGHT_COLORS: readonly (readonly [number, number, number])[] = [
  [1, 0.55, 0.2],
  [0.3, 0.5, 1],
  [1, 0.3, 0.3],
  [0.4, 1, 0.5],
  [1, 0.85, 0.4],
  [0.7, 0.4, 1],
  [0.3, 0.9, 1],
  [1, 0.5, 0.8],
];

/** Eight point lights orbiting at different radii and speeds. `t` is scene time in seconds. */
export function pointLightState(i: number, t: number): PointLightState {
  const a = t * (0.3 + i * 0.07) + (i * Math.PI) / 4;
  const r = 6 + (i % 4) * 3;
  return {
    x: Math.cos(a) * r,
    y: 2 + (i % 3) * 0.8,
    z: Math.sin(a) * r,
    color: LIGHT_COLORS[i % LIGHT_COLORS.length] ?? [1, 1, 1],
    intensity: 40,
    range: 14,
  };
}

export interface PlayerState {
  x: number;
  z: number;
  heading: number;
  /** Blend weights for PLAYER_CLIPS, summing to 1. */
  weights: readonly [number, number, number];
}

/** Player jogs a figure-eight; idle→walk→run weights cycle every 6 s so all three clips blend. */
export function playerState(t: number): PlayerState {
  const a = t * 0.25;
  const x = Math.sin(a) * 7;
  const z = Math.sin(a * 2) * 4;
  const dx = Math.cos(a) * 7;
  const dz = Math.cos(a * 2) * 8;
  const phase = (Math.sin((t / 6) * Math.PI * 2) + 1) / 2; // 0..1
  const idle = Math.max(0, 1 - phase * 2);
  const run = Math.max(0, phase * 2 - 1);
  const walk = 1 - idle - run;
  return { x, z, heading: Math.atan2(dx, dz), weights: [idle, walk, run] };
}

export interface Impulse {
  index: number;
  impulse: readonly [number, number, number];
}

/** Every 90 frames, kick 20 bodies so the pile keeps colliding instead of going to sleep. */
export function impulsesForFrame(frame: number): Impulse[] {
  if (frame === 0 || frame % 90 !== 0) return [];
  const wave = frame / 90;
  const out: Impulse[] = [];
  for (let k = 0; k < 20; k++) {
    const index = (wave * 37 + k * 10) % BODY_COUNT;
    const s = ((index * 7919 + wave * 104729) % 1000) / 1000 - 0.5;
    out.push({ index, impulse: [s * 6, 7 + (k % 5), -s * 6] });
  }
  return out;
}

/** Third-person camera: behind and above the room centre, looking at the player. */
export const CAMERA = { x: 0, y: 14, z: 26, targetY: 1 } as const;

/** Soft round particle sprite as RGBA bytes (size×size), shared so both engines draw the same particle. */
export function radialSprite(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const a = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2);
      out.set([255, 255, 255, Math.round(a * a * 255)], (y * size + x) * 4);
    }
  }
  return out;
}
