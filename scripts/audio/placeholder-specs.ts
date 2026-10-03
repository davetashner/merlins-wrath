// The placeholder sound set (mw-e28.2): one entry per cue id, written under the final asset ids so
// that swapping in a real sound is a file replacement plus clearing `placeholder` (audio bible §6,
// §9.3). The set covers every id the cue sheets can play (the material impact classes and their
// death variants, the generic combat cues, the weapon × material impact matrix of mw-e28.4) plus the
// initial combat, archery, footsteps, armour and UI ids the SFX asset groups will deliver (prompt
// beads mw-e38.12, mw-e38.28, mw-e38.20, mw-e38.24 and mw-e38.36).
//
// Every sound is synthesised here from filtered noise, tones and clicks: no downloaded clips, no
// generation APIs. They are stand-ins, not the palette of audio bible §7; they only need to read as
// the right kind of sound at roughly the right loudness.

import type { ClickLayer, Layer, NoiseLayer, Recipe, ToneLayer } from './synth.ts';

/** Buses a placeholder plays on (a subset of the engine's playable buses). */
export type PlaceholderBus = 'sfx' | 'combat' | 'footsteps' | 'ui';

/** One placeholder cue: a manifest entry plus how to synthesise its variants. */
export interface PlaceholderSpec {
  /** Cue id; its variants are `<id>-01`, `<id>-02`… (audio bible §6). */
  readonly id: string;
  readonly bus: PlaceholderBus;
  /** Positional (world sounds) vs 2D (UI). */
  readonly spatial: boolean;
  readonly variants: number;
  readonly recipe: Recipe;
  /** Loops get a whole-file loop sidecar (audio bible §5.3). */
  readonly loop?: boolean;
  /** How far variants stray from the recipe (fraction; default 0.08). */
  readonly spread?: number;
}

const noise = (
  filter: NoiseLayer['filter'],
  freq: number,
  gain: number,
  env: Partial<NoiseLayer> = {},
): NoiseLayer => ({ kind: 'noise', filter, freq, gain, attack: 0.001, decay: 0.05, ...env });

const tone = (freq: number, gain: number, env: Partial<ToneLayer> = {}): ToneLayer => ({
  kind: 'tone',
  freq,
  gain,
  attack: 0.001,
  decay: 0.08,
  ...env,
});

const click = (gain: number, start = 0): ClickLayer => ({ kind: 'click', gain, start });

/** Peak levels (dBFS): SFX one-shots are peak-normalised to −3 (audio bible §5.1). */
const SFX_PEAK = -3;
/** UI sits well under combat (audio bible §5.1: never louder than combat SFX). */
const UI_PEAK = -12;

/** The material impact classes (a material's `impactSound` is `sfx-impact-<class>`). */
export const IMPACT_CLASSES = [
  'bone',
  'cloth',
  'earth',
  'flesh',
  'glass',
  'metal',
  'rope',
  'stone',
  'straw',
  'water',
  'wood',
] as const;
export type ImpactClass = (typeof IMPACT_CLASSES)[number];

/** Three-layer impact bodies per class (audio bible §7.1, §7.2): transient, body, and a thump. */
const IMPACT_LAYERS: Readonly<Record<ImpactClass, readonly Layer[]>> = {
  bone: [
    click(0.6),
    noise('bandpass', 1800, 0.8, { q: 3, decay: 0.03 }),
    tone(900, 0.3, { decay: 0.02 }),
  ],
  cloth: [noise('bandpass', 1400, 1, { attack: 0.01, decay: 0.06, q: 0.7 })],
  earth: [noise('lowpass', 350, 1, { decay: 0.06 }), tone(70, 0.6, { decay: 0.06 })],
  flesh: [noise('lowpass', 280, 1, { decay: 0.05 }), tone(95, 0.7, { to: 60, decay: 0.07 })],
  glass: [
    click(0.8),
    noise('highpass', 3500, 0.5, { decay: 0.05 }),
    tone(2830, 0.4, { decay: 0.15 }),
    tone(4170, 0.3, { decay: 0.1 }),
    tone(6310, 0.2, { decay: 0.07 }),
  ],
  metal: [
    click(0.7),
    noise('bandpass', 2400, 0.5, { q: 2, decay: 0.03 }),
    tone(523, 0.45, { decay: 0.35 }),
    tone(1342, 0.3, { decay: 0.25 }),
    tone(2411, 0.2, { decay: 0.15 }),
  ],
  rope: [
    noise('bandpass', 900, 0.8, { q: 2, attack: 0.01, decay: 0.07 }),
    tone(210, 0.3, { wave: 'saw', decay: 0.05 }),
  ],
  stone: [click(0.5), noise('lowpass', 450, 1, { decay: 0.05 }), tone(75, 0.6, { decay: 0.05 })],
  straw: [noise('highpass', 2500, 1, { decay: 0.09, grain: 0.45 })],
  water: [
    noise('bandpass', 1400, 1, { to: 350, q: 1.4, attack: 0.005, decay: 0.12 }),
    tone(90, 0.4, { decay: 0.05 }),
  ],
  wood: [
    click(0.5),
    noise('bandpass', 750, 1, { q: 1.6, decay: 0.05 }),
    tone(180, 0.5, { decay: 0.04 }),
  ],
};

const impactDuration = (cls: ImpactClass): number =>
  cls === 'metal' ? 0.45 : cls === 'glass' || cls === 'water' ? 0.3 : 0.2;

/** `sfx-impact-<class>`: what a hit or a physics impact on that material sounds like. */
function impactSpecs(): PlaceholderSpec[] {
  return IMPACT_CLASSES.map((cls) => ({
    id: `sfx-impact-${cls}`,
    bus: 'sfx',
    spatial: true,
    variants: 4,
    recipe: { duration: impactDuration(cls), layers: IMPACT_LAYERS[cls], peakDb: SFX_PEAK },
  }));
}

/** `sfx-combat-death-<class>`: a heavier, lower impact of the class with a body-fall thud. */
function deathSpecs(): PlaceholderSpec[] {
  return IMPACT_CLASSES.map((cls) => ({
    id: `sfx-combat-death-${cls}`,
    bus: 'combat',
    spatial: true,
    variants: 1,
    recipe: {
      duration: 0.5,
      peakDb: SFX_PEAK,
      layers: [
        ...IMPACT_LAYERS[cls],
        noise('lowpass', 220, 0.9, { start: 0.18, decay: 0.12 }),
        tone(55, 0.8, { start: 0.18, to: 40, decay: 0.12 }),
      ],
    },
  }));
}

/** A whoosh: band-passed noise sweeping up then fading (sword swings, flybys). */
const whoosh = (from: number, to: number, duration: number, peakDb = SFX_PEAK): Recipe => ({
  duration,
  peakDb,
  layers: [
    noise('bandpass', from, 1, { to, q: 1.5, attack: duration * 0.45, decay: duration * 0.2 }),
  ],
});

/** The generic combat cues of cue-sheet/combat.json. */
const COMBAT: readonly PlaceholderSpec[] = [
  {
    id: 'sfx-combat-glance',
    bus: 'combat',
    spatial: true,
    variants: 3,
    recipe: {
      duration: 0.25,
      peakDb: -6,
      layers: [
        click(0.8),
        tone(1900, 0.5, { to: 1700, decay: 0.06 }),
        noise('highpass', 3000, 0.4),
      ],
    },
  },
  {
    id: 'sfx-combat-critical',
    bus: 'combat',
    spatial: true,
    variants: 2,
    recipe: {
      duration: 0.35,
      peakDb: SFX_PEAK,
      layers: [
        click(1),
        noise('highpass', 2000, 0.7, { decay: 0.04 }),
        tone(1200, 0.5, { decay: 0.12 }),
        tone(1800, 0.3, { decay: 0.1 }),
      ],
    },
  },
  {
    id: 'sfx-combat-stagger',
    bus: 'combat',
    spatial: true,
    variants: 2,
    recipe: {
      duration: 0.4,
      peakDb: SFX_PEAK,
      layers: [
        tone(300, 0.6, { to: 110, wave: 'triangle', decay: 0.15 }),
        noise('lowpass', 300, 0.6, { decay: 0.1 }),
      ],
    },
  },
  {
    // A swing that passed through a dodge's i-frames (DodgedHit): a close, bright miss.
    id: 'sfx-combat-whiff',
    bus: 'combat',
    spatial: true,
    variants: 2,
    recipe: whoosh(900, 3000, 0.22, -6),
  },
  {
    id: 'sfx-combat-stamina-wheeze',
    bus: 'combat',
    spatial: true,
    variants: 2,
    recipe: {
      duration: 0.45,
      peakDb: -9,
      layers: [
        noise('bandpass', 900, 1, { to: 1300, q: 1.2, attack: 0.12, hold: 0.1, decay: 0.08 }),
      ],
    },
  },
  {
    // The frozen fixture guard's strike windup (debug builds only; TelegraphStarted, `sfx-telegraph-`
    // + its attack's telegraph): a short rising whistle, so a fixture guard's swing is heard before
    // it lands now that it fights in the game loop (mw-e11.21).
    id: 'sfx-telegraph-fixture-guard-strike-windup',
    bus: 'combat',
    spatial: true,
    variants: 1,
    recipe: {
      duration: 0.3,
      peakDb: -8,
      layers: [
        noise('bandpass', 700, 0.8, { to: 1600, q: 1.5, attack: 0.08, hold: 0.12, decay: 0.1 }),
      ],
    },
  },
  {
    // The grey-box Forgotten's parryable windups (mw-e04.20, TelegraphStarted): a dry bone rattle
    // with a rising scrape, so a swing is heard before it lands.
    id: 'sfx-telegraph-forgotten-windup',
    bus: 'combat',
    spatial: true,
    variants: 1,
    recipe: {
      duration: 0.3,
      peakDb: -6,
      layers: [
        click(0.6),
        click(0.5, 0.06),
        click(0.4, 0.12),
        noise('bandpass', 1400, 0.6, { to: 2600, q: 2, attack: 0.05, hold: 0.15, decay: 0.1 }),
      ],
    },
  },
  {
    // Its unparryable lunging thrust (mw-e04.20): a longer, lower grind with a high ring on top, so
    // it reads as a different threat from the swings.
    id: 'sfx-telegraph-forgotten-lunge',
    bus: 'combat',
    spatial: true,
    variants: 1,
    recipe: {
      duration: 0.45,
      peakDb: -4,
      layers: [
        noise('lowpass', 500, 0.8, { attack: 0.08, hold: 0.25, decay: 0.15 }),
        tone(1760, 0.35, { to: 2200, attack: 0.1, hold: 0.2, decay: 0.15 }),
      ],
    },
  },
  {
    id: 'sfx-combat-exhausted',
    bus: 'combat',
    spatial: true,
    variants: 1,
    recipe: {
      duration: 0.8,
      peakDb: -6,
      layers: [
        noise('bandpass', 1100, 1, { to: 600, q: 1.2, attack: 0.1, hold: 0.15, decay: 0.12 }),
        noise('bandpass', 800, 0.7, { start: 0.45, q: 1.2, attack: 0.08, decay: 0.08 }),
      ],
    },
  },
];

/**
 * Attacker sides of the impact matrix (mw-e28.4), picked by a hit's dominant damage type: slash is a
 * blade, blunt a club or shield, pierce a point (arrows reuse the archery impacts). Each is a
 * transient layered over the struck material's body (audio bible §7.1's three-layer impacts).
 */
export const STRIKE_CLASSES = ['blade', 'blunt', 'pierce'] as const;
export type StrikeClass = (typeof STRIKE_CLASSES)[number];

const STRIKE_LAYERS: Readonly<Record<StrikeClass, readonly Layer[]>> = {
  blade: [
    noise('highpass', 4200, 0.8, { decay: 0.03 }),
    tone(2600, 0.25, { to: 1900, decay: 0.03 }),
  ],
  blunt: [tone(72, 1, { to: 50, decay: 0.07 }), noise('lowpass', 320, 0.8, { decay: 0.05 })],
  pierce: [click(1), noise('bandpass', 2600, 0.6, { q: 3, decay: 0.02 })],
};

/** Target materials with their own blade and blunt pair (others fall back to the generic strike). */
export const MATRIX_TARGETS = ['flesh', 'bone', 'metal', 'wood', 'stone'] as const;

/** `sfx-<strike>-impact` (generic) and `sfx-<blade|blunt>-impact-<target>` (pairs). */
function matrixSpecs(): PlaceholderSpec[] {
  const generic = STRIKE_CLASSES.map((cls) => ({
    id: `sfx-${cls}-impact`,
    recipe: {
      duration: 0.18,
      peakDb: SFX_PEAK,
      layers: [...STRIKE_LAYERS[cls], tone(120, 0.5, { decay: 0.04 })],
    },
  }));
  const pairs = (['blade', 'blunt'] as const).flatMap((cls) =>
    MATRIX_TARGETS.map((target) => ({
      id: `sfx-${cls}-impact-${target}`,
      recipe: {
        duration: target === 'metal' ? 0.3 : 0.18,
        peakDb: SFX_PEAK,
        layers: [...STRIKE_LAYERS[cls], ...IMPACT_LAYERS[target]],
      },
    })),
  );
  return [...generic, ...pairs].map((spec) => ({
    ...spec,
    bus: 'combat',
    spatial: true,
    variants: 2,
  }));
}

/** Knight combat (mw-e38.12's 14 ids); swings and blocks get 3 variants. */
const KNIGHT: readonly PlaceholderSpec[] = [
  { id: 'sfx-knight-sword-swing-light', variants: 3, recipe: whoosh(500, 2200, 0.25) },
  { id: 'sfx-knight-sword-swing-heavy', variants: 3, recipe: whoosh(250, 1300, 0.42) },
  {
    id: 'sfx-knight-block-shield-wood',
    variants: 3,
    recipe: {
      duration: 0.3,
      peakDb: SFX_PEAK,
      layers: [...IMPACT_LAYERS.wood, tone(110, 0.7, { decay: 0.06 })],
    },
  },
  {
    id: 'sfx-knight-block-shield-metal',
    variants: 3,
    recipe: { duration: 0.45, peakDb: SFX_PEAK, layers: [...IMPACT_LAYERS.metal, tone(120, 0.6)] },
  },
  {
    id: 'sfx-knight-parry-metal',
    variants: 2,
    recipe: {
      duration: 0.5,
      peakDb: SFX_PEAK,
      layers: [
        click(1),
        tone(1568, 0.6, { decay: 0.3 }),
        tone(2350, 0.4, { decay: 0.25 }),
        tone(3920, 0.2, { decay: 0.12 }),
      ],
    },
  },
  {
    id: 'sfx-knight-guard-break',
    variants: 1,
    recipe: {
      duration: 0.5,
      peakDb: SFX_PEAK,
      layers: [...IMPACT_LAYERS.metal, tone(260, 0.6, { to: 90, wave: 'triangle', decay: 0.2 })],
    },
  },
  {
    id: 'sfx-knight-riposte',
    variants: 1,
    recipe: {
      duration: 0.5,
      peakDb: SFX_PEAK,
      layers: [
        noise('bandpass', 600, 0.8, { to: 2600, q: 1.5, attack: 0.12, decay: 0.05 }),
        click(1, 0.16),
        tone(1200, 0.5, { start: 0.16, decay: 0.12 }),
      ],
    },
  },
  {
    id: 'sfx-knight-shield-bash',
    variants: 2,
    recipe: {
      duration: 0.35,
      peakDb: SFX_PEAK,
      layers: [...IMPACT_LAYERS.wood, tone(80, 0.9, { decay: 0.08 })],
    },
  },
  {
    id: 'sfx-knight-kick',
    variants: 2,
    recipe: {
      duration: 0.3,
      peakDb: SFX_PEAK,
      layers: [
        noise('bandpass', 400, 0.5, { to: 1200, attack: 0.08, decay: 0.02 }),
        ...IMPACT_LAYERS.flesh.map((l) => ({ ...l, start: 0.09 })),
      ],
    },
  },
  {
    id: 'sfx-knight-dodge-roll-cloth',
    variants: 2,
    recipe: {
      duration: 0.45,
      peakDb: -6,
      layers: [
        noise('lowpass', 900, 1, { attack: 0.12, hold: 0.1, decay: 0.08 }),
        tone(70, 0.5, { start: 0.3, decay: 0.05 }),
      ],
    },
  },
  {
    id: 'sfx-knight-dodge-roll-armor',
    variants: 2,
    recipe: {
      duration: 0.5,
      peakDb: -6,
      layers: [
        noise('lowpass', 900, 0.8, { attack: 0.12, hold: 0.1, decay: 0.08 }),
        noise('highpass', 5000, 0.5, { attack: 0.05, hold: 0.2, decay: 0.08, grain: 0.3 }),
        tone(70, 0.5, { start: 0.3, decay: 0.05 }),
      ],
    },
  },
  {
    id: 'sfx-knight-charge-ready',
    variants: 1,
    recipe: {
      duration: 0.4,
      peakDb: -6,
      layers: [
        tone(440, 0.6, { to: 880, attack: 0.02, hold: 0.1, decay: 0.12 }),
        tone(1320, 0.3, { start: 0.1, decay: 0.12 }),
      ],
    },
  },
  {
    id: 'sfx-knight-stamina-exhausted',
    variants: 1,
    recipe: {
      duration: 0.7,
      peakDb: -6,
      layers: [
        noise('bandpass', 1000, 1, { to: 550, q: 1.2, attack: 0.1, hold: 0.15, decay: 0.12 }),
      ],
    },
  },
  {
    // The backstep's scuff (move backstep's own sound; not in mw-e38.12's list yet).
    id: 'sfx-knight-backstep',
    variants: 1,
    recipe: {
      duration: 0.3,
      peakDb: -6,
      layers: [
        noise('lowpass', 800, 1, { attack: 0.06, decay: 0.08 }),
        tone(80, 0.5, { start: 0.2, decay: 0.04 }),
      ],
    },
  },
  {
    id: 'sfx-knight-wall-recoil-clang',
    variants: 2,
    recipe: {
      duration: 0.5,
      peakDb: SFX_PEAK,
      layers: [...IMPACT_LAYERS.metal, ...IMPACT_LAYERS.stone],
    },
  },
].map((spec) => ({ ...spec, bus: 'combat', spatial: true }));

/** Bow and arrows (mw-e38.28's 15 ids). */
const ARCHERY: readonly PlaceholderSpec[] = [
  {
    id: 'sfx-bow-draw-creak-loop',
    variants: 1,
    loop: true,
    recipe: {
      duration: 1,
      loop: true,
      peakDb: -9,
      layers: [0.05, 0.3, 0.55, 0.8].map((start) =>
        noise('bandpass', 420, 1, {
          start,
          q: 6,
          attack: 0.02,
          hold: 0.06,
          decay: 0.03,
          grain: 0.7,
        }),
      ),
    },
  },
  {
    id: 'sfx-bow-release-twang',
    variants: 3,
    recipe: {
      duration: 0.4,
      peakDb: SFX_PEAK,
      layers: [
        click(0.8),
        tone(196, 0.7, { wave: 'triangle', to: 180, decay: 0.12 }),
        noise('bandpass', 1500, 0.3, { to: 3000 }),
      ],
    },
  },
  {
    id: 'sfx-bow-focused-chime',
    variants: 1,
    recipe: {
      duration: 0.6,
      peakDb: -6,
      layers: [tone(1318.5, 0.5, { decay: 0.2 }), tone(1975.5, 0.35, { start: 0.04, decay: 0.2 })],
    },
  },
  { id: 'sfx-arrow-flyby', variants: 3, recipe: whoosh(900, 3200, 0.4, -6) },
  ...(['wood', 'stone', 'flesh', 'metal'] as const).map((cls) => ({
    id: `sfx-arrow-impact-${cls}`,
    variants: 3,
    recipe: {
      duration: Math.min(0.4, impactDuration(cls)),
      peakDb: SFX_PEAK,
      layers: [click(1), ...IMPACT_LAYERS[cls]],
    },
  })),
  {
    id: 'sfx-arrow-ricochet-metal',
    variants: 2,
    recipe: {
      duration: 0.45,
      peakDb: SFX_PEAK,
      layers: [
        click(1),
        tone(2400, 0.5, { to: 1500, decay: 0.12 }),
        noise('bandpass', 3000, 0.3, { to: 1200, decay: 0.1 }),
      ],
    },
  },
  {
    id: 'sfx-arrow-pickup',
    variants: 1,
    recipe: {
      duration: 0.2,
      peakDb: -9,
      layers: [click(0.6), noise('highpass', 2500, 0.6, { attack: 0.02, decay: 0.04 })],
    },
  },
  {
    id: 'sfx-arrow-fire-ignite',
    variants: 1,
    recipe: {
      duration: 0.5,
      peakDb: SFX_PEAK,
      layers: [
        noise('lowpass', 300, 1, { to: 2500, attack: 0.08, hold: 0.05, decay: 0.12 }),
        noise('highpass', 4000, 0.3, { start: 0.15, decay: 0.15, grain: 0.2 }),
      ],
    },
  },
  {
    id: 'sfx-arrow-water-splash',
    variants: 2,
    recipe: { duration: 0.4, peakDb: SFX_PEAK, layers: IMPACT_LAYERS.water },
  },
  {
    id: 'sfx-arrow-rope-unfurl',
    variants: 1,
    recipe: {
      duration: 0.6,
      peakDb: -6,
      layers: [
        noise('bandpass', 1100, 1, {
          to: 700,
          q: 1.5,
          attack: 0.05,
          hold: 0.3,
          decay: 0.08,
          grain: 0.6,
        }),
      ],
    },
  },
  {
    id: 'sfx-arrow-noise-rattle',
    variants: 1,
    recipe: {
      duration: 0.5,
      peakDb: SFX_PEAK,
      layers: [
        noise('bandpass', 1800, 1, { q: 2, attack: 0.005, hold: 0.3, decay: 0.06, grain: 0.35 }),
      ],
    },
  },
  {
    id: 'sfx-arrow-blunt-thud',
    variants: 2,
    recipe: {
      duration: 0.25,
      peakDb: SFX_PEAK,
      layers: [tone(85, 1, { decay: 0.06 }), noise('lowpass', 500, 0.6)],
    },
  },
].map((spec) => ({ ...spec, bus: 'combat', spatial: true }));

/** Footstep surfaces of the core set (mw-e38.20); ids equal the e09 surface ids (audio bible §7.3). */
export const FOOTSTEP_SURFACES = [
  'stone',
  'wood',
  'dirt',
  'grass',
  'gravel',
  'water-shallow',
] as const;
export type FootstepSurface = (typeof FOOTSTEP_SURFACES)[number];
export const FOOTSTEP_GAITS = ['sneak', 'walk', 'run'] as const;
export type FootstepGait = (typeof FOOTSTEP_GAITS)[number];

const STEP_LAYERS: Readonly<Record<FootstepSurface, readonly Layer[]>> = {
  stone: [
    click(0.6),
    noise('bandpass', 1800, 0.8, { q: 1.2, decay: 0.02 }),
    tone(110, 0.3, { decay: 0.02 }),
  ],
  wood: [
    click(0.4),
    noise('bandpass', 650, 0.9, { q: 1.5, decay: 0.03 }),
    tone(150, 0.5, { decay: 0.03 }),
  ],
  dirt: [noise('lowpass', 700, 1, { attack: 0.004, decay: 0.03 })],
  grass: [noise('highpass', 2200, 1, { attack: 0.01, decay: 0.04, grain: 0.6 })],
  gravel: [noise('bandpass', 3000, 1, { q: 0.8, attack: 0.004, decay: 0.05, grain: 0.4 })],
  'water-shallow': [noise('bandpass', 1600, 1, { to: 500, q: 1.2, attack: 0.005, decay: 0.05 })],
};

/**
 * Peak level per surface and gait. Loudness ordering must match the sim's noise radius (audio bible
 * §7.3): sneak < walk < run < land, and grass < dirt < stone < gravel/water.
 */
const GAIT_PEAK: Readonly<Record<FootstepGait, number>> = { sneak: -21, walk: -14, run: -9 };
const SURFACE_OFFSET: Readonly<Record<FootstepSurface, number>> = {
  grass: -3,
  dirt: -1.5,
  stone: 0,
  wood: 0,
  gravel: 1.5,
  'water-shallow': 1.5,
};
const GAIT_DURATION: Readonly<Record<FootstepGait, number>> = { sneak: 0.1, walk: 0.12, run: 0.13 };

/** Peak level of a footstep (exported for the loudness-ordering test). */
export const footstepPeak = (surface: FootstepSurface, gait: FootstepGait): number =>
  GAIT_PEAK[gait] + SURFACE_OFFSET[surface];

/** Armour layer peaks: under a walk step's body, plate above chain. */
export const ARMOUR_PEAK = { plate: -15, chain: -18 } as const;

/** Landing peaks, above any run step. */
export const LANDING_PEAK = { light: -7, heavy: -4 } as const;

function footstepSpecs(): PlaceholderSpec[] {
  const steps = FOOTSTEP_SURFACES.flatMap((surface) =>
    FOOTSTEP_GAITS.map((gait) => ({
      id: `sfx-foot-${surface}-${gait}`,
      variants: 4,
      spread: 0.12,
      recipe: {
        duration: GAIT_DURATION[gait],
        peakDb: footstepPeak(surface, gait),
        layers: STEP_LAYERS[surface],
      },
    })),
  );
  const landings = (['light', 'heavy'] as const).map((weight) => ({
    id: `sfx-foot-land-${weight}`,
    variants: 3,
    recipe: {
      duration: weight === 'heavy' ? 0.3 : 0.22,
      peakDb: LANDING_PEAK[weight],
      layers: [
        noise('lowpass', 500, 1, { decay: weight === 'heavy' ? 0.06 : 0.04 }),
        tone(weight === 'heavy' ? 60 : 85, 0.8, { decay: 0.05 }),
      ],
    },
  }));
  // Armour layers (mw-e38.24) play on top of each footstep; plate is the loudest (audio bible §7.3).
  const armour = [
    {
      id: 'sfx-armor-plate-layer',
      variants: 2,
      recipe: {
        duration: 0.15,
        peakDb: ARMOUR_PEAK.plate,
        layers: [
          click(0.4),
          tone(1900, 0.3, { decay: 0.05 }),
          tone(3100, 0.2, { decay: 0.035 }),
          noise('highpass', 4000, 0.3, { decay: 0.03 }),
        ],
      },
    },
    {
      id: 'sfx-armor-chain-layer',
      variants: 2,
      recipe: {
        duration: 0.15,
        peakDb: ARMOUR_PEAK.chain,
        layers: [noise('highpass', 5000, 1, { attack: 0.01, hold: 0.04, decay: 0.04, grain: 0.3 })],
      },
    },
  ];
  return [...steps, ...landings, ...armour].map((spec) => ({
    ...spec,
    bus: 'footsteps',
    spatial: true,
  }));
}

/** UI (mw-e38.36's 14 ids): paper, leather and brass, all short except the heartbeat loop. */
const UI: readonly PlaceholderSpec[] = [
  {
    id: 'sfx-ui-menu-open',
    recipe: {
      duration: 0.25,
      layers: [noise('lowpass', 700, 1, { to: 1800, attack: 0.08, decay: 0.05 }), click(0.3, 0.1)],
    },
  },
  {
    id: 'sfx-ui-menu-close',
    recipe: {
      duration: 0.25,
      layers: [click(0.3), noise('lowpass', 1800, 1, { to: 600, attack: 0.02, decay: 0.07 })],
    },
  },
  {
    id: 'sfx-ui-hover',
    recipe: { duration: 0.05, layers: [click(0.5), tone(2400, 0.2, { decay: 0.01 })] },
  },
  {
    id: 'sfx-ui-confirm',
    recipe: {
      duration: 0.15,
      layers: [click(0.8), tone(1800, 0.5, { decay: 0.04 }), tone(2700, 0.3, { decay: 0.03 })],
    },
  },
  {
    id: 'sfx-ui-cancel',
    recipe: { duration: 0.15, layers: [click(0.5), tone(900, 0.5, { to: 600, decay: 0.05 })] },
  },
  {
    id: 'sfx-ui-page-turn',
    recipe: {
      duration: 0.3,
      layers: [noise('highpass', 1500, 1, { to: 4000, attack: 0.1, decay: 0.06 })],
    },
  },
  {
    id: 'sfx-ui-coin',
    recipe: {
      duration: 0.3,
      layers: [
        click(0.6),
        tone(2637, 0.4, { decay: 0.08 }),
        tone(3951, 0.3, { decay: 0.06 }),
        tone(5274, 0.2, { decay: 0.04 }),
      ],
    },
  },
  {
    id: 'sfx-ui-item-pickup',
    recipe: {
      duration: 0.18,
      layers: [
        tone(520, 0.6, { to: 820, attack: 0.01, decay: 0.05 }),
        noise('highpass', 3000, 0.2),
      ],
    },
  },
  {
    id: 'sfx-ui-equip',
    recipe: {
      duration: 0.2,
      layers: [noise('lowpass', 1200, 1, { attack: 0.02, decay: 0.04 }), click(0.6, 0.08)],
    },
  },
  {
    id: 'sfx-ui-quest-update',
    recipe: {
      duration: 0.7,
      layers: [tone(880, 0.5, { decay: 0.2 }), tone(1318.5, 0.4, { start: 0.12, decay: 0.22 })],
    },
  },
  {
    id: 'sfx-ui-journal-quill',
    recipe: {
      duration: 0.35,
      layers: [noise('highpass', 3500, 1, { attack: 0.02, hold: 0.2, decay: 0.05, grain: 0.5 })],
    },
  },
  {
    id: 'sfx-ui-error-deny',
    recipe: {
      duration: 0.25,
      layers: [...IMPACT_LAYERS.wood, ...IMPACT_LAYERS.wood.map((l) => ({ ...l, start: 0.11 }))],
    },
  },
  {
    id: 'sfx-ui-lockon',
    recipe: { duration: 0.06, layers: [click(0.8), tone(1500, 0.4, { decay: 0.015 })] },
  },
  {
    id: 'sfx-ui-low-health-heartbeat-loop',
    loop: true,
    recipe: {
      duration: 1,
      loop: true,
      layers: [
        tone(60, 1, { start: 0.02, decay: 0.05 }),
        tone(55, 0.8, { start: 0.3, decay: 0.06 }),
      ],
    },
  },
].map((spec) => ({
  ...spec,
  recipe: { ...spec.recipe, peakDb: UI_PEAK },
  bus: 'ui',
  spatial: false,
  variants: 1,
}));

/** Every placeholder, sorted by id. */
export function placeholderSpecs(): PlaceholderSpec[] {
  return [
    ...impactSpecs(),
    ...deathSpecs(),
    ...matrixSpecs(),
    ...COMBAT,
    ...KNIGHT,
    ...ARCHERY,
    ...footstepSpecs(),
    ...UI,
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
}
