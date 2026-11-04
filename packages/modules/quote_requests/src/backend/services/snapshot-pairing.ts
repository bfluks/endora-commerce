/**
 * Feature 159 (research N-32) — which line of one revision snapshot a line of
 * the next one *is*, shared by the admin History (`history/history-diff.ts`)
 * and the customer's comparison (`RfqRevisionService.diffRevisions`).
 *
 * One product may sit on several lines, in different groups, so pairing by
 * product alone collapses them. Lines pair by the rule the rewrites use
 * (`pairLines`, customer mode: product and variant, then packaging name, then
 * order), each pass preferring a line of the same group and quantity. Pure.
 */
import type { QuoteRequestRevisionLine } from '../entities/quote-request-revision.entity.js';
import { pairLines } from './line-carry-over.js';

export interface SnapshotPairing {
  /** Index-aligned with the later snapshot: the earlier line each line is, or `null` (added). */
  readonly paired: ReadonlyArray<QuoteRequestRevisionLine | null>;
  /** Earlier lines no later line is, in their order. */
  readonly removed: readonly QuoteRequestRevisionLine[];
}

/** A snapshot line's group; a snapshot written before the feature records none and says nothing. */
function groupOf(item: QuoteRequestRevisionLine): string | null | undefined {
  return 'groupId' in item ? (item.groupId ?? null) : undefined;
}

export function pairSnapshotLines(
  before: readonly QuoteRequestRevisionLine[],
  after: readonly QuoteRequestRevisionLine[],
): SnapshotPairing {
  const rows = before.map((item, index) => ({
    id: String(index),
    productId: item.productId,
    variantId: item.variantId ?? null,
    packagingUnitName: item.packagingUnitName ?? null,
    groupId: groupOf(item),
    quantity: item.quantity,
    item,
  }));
  const { paired, removed } = pairLines(
    rows,
    after.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? null,
      // An absent key (a snapshot written before feature 146) says nothing
      // about packaging: only product, variant and order decide.
      packagingUnitName: 'packagingUnitName' in item ? (item.packagingUnitName ?? null) : undefined,
      groupId: groupOf(item),
      quantity: item.quantity,
    })),
    'customer',
  );
  return { paired: paired.map((row) => row?.item ?? null), removed: removed.map((row) => row.item) };
}

/**
 * A line's product, variant and packaging, as one key — a packaging unit is in
 * the product name an entry shows, so it tells two lines apart already.
 */
function lineKey(item: Pick<QuoteRequestRevisionLine, 'productId' | 'variantId' | 'packagingUnitName'>): string {
  return `${item.productId}|${item.variantId ?? ''}|${item.packagingUnitName ?? ''}`;
}

/**
 * The group an entry about `item` names — the group's name, `null` for an
 * ungrouped line — or `undefined` when the line needs no naming: its product,
 * variant and packaging sit on one line only of either snapshot.
 */
export function disambiguatingGroupName(
  before: readonly QuoteRequestRevisionLine[],
  after: readonly QuoteRequestRevisionLine[],
): (item: QuoteRequestRevisionLine) => string | null | undefined {
  const repeated = new Set<string>();
  for (const items of [before, after]) {
    const seen = new Set<string>();
    for (const item of items) {
      const key = lineKey(item);
      if (seen.has(key)) repeated.add(key);
      seen.add(key);
    }
  }
  return (item) => (repeated.has(lineKey(item)) ? (item.groupId ? (item.groupName ?? null) : null) : undefined);
}
