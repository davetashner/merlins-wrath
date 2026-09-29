// VFX testbed tools (mw-e29.1): the `?vfx` URL parameter spawns the framework's test effects in the
// greybox testbed and shows the debug stats overlay.
//
//   ?vfx          stats overlay only
//   ?vfx=demo     20 test effects on a ring around the scene centre (AC-6 smoke); one-shots repeat
//   ?vfx=stress   50 looping effects that together fill the High particle cap (AC-7 perf)

import { at, type VfxStats, type VfxSystem } from '@game/vfx/index';
import type { Vec3 } from '@sim/index';

export type VfxDemoMode = 'stats' | 'demo' | 'stress';

/** `?vfx` → 'stats', `?vfx=demo` / `?vfx=stress` → that mode, otherwise undefined (off). */
export function parseVfxParam(search: string): VfxDemoMode | undefined {
  const value = new URLSearchParams(search).get('vfx');
  if (value === null) return undefined;
  return value === 'demo' || value === 'stress' ? value : 'stats';
}

/** Effects the demo cycles through (content/data/vfx-effect). */
export const DEMO_EFFECTS: readonly string[] = [
  'vfx-test-sparks',
  'vfx-test-flame',
  'vfx-test-smoke',
  'vfx-test-arcane-motes',
];
/** Effects the demo spawns. */
export const DEMO_COUNT = 20;
/** The stress effect: reserves 40 particles, so 50 of them fill the 2000-particle High cap. */
export const STRESS_EFFECT = 'vfx-test-stress';
export const STRESS_COUNT = 50;
/** Seconds between repeats of a demo one-shot. */
export const DEMO_REPEAT_SECONDS = 1;

const DEMO_RADIUS = 3;
const STRESS_COLUMNS = 10;
const STRESS_SPACING = 1.2;
const HEIGHT = 1;

interface Placed {
  readonly effect: string;
  readonly position: Vec3;
}

/** Where each effect of a mode goes, around `centre`. */
export function demoPlacements(mode: 'demo' | 'stress', centre: Vec3): Placed[] {
  if (mode === 'demo') {
    return Array.from({ length: DEMO_COUNT }, (_, i) => {
      const angle = (i / DEMO_COUNT) * Math.PI * 2;
      return {
        effect: at(DEMO_EFFECTS, i % DEMO_EFFECTS.length),
        position: {
          x: centre.x + Math.cos(angle) * DEMO_RADIUS,
          y: centre.y + HEIGHT,
          z: centre.z + Math.sin(angle) * DEMO_RADIUS,
        },
      };
    });
  }
  const rows = STRESS_COUNT / STRESS_COLUMNS;
  return Array.from({ length: STRESS_COUNT }, (_, i) => ({
    effect: STRESS_EFFECT,
    position: {
      x: centre.x + ((i % STRESS_COLUMNS) - (STRESS_COLUMNS - 1) / 2) * STRESS_SPACING,
      y: centre.y + HEIGHT,
      z: centre.z + (Math.floor(i / STRESS_COLUMNS) - (rows - 1) / 2) * STRESS_SPACING,
    },
  }));
}

/** Keeps a demo's effects running: spawns them all, then repeats one-shots once they end. */
export class VfxDemo {
  readonly #vfx: VfxSystem;
  readonly #placed: Placed[];
  readonly #handles: (number | null)[];
  #sinceRepeat = 0;

  constructor(vfx: VfxSystem, mode: 'demo' | 'stress', centre: Vec3) {
    this.#vfx = vfx;
    this.#placed = demoPlacements(mode, centre);
    this.#handles = this.#placed.map((p) => vfx.spawn(p.effect, { position: p.position }));
  }

  /** Spawned (non-null) handles right now. */
  get running(): number {
    return this.#handles.filter((h) => h !== null && this.#vfx.alive(h)).length;
  }

  /** Call once per frame. */
  update(dt: number): void {
    this.#sinceRepeat += dt;
    if (this.#sinceRepeat < DEMO_REPEAT_SECONDS) return;
    this.#sinceRepeat = 0;
    this.#placed.forEach((p, i) => {
      const handle = this.#handles[i] ?? null;
      if (handle === null || !this.#vfx.alive(handle)) {
        this.#handles[i] = this.#vfx.spawn(p.effect, { position: p.position });
      }
    });
  }
}

/** The debug overlay's text, one line per group. */
export function formatVfxStats(s: VfxStats): string {
  return [
    `VFX ${s.tier} · particles ${String(s.particles)} / reserved ${String(s.reserved)} / cap ${String(s.cap)}`,
    `effects ${String(s.effects)} · dormant ${String(s.dormant)} · pooled ${String(s.idle)} · allocated ${String(s.allocations)}`,
    `culled ${String(s.culled)} · refused ${String(s.refused)} · evicted ${String(s.evicted)} · missing ${String(s.missing)}`,
  ].join('\n');
}
