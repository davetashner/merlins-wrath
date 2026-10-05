// The `merchants` save section (mw-e20.4): every touched merchant's runtime state (src/sim/economy/
// shop-state.ts), keyed by merchant id: the gold it carries, its stock lines and its buyback list.
// A merchant never touched has no record and starts from its definition next time. A load drops
// stock and buyback entries whose item definition this build no longer has, logs one warning per
// drop and loads the rest: losing a removed item is better than losing the save.

import { merchantStoreOf, type MerchantState, type MerchantStates } from '@sim/index';
import { z } from 'zod';
import { defineSaveSection, type SaveSection, type SectionMigration } from './format';

/** Id of the merchants section (never renamed). */
export const MERCHANTS_SECTION_ID = 'merchants';

/**
 * Data version of the merchants section. v1 (mw-e20.4): gold, stock lines and buyback per merchant.
 * v2 (mw-e20.5): adds the optional `restockedDay` and `opened` (restock bookkeeping).
 */
export const MERCHANTS_SECTION_VERSION = 2;

/**
 * `MERCHANTS_MIGRATIONS[n]` upgrades the section's data from v`n` to v`n + 1`. v1 -> v2 only
 * adds optional fields, so the data passes through (a merchant without `restockedDay` is taken as
 * restocked today).
 */
export const MERCHANTS_MIGRATIONS: Readonly<Record<number, SectionMigration>> = Object.freeze({
  1: (data) => data,
});

/** The section's data. */
export interface MerchantsData {
  readonly merchants: MerchantStates;
}

const count = z.int().positive();
const defId = z.string().min(1);
const flags = z.strictObject({
  stolen: z.boolean().exactOptional(),
  ownerId: z.string().exactOptional(),
  bound: z.boolean().exactOptional(),
});

const merchantSchema = z.strictObject({
  gold: z.int().nonnegative(),
  nextId: count,
  stock: z.array(
    z.strictObject({
      id: count,
      defId,
      count,
      flags,
      entry: z.int().nonnegative().nullable(),
    }),
  ),
  buyback: z.array(z.strictObject({ id: count, defId, count, flags, unitPrice: count })),
  restockedDay: count.exactOptional(),
  opened: z.array(z.int().nonnegative()).exactOptional(),
});

const merchantsSchema = z.strictObject({
  merchants: z.record(z.string().min(1), merchantSchema),
}) satisfies z.ZodType<MerchantsData>;

export interface MerchantsSectionOptions {
  /**
   * Whether an item definition exists in this build (the content registry's item ids). When
   * omitted, every saved item is kept.
   */
  readonly knownItem?: (defId: string) => boolean;
  /** Receives one message per item a load dropped. */
  readonly warn?: (message: string) => void;
}

/** The warning a load logs for a dropped item. */
export function droppedShopItemMessage(merchantId: string, item: string, where: string): string {
  return `save: dropped item "${item}" from merchant "${merchantId}"'s ${where}: the item is no longer defined`;
}

/** The merchants section; register it after the inventory section. */
export function merchantsSaveSection(
  options: MerchantsSectionOptions = {},
): SaveSection<MerchantsData> {
  const { knownItem, warn } = options;
  return defineSaveSection<MerchantsData>({
    id: MERCHANTS_SECTION_ID,
    version: MERCHANTS_SECTION_VERSION,
    schema: merchantsSchema,
    migrations: MERCHANTS_MIGRATIONS,
    serialize: (world) => ({ merchants: merchantStoreOf(world).capture() }),
    deserialize: (world, saved, context) => {
      const report = (merchantId: string, item: string, where: string): void => {
        const message = droppedShopItemMessage(merchantId, item, where);
        context.warn(message);
        warn?.(message);
      };
      const merchants: Record<string, MerchantState> = {};
      for (const [id, state] of Object.entries(saved.merchants)) {
        if (knownItem === undefined) {
          merchants[id] = state;
          continue;
        }
        const keep = (item: string, where: string): boolean => {
          if (knownItem(item)) return true;
          report(id, item, where);
          return false;
        };
        merchants[id] = {
          ...state,
          stock: state.stock.filter((line) => keep(line.defId, 'stock')),
          buyback: state.buyback.filter((entry) => keep(entry.defId, 'buyback')),
        };
      }
      merchantStoreOf(world).restore(merchants);
    },
    missing: (world) => {
      merchantStoreOf(world).restore({});
    },
  });
}
