// Load-time loot-table checks (mw-e18.2): what one loot-table file can't check alone, so broken loot
// fails in CI instead of silently giving an empty chest or a duplicate artifact. Weights (≥ 1) and
// count ranges (min ≤ max) are the schema's (src/content/types/loot-table.ts); across tables this
// checks that:
//
// - every item and nested table an entry names exists, and every creature's `loot` names a table
//   (the loader also checks `ref`s, so the first two only fire when the validator runs on its own);
// - a table that rolls (`rolls.max` > 0) has entries to roll;
// - nested tables never form a cycle ("a > b > a") nor nest deeper than LOOT_MAX_DEPTH, which the
//   sim would otherwise only catch mid-roll with `loot.depthExceeded`;
// - a unique item is guaranteed in at most one placement across the world, one unit at a time. A
//   placement is a creature dropping a table that guarantees it, or the table itself while nothing
//   places it yet (containers in scenes join the placers when they land);
// - every table is referenced by a creature or another table; an unreferenced one is a warning only.
//
// `lootTableProblems` returns errors and warnings; `checkLootTables` is the errors as a ContentCheck
// on every load, and `pnpm content:loot` (scripts/loot-check.ts) prints both in CI.

import type { ContentCheck, ContentIssue, LoadedEntry } from './loader.ts';
import type { CreatureDef } from './types/creature.ts';
import type { ItemDef } from './types/item.ts';
import { LOOT_MAX_DEPTH, type LootTable } from './types/loot-table.ts';

/** What `lootTableProblems` found: errors fail validation, warnings never do. */
export interface LootProblems {
  readonly errors: readonly ContentIssue[];
  readonly warnings: readonly ContentIssue[];
}

/** A loaded loot table and the file it came from. */
interface TableFile {
  readonly file: string;
  readonly table: LootTable;
}

/** A guaranteed drop of a unique item somewhere in the world. */
interface Placement {
  readonly name: string;
  readonly file: string;
  readonly pointer: string;
}

/** Cycles and over-deep chains of nested tables, depth-first in id order (`sorted`). */
function nestingProblems(
  sorted: readonly TableFile[],
  tables: ReadonlyMap<string, TableFile>,
  errors: ContentIssue[],
) {
  /** The tables `node` rolls that exist, with their entry index. */
  const children = (node: TableFile) =>
    node.table.entries.flatMap((entry, i) => {
      const child = entry.table === undefined ? undefined : tables.get(entry.table.id);
      return child === undefined ? [] : [{ child, i }];
    });

  // Cycles: an edge back to a table still on the stack closes one.
  const done = new Set<TableFile>();
  const stack: string[] = [];
  const visit = (node: TableFile) => {
    stack.push(node.table.id);
    for (const { child, i } of children(node)) {
      const at = stack.indexOf(child.table.id);
      if (at !== -1) {
        const path = [...stack.slice(at), child.table.id].join(' > ');
        errors.push({
          file: node.file,
          pointer: `/entries/${String(i)}/table`,
          message: `loot-table:${node.table.id} entries[${String(i)}] closes a cycle of nested tables: ${path}`,
        });
      } else if (!done.has(child)) {
        visit(child);
      }
    }
    stack.pop();
    done.add(node);
  };
  const before = errors.length;
  for (const node of sorted) if (!done.has(node)) visit(node);
  if (errors.length > before) return; // depth is meaningless around a cycle

  // Depth: the longest chain from each table (the table itself is depth 1).
  const longest = new Map<TableFile, readonly string[]>();
  const chain = (node: TableFile): readonly string[] => {
    const known = longest.get(node);
    if (known !== undefined) return known;
    let best: readonly string[] = [];
    for (const { child } of children(node)) {
      const sub = chain(child);
      if (sub.length > best.length) best = sub;
    }
    const result = [node.table.id, ...best];
    longest.set(node, result);
    return result;
  };
  for (const node of sorted) {
    const path = chain(node);
    if (path.length > LOOT_MAX_DEPTH) {
      errors.push({
        file: node.file,
        pointer: '/entries',
        message:
          `loot-table:${node.table.id} nests ${String(path.length)} tables deep (${path.join(' > ')}); ` +
          `the most is ${String(LOOT_MAX_DEPTH)}`,
      });
    }
  }
}

/** Every loot-table problem across `entries` (the loaded content), in a stable order. */
export function lootTableProblems(entries: readonly LoadedEntry[]): LootProblems {
  const errors: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];
  const items = new Map<string, ItemDef>();
  const creatures: { file: string; creature: CreatureDef }[] = [];
  const sorted: TableFile[] = [];
  for (const { type, file, value } of entries) {
    if (type === 'item') items.set(value.id, value as ItemDef);
    if (type === 'creature') creatures.push({ file, creature: value as CreatureDef });
    if (type === 'loot-table') sorted.push({ file, table: value as LootTable });
  }
  sorted.sort((a, b) => a.table.id.localeCompare(b.table.id));
  const tables = new Map(sorted.map((node) => [node.table.id, node]));

  const referenced = new Set<string>();
  const placers = new Map<string, string[]>();
  for (const { file, creature } of creatures) {
    if (creature.loot === undefined) continue;
    if (tables.has(creature.loot)) {
      referenced.add(creature.loot);
      placers.set(creature.loot, [
        ...(placers.get(creature.loot) ?? []),
        `creature:${creature.id}`,
      ]);
    } else {
      errors.push({
        file,
        pointer: '/loot',
        message: `creature:${creature.id} loot names missing loot-table "${creature.loot}"`,
      });
    }
  }

  for (const { file, table } of sorted) {
    const at = `loot-table:${table.id}`;
    const missingItem = (where: string, pointer: string, id: string) => {
      if (!items.has(id)) {
        errors.push({ file, pointer, message: `${at} ${where} names missing item "${id}"` });
      }
    };
    table.guaranteed.forEach(({ item }, i) => {
      missingItem(`guaranteed[${String(i)}]`, `/guaranteed/${String(i)}/item`, item.id);
    });
    table.entries.forEach((entry, i) => {
      const where = `entries[${String(i)}]`;
      if (entry.item !== undefined) missingItem(where, `/entries/${String(i)}/item`, entry.item.id);
      if (entry.table === undefined) return;
      const target = entry.table.id;
      if (!tables.has(target)) {
        errors.push({
          file,
          pointer: `/entries/${String(i)}/table`,
          message: `${at} ${where} names missing loot-table "${target}"`,
        });
      } else if (target !== table.id) {
        referenced.add(target);
      }
    });
    if (table.rolls.max > 0 && table.entries.length === 0) {
      errors.push({
        file,
        pointer: '/rolls',
        message: `${at} rolls up to ${String(table.rolls.max)} times but has no entries to roll`,
      });
    }
  }

  nestingProblems(sorted, tables, errors);

  // Unique items: at most one guaranteed placement in the world, one unit at a time.
  const placements = new Map<string, Placement[]>();
  for (const { file, table } of sorted) {
    table.guaranteed.forEach(({ item, count }, i) => {
      if (items.get(item.id)?.flags.unique !== true) return;
      const pointer = `/guaranteed/${String(i)}`;
      const where = `loot-table:${table.id} guaranteed[${String(i)}]`;
      if (count > 1) {
        errors.push({
          file,
          pointer: `${pointer}/count`,
          message: `${where} guarantees ${String(count)} of unique item "${item.id}"; a unique item drops once`,
        });
      }
      const by = placers.get(table.id) ?? [];
      const found =
        by.length === 0
          ? [{ name: where, file, pointer }]
          : by.map((placer) => ({ name: `${placer} (via ${where})`, file, pointer }));
      placements.set(item.id, [...(placements.get(item.id) ?? []), ...found]);
    });
  }
  for (const [item, found] of [...placements].sort(([a], [b]) => a.localeCompare(b))) {
    if (found.length < 2) continue;
    const [first] = found as [Placement];
    errors.push({
      file: first.file,
      pointer: first.pointer,
      message:
        `unique item "${item}" is guaranteed in ${String(found.length)} placements; ` +
        `it may be guaranteed in at most one: ${found.map((p) => p.name).join(', ')}`,
    });
  }

  for (const { file, table } of sorted) {
    if (referenced.has(table.id)) continue;
    warnings.push({
      file,
      pointer: '',
      message: `loot-table:${table.id} is not referenced by any creature or loot table`,
    });
  }
  return { errors, warnings };
}

/** The content check for loot tables: the errors of `lootTableProblems` (warnings never fail a load). */
export const checkLootTables: ContentCheck = (entries) => lootTableProblems(entries).errors;
