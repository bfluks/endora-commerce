/**
 * Feature 146 (FR-012, FR-013, FR-015, FR-016, FR-036; contract
 * `admin-quote-request-api.md` §3, rule H3) — what changed between two
 * revision snapshots, as the admin History lists it.
 *
 * Pure: two snapshots and the variant labels in, a change list out. Lines pair
 * by the same rule the rewrites use (`pairSnapshotLines` over `pairLines`,
 * customer mode: product and variant, then packaging name, then order — each
 * preferring the same group and quantity, feature 159), so two variants of one
 * product never merge and a legacy snapshot without packaging keys still pairs
 * by product and variant. The validity change is not a snapshot property; the
 * projection adds it from the event payload (research R7).
 *
 * Packaging-unit and custom-field changes are never listed, and neither is the
 * product name — it carries the packaging suffix, so listing it would list a
 * packaging change under another name.
 */
import type {
  QuoteRequestHistoryChange,
  QuoteRequestHistoryLineRef,
} from '@endora-commerce/contracts';
import type { QuoteRequestRevisionLine } from '../../entities/quote-request-revision.entity.js';
import { disambiguatingGroupName, pairSnapshotLines } from '../snapshot-pairing.js';

/** The part of a revision the diff compares. */
export interface HistorySnapshot {
  headerNote: string | null;
  items: readonly QuoteRequestRevisionLine[];
}

export function historyDiff(
  before: HistorySnapshot,
  after: HistorySnapshot,
  variantLabels: ReadonlyMap<string, string> = new Map(),
): QuoteRequestHistoryChange[] {
  const changes: QuoteRequestHistoryChange[] = [];

  const beforeNote = before.headerNote ?? null;
  const afterNote = after.headerNote ?? null;
  if (beforeNote !== afterNote) {
    changes.push({ kind: 'header_note', before: beforeNote, after: afterNote });
  }

  // Feature 159 (research N-32) — one product may sit on several lines, in
  // different groups: they pair by group and quantity, and a reference to one
  // of them names its group, so "P: 3 → 2" says which P line.
  const { paired, removed } = pairSnapshotLines(before.items, after.items);
  const groupNameOf = disambiguatingGroupName(before.items, after.items);
  const ref = (item: QuoteRequestRevisionLine): QuoteRequestHistoryLineRef => {
    const variantId = item.variantId ?? null;
    const groupName = groupNameOf(item);
    return {
      productId: item.productId,
      variantId,
      productName: item.productName,
      variantLabel: variantId !== null ? (variantLabels.get(variantId) ?? null) : null,
      ...(groupName !== undefined ? { groupName } : {}),
    };
  };

  after.items.forEach((next, index) => {
    const previous = paired[index] ?? null;
    const line = ref(next);
    if (previous === null) {
      changes.push({
        kind: 'line_added',
        line,
        quantity: next.quantity,
        agreedUnitPrice: price(next.agreedUnitPrice),
        currency: next.lineCurrency,
      });
      return;
    }
    if (previous.quantity !== next.quantity) {
      changes.push({ kind: 'line_quantity', line, before: previous.quantity, after: next.quantity });
    }
    if (!samePrice(previous.agreedUnitPrice, next.agreedUnitPrice)) {
      changes.push({
        kind: 'line_agreed_unit_price',
        line,
        before: price(previous.agreedUnitPrice),
        after: price(next.agreedUnitPrice),
        currency: next.lineCurrency,
      });
    }
    if (!samePrice(previous.desiredUnitPrice, next.desiredUnitPrice)) {
      changes.push({
        kind: 'line_proposed_unit_price',
        line,
        before: price(previous.desiredUnitPrice),
        after: price(next.desiredUnitPrice),
        currency: next.lineCurrency,
      });
    }
    if ((previous.lineNote ?? null) !== (next.lineNote ?? null)) {
      changes.push({
        kind: 'line_note',
        line,
        before: previous.lineNote ?? null,
        after: next.lineNote ?? null,
      });
    }
  });

  for (const item of removed) {
    changes.push({ kind: 'line_removed', line: ref(item) });
  }

  changes.push(
    ...groupingChanges(
      before.items,
      after.items,
      paired,
      ref,
    ),
  );

  return changes;
}

// ---------------------------------------------------------------------------
// Feature 159 (FR-022, research R-11) — the grouping, as the snapshots record
// it. Groups pair by id; a snapshot written before the feature reads as all
// ungrouped and in no known order.
// ---------------------------------------------------------------------------

interface RecordedGroup {
  readonly id: string;
  readonly name: string;
  readonly position: number;
}

/** The groups a snapshot shows, in order. */
function recordedGroups(items: readonly QuoteRequestRevisionLine[]): RecordedGroup[] {
  const byId = new Map<string, RecordedGroup>();
  items.forEach((item, index) => {
    if (!item.groupId || byId.has(item.groupId)) return;
    byId.set(item.groupId, { id: item.groupId, name: item.groupName ?? '', position: item.groupPosition ?? index });
  });
  return [...byId.values()].sort((a, b) => a.position - b.position);
}

function groupingChanges(
  beforeItems: readonly QuoteRequestRevisionLine[],
  afterItems: readonly QuoteRequestRevisionLine[],
  /** Index-aligned with `afterItems`: the before line each after line is, or `null`. */
  pairedBefore: readonly (QuoteRequestRevisionLine | null)[],
  ref: (item: QuoteRequestRevisionLine) => QuoteRequestHistoryLineRef,
): QuoteRequestHistoryChange[] {
  const out: QuoteRequestHistoryChange[] = [];
  const beforeGroups = recordedGroups(beforeItems);
  const afterGroups = recordedGroups(afterItems);
  const beforeById = new Map(beforeGroups.map((group) => [group.id, group]));
  const afterById = new Map(afterGroups.map((group) => [group.id, group]));

  for (const group of afterGroups) {
    if (!beforeById.has(group.id)) out.push({ kind: 'group_added', group: { id: group.id, name: group.name } });
  }
  for (const group of beforeGroups) {
    if (!afterById.has(group.id)) out.push({ kind: 'group_removed', group: { id: group.id, name: group.name } });
  }
  for (const group of afterGroups) {
    const previous = beforeById.get(group.id);
    if (previous && previous.name !== group.name) {
      out.push({ kind: 'group_renamed', groupId: group.id, before: previous.name, after: group.name });
    }
  }

  // A line that stayed in its section, by section: the order there is the
  // order a reorder changed. A line added, removed or moved is reported as
  // such and is no part of it.
  const stayedBefore = new Map<string, QuoteRequestRevisionLine[]>();
  const stayedAfter = new Map<string, QuoteRequestRevisionLine[]>();
  afterItems.forEach((next, index) => {
    const previous = pairedBefore[index] ?? null;
    if (previous === null) return;
    const from = previous.groupId ?? null;
    const to = next.groupId ?? null;
    if (from !== to) {
      out.push({
        kind: 'line_group',
        line: ref(next),
        before: from === null ? null : (previous.groupName ?? beforeById.get(from)?.name ?? null),
        after: to === null ? null : (next.groupName ?? afterById.get(to)?.name ?? null),
      });
      return;
    }
    const section = to ?? '';
    stayedAfter.set(section, [...(stayedAfter.get(section) ?? []), next]);
    stayedBefore.set(section, [...(stayedBefore.get(section) ?? []), previous]);
  });

  // A snapshot written before the feature has no recorded order to compare.
  const legacy = beforeItems.length > 0 && beforeItems.every((item) => item.position === undefined);
  if (!legacy) {
    const commonBefore = beforeGroups.filter((group) => afterById.has(group.id)).map((group) => group.id);
    const commonAfter = afterGroups.filter((group) => beforeById.has(group.id)).map((group) => group.id);
    const groupsReordered = commonBefore.join('|') !== commonAfter.join('|');
    const linesReordered = [...stayedAfter.entries()].some(([section, lines]) => {
      const previous = stayedBefore.get(section) ?? [];
      // The after lines in after order, against the same lines in before order.
      const beforeOrder = [...previous].sort((a, b) => beforeItems.indexOf(a) - beforeItems.indexOf(b));
      return lines.some((_, index) => previous[index] !== beforeOrder[index]);
    });
    if (groupsReordered || linesReordered) out.push({ kind: 'line_order' });
  }
  return out;
}

/** Two snapshot prices, compared as numbers (a legacy snapshot may hold a string). */
function samePrice(a: number | null | undefined, b: number | null | undefined): boolean {
  return price(a) === price(b);
}

/** A snapshot price as a number, or `null`. */
function price(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
