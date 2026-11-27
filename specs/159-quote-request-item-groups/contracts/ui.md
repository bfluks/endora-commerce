# Contract: user interface — the grouping editor, the read-only views, and their texts

Applies `.claude/skills/ux-laws/SKILL.md` (Laws of UX, WCAG 2.2 AA floor, repo tokens and primitives,
required component states). `AK` = `packages/admin-kit/src`.

## 1. Kit primitive (`@endora-commerce/admin-kit/components`)

### 1.1 `useGroupedReorder` — `AK/components/reorder/useGroupedReorder.ts`

The multi-section sibling of `useReorderList` (same file conventions: owns no list, all copy as props,
native HTML5 drag, ARIA grab mode, announcements).

```ts
export interface GroupedReorderModel {
  readonly sections: readonly { readonly key: string; readonly fixed: boolean; readonly itemIds: readonly string[] }[];
}
export interface GroupedReorderLabels {
  itemGrabbed(c: { name: string; section: string; index: number; total: number }): string;
  itemMoved(c: { name: string; section: string; index: number; total: number }): string;
  itemDropped(c: …): string;  itemCancelled(c: …): string;
  groupMoved(c: { name: string; index: number; total: number }): string;
  itemHandle(c: { name: string }): string;  groupHandle(c: { name: string }): string;
  atStart(c: …): string; atEnd(c: …): string;
}
export function useGroupedReorder(options: {
  model: GroupedReorderModel;
  getItemLabel(id: string): string;
  getSectionLabel(key: string): string;
  onMoveItem(id: string, toSectionKey: string, toIndex: number): void;
  onMoveSection(key: string, toIndex: number): void;   // never called for a `fixed` section
  labels: GroupedReorderLabels;
  disabled?: boolean;
}): {
  announcement: string;
  getItemProps(id: string): ItemDragProps;  getItemHandleProps(id: string): HandleProps;
  getSectionProps(key: string): SectionDropProps;  getSectionHandleProps(key: string): HandleProps;
  moveItemBy(id: string, delta: -1 | 1): void;          // crosses section boundaries
  moveSectionBy(key: string, delta: -1 | 1): void;
};
```

Keyboard (item handle): Space/Enter lift; ↑/↓ move one place, moving past the first/last place of a
section moves into the previous/next section's last/first place; Escape restores; Space/Enter drop.
Group handle: Space/Enter lift; ↑/↓ move among groups; the fixed section never moves and nothing moves
below it.

### 1.2 `LineGroupsEditor` — `AK/components/line-groups/LineGroupsEditor.tsx`

```tsx
<LineGroupsEditor<TLine>
  groups={[{ key, name }]}                    // display order; the fixed "ungrouped" section is implicit
  lines={lines}                               // TLine & { key: string; groupKey: string | null }, display order
  onChange={(next: { groups; lines }) => void}
  renderLine={(line, slots: { handle: ReactNode; moveMenu: ReactNode }) => ReactNode}
  renderSummary={(sectionLines: TLine[], section: { kind; name: string | null }) => ReactNode}
  renderSectionFooter?={(section) => ReactNode}   // e.g. a per-group "Add product"
  readOnly?: boolean
  maxGroups?: number                          // default LINE_GROUP_LIMITS.maxGroups
  labels={…}                                  // every visible string and every announcement
/>
```

- **Groups**: header = drag handle, inline name `Input` (`aria-label` "Group name", required, 120 max,
  error state on empty), *Move up* / *Move down* (`TouchReorderButtons`), *Delete group* (icon button,
  `aria-label` includes the name; no confirmation dialog — nothing is lost, lines move to *Ungrouped*,
  and the announcement says so: Jakob's/forgiveness pattern); body = lines or an empty drop area
  ("Drag lines here or use *Move to group*").
- **Ungrouped** section: rendered last with its fixed label, no controls; rendered only when at least one
  group exists (with no group, the editor renders the bare line list — D1, FR-033).
- **Add group**: one button under the last group (disabled at `maxGroups` with an explanatory
  description); focuses the new name field.
- **Move to group**: a `DropdownMenu` per line listing every other section by name (WCAG 2.5.7
  single-pointer alternative); moves to the end of the target.
- `readOnly`: section headings with names and summaries, no handles, menus or inputs — used by the admin
  quote *Overview* tab and the admin order screen.
- States: empty group, focus-visible on every control, drop indicator line, disabled while saving.
  `axe-core` clean in light and dark themes. Hit targets ≥ 24 × 24 px.

### 1.3 `SplitLineDialog` — *Split line* (D6, research N-33)

```tsx
<SplitLineDialog
  lineName="Bolt" quantity={8} step={1}
  targets={[{ key: 'g1', name: 'Hall A' }, { key: null, name: 'Ungrouped' }]}
  defaultTargetKey="g1"                       // the line's own section
  labels={…}                                  // every string from the module's bundle
  onConfirm={({ quantity, targetKey }) => …} onClose={…}
/>
```

Beside the editor, domain-free like it: a `ModalDialog` (focus trap, Escape, focus back to the opener)
asking for the quantity to move — a number field focused on open, starting at half the line rounded down
to the step, valid in whole steps from `step` to `quantity − step`; an invalid entry is marked
(`aria-invalid`) with its reason in the field's description and disables the confirm button — and the
section of the new line (a native `select`, default the line's own). Enter confirms. `canSplitLine(quantity,
step)` says whether a line can be split at all; `splitLineInto(lines, key, split, ops)` applies a confirmed
split to a display-ordered list (the source keeps the rest; the caller's `make` builds the new line, placed
right after the source in its own section, else after the target section's last line).

The screens show the trigger — an icon button (`lucide` `Split`, `aria-label` and `title` "Split line:
{name}") beside *Move to group* — on every line whose quantity can be split, grouped or not.

## 2. Admin screens

| Screen (module) | Change |
| --- | --- |
| `RfqDetail.tsx` *Modify* tab (`quote_requests`) | the line grid is wrapped by `LineGroupsEditor`; `ModifyLineDraft` gains `key`, `groupKey`; the draft keeps `groups: { key, id?, name }[]` seeded from `rfq.itemGroups` (empty ones included); `save()` sends `groups` + `items[].groupKey` in display order; section summary = the screen's own total rule (net, VAT, gross, plus discount vs. reference where every line has one) over the section's draft lines |
| `RfqDetail.tsx` *Overview* tab | lines shown through `LineGroupsEditor readOnly` (no group → unchanged table) |
| `RfqHistory.tsx` | renders the five new change kinds (§4) |
| `RfqCreatePage.tsx` | same editor; `groups` + `groupKey` on create; lines keyed per line (D6) — a product already a line is offered again, and the price prefill queue is keyed by line |
| `RfqDetail.tsx` *Modify* tab — *Split line* (D6) | the trigger per line; the new line copies the product, variant, agreed price and (shown) proposal and reference of the line it came from and is sent with `splitFromId`, so the server keeps its packaging unit, proposal and reference |
| `OrderCreatePage.tsx` (`orders`) | items table wrapped by the editor; section summary from the preview's per-line amounts (net, VAT, gross); create sends `groups` + `groupKey`, one request line per screen line in display order; lines keyed per line (D6) with *Split line*; each line reads the preview answer at its own index (only while it is still about its product and quantity) |
| `OrderDetail.tsx` (`orders`) | items shown grouped read-only (no PDF action — owner answer Q-A) |
| `GroupingField.tsx`, `items-table/canvas.tsx` (`document_templates`) | contracts/document-sections.md §4 |

No new route, sidebar entry or permission; the command palette is unchanged (the screens are reached by
the existing `open-rfq-inbox` and `open-orders` actions).

## 3. Storefront (read-only)

- `storefront/components/line-groups/GroupedLineRows.tsx` — a server component rendering, inside an
  existing `<tbody>`, for each section from `arrangeLineGroups(itemGroups, items)` (non-empty only): a
  heading row (`<tr><th colSpan scope="colgroup">name</th></tr>`), the page's own line rows (render
  prop), and a summary row (item count, net, VAT, gross through the page's existing money formatter).
  With no non-empty group it renders the line rows only — the page's markup is unchanged (SC-004).
- `app/(account)/quote-requests/[id]/page.tsx` — uses it; summary rule = the page's existing total rule
  over the section (agreed price, else desired price, every line or none).
- `app/(account)/orders/[id]/page.tsx` — uses it; summary from the lines' `unitPrice`, `taxRate`,
  `lineTotal`.
- `lib/api/rfq.ts`, `lib/api/orders.ts` — `itemGroups`, `groupId`, `position` on the hand-written types
  (or derived from `@endora-commerce/contracts`).
- The comparison block's `describeDiff` handles `kind: 'grouping'`.
- No control of any kind changes a group.

## 4. Texts (en / pl) — each module's own bundle

`quote_requests` (`i18n/{en,pl}.json`) and `orders` (`i18n/{en,pl}.json`) each carry the editor's labels
(the kit has none):

| Key (`<module>.lineGroups.*`) | en | pl |
| --- | --- | --- |
| `addGroup` | Add group | Dodaj grupę |
| `groupName` | Group name | Nazwa grupy |
| `groupNamePlaceholder` | e.g. Ground floor | np. Parter |
| `nameRequired` | Enter a group name. | Wpisz nazwę grupy. |
| `deleteGroup` | Delete group {name} | Usuń grupę {name} |
| `deletedAnnouncement` | Group {name} deleted. Its lines moved to Ungrouped. | Usunięto grupę {name}. Jej pozycje przeniesiono do sekcji Bez grupy. |
| `ungrouped` | Ungrouped | Bez grupy |
| `emptyGroup` | Drag lines here or use Move to group. | Przeciągnij tu pozycje lub użyj opcji Przenieś do grupy. |
| `moveToGroup` | Move to group | Przenieś do grupy |
| `moveUp` / `moveDown` | Move group up / Move group down | Przesuń grupę w górę / w dół |
| `limitReached` | A document can have at most {max} groups. | Dokument może mieć najwyżej {max} grup. |
| `summary.items.one` / `.few` / `.many` / `.other` | {count} item / — / — / {count} items | {count} pozycja / {count} pozycje / {count} pozycji / {count} pozycji |
| `summary.net` / `summary.vat` / `summary.gross` / `summary.discount` | Net / VAT / Gross / Discount | Netto / VAT / Brutto / Rabat |
| `announce.grabbed`, `.moved`, `.dropped`, `.cancelled`, `.groupMoved`, `.atStart`, `.atEnd`, `.handle`, `.groupHandle` | (sentences naming line, group, position, total) | (Polish equivalents) |
| `split.action` / `split.title` (D6) | Split line: {name} | Podziel pozycję: {name} |
| `split.quantity` | Quantity for the new line | Ilość na nowej pozycji |
| `split.quantityHelp` | From {min} to {max}. {remaining} stay on this line. | Od {min} do {max}. Na tej pozycji zostanie {remaining}. |
| `split.quantityInvalid` | Enter a whole number from {min} to {max}, in steps of {step}. | Wpisz liczbę całkowitą od {min} do {max}, co {step}. |
| `split.target` | Group of the new line | Grupa nowej pozycji |
| `split.confirm` / `split.cancel` | Split line / Cancel | Podziel pozycję / Anuluj |

The admin interpolator (`AK/i18n/interpolate.ts`) substitutes `{name}` only — there is no ICU plural
syntax in the tree — so a count picks its key with `new Intl.PluralRules(language).select(count)`
(`one`/`few`/`many`/`other`; English ships `one` and `other`, and a missing form falls back to `other`).
The storefront and the PDF texts use the same selection.

`quote_requests` history kinds (`history.change.*`): `groupAdded` "Group {name} added" / "Dodano grupę
{name}"; `groupRemoved` "Group {name} removed" / "Usunięto grupę {name}"; `groupRenamed` "Group renamed
from {before} to {after}" / "Zmieniono nazwę grupy z {before} na {after}"; `lineGroup` "{line} moved
from {before} to {after}" / "{line}: przeniesiono z {before} do {after}" (`null` → the *Ungrouped*
label); `lineOrder` "Order of lines changed" / "Zmieniono kolejność pozycji". A line reference naming its
group (D6) reads `rfq.detail.history.lineInGroup` "{line} — {group}" in both languages.

`document_templates` (`itemsTable.grouping.*`): `mode.sections` "Document's groups" / "Grupy z
dokumentu"; `mode.field` "By field" / "Według pola"; `mode.none` "No grouping" / "Bez grupowania";
`otherItemsLabel` "Other items heading" / "Nagłówek pozostałych pozycji"; `showItemCount` "Show item
count" / "Pokaż liczbę pozycji"; `noSections` "This document type has no groups." / "Ten typ dokumentu
nie ma grup."; PDF defaults in the facility text map: `Other items` / `Pozostałe pozycje`; item-count
plural forms.

Storefront (`storefront/lib/i18n/messages.ts`, both catalogues): `lineGroups.otherItems` "Other items" /
"Pozostałe pozycje"; `lineGroups.summary` "{count} items · net {net} · VAT {vat} · gross {gross}" (plural
forms per language); `quoteRequest.diff.grouping` "The arrangement of the lines changed." / "Zmieniono
układ pozycji.".

