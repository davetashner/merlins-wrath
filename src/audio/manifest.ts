// The sound manifest (mw-e28.1): what a cue id means to the engine — which asset files are its
// round-robin variants, which bus it plays on, whether it is positional or looped and how important
// it is when voices run out. Cue sheets (mw-e28.3) and the placeholder pack (mw-e28.2) author these
// entries; the engine only reads them. Asset ids, runtime paths and formats follow the audio bible
// §5.2, §5.3 and §6.
import { contentId } from '@content/index';
import { z } from 'zod';

/** Buses a sound may play on (master only receives other buses). */
export const PLAYABLE_BUS_IDS = [
  'music',
  'sfx',
  'combat',
  'footsteps',
  'creatures',
  'ambience',
  'ui',
] as const;
export type PlayableBusId = (typeof PLAYABLE_BUS_IDS)[number];

/** Every bus in the mix graph (audio bible §5.1: file loudness is fixed, the mixer applies bus gains). */
export const BUS_IDS = ['master', ...PLAYABLE_BUS_IDS] as const;
export type BusId = (typeof BUS_IDS)[number];

/** Default priority for cues that don't set one; UI and stingers should go higher, ambience lower. */
export const DEFAULT_PRIORITY = 50;

/** One manifest entry: a playable cue. */
export const soundDefSchema = z
  .object({
    id: contentId,
    /** Asset ids of the round-robin variants (audio bible §6), e.g. `sfx-foot-stone-walk-03`. */
    variants: z.tuple([contentId], contentId),
    bus: z.enum(PLAYABLE_BUS_IDS),
    /** Positional (mono, through a PannerNode) vs 2D. */
    spatial: z.boolean().default(false),
    /** Loop the buffer; loop points come from the §5.3 sidecar JSON when present. */
    loop: z.boolean().default(false),
    /** 0–100; higher steals lower when the voice pool is full. */
    priority: z.number().int().min(0).max(100).default(DEFAULT_PRIORITY),
    /** Per-cue trim applied on top of the bus gain. */
    gainDb: z.number().max(12).default(0),
    /** Stand-in sound under the final asset id (audio bible §9.3, mw-e28.2). */
    placeholder: z.boolean().default(false),
  })
  .strict();

export type SoundDef = z.output<typeof soundDefSchema>;
export type SoundDefInput = z.input<typeof soundDefSchema>;

/** A manifest file: a list of entries with unique ids. */
export const soundManifestSchema = z.array(soundDefSchema).superRefine((defs, ctx) => {
  const seen = new Set<string>();
  defs.forEach((def, index) => {
    if (seen.has(def.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `duplicate sound id "${def.id}"`,
      });
    }
    seen.add(def.id);
  });
});

/** Loop-point sidecar JSON (audio bible §5.3), in source-sample units at 48 kHz. */
export const loopSidecarSchema = z
  .object({
    bpm: z.number().positive(),
    beatsPerBar: z.number().int().positive(),
    loopStartSample: z.number().int().nonnegative(),
    loopEndSample: z.number().int().positive(),
    key: z.string().optional(),
  })
  .refine((s) => s.loopEndSample > s.loopStartSample, {
    message: 'loopEndSample must be after loopStartSample',
    path: ['loopEndSample'],
  });
export type LoopSidecar = z.output<typeof loopSidecarSchema>;

/** The sample rate sidecar loop points are expressed in (audio bible §5.3, §5.4). */
export const SIDECAR_SAMPLE_RATE = 48_000;

/** Loop region in seconds, for `AudioBufferSourceNode.loopStart/loopEnd`. */
export function loopSeconds(sidecar: LoopSidecar): { start: number; end: number } {
  return {
    start: sidecar.loopStartSample / SIDECAR_SAMPLE_RATE,
    end: sidecar.loopEndSample / SIDECAR_SAMPLE_RATE,
  };
}

/** Runtime file formats (audio bible §5.2). */
export type AudioFormat = 'ogg' | 'm4a';

/** MIME probe for the primary format. */
export const OPUS_MIME = 'audio/ogg; codecs=opus';

/**
 * Opus-in-Ogg when the browser says it can play it (`"probably"` or `"maybe"`), else the AAC `.m4a`
 * fallback (audio bible §5.2).
 */
export function pickFormat(canPlayType: (mime: string) => string): AudioFormat {
  return canPlayType(OPUS_MIME) === '' ? 'm4a' : 'ogg';
}

/** Asset category folder from the id prefix (`music-…`, `amb-…`, `sfx-…`; audio bible §6). */
export function assetCategory(assetId: string): string {
  return assetId.slice(0, assetId.indexOf('-'));
}

/**
 * File format of the synthesised placeholder pack (mw-e28.2): 16-bit PCM WAV, which every browser
 * decodes, so placeholders need no encoder. Final assets use the §5.2 formats.
 */
export const PLACEHOLDER_FORMAT = 'wav';

/** Runtime URL of an asset file: `<base>/<category>/<asset-id>.<ext>` (audio bible §6). */
export function assetUrl(
  base: string,
  assetId: string,
  ext: AudioFormat | typeof PLACEHOLDER_FORMAT | 'json',
): string {
  return `${base}/${assetCategory(assetId)}/${assetId}.${ext}`;
}

/**
 * URL resolution for a registry's assets under `base`: placeholder assets are the pack's WAVs,
 * everything else the session's format (loop sidecars are JSON either way).
 */
export function registryAssetUrl(
  registry: Pick<SoundRegistry, 'isPlaceholderAsset'>,
  base: string,
): (assetId: string, ext: AudioFormat | 'json') => string {
  return (assetId, ext) =>
    assetUrl(
      base,
      assetId,
      ext !== 'json' && registry.isPlaceholderAsset(assetId) ? PLACEHOLDER_FORMAT : ext,
    );
}

/** Id → definition lookup built from one or more validated manifests. */
export class SoundRegistry {
  readonly #defs = new Map<string, SoundDef>();
  readonly #placeholderAssets = new Set<string>();

  /** Validates and adds entries; throws a ZodError on bad data or an id already registered. */
  register(manifest: readonly SoundDefInput[]): this {
    const defs = soundManifestSchema.parse(manifest);
    for (const def of defs) {
      if (this.#defs.has(def.id)) throw new Error(`sound id "${def.id}" is already registered`);
    }
    for (const def of defs) {
      this.#defs.set(def.id, def);
      if (def.placeholder) for (const asset of def.variants) this.#placeholderAssets.add(asset);
    }
    return this;
  }

  /** Whether an asset id is a variant of a placeholder entry (served from the placeholder pack). */
  isPlaceholderAsset(assetId: string): boolean {
    return this.#placeholderAssets.has(assetId);
  }

  get(id: string): SoundDef | undefined {
    return this.#defs.get(id);
  }

  /** Every registered id (e.g. for the placeholder report, mw-e28.2). */
  ids(): string[] {
    return [...this.#defs.keys()];
  }
}
