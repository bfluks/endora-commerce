# Contract: document sections — the Line items table prints a document's groups

**Owner**: `document_templates` (facility, `packages/modules/document_templates`), shapes in
`packages/contracts/src/document-templates.ts`. **Host**: `quote_requests` (US3). (No order PDF — owner answer Q-A; the mechanism stays generic.)
Extends `specs/153-quote-request-pdf-template/contracts/document-collections.md`; everything not
mentioned there is unchanged.

## 1. A collection may declare sections

```ts
export interface DocumentItemSection {
  /** The group's id, or the literal `'ungrouped'`. Unique within one render. */
  readonly key: string;
  readonly kind: 'group' | 'ungrouped';
  /** The group's name as written by an administrator; `null` for `ungrouped`. Never translated. */
  readonly label: string | null;
  /** Indexes into `items(data)`; ascending; the sections together cover every index exactly once. */
  readonly itemIndexes: readonly number[];
  /** The section's totals, keyed like `summary(data)`, computed by the host over the section's lines. */
  readonly summary: Readonly<Record<string, DocumentValue>>;
}

export interface DocumentCollectionDeclaration<TData = unknown> {
  …153 members…
  /** Feature 159 — the document's groups. Absent = the collection has no sections. */
  sections?(data: TData): readonly DocumentItemSection[];
}

export const documentItemSectionSchema = z.object({
  key: z.string().min(1).max(64),
  kind: z.enum(['group', 'ungrouped']),
  label: z.string().nullable(),
  itemIndexes: z.array(z.number().int().nonnegative()),
  summary: z.record(z.string(), documentValueSchema),
});
```

Host obligations: `items(data)` returns lines **in display order** (groups by position, then ungrouped);
`sections(data)` returns only non-empty sections, groups first in order, `ungrouped` last; each section's
`itemIndexes` is a contiguous ascending run. The facility checks the partition per render
(`isValidSectionPartition(sections, items.length)`, pure, in `CT`): a violation is logged once with the
document type and the table prints flat — the document never fails for it.

## 2. The table's grouping setting

```ts
const fieldGroupingSchema = z.object({
  by: z.literal('field').optional(),          // absent on templates saved before this feature
  field: fieldPath,
  emptyLabel: …, subtotalField: …, subtotalLabel: …,   // as 153
});
const sectionsGroupingSchema = z.object({
  by: z.literal('sections'),
  otherItemsLabel: z.string().max(ITEMS_TABLE_LIMITS.maxGroupEmptyLabelLength).default(''),
  showItemCount: booleanLike.default(true),
});
const noGroupingSchema = z.object({ by: z.literal('none') });

export const itemsTableGroupingSchema = z.union([sectionsGroupingSchema, noGroupingSchema, fieldGroupingSchema]);
// itemsTablePropsSchema.grouping: itemsTableGroupingSchema.nullable().optional()  — unchanged envelope
```

| Stored `grouping` | Mode |
| --- | --- |
| `null`, absent | **sections** with `otherItemsLabel: ''`, `showItemCount: true` |
| `{ by: 'sections', … }` | sections |
| `{ by: 'none' }` | flat |
| `{ field, … }` or `{ by: 'field', field, … }` | by field, exactly as 153 |

Every template saved before this feature validates unchanged (SC-004, FR-045).

## 3. Rendering in sections mode (`DT/src/backend/rendering/items-table.ts`)

Let `S` = `collection.sections?.(data) ?? []`.

- **No section of kind `group` in `S`** (or no `sections` declared, or an invalid partition) → the 153
  flat rendering, unchanged — byte-identical pdfmake definition (tested by snapshot equality against the
  pre-feature definition for the same props and items).
- **Otherwise**, for each section in order:
  1. a heading row spanning all visible columns: `label` for a group; for `ungrouped`, the interpolated
     `otherItemsLabel`, or — when empty — the facility's default in the PDF language (`Other items` /
     `Pozostałe pozycje`); when `showItemCount`, followed by ` · <count>` formatted with the facility's
     plural texts (`1 item`, `3 items`; `1 pozycja`, `3 pozycje`, `5 pozycji` — `Intl.PluralRules`).
     Bold, `headerBackground` fill;
  2. the section's item rows (detail rows included), striping continued across sections;
  3. one subtotal row per entry of the table's own `totals` list, evaluated with the entry's
     `visibleWhen` over `{ summary: section.summary }`, label as the totals row's (field label when empty),
     value formatted like the totals row, right-aligned, not emphasised. Not printed when the table has
     no totals rows.
- Then the document totals table as in 153, from `summary(data)`.
- `row.number` runs 1…n across sections (already numbered over `items` in display order).
- Heading and subtotal rows are kept with the next row where pdfmake allows (`dontBreakRows` already
  holds per row; a heading row orphaned at a page foot is a SHOULD, verified in the quickstart).

## 4. Builder descriptor, sample and editor

- `documentTypeDetailSchema.collections[i]` += `sampleSections: DocumentItemSection[]` (from the host's
  sample data; `[]` when the collection declares none).
- `GroupingField.tsx` offers a radio group: **Document's groups** (writes `null` on a fresh table, or
  `{ by: 'sections', … }` once its options are touched), **By field** (the 153 controls), **No grouping**
  (`{ by: 'none' }`). Under *Document's groups*: *Other items heading* (text, per language layout) and
  *Show item count* (checkbox). Under a collection with no sections, *Document's groups* is shown with
  the hint "This document type has no groups" and behaves as flat.
- The canvas (`items-table/canvas.tsx`) renders sections from `sampleSections` with the same rules.
- Bundle keys (`DT/i18n/{en,pl}.json`) in [ui.md](./ui.md) §4.

## 5. The quote's sections (`QR/src/backend/document/quote-lines.ts`)

```ts
sections(data) {
  const sections = arrangeLineGroups(data.groups, data.lines);   // lines carry groupId/position
  // indexes: data.lines is already in display order, so each section is a contiguous run
  return sections.map((s) => ({
    key: s.group?.id ?? 'ungrouped', kind: s.kind, label: s.group?.name ?? null,
    itemIndexes: …,
    summary: quoteSummary({ ...data, lines: s.lines }),    // the document's own rule over the section
  }));
}
```

`QuoteRequestDocumentData.lines` is in display order and `groups` holds non-empty groups only (the data
builder), so `items(data)` needs no change. The built-in layout keeps `grouping: null` (= sections). The
sample (`document/sample.ts`) gains two groups and one ungrouped line.

## 6. Off-states

Unchanged from 153: the facility off → no PDF anywhere, nothing lost; a host off → its type, blocks and
templates invisible, nothing lost.
