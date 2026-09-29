// How much sight a collider or volume lets through (mw-e09.1). Every occluder is one of three kinds:
// opaque (walls, crates, closed doors: nothing passes), transparent (glass, grates, bars: sight
// passes untouched, bodies do not) or partial (foliage, curtains, smoke: a factor of the sight passes).
// A ray's visibility is the product of the transmittance of everything it crosses, so two
// partial:0.5 bushes let a quarter through.
//
// The world-property vocabulary (src/sim/properties) has `opaque` and `transparent` flags; partial
// cover has no factor there yet, so line of sight carries its own occlusion value per collider and
// volume. Deriving it from an entity's properties is follow-up work once colliders map to entities.

/** Nothing passes. */
export interface OpaqueOcclusion {
  readonly kind: 'opaque';
}
/** Sight passes untouched (the collider still blocks movement). */
export interface TransparentOcclusion {
  readonly kind: 'transparent';
}
/** `factor` of the sight passes: 0 = as good as opaque, 1 = as good as transparent. */
export interface PartialOcclusion {
  readonly kind: 'partial';
  readonly factor: number;
}

export type Occlusion = OpaqueOcclusion | TransparentOcclusion | PartialOcclusion;

export const OPAQUE: OpaqueOcclusion = Object.freeze({ kind: 'opaque' });
export const TRANSPARENT: TransparentOcclusion = Object.freeze({ kind: 'transparent' });

/**
 * Partial cover letting `factor` of the sight through.
 * @throws RangeError unless `factor` is a number in [0, 1].
 */
export function partial(factor: number): PartialOcclusion {
  if (!(factor >= 0 && factor <= 1)) {
    throw new RangeError(`partial occlusion factor must be in [0, 1], got ${String(factor)}`);
  }
  return Object.freeze({ kind: 'partial', factor });
}

/** The fraction of sight an occluder lets through, in [0, 1]. */
export function transmittance(occlusion: Occlusion): number {
  switch (occlusion.kind) {
    case 'opaque':
      return 0;
    case 'transparent':
      return 1;
    case 'partial':
      return occlusion.factor;
  }
}

/**
 * Parses the authored form: `opaque`, `transparent` or `partial:<factor>` (e.g. `partial:0.5`).
 * @throws RangeError for anything else, or a factor outside [0, 1].
 */
export function parseOcclusion(text: string): Occlusion {
  if (text === 'opaque') return OPAQUE;
  if (text === 'transparent') return TRANSPARENT;
  const match = /^partial:(\d+(?:\.\d+)?)$/.exec(text);
  if (match === null) {
    throw new RangeError(
      `occlusion must be opaque, transparent or partial:<factor>, got ${JSON.stringify(text)}`,
    );
  }
  return partial(Number(match[1]));
}
