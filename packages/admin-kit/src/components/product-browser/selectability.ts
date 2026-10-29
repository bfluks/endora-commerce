import type { ProductBrowserItem } from './types.js';

/**
 * What a host refuses in the product browser (feature 145, research R-4).
 *
 * The kit knows no host: each screen passes its own rules, and the same object
 * drives both entry points — the browser's row checkboxes and the quick search
 * (`ProductPicker` with `rules`).
 */
export interface ProductBrowserRules {
  /** The status tab the browser opens on. */
  initialStatus: 'all' | 'active';
  /** Types shown but not selectable (reason `typeBlocked`). */
  blockedTypes?: ReadonlyArray<ProductBrowserItem['type']> | undefined;
  /** Statuses shown but not selectable (reason `statusBlocked`). */
  blockedStatuses?: ReadonlyArray<ProductBrowserItem['status']> | undefined;
  /**
   * Archived products shown but not selectable (reason `archived`), whatever their
   * status (feature 163, FR-019). A host that sets it also loses the browser's
   * Archived tab: a tab of rows none of which may be ticked is noise.
   */
  blockArchived?: boolean | undefined;
  /** `core` key for the already-added row state; default `productBrowser.reason.alreadyAdded`. */
  alreadyAddedLabelKey?: string | undefined;
}

export type ProductSelectabilityReason =
  | 'alreadyAdded'
  | 'typeBlocked'
  | 'statusBlocked'
  | 'archived'
  | 'limitReached';

export type ProductSelectability =
  | { selectable: true }
  | { selectable: false; reason: ProductSelectabilityReason };

/** An empty id set, for a context with nothing already added or selected. */
export const NO_PRODUCT_IDS: ReadonlySet<string> = new Set<string>();

export interface ProductSelectabilityContext {
  alreadyAddedIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  max: number;
}

/**
 * Whether one row may be ticked, and if not, why.
 *
 * First match wins: `alreadyAdded` → `typeBlocked` → `archived` → `statusBlocked`
 * → `limitReached`. `archived` precedes the status: an archived `active` product
 * is refused for being archived, and an archived `inactive` one is named by the
 * stronger of its two reasons. The cap applies only to a row that is not already selected, so a
 * selected row stays de-selectable when the selection is full.
 */
export function productSelectability(
  row: Pick<ProductBrowserItem, 'id' | 'status' | 'type' | 'archivedAt'>,
  rules: ProductBrowserRules,
  ctx: ProductSelectabilityContext,
): ProductSelectability {
  if (ctx.alreadyAddedIds.has(row.id)) return { selectable: false, reason: 'alreadyAdded' };
  if (rules.blockedTypes?.includes(row.type)) return { selectable: false, reason: 'typeBlocked' };
  if (rules.blockArchived && isProductArchived(row)) return { selectable: false, reason: 'archived' };
  if (rules.blockedStatuses?.includes(row.status)) {
    return { selectable: false, reason: 'statusBlocked' };
  }
  if (!ctx.selectedIds.has(row.id) && ctx.selectedIds.size >= ctx.max) {
    return { selectable: false, reason: 'limitReached' };
  }
  return { selectable: true };
}

/** The `core` key that names a refusal on screen. */
export function productSelectabilityReasonKey(
  reason: ProductSelectabilityReason,
  rules: Pick<ProductBrowserRules, 'alreadyAddedLabelKey'>,
): string {
  switch (reason) {
    case 'alreadyAdded':
      return rules.alreadyAddedLabelKey ?? 'productBrowser.reason.alreadyAdded';
    case 'typeBlocked':
      return 'productBrowser.reason.groupParent';
    case 'statusBlocked':
      return 'productBrowser.reason.notActive';
    case 'archived':
      return 'productBrowser.reason.archived';
    case 'limitReached':
      return 'productBrowser.reason.limitReached';
  }
}

/** Whether a row is archived (feature 163, FR-019): `archivedAt` set, never a status. */
export function isProductArchived(row: Pick<ProductBrowserItem, 'archivedAt'>): boolean {
  return row.archivedAt !== undefined && row.archivedAt !== null;
}
