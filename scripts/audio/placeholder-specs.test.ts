import { describe, expect, it } from 'vitest';
import {
  FOOTSTEP_GAITS,
  FOOTSTEP_SURFACES,
  footstepPeak,
  LANDING_PEAK,
  placeholderSpecs,
} from './placeholder-specs.ts';

const specs = placeholderSpecs();
const byId = new Map(specs.map((spec) => [spec.id, spec]));

/** Asset ids of the SFX prompt beads (variant suffix dropped): the pack's initial set. */
const PROMPT_BEAD_IDS = {
  // mw-e38.12, knight combat (14)
  knight: [
    'sfx-knight-sword-swing-light',
    'sfx-knight-sword-swing-heavy',
    'sfx-knight-block-shield-wood',
    'sfx-knight-block-shield-metal',
    'sfx-knight-parry-metal',
    'sfx-knight-guard-break',
    'sfx-knight-riposte',
    'sfx-knight-shield-bash',
    'sfx-knight-kick',
    'sfx-knight-dodge-roll-cloth',
    'sfx-knight-dodge-roll-armor',
    'sfx-knight-charge-ready',
    'sfx-knight-stamina-exhausted',
    'sfx-knight-wall-recoil-clang',
  ],
  // mw-e38.28, bow and arrows (15)
  archery: [
    'sfx-bow-draw-creak-loop',
    'sfx-bow-release-twang',
    'sfx-bow-focused-chime',
    'sfx-arrow-flyby',
    'sfx-arrow-impact-wood',
    'sfx-arrow-impact-stone',
    'sfx-arrow-impact-flesh',
    'sfx-arrow-impact-metal',
    'sfx-arrow-ricochet-metal',
    'sfx-arrow-pickup',
    'sfx-arrow-fire-ignite',
    'sfx-arrow-water-splash',
    'sfx-arrow-rope-unfurl',
    'sfx-arrow-noise-rattle',
    'sfx-arrow-blunt-thud',
  ],
  // mw-e38.20, core footsteps (20)
  footsteps: [
    ...FOOTSTEP_SURFACES.flatMap((s) => FOOTSTEP_GAITS.map((g) => `sfx-foot-${s}-${g}`)),
    'sfx-foot-land-light',
    'sfx-foot-land-heavy',
  ],
  // mw-e38.36, UI (14)
  ui: [
    'sfx-ui-menu-open',
    'sfx-ui-menu-close',
    'sfx-ui-hover',
    'sfx-ui-confirm',
    'sfx-ui-cancel',
    'sfx-ui-page-turn',
    'sfx-ui-coin',
    'sfx-ui-item-pickup',
    'sfx-ui-equip',
    'sfx-ui-quest-update',
    'sfx-ui-journal-quill',
    'sfx-ui-error-deny',
    'sfx-ui-lockon',
    'sfx-ui-low-health-heartbeat-loop',
  ],
};

describe('placeholder set (mw-e28.2)', () => {
  it('covers the initial combat, archery, footsteps and UI ids of the SFX prompt beads', () => {
    expect(PROMPT_BEAD_IDS.knight).toHaveLength(14);
    expect(PROMPT_BEAD_IDS.archery).toHaveLength(15);
    expect(PROMPT_BEAD_IDS.footsteps).toHaveLength(20);
    expect(PROMPT_BEAD_IDS.ui).toHaveLength(14);
    for (const id of Object.values(PROMPT_BEAD_IDS).flat()) expect(byId.has(id), id).toBe(true);
  });

  it('ids are unique, sorted, lower-kebab sfx ids (audio bible §6) with at least one variant', () => {
    expect(byId.size).toBe(specs.length);
    expect(specs.map((s) => s.id)).toEqual(specs.map((s) => s.id).sort());
    for (const spec of specs) {
      expect(spec.id).toMatch(/^sfx-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(spec.variants).toBeGreaterThanOrEqual(1);
    }
  });

  it('round-robin counts: ≥ 3 for swings and blocks, 4 per footstep surface and gait', () => {
    for (const id of [
      'sword-swing-light',
      'sword-swing-heavy',
      'block-shield-wood',
      'block-shield-metal',
    ]) {
      expect(byId.get(`sfx-knight-${id}`)?.variants).toBeGreaterThanOrEqual(3);
    }
    for (const s of FOOTSTEP_SURFACES) {
      for (const g of FOOTSTEP_GAITS) expect(byId.get(`sfx-foot-${s}-${g}`)?.variants).toBe(4);
    }
  });

  it('buses and positioning: UI is 2D on the ui bus, world sounds are positional', () => {
    for (const spec of specs) {
      if (spec.id.startsWith('sfx-ui-')) expect(spec).toMatchObject({ bus: 'ui', spatial: false });
      else expect(spec.spatial).toBe(true);
      if (spec.id.startsWith('sfx-foot-')) expect(spec.bus).toBe('footsteps');
    }
  });

  it('loops are the two -loop ids, rendered at full length', () => {
    const loops = specs.filter((s) => s.loop === true);
    expect(loops.map((s) => s.id)).toEqual([
      'sfx-bow-draw-creak-loop',
      'sfx-ui-low-health-heartbeat-loop',
    ]);
    for (const spec of loops) expect(spec.recipe.loop).toBe(true);
  });

  it('footstep loudness follows the noise radius: sneak < walk < run < landing; grass < dirt < stone < gravel', () => {
    for (const s of FOOTSTEP_SURFACES) {
      expect(footstepPeak(s, 'sneak')).toBeLessThan(footstepPeak(s, 'walk'));
      expect(footstepPeak(s, 'walk')).toBeLessThan(footstepPeak(s, 'run'));
      expect(footstepPeak(s, 'run')).toBeLessThan(LANDING_PEAK.light);
    }
    expect(LANDING_PEAK.light).toBeLessThan(LANDING_PEAK.heavy);
    const walk = (s: (typeof FOOTSTEP_SURFACES)[number]) => footstepPeak(s, 'walk');
    expect(walk('grass')).toBeLessThan(walk('dirt'));
    expect(walk('dirt')).toBeLessThan(walk('stone'));
    expect(walk('stone')).toBeLessThan(walk('gravel'));
    expect(byId.get('sfx-foot-stone-walk')?.recipe.peakDb).toBe(walk('stone'));
  });

  it('UI never peaks above combat SFX (audio bible §5.1)', () => {
    const ui = specs.filter((s) => s.bus === 'ui').map((s) => s.recipe.peakDb);
    const combat = specs.filter((s) => s.bus === 'combat').map((s) => s.recipe.peakDb);
    expect(Math.max(...ui)).toBeLessThan(Math.min(...combat));
  });
});
