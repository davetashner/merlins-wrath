// Building blocks every content schema uses (mw-e00.18): the id format and typed cross-references.
// A reference is written in JSON as the target's plain id ("plank"); the schema says which content
// type it points at, and parsing turns it into a ContentRef so the loader can find every reference
// after load and check that its target exists (validation that zod alone can't do per entry).

import { z } from 'zod';

/** Content ids: lowercase kebab-case, e.g. `forgotten-miner`. Stable forever once shipped (saves). */
export const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Schema for an entry's own `id`. Every content type's schema must have `id: contentId`. */
export const contentId = z
  .string()
  .regex(CONTENT_ID_PATTERN, 'must be lowercase kebab-case, e.g. "forgotten-miner"');

/** A resolved-at-load reference to another content entry, e.g. `creature:goblin-archer`. */
export class ContentRef<T extends string = string> {
  /** Content type of the target, e.g. `creature`. */
  readonly type: T;
  /** Id of the target entry within that type. */
  readonly id: string;

  constructor(type: T, id: string) {
    this.type = type;
    this.id = id;
    Object.freeze(this);
  }

  /** The plain id, so `JSON.stringify` writes a loaded entry back in its content-file form. */
  toJSON(): string {
    return this.id;
  }

  /** `type:id`, the form used in error messages and test names. */
  toString(): string {
    return `${this.type}:${this.id}`;
  }
}

/**
 * Schema for a reference to an entry of `type`. The JSON holds the target id; the parsed value is a
 * `ContentRef<type>`. Targets are checked after every file has loaded (`loadContent`). The generated
 * JSON Schema marks the field with `x-contentRef: type` (read by the content docs generator).
 */
export function ref<T extends string>(type: T) {
  return contentId.meta({ 'x-contentRef': type }).transform((id) => new ContentRef(type, id));
}

/** A loaded entry as content-file JSON (refs back to plain ids); parsing it gives an equal entry. */
export function serializeContent(entry: unknown): string {
  return `${JSON.stringify(entry, null, 2)}\n`;
}
