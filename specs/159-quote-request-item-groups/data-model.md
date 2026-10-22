# Data Model: Named, reorderable line-item groups on quote requests and orders

**Feature**: `specs/159-quote-request-item-groups/` | **Date**: 2026-10-20
Decisions referenced as R-n are in [research.md](./research.md). `QR` = `packages/modules/quote_requests`,
`OR` = `packages/modules/orders`, `DT` = `packages/modules/document_templates`, `CT` =
`packages/contracts/src`.

Migrations are **scaffolded, never numbered**: `pnpm --filter backend run migration:new -- --module
<id> --name <slug>`, then `pnpm --filter backend run composer:generate`, committing
`backend/src/db/migrations-registry.generated.ts` (and the entity registry) in the same merge request
(`specs/conventions/module-migrations.md`). Each module writes only its own tables. No cross-module
foreign key is added, so no `dependencies` change.

---

## 1. `quote_requests` — groups and line placement

### 1.1 New table `quote_request_item_groups` (owner `quote_requests`)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | — | PK |
| `quote_request_id` | uuid | no | — | FK `quote_request_item_groups_quote_request_fk` → `quote_requests(id)` **on delete cascade** (as `quote_request_items`) |
| `name` | varchar(120) | no | — | trimmed, 1–120 chars (validated in contracts; DB `check (char_length(btrim(name)) between 1 and 120)`) |
| `position` | integer | no | — | 0-based order among the quote's groups; `check (position >= 0)` |
| `created_at` | timestamptz | no | — | |
| `updated_at` | timestamptz | no | — | |

Indexes: `quote_request_item_groups_quote_request_id_index` on `(quote_request_id)`.
No unique `(quote_request_id, position)` — positions are rewritten as a set inside one transaction and a
deferred constraint buys nothing the service's renumbering does not already guarantee; not unique on
`name` (spec *Edge Cases*).

Entity `QR/src/backend/entities/quote-request-item-group.entity.ts`:

```ts
@TransitivelyScoped('QuoteRequest', 'quoteRequestId')
@Entity({ tableName: 'quote_request_item_groups' })
export class QuoteRequestItemGroup {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt';
  @PrimaryKey({ type: 'uuid' }) id: string = randomUUID();
  @Property({ type: 'uuid' }) @Index() quoteRequestId!: string;
  @Property({ type: 'string', length: 120 }) name!: string;
  @Property({ type: 'integer' }) position!: number;
  @Property({ type: 'datetime', onCreate: () => new Date() }) createdAt: Date = new Date();
  @Property({ type: 'datetime', onUpdate: () => new Date() }) updatedAt: Date = new Date();
}
```

### 1.2 Altered table `quote_request_items`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `group_id` | uuid | yes | `null` | FK `quote_request_items_group_fk` → `quote_request_item_groups(id)` **on delete set null** (D2 at the database level); `null` = ungrouped |
| `position` | integer | no | `0` | 0-based order within the line's section; `check (position >= 0)`; **no backfill** (R-6) |

Index: `quote_request_items_group_id_index` on `(group_id)` (serves the `set null` cascade).

Entity: `QuoteRequestItem` gains `groupId?: string | null` and `position: number = 0` (both in
`OptionalProps`).

### 1.3 Migration (one, owner `quote_requests`)

`migration:new -- --module quote_requests --name quote_request_item_groups`:

```sql
create table "quote_request_item_groups" (
  "id" uuid not null,
  "quote_request_id" uuid not null,
  "name" varchar(120) not null,
  "position" int not null,
  "created_at" timestamptz not null,
  "updated_at" timestamptz not null,
  constraint "quote_request_item_groups_pkey" primary key ("id"),
  constraint "quote_request_item_groups_quote_request_fk"
    foreign key ("quote_request_id") references "quote_requests" ("id") on delete cascade,
  constraint "quote_request_item_groups_name_check" check (char_length(btrim("name")) between 1 and 120),
  constraint "quote_request_item_groups_position_check" check ("position" >= 0)
);
create index "quote_request_item_groups_quote_request_id_index" on "quote_request_item_groups" ("quote_request_id");
alter table "quote_request_items" add column "group_id" uuid null,
  add column "position" int not null default 0;
alter table "quote_request_items" add constraint "quote_request_items_group_fk"
  foreign key ("group_id") references "quote_request_item_groups" ("id") on delete set null;
alter table "quote_request_items" add constraint "quote_request_items_position_check" check ("position" >= 0);
create index "quote_request_items_group_id_index" on "quote_request_items" ("group_id");
```

`down()` drops the index, the two constraints, the two columns and the table, in reverse.

### 1.4 Invariants (enforced by the service, proven by tests)

- **I-Q1** A line's `group_id`, when set, names a group of the **same** quote request (the FK alone does
  not say so; `modify`/`createOnBehalf` only ever assign groups they wrote for this quote in this
  transaction).
- **I-Q2** Groups of one quote have positions `0…g-1`; lines of one section have positions `0…k-1`,
  rewritten as a set on every save.
- **I-Q3** At most 50 groups per quote.
- **I-Q4** The grouping changes only through `modify` and `createOnBehalf`, only in *Created from
  admin* / *Pending*; every such save is a revision (owner answer Q-B, R-9).

### 1.5 Revision snapshot (no migration — R-10)

`QuoteRequestRevisionLine` (`QR/src/backend/entities/quote-request-revision.entity.ts`, jsonb
`items_snapshot`) gains optional keys, written from this feature on:

```ts
position?: number;            // within its section
groupId?: string | null;      // null = ungrouped
groupName?: string | null;
groupPosition?: number | null;
```

`RfqRevisionService.record` writes the lines **in display order** with these keys. An absent key reads as
"ungrouped, legacy order". Only groups holding lines can appear (D2).

---

## 2. `orders` — groups and line placement

### 2.1 New table `order_item_groups` (owner `orders`)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | uuid | no | — | PK |
| `order_id` | uuid | no | — | FK `order_item_groups_order_fk` → `orders(id)` **on delete cascade** (as `order_items_order_fk`) |
| `name` | varchar(120) | no | — | copied from the quote group or typed by the administrator |
| `position` | integer | no | — | 0-based; `check (position >= 0)` |
| `created_at` | timestamptz | no | — | |

No `updated_at`: a row is written once at placement and never changed (R-18).
Index `order_item_groups_order_id_index` on `(order_id)`.

Entity `OR/src/backend/entities/order-item-group.entity.ts`:
`@TransitivelyScoped('Order', 'orderId') @Entity({ tableName: 'order_item_groups' }) class OrderItemGroup`
with `id`, `orderId`, `name`, `position`, `createdAt`.

### 2.2 Altered table `order_items`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `group_id` | uuid | yes | `null` | FK `order_items_group_fk` → `order_item_groups(id)` on delete set null |
| `position` | integer | no | `0` | within the line's section; written at placement for every new order; metadata-only add, no backfill |

Index `order_items_group_id_index` on `(group_id)`.
`OrderItem` gains `groupId?: string | null`, `position: number = 0`.

### 2.3 Migration (one, owner `orders`)

`migration:new -- --module orders --name order_item_groups` — the same shape as §1.3 for
`order_item_groups` / `order_items` (no `updated_at`). `order_items` was created by the platform's frozen
`core_commerce_init`, and `orders` has altered it in its own migrations before
(`…_orders_order_item_packaging.ts`, `…_orders_order_item_returnable_at_purchase.ts`) — the same
ownership applies.

### 2.4 Invariants

- **I-O1** Written only inside `OrderService.placeOrder`'s transaction; no other write path (R-18).
- **I-O2** Every group holds at least one line at placement (empty quote groups are not carried, an
  admin's empty group is not created — D2).
- **I-O3** Every new order's lines get positions `0…k-1` per section; an order without groups has one
  section (ungrouped) ordered as the basket was.
- **I-O4** At most 50 groups per order (an admin request is refused above it; a quote cannot exceed it).

---

## 3. Shared shapes and the arrangement helper (`CT/line-groups.ts`, new)

Full schemas in [contracts/line-groups.md](./contracts/line-groups.md). Summary:

```ts
export const LINE_GROUP_LIMITS = { maxGroups: 50, maxNameLength: 120 } as const;
export const lineGroupKeySchema;        // /^[A-Za-z0-9_-]{1,64}$/
export const lineGroupNameSchema;       // trimmed, 1–120
export const lineGroupSchema;           // reply: { id, name, position }
export const lineGroupInputSchema;      // request: { key, id?, name }  (quotes)
export const newLineGroupInputSchema;   // request: { key, name }       (orders)
export function lineGroupsInputRefinement(...) // unique keys/ids, every line's groupKey declared, ≤ 50

export interface ArrangeableLine { groupId?: string | null; position?: number }
export interface LineSection<T> { kind: 'group' | 'ungrouped'; group: LineGroup | null; lines: T[] }
export function arrangeLineGroups<T extends ArrangeableLine>(
  groups: readonly LineGroup[], lines: readonly T[],
  options?: { includeEmptyGroups?: boolean; includeEmptyUngrouped?: boolean },
): LineSection<T>[];
export function flattenSections<T>(sections: readonly LineSection<T>[]): T[];
```

`arrangeLineGroups` is pure and total: groups sorted by `position` (ties by input order); each group's
lines by `position` (ties by input order); a line naming an unknown group is treated as ungrouped; the
ungrouped section last; empty groups dropped unless `includeEmptyGroups`; the ungrouped section dropped
when empty unless `includeEmptyUngrouped`. Used by the backend readers, the admin screens, the storefront
and the document data builders — the one ordering of R-6.

---

## 4. Quote request API additions (`CT/quote-requests.ts`)

- `adminPatchQuoteRequestSchema` += `groups?: lineGroupInputSchema[]`; `adminPatchQuoteRequestLineSchema`
  += `groupKey?: lineGroupKey | null`. Refinement: `groups` ⇒ `items`.
- `adminCreateQuoteRequestSchema` += `groups?: newLineGroupInputSchema[]`; its line schema += `groupKey?`.
- `quoteRequestItemSchema` += `groupId: uuid | null` (default `null`), `position: int ≥ 0` (default `0`).
- `quoteRequestSchema` += `itemGroups: lineGroupSchema[]` (default `[]`). Admin reply: every group,
  empty ones included. Customer reply: non-empty groups only. `items` in display order on both.
- `CUSTOMER_ITEM_KEYS` += `groupId`, `position` (`QR/…/customer-projection.ts`); the customer reply's
  top-level `itemGroups` is built from non-empty groups only.
- `quoteRequestHistoryChangeSchema` += `group_added`, `group_removed`, `group_renamed`, `line_group`,
  `line_order`.
- `RfqDiffEntry` (`QR/…/rfq-revision-service.ts`) and the comparison schema += `{ kind: 'grouping' }`.
- `QuoteRequestLineRecord` += `position?: number`, `group?: { id, name, position } | null`; `listItems`
  in display order.
- `quoteRequestDocumentDataSchema` += `groups: lineGroupSchema[]` (non-empty only) and per line
  `groupId: string | null`, `position: number`; `lines` in display order.

## 5. Order API additions (`CT/orders.ts`)

- `orderItemSchema` += `groupId: uuid | null` (default `null`), `position` (default `0`).
- `orderSchema` += `itemGroups: lineGroupSchema[]` (default `[]`); `items` in display order.
- `adminCreateOrderLineSchema = adminCreateOrderItemSchema.extend({ groupKey })`;
  `adminCreateOrderRequestSchema.items` uses it; += `groups?: newLineGroupInputSchema[]`.
  `adminOrderPreviewRequestSchema` unchanged.

## 6. Document-templates facility additions (`CT/document-templates.ts`)

```ts
export interface DocumentItemSection {
  readonly key: string;                       // group id, or 'ungrouped'
  readonly kind: 'group' | 'ungrouped';
  readonly label: string | null;              // group name; null for ungrouped
  readonly itemIndexes: readonly number[];    // into items(data), ascending, contiguous in print order
  readonly summary: Readonly<Record<string, DocumentValue>>; // over summaryFields
}
DocumentCollectionDeclaration.sections?(data: TData): readonly DocumentItemSection[];

itemsTableGroupingSchema = z.union([
  fieldGrouping,                                            // existing shape; `by` absent or 'field'
  z.object({ by: z.literal('sections'),
             otherItemsLabel: z.string().max(100).default(''),
             showItemCount: booleanLike.default(true) }),
  z.object({ by: z.literal('none') }),
]);
// null / absent ⇒ sections with defaults (R-19)
documentTypeDetailSchema.collections[i] += sampleSections: DocumentItemSection[]
```

## 7. State transitions

```text
Quote request grouping
  Created from admin ──modify/create──▶ (editable)      ┐
  Pending            ──modify─────────▶ (editable)      ├─ every save: groups upserted, lines placed,
                                                        ┘   revision snapshot carries the grouping
  Approved / Completed / Canceled / Expired ──▶ read-only (modify refuses, as today)

Order grouping
  (none) ──placeOrder [admin lineGrouping | vouched quote source | neither]──▶ fixed for life
```

## 8. What is deliberately not stored

Group summaries (R-15); empty groups in revisions or orders (D2); a group's language variants (names are
operator content); a grouping on carts.
