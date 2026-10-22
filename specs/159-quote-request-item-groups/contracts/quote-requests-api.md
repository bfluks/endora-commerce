# Contract: quote request API — grouping

**Owner**: `quote_requests` (`packages/modules/quote_requests`), shapes in
`packages/contracts/src/quote-requests.ts`. Every route below exists today; this contract lists only
what changes. Permission and visibility are unchanged: admin routes `requireAdmin('rfqs:handle')` plus
the sales-rep organisation check (`findVisibleForAdmin`); customer routes `requireCustomer` plus
`findVisibleForCustomer`. An out-of-scope quote answers **404** exactly as an unknown id.

## 1. `PATCH /api/v1/admin/quote-requests/:id` — modify (Save revision)

Header `If-Match: "<version>"` as today.

```jsonc
{
  "headerNote": "…",                     // unchanged
  "expiresInDays": 14,                   // unchanged
  "groups": [                            // NEW, optional — the whole grouping, in display order
    { "key": "g-ground", "id": "8a1f…", "name": "Ground floor" },   // existing group (renamed or not)
    { "key": "n1", "name": "Options" }                               // new group
  ],
  "items": [                             // in display order: groups' lines, then ungrouped
    { "id": "…", "productId": "…", "quantity": 4, "agreedUnitPrice": 120.5, "groupKey": "g-ground" },
    { "productId": "…", "quantity": 1, "groupKey": "n1" },
    { "productId": "…", "quantity": 2, "groupKey": null }            // ungrouped
  ]
}
```

| Body | Effect on the grouping |
| --- | --- |
| no `groups`, no `items` | untouched |
| `items`, no `groups` | kept: each **paired** line keeps its group (`pairLines`, admin mode); positions follow the body order within each section; new lines ungrouped; no group deleted (R-14) |
| `groups` and `items` | replaced: groups with an `id` are updated (name, position), groups without are created, stored groups not named are deleted (their lines are being rewritten anyway); lines take their `groupKey`'s group; positions = body order within each section |
| `groups`, no `items` | **400** (§line-groups 1) |

Service-level refusals (**422 `VALIDATION_FAILED`**, `details[].path`): `groups.<i>.id` not a group of
this quote. State refusal unchanged (**409 `RFQ_NOT_QUOTED`** outside *Created from admin* / *Pending*).
Concurrency unchanged (**409 `VERSION_CONFLICT`**).

Everything is written inside the existing `underRowLock` and flush: groups upserted/deleted, lines
recreated with `groupId`/`position`, the audit entry `quote_request.modify` with
`stateBefore.groups` / `stateAfter.groups` = `[{ name, lineCount }]` in order. The revision is then
recorded from the lines **in display order** with the snapshot keys of `data-model.md` §1.5, and the
`modified` event's `diff` gains `{ kind: 'grouping' }` when the grouping as shown changed.

A body that changes only the grouping is handled exactly the same way — a revision the customer is
asked to accept (owner answer Q-B, research R-9).

**One product on several lines (D6, research N-32, N-33).** `items` may name one product and variant
on several lines, in different groups or in one. A line without an `id` pairs with a stored row by
`pairLines` (admin mode), whose every pass prefers a row of the line's group (the stored id its
`groupKey` names; nothing for a new group, nor without `groups`) and quantity before stored order.
A new line may carry **`splitFromId`** — the stored line it was split off with *Split line*:

```jsonc
{ "id": "L1", "productId": "X", "quantity": 5, "groupKey": "g-y" },                    // kept, reduced
{ "productId": "X", "quantity": 3, "groupKey": "g-z", "splitFromId": "L1" }           // split off L1
```

The new line takes that row's variant (unless sent), variant label, product name snapshot, packaging
unit, customer's proposal, line note (unless sent), currency and stored reference; the stored row
itself stays paired with the line that names its `id`. A `splitFromId` naming no line of this quote
(another quote's, a deleted one, another product's) is ignored: the line is a plain new line.

## 2. `POST /api/v1/admin/quote-requests` — create on behalf

`adminCreateQuoteRequestSchema` += `groups?: newLineGroupInputSchema[]`; each line += `groupKey?`.
Groups and lines written in the existing flow before revision 1 is recorded; audit
`quote_request.create_on_behalf` `stateAfter.groups`.

## 3. Replies — `GET /api/v1/admin/quote-requests/:id`, every admin write reply, `GET /api/v1/quote-requests/:id` and the customer write replies

```jsonc
{
  "itemGroups": [ { "id": "…", "name": "Ground floor", "position": 0 }, … ],   // NEW
  "items": [ { "id": "…", …, "groupId": "…" | null, "position": 0 }, … ]      // NEW keys; display order
}
```

| Reply | `itemGroups` | `items` |
| --- | --- | --- |
| admin | every group, **empty ones included** (the editor needs them, D2) | display order (`flattenSections(arrangeLineGroups(…, { includeEmptyGroups: true }))`) |
| customer | **non-empty groups only** (D2) | display order |

`serializeFull` reads lines with `orderBy: { position: 'asc', createdAt: 'asc', id: 'asc' }` and groups
with `orderBy: { position: 'asc' }`, then arranges — fixing today's unordered read (research R-1).
`CUSTOMER_ITEM_KEYS` += `groupId`, `position`; `itemGroups` is added to the customer reply from the
non-empty set, never from the admin projection.

## 4. Revision comparison (customer) and history (admin)

- `comparisonAgainstLastSeen.diff[]` may contain `{ "kind": "grouping" }` — no other key (passes
  `CUSTOMER_DIFF_KEYS`). Emitted when the sections as shown differ (group names, group order,
  membership, line order) between the last-seen and the current revision.
- Revision lines pair one to one (`snapshot-pairing.ts`: `pairLines`, customer mode, each pass
  preferring the same group and quantity) — not by product, which collapsed a product on several
  lines (D6, research N-32). A `line_added`, `line_removed`, `line_quantity` or
  `line_agreed_unit_price` entry about a product, variant and packaging unit that sits on more than
  one line of either revision carries **`groupName`** — the group's name, `null` = ungrouped — so
  `X: 5 → 3` says which X line; otherwise the key is absent. `groupName` is in `CUSTOMER_DIFF_KEYS`:
  it is a group the customer was shown on that revision.
- `GET /api/v1/admin/quote-requests/:id/history` — `entries[].changes[]` may contain:

```jsonc
{ "kind": "group_added",   "group": { "id": "…", "name": "Options" } }
{ "kind": "group_removed", "group": { "id": "…", "name": "Options" } }
{ "kind": "group_renamed", "groupId": "…", "before": "First floor", "after": "Floor 1" }
{ "kind": "line_group",    "line": { …QuoteRequestHistoryLineRef }, "before": "Ground floor", "after": null }
{ "kind": "line_order" }
```

`before`/`after` of `line_group` are group names as recorded in the snapshots, `null` = ungrouped.
`QuoteRequestHistoryLineRef` gains an optional `groupName` (`null` = ungrouped) under the same rule
as the comparison's: present only for a product, variant and packaging unit on more than one line of
either revision; the History tab renders it with `rfq.detail.history.lineInGroup`.
Groups pair by `groupId`; a legacy snapshot (no keys) reads as all-ungrouped, so the first grouped
revision after this feature lists `group_added` for each group and `line_group` for each placed line.
`line_order` appears at most once per entry, only when an order differs and no `group_*`/`line_group`
change explains it. Admin UI bundle keys in [ui.md](./ui.md) §4.

## 5. Customer writes — unchanged shapes

`POST /api/v1/quote-requests`, `PATCH /api/v1/quote-requests/:id`, accept, reject, resubmit,
convert-to-order: **no grouping key** (schemas are `.strict()`; a sent `groups` / `groupKey` answers 400).
`patchDraft` keeps a paired line's group (R-13). `resubmit` copies no group (R-24). `convertToOrder`
seeds the basket in display order.

## 6. Published read port — `quoteRequestReadPort.listItems`

```ts
export interface QuoteRequestLineRecord {
  …existing…
  /** Feature 159 — order within the line's section. Optional for structural stubs. */
  position?: number;
  /** Feature 159 — the line's group, or `null` when ungrouped. Optional for structural stubs. */
  group?: { id: string; name: string; position: number } | null;
}
```

`listItems` answers lines **in display order** (was: `createdAt` only). Consumers today: `carts`
(conversion reference), `orders` (placement vouching and, now, carry-over), `crm`, ERP exporters — none
depends on the old order beyond "insertion order", which is what the new order reproduces for an
ungrouped quote.

## 7. Quote PDF data

`QuoteRequestDocumentDataBuilder` adds `groups` (non-empty, in order) and per line `groupId`,
`position`, with `lines` in display order; the `lines` collection declares `sections`
([document-sections.md](./document-sections.md) §3).

## 8. Errors

No new error code. `VALIDATION_FAILED` (400 schema, 422 service), `RFQ_NOT_QUOTED`, `VERSION_CONFLICT`,
`NOT_FOUND` as today; messages translated through the existing envelope.
