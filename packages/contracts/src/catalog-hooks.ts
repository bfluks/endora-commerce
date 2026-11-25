// `catalog`'s hookable actions — spec 193 (`specs/193-product-visibility-rules/` T049, research
// R-11), on the mechanism of `specs/176-command-hooks-outbox/`.
//
// The catalog writes that can move a product's status: its global status, its archive flag, or a
// channel-scoped status cell (`product_channel_scopes.status`, scope level `channel`; or
// `product_channel_language_scopes.status`, scope level `channel_language`). A module that must
// act in the same transaction when a product becomes active again — the website rule's admission
// (`product_visibility_rules`) — registers a `beforeCommit` hook on these refs.
//
// `product.bulk_update` is not a Command of its own: every product of a bulk edit runs one of
// the Commands below (`product.update`, `product.restore`, `product.scopes.update`), so a hook
// on those sees every bulk write. `product.scoped_values.copy_to_channels` copies text fields
// only and never a status, so it is not declared.
//
// The data is ids, status codes and booleans — never a name or a value a person typed. The
// action strings, object types and data shape are a public contract: changing one is a
// changeset on `@endora-commerce/contracts`.

import { hookableAction } from './command-hooks.js';
import type { ProductScopeStatus } from './product-scopes.js';

/** A product's global state as a status hook sees it. */
export interface ProductGlobalStatus {
  readonly status: 'active' | 'inactive';
  readonly archived: boolean;
  readonly deleted: boolean;
}

/** One stored status cell; `languageCode` `null` = the channel row (scope level `channel`). */
export interface ProductChannelStatusCell {
  readonly salesChannelId: string;
  readonly languageCode: string | null;
  /** `null` = no stored value: the cell inherits. */
  readonly status: ProductScopeStatus | null;
}

/** What the catalog reads of one product before and after a hooked write. */
export interface ProductStatusFacts extends ProductGlobalStatus {
  readonly productId: string;
  readonly channelStatuses: readonly ProductChannelStatusCell[];
}

/** One product of a hooked write: its global state either side, and each status cell that moved. */
export interface ProductStatusChange {
  readonly productId: string;
  /** `null` when the product did not exist before the write. */
  readonly before: ProductGlobalStatus | null;
  /** `null` when the product does not exist after the write. */
  readonly after: ProductGlobalStatus | null;
  readonly channelStatuses: ReadonlyArray<{
    readonly salesChannelId: string;
    readonly languageCode: string | null;
    readonly before: ProductScopeStatus | null;
    readonly after: ProductScopeStatus | null;
  }>;
}

/** The hook data of every action in {@link CATALOG_HOOKABLE_ACTIONS}. */
export interface ProductStatusHookData {
  /** Every product the write addressed, whether or not anything of its status moved. */
  readonly products: readonly ProductStatusChange[];
}

function globalOf(facts: ProductStatusFacts | undefined): ProductGlobalStatus | null {
  return facts ? { status: facts.status, archived: facts.archived, deleted: facts.deleted } : null;
}

/** The hook data from the facts read before and after the write, product by product. */
export function productStatusChanges(
  before: readonly ProductStatusFacts[],
  after: readonly ProductStatusFacts[],
): ProductStatusHookData {
  const was = new Map(before.map((f) => [f.productId, f]));
  const now = new Map(after.map((f) => [f.productId, f]));
  const ids = [...new Set([...was.keys(), ...now.keys()])];
  return {
    products: ids.map((productId) => {
      const b = was.get(productId);
      const a = now.get(productId);
      const key = (c: ProductChannelStatusCell) => `${c.salesChannelId}|${c.languageCode ?? ''}`;
      const cellsBefore = new Map((b?.channelStatuses ?? []).map((c) => [key(c), c]));
      const cellsAfter = new Map((a?.channelStatuses ?? []).map((c) => [key(c), c]));
      const cells = [...new Set([...cellsBefore.keys(), ...cellsAfter.keys()])]
        .map((k) => {
          const x = cellsBefore.get(k) ?? cellsAfter.get(k)!;
          return {
            salesChannelId: x.salesChannelId,
            languageCode: x.languageCode,
            before: cellsBefore.get(k)?.status ?? null,
            after: cellsAfter.get(k)?.status ?? null,
          };
        })
        .filter((c) => c.before !== c.after);
      return { productId, before: globalOf(b), after: globalOf(a), channelStatuses: cells };
    }),
  };
}

export const CATALOG_HOOKABLE_ACTIONS = {
  productUpdate: hookableAction<ProductStatusHookData>('product.update', 'product', ['beforeCommit']),
  productRestore: hookableAction<ProductStatusHookData>('product.restore', 'product', ['beforeCommit']),
  productBulkUpdateUndo: hookableAction<ProductStatusHookData>('product.bulk_update.undo', 'bulk_operation', ['beforeCommit']),
  productScopesUpdate: hookableAction<ProductStatusHookData>('product.scopes.update', 'product', ['beforeCommit']),
  productScopedValuesSave: hookableAction<ProductStatusHookData>('product.scoped_values.save', 'product', ['beforeCommit']),
  productScopedValuesImport: hookableAction<ProductStatusHookData>('product.scoped_values.import', 'product', ['beforeCommit']),
} as const;
