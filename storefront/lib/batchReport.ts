import { tForLocale, type MessageKey } from './i18n/messages';
import { formatCount } from './orderMinimum';
import { belowMinimumText } from './cartMinimum';
import type { QuickOrderBuildRejectedLine, RejectedQuickOrderItem } from './api/quick-order';
import type { ConversionSkip } from './api/shopping-lists';

/**
 * Feature 154 (FR-011, US4) — the buyer-facing sentences of the batch paths' reports: the
 * quick-order import preview's rejected rows, the quick-order build's `rejected[]`, the
 * shopping list → cart `skipped[]` and the quote → cart dropped lines. Each states the minimum
 * the line missed, in PL and EN. Pure, so the report pages stay server-rendered and the
 * wording is testable in the node-only test environment.
 */

/** A quick-order preview row's reason — "The product's total in this file is 7, minimum 10 pcs". */
export function quickOrderRejectionLabel(
  row: Pick<RejectedQuickOrderItem, 'reason'> & Partial<RejectedQuickOrderItem>,
  locale: string,
): string {
  const t = tForLocale(locale);
  if (row.reason === 'below_minimum' && row.minimum !== undefined && row.productTotal !== undefined) {
    return t('quickOrder.reason.below_minimumDetail')
      .replace('{total}', formatCount(row.productTotal, locale))
      .replace('{count}', formatCount(row.minimum, locale));
  }
  return t(`quickOrder.reason.${row.reason}` as MessageKey);
}

/** One line a quick-order build left out of the cart — "Anchor bolt × 5 — Below the minimum (10 pcs)". */
export function quickOrderBuildRejectionText(
  line: Pick<QuickOrderBuildRejectedLine, 'productName' | 'quantity' | 'kind' | 'minimum' | 'packagingUnitName'>,
  locale: string,
): string {
  const reason =
    belowMinimumText(
      {
        belowMinimum: {
          kind: line.kind,
          minimum: line.minimum,
          ...(line.packagingUnitName !== undefined ? { packagingUnitName: line.packagingUnitName } : {}),
        },
      },
      locale,
    ) ?? tForLocale(locale)('order.minimum.below.bare');
  return fill(tForLocale(locale)('quickOrder.build.rejectedLine'), {
    product: line.productName,
    quantity: formatCount(line.quantity, locale),
    reason,
  });
}

/**
 * Fills `{name}` placeholders in one pass, so a brace inside an operator-authored value (a
 * product or unit name) is never read as a placeholder.
 */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/**
 * The quick-order build's outcome line: how many of the lines sent reached the cart, or that
 * none did — never "Cart built" over a build that added nothing.
 */
export function quickOrderBuildOutcome(sentCount: number, rejectedCount: number, locale: string): string {
  const t = tForLocale(locale);
  const added = Math.max(0, sentCount - rejectedCount);
  if (added === 0) return t('quickOrder.build.noneAdded');
  return t('quickOrder.build.added')
    .replace('{added}', formatCount(added, locale))
    .replace('{total}', formatCount(sentCount, locale));
}

/** A shopping list → cart skip's reason. A list line counts pieces, so its minimum is pieces. */
export function shoppingListSkipLabel(skip: Pick<ConversionSkip, 'reason' | 'minimum'>, locale: string): string {
  const t = tForLocale(locale);
  if (skip.reason === 'below_minimum') {
    return skip.minimum !== undefined
      ? (belowMinimumText({ belowMinimum: { kind: 'pieces', minimum: skip.minimum } }, locale) ??
          t('order.minimum.below.bare'))
      : t('order.minimum.below.bare');
  }
  return t(`shoppingList.skip.${skip.reason}`);
}

/**
 * A quote → cart dropped line's `below_minimum` reason, lower-case to follow the banner's
 * "…were not added because:". The dropped line carries no kind (a quote line may count a
 * packaging unit), so the minimum is stated without a unit.
 */
export function droppedBelowMinimumReason(minimum: number | undefined, locale: string): string {
  const t = tForLocale(locale);
  if (minimum === undefined) return t('cart.dropped.belowMinimumBare');
  return t('cart.dropped.belowMinimum').replace('{minimum}', formatCount(minimum, locale));
}

/**
 * A report carried across a server action's redirect, as the quick-order preview already is:
 * JSON in base64url. The page reads back only what its own action wrote; anything else
 * decodes to an empty report rather than an error page.
 */
export function encodeReport(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeReport<T = unknown>(value: string | undefined | null): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Whether a value read back from the redirect URL is a build refusal the page can word. The
 * URL is the buyer's to edit; a hand-made entry is dropped rather than rendered half-filled.
 */
export function isBuildRejectedLine(value: unknown): value is QuickOrderBuildRejectedLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.productName === 'string' &&
    Number.isInteger(line.quantity) &&
    Number.isInteger(line.minimum) &&
    (line.kind === 'pieces' || line.kind === 'packaging_unit') &&
    (line.packagingUnitName === undefined || typeof line.packagingUnitName === 'string')
  );
}

/** As {@link isBuildRejectedLine}, for a shopping list → cart skip. */
export function isConversionSkip(value: unknown): value is ConversionSkip {
  if (typeof value !== 'object' || value === null) return false;
  const skip = value as Record<string, unknown>;
  return (
    typeof skip.itemId === 'string' &&
    typeof skip.productId === 'string' &&
    (skip.reason === 'product_archived' ||
      skip.reason === 'variant_unavailable' ||
      skip.reason === 'product_not_found' ||
      skip.reason === 'below_minimum') &&
    (skip.minimum === undefined || Number.isInteger(skip.minimum))
  );
}
