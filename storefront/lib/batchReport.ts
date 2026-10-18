import { tForLocale, type MessageKey } from './i18n/messages';
import { formatCount } from './orderMinimum';
import { belowMinimumText } from './cartMinimum';
import type { QuickOrderBuildRejectedLine, RejectedQuickOrderItem } from './api/quick-order';
import type { ConversionSkip } from './api/shopping-lists';

/**
 * Feature 155 (FR-011, US4) — the buyer-facing sentences of the batch paths' reports: the
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
 * JSON in base64url (round B UI review). Bounded: only the first {@link REPORT_CAP} lines
 * travel, each projected to the fields the page words and with its names cut to
 * {@link REPORT_NAME_MAX} characters, and the rest travel as a count (`more`). The query is the
 * buyer's to edit, so the reader is defensive: an oversized, malformed or hand-made value decodes
 * to an empty report — never an error page — and every line is checked before it is rendered.
 */
export const REPORT_CAP = 20;
const REPORT_NAME_MAX = 200;
/** Longer than anything {@link encodeBuildRejections} or {@link encodeConversionSkips} writes. */
const REPORT_ENCODED_MAX = 16_000;

export interface CarriedReport<T> {
  lines: T[];
  /** How many lines were left out of `lines`. */
  more: number;
}

const EMPTY_REPORT = { lines: [], more: 0 } as const;

function encodeCarried<T>(lines: readonly unknown[], project: (line: unknown) => T | null): string {
  const kept: T[] = [];
  for (const line of lines.slice(0, REPORT_CAP)) {
    const projected = project(line);
    if (projected !== null) kept.push(projected);
  }
  const payload = { lines: kept, more: Math.max(0, lines.length - REPORT_CAP) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCarried<T>(value: string | undefined | null, guard: (line: unknown) => line is T): CarriedReport<T> {
  if (!value || value.length > REPORT_ENCODED_MAX) return { ...EMPTY_REPORT, lines: [] };
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...EMPTY_REPORT, lines: [] };
    const { lines, more } = parsed as { lines?: unknown; more?: unknown };
    if (!Array.isArray(lines)) return { ...EMPTY_REPORT, lines: [] };
    return {
      lines: lines.slice(0, REPORT_CAP).filter(guard),
      more: Number.isInteger(more) && (more as number) > 0 ? (more as number) : 0,
    };
  } catch {
    return { ...EMPTY_REPORT, lines: [] };
  }
}

const cut = (name: string): string => (name.length > REPORT_NAME_MAX ? `${name.slice(0, REPORT_NAME_MAX - 1)}…` : name);

/** The quick-order build's `rejected[]` line, as it travels: what the page words, nothing else. */
export type CarriedBuildRejection = Pick<
  QuickOrderBuildRejectedLine,
  'productName' | 'quantity' | 'kind' | 'minimum' | 'packagingUnitName'
>;

export function encodeBuildRejections(lines: readonly unknown[]): string {
  return encodeCarried<CarriedBuildRejection>(lines, (line) => {
    if (!isBuildRejectedLine(line)) return null;
    return {
      productName: cut(line.productName),
      quantity: line.quantity,
      kind: line.kind,
      minimum: line.minimum,
      ...(line.packagingUnitName !== undefined ? { packagingUnitName: cut(line.packagingUnitName) } : {}),
    };
  });
}

export function decodeBuildRejections(value: string | undefined | null): CarriedReport<CarriedBuildRejection> {
  return decodeCarried(value, isBuildRejectedLine);
}

/** A shopping list → cart skip, as it travels. */
export type CarriedConversionSkip = Pick<ConversionSkip, 'itemId' | 'productId' | 'reason' | 'minimum'>;

export function encodeConversionSkips(skips: readonly unknown[]): string {
  return encodeCarried<CarriedConversionSkip>(skips, (skip) => {
    if (!isConversionSkip(skip)) return null;
    return {
      itemId: skip.itemId,
      productId: skip.productId,
      reason: skip.reason,
      ...(skip.minimum !== undefined ? { minimum: skip.minimum } : {}),
    };
  });
}

export function decodeConversionSkips(value: string | undefined | null): CarriedReport<CarriedConversionSkip> {
  return decodeCarried(value, isConversionSkip);
}

/** "+5 more" — the lines a carried report left out. */
export function reportMoreText(more: number, locale: string): string {
  return tForLocale(locale)('batchReport.more').replace('{count}', formatCount(more, locale));
}

/**
 * Whether a value read back from the redirect URL is a build refusal the page can word. The
 * URL is the buyer's to edit; a hand-made entry is dropped rather than rendered half-filled.
 */
export function isBuildRejectedLine(value: unknown): value is CarriedBuildRejection {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.productName === 'string' &&
    Number.isInteger(line.quantity) &&
    (line.quantity as number) > 0 &&
    Number.isInteger(line.minimum) &&
    (line.minimum as number) > 0 &&
    (line.kind === 'pieces' || line.kind === 'packaging_unit') &&
    (line.packagingUnitName === undefined || typeof line.packagingUnitName === 'string')
  );
}

/** As {@link isBuildRejectedLine}, for a shopping list → cart skip. */
export function isConversionSkip(value: unknown): value is CarriedConversionSkip {
  if (typeof value !== 'object' || value === null) return false;
  const skip = value as Record<string, unknown>;
  return (
    typeof skip.itemId === 'string' &&
    skip.itemId.length <= 64 &&
    typeof skip.productId === 'string' &&
    skip.productId.length <= 64 &&
    (skip.reason === 'product_archived' ||
      skip.reason === 'variant_unavailable' ||
      skip.reason === 'product_not_found' ||
      skip.reason === 'below_minimum') &&
    (skip.minimum === undefined || Number.isInteger(skip.minimum))
  );
}
