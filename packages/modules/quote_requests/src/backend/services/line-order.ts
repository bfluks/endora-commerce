import type { EntityManager } from '@mikro-orm/postgresql';
import { arrangeLineGroups, flattenSections, type LineGroup, type LineSection } from '@endora-commerce/contracts';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { QuoteRequestItemGroup } from '../entities/quote-request-item-group.entity.js';

/**
 * Feature 159 (research R-6, FR-011) — the one display order of a quote's
 * lines: groups by position, each group's lines by `(position, createdAt, id)`,
 * then the ungrouped lines the same way. Every read of a quote's lines goes
 * through here, so the admin reply, the customer reply, the revision snapshot,
 * the read port and the PDF data agree. A quote never grouped (every line at
 * position 0) keeps its `(createdAt, id)` order.
 */
export const LINE_STORAGE_ORDER = { position: 'asc', createdAt: 'asc', id: 'asc' } as const;

export function toLineGroup(group: Pick<QuoteRequestItemGroup, 'id' | 'name' | 'position'>): LineGroup {
  return { id: group.id, name: group.name, position: group.position };
}

export interface ArrangedQuoteLines {
  /** Every stored group, by position — empty ones included. */
  readonly groups: readonly QuoteRequestItemGroup[];
  /** The lines in display order. */
  readonly lines: QuoteRequestItem[];
  /** The sections, groups holding no line omitted. */
  readonly sections: LineSection<QuoteRequestItem>[];
}

/** Sort already-read lines and groups into the display order. */
export function arrangeQuoteLines(
  groups: readonly QuoteRequestItemGroup[],
  lines: readonly QuoteRequestItem[],
): ArrangedQuoteLines {
  const sortedGroups = [...groups].sort((a, b) => a.position - b.position);
  const sortedLines = [...lines].sort(
    (a, b) =>
      a.position - b.position ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const sections = arrangeLineGroups(sortedGroups.map(toLineGroup), sortedLines);
  return { groups: sortedGroups, lines: flattenSections(sections), sections };
}

/** Read a quote's groups and lines and answer them in the display order. */
export async function loadArrangedQuoteLines(em: EntityManager, quoteRequestId: string): Promise<ArrangedQuoteLines> {
  const [groups, lines] = await Promise.all([
    em.find(QuoteRequestItemGroup, { quoteRequestId }, { orderBy: { position: 'asc' } }),
    em.find(QuoteRequestItem, { quoteRequestId }, { orderBy: LINE_STORAGE_ORDER }),
  ]);
  return arrangeQuoteLines(groups, lines);
}

/** The groups holding at least one line, in order — what a customer, a revision and a PDF are shown (D2). */
export function nonEmptyGroups(arranged: ArrangedQuoteLines): LineGroup[] {
  return arranged.sections.flatMap((section) => (section.group ? [section.group] : []));
}
