// The UI icon manifest (mw-e17.2): every inventory and spell icon the UI may show, keyed by its final
// asset id (style bible §15.1: `icon-item-…`, `icon-spell-…`), and whether it is still a placeholder.
// Item definitions name their icon by id; the item content check (`itemIconProblems`) fails when an
// item names an icon this manifest lacks, placeholder or not. The icon integration beads
// (e37-asset-icons-*-integrate) add the files and flip `placeholder` to false, so integration is a
// file swap. Fixture items' icons are listed as placeholders.

import { z } from 'zod';
import manifestJson from './icon-manifest.json';

/** UI icon asset ids (style bible §15.1). */
export const ICON_ID_PATTERN = /^icon-(?:item|spell)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One manifest entry. */
export const iconSchema = z.strictObject({
  id: z
    .string()
    .regex(ICON_ID_PATTERN, 'must be an icon asset id like "icon-item-lockpick-iron-01"'),
  /** Generated stand-in under the final id; false once approved art lands. */
  placeholder: z.boolean(),
});

/** The manifest file: entries with unique ids. */
export const iconManifestSchema = z.array(iconSchema).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `duplicate icon id "${entry.id}"`,
      });
    }
    seen.add(entry.id);
  });
});

export type IconEntry = z.output<typeof iconSchema>;

/** The committed manifest (src/ui/icons/icon-manifest.json), validated. */
export function iconManifest(): readonly IconEntry[] {
  return iconManifestSchema.parse(manifestJson);
}
