// The save section registry (mw-e30.1): the one place that turns a whole world into save bytes and
// back. The core `world` section stores the sim's WorldSnapshot (entities, clock, RNG streams and
// every component no other section claims); each system registers its own section for the state it
// owns, with its own version and migrations. Loading is all-or-nothing: every section is decoded,
// migrated and validated before the world is touched, and if applying one throws, the world is
// rolled back to exactly its prior state. Sections from a newer build that this build does not know
// are kept verbatim so re-saving never destroys them.

import type { World, WorldSnapshot } from '@sim/index';
import { z } from 'zod';
import { decodeSave, encodeSave, type BuildInfo, type SaveEnvelope } from './envelope';
import { SaveApplyError, SaveCorruptError, type SaveLoadError } from './errors';
import {
  defineSaveSection,
  migrateSection,
  validateSection,
  type SaveSection,
  type SectionRecord,
} from './section';

/** Id of the built-in section holding the world snapshot. */
export const WORLD_SECTION_ID = 'world';

/** Data version of the world section (the WorldSnapshot shape). */
export const WORLD_SECTION_VERSION = 1;

const worldSnapshotSchema = z.strictObject({
  seed: z.number(),
  clock: z.strictObject({ tick: z.number(), hz: z.number() }),
  nextEntity: z.number(),
  entities: z.array(z.number()),
  components: z.record(z.string(), z.array(z.tuple([z.number(), z.unknown()]))),
  rng: z.record(z.string(), z.strictObject({ seed: z.number(), state: z.array(z.number()) })),
}) satisfies z.ZodType<WorldSnapshot>;

/** A non-fatal load finding, for logs and the load UI. */
export interface SaveWarning {
  /**
   * `unknown-section`: the save has a section this build does not register (kept for re-saving).
   * `missing-section`: a registered section is absent from the save (its state was left empty).
   */
  readonly kind: 'unknown-section' | 'missing-section';
  readonly section: string;
  readonly message: string;
}

/** Outcome of loading a save into a world. */
export type LoadSaveResult =
  | {
      readonly ok: true;
      readonly envelope: SaveEnvelope;
      readonly warnings: readonly SaveWarning[];
      /** Sections this build does not know; pass back as `preserve` when saving again. */
      readonly unknownSections: Readonly<Record<string, SectionRecord>>;
    }
  | { readonly ok: false; readonly error: SaveLoadError };

export interface WriteSaveOptions {
  readonly build: BuildInfo;
  /** Wall-clock milliseconds since the Unix epoch; injected so saving stays pure. */
  readonly wallClockSavedAt: number;
  /** Plain, canonically encodable data for slot lists. Defaults to `{}`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Unknown sections from the load this save continues (`LoadSaveResult.unknownSections`). */
  readonly preserve?: Readonly<Record<string, SectionRecord>>;
}

/** Sections that make up a save, in apply order (the world section first). */
export class SaveRegistry {
  private readonly ordered: SaveSection[];
  private readonly ids = new Set<string>();
  /** Component name → id of the section that saves it. */
  private readonly owners = new Map<string, string>();

  constructor() {
    this.ordered = [
      defineSaveSection<WorldSnapshot>({
        id: WORLD_SECTION_ID,
        version: WORLD_SECTION_VERSION,
        schema: worldSnapshotSchema,
        serialize: (world) => {
          const snapshot = world.snapshot();
          const components = Object.fromEntries(
            Object.entries(snapshot.components).filter(([name]) => !this.owners.has(name)),
          );
          return { ...snapshot, components };
        },
        deserialize: (world, data) => {
          world.restore(data);
        },
      }),
    ];
    this.ids.add(WORLD_SECTION_ID);
  }

  /**
   * Adds a section; it is saved and applied after every section registered before it.
   * @throws RangeError for a malformed definition (see defineSaveSection); Error for a duplicate id
   *   or a component another section already claims.
   */
  register<TData>(section: SaveSection<TData>): this {
    const checked = defineSaveSection(section);
    if (this.ids.has(checked.id))
      throw new Error(`save section "${checked.id}" is already registered`);
    for (const { name } of checked.components ?? []) {
      const owner = this.owners.get(name);
      if (owner !== undefined) {
        throw new Error(`component "${name}" is already saved by section "${owner}"`);
      }
    }
    for (const { name } of checked.components ?? []) this.owners.set(name, checked.id);
    this.ids.add(checked.id);
    this.ordered.push(checked);
    return this;
  }

  /** Every section, world first, in apply order (e.g. for schema fingerprints). */
  get sections(): readonly SaveSection[] {
    return [...this.ordered];
  }

  /**
   * Serializes the whole world into save bytes. Every section's output is validated against its own
   * schema first, so a save that this build wrote is always one it can load.
   * @throws SaveSectionInvalidError when a section serializes data its schema rejects;
   *   CanonicalEncodingError for values with no canonical form (functions, Maps, undefined…).
   */
  write(world: World, options: WriteSaveOptions): Uint8Array {
    const sections: Record<string, SectionRecord> = {};
    for (const [id, record] of Object.entries(options.preserve ?? {})) {
      if (!this.ids.has(id)) sections[id] = record;
    }
    for (const section of this.ordered) {
      const data = section.serialize(world);
      const valid = validateSection(section, data);
      if (!valid.ok) throw valid.error;
      sections[section.id] = { version: section.version, data };
    }
    const { gameVersion, buildSha, contentHash } = options.build;
    return encodeSave({
      gameVersion,
      buildSha,
      contentHash,
      createdAtTick: world.tick,
      wallClockSavedAt: options.wallClockSavedAt,
      metadata: options.metadata ?? {},
      sections,
    });
  }

  /**
   * Loads save bytes into `world` (which must have the save's component types registered). On any
   * failure the world is left exactly as it was and a typed error is returned.
   */
  read(world: World, bytes: Uint8Array): LoadSaveResult {
    const decoded = decodeSave(bytes);
    if (!decoded.ok) return decoded;
    const { envelope } = decoded;
    const warnings: SaveWarning[] = [];
    const unknownSections: Record<string, SectionRecord> = {};
    for (const [id, record] of Object.entries(envelope.sections)) {
      if (this.ids.has(id)) continue;
      unknownSections[id] = record;
      warnings.push({
        kind: 'unknown-section',
        section: id,
        message: `save section "${id}" (v${String(record.version)}) is not known to this build; it will be kept on re-save`,
      });
    }

    const prepared: { section: SaveSection; data: unknown }[] = [];
    for (const section of this.ordered) {
      const record = envelope.sections[section.id];
      if (record === undefined) {
        if (section.id === WORLD_SECTION_ID) {
          return { ok: false, error: new SaveCorruptError('the world section is missing') };
        }
        warnings.push({
          kind: 'missing-section',
          section: section.id,
          message: `save has no "${section.id}" section; its state starts empty`,
        });
        continue;
      }
      const migrated = migrateSection(section, record);
      if (!migrated.ok) return migrated;
      const valid = validateSection(section, migrated.data);
      if (!valid.ok) return valid;
      prepared.push({ section, data: valid.data });
    }

    const before = world.snapshot();
    let applying = WORLD_SECTION_ID;
    try {
      for (const { section, data } of prepared) {
        applying = section.id;
        section.deserialize(world, data);
      }
    } catch (cause) {
      world.restore(before);
      return { ok: false, error: new SaveApplyError(applying, cause) };
    }
    return { ok: true, envelope, warnings, unknownSections };
  }
}
