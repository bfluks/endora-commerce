import { unitPriceDisplayText } from '@endora-commerce/contracts';
import type { RfqDiffEntry } from '../api/rfq';
import { tForLocale } from '../i18n/messages';

/**
 * One entry of the customer's comparison with the last revision they saw, as
 * a sentence. Moved out of the quote request page so it can be asserted; the
 * line and note sentences read as they did. Feature 159 adds the grouping
 * notice, which names nothing: the arrangement of the lines changed; and, for a
 * product on several lines, the group of the line an entry is about (research
 * N-32) — *Other items* for an ungrouped one.
 */
export function describeRfqDiff(d: RfqDiffEntry, locale: string): string {
  const line = (entry: { productName: string; groupName?: string | null }): string =>
    entry.groupName === undefined
      ? entry.productName
      : `${entry.productName} (${entry.groupName ?? tForLocale(locale)('lineGroups.otherItems')})`;
  switch (d.kind) {
    case 'header_note':
      return `Uwagi: „${d.before ?? '—'}” → „${d.after ?? '—'}”`;
    case 'line_added':
      return `Dodano: ${line(d)} × ${d.quantity}${d.agreedUnitPrice !== null ? ` po ${unitPriceDisplayText(d.agreedUnitPrice)}` : ''}`;
    case 'line_removed':
      return `Usunięto: ${line(d)}`;
    case 'line_quantity':
      return `${line(d)}: ilość ${d.before} → ${d.after}`;
    case 'line_agreed_unit_price':
      // Unit prices, at their significant places up to four (owner ruling of 2026-10-25).
      return `${line(d)}: cena ${d.before !== null ? unitPriceDisplayText(d.before) : '—'} → ${d.after !== null ? unitPriceDisplayText(d.after) : '—'}`;
    case 'grouping':
      return tForLocale(locale)('quoteRequest.diff.grouping');
  }
}
