---
title: shopping_lists
description: Per-customer named bundles convertible to Cart or RFQ
---

# `shopping_lists`

Per-customer named bundles of (product, variant?, quantity, note?) rows.
Buyers save recurring orders, then convert all or a selected subset of
items into a Cart or a draft Quote Request in a single click. Conversions
skip archived products and report them rather than failing the whole batch.

## Public surface

All endpoints require an authenticated customer session and are scoped to
the `(customer, organization)` pair on the session.

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/shopping-lists` | List the buyer's lists with their items |
| `POST /api/v1/shopping-lists` | Create a new list |
| `GET /api/v1/shopping-lists/:id` | One list with its items |
| `PATCH /api/v1/shopping-lists/:id` | Rename |
| `DELETE /api/v1/shopping-lists/:id` | Delete (cascades to items) |
| `POST /api/v1/shopping-lists/:id/items` | Add an item |
| `PATCH /api/v1/shopping-lists/:id/items/:itemId` | Update quantity / note |
| `DELETE /api/v1/shopping-lists/:id/items/:itemId` | Remove |
| `POST /api/v1/shopping-lists/:id/convert-to-cart` | Add items to the active cart; archived rows are skipped + reported |
| `POST /api/v1/shopping-lists/:id/convert-to-rfq` | Add items to the draft RFQ; returns the `rfqId` for deep-linking |

The two converters accept an optional `itemIds: string[]` body. Empty or
missing array means "convert every item on the list".

## Conversion semantics

`ShoppingListService` partitions the requested items by their referencing
product's status:

- `active` products go into the cart as one batch through the cart's
  `addItems` (judged together with the cart, so the minimum order quantities
  apply), and into the RFQ via `RfqService.createForCustomer`, whose
  customer-write minimum check applies.
- `archived` products (or rows whose product no longer exists) are
  reported in `skipped[]` with one of:
  - `product_archived`
  - `product_not_found`
  - `variant_unavailable`
  - `below_minimum` (cart only) — the product's total in the cart after the
    conversion would stay below a minimum order quantity; the skip carries the
    `minimum` the line missed.

A product the buyer may no longer see, or that the channel does not publish,
is skipped as `product_not_found` — exactly like a deleted product, with no
name or minimum. Every other line is still added; the conversion is not rolled
back.

The HTTP response is always `200 OK` with `{ added, skipped }` so the UI
can show a friendly message rather than treating the partial result as
an error.

## Entities

`ShoppingList` — `(organizationId, customerAccountId, name)`.

`ShoppingListItem` — cascade-deletes with its parent list. The FK to
`products` is intentionally a plain uuid column without a CASCADE so a
product archive doesn't drop historical rows; the conversion service
surfaces them in the skip report instead.

## Extension points

- **Sharing within an organization** — the entity has no `isShared`
  column today; adding org-wide sharing means a column flip plus a
  one-line tweak to `#owned()` in `shopping-list-service.ts`.
- **Per-list deadlines** — extend `ShoppingList` with `expiresAt` for
  procurement workflows that auto-archive stale lists.
- **Convert-to-quote-only-mode** — the converter already returns an RFQ
  id; the storefront can deep-link the buyer into the draft to add a
  requester note before submission.
