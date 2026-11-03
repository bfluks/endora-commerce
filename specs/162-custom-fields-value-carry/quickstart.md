# Quickstart: Custom-field value carry-over (`specs/162-custom-fields-value-carry/`)

A manual walk-through of the four stories on a dev stack (`pnpm run dev`), for the owner's test and
for a reviewer. Every field key and record below is an example; use your own.

## 0. Prerequisites

- `pnpm run setup` on a fresh database (or `db:reset` after the three migrations land), then
  `pnpm run dev`.
- An administrator holding `custom_fields:write`, `orders:read`, `orders:write`, `rfqs:handle`,
  `crm:read`, `crm:write`.
- A buyer account in Organization **A**, assigned to the store you shop on.
- `crm` and `quote_requests` switched on (`/platform/modules`).

## 1. Configure (US4)

1. `/custom-fields` → create an **Order** field `order_source`, type *Select*, options `fair`,
   `web`, audience *Internal*.
2. Create a **Quote Request** field `order_source`, type *Select*, options `fair`, `web`, `phone`,
   audience *Internal*.
3. Edit the Quote Request field → tick *Carry value to Order* → *Save*. **Expect** a refusal naming
   the missing option `phone` on Order (US4-3).
4. Add option `phone` to the Order field; retry → saved. The table's *Carries to* shows *Order*
   (US4-5). Switch the language to Polish → the column and chip are translated.
5. Try *Carry value to Order* on a **Category** field → no toggle is offered (US4-4). An Order field
   offers only *Sales opportunity*.
6. Make the Quote Request field *Internal* and the Order field *Customer*; try to save a carry →
   refused with the audience sentence (US4-3b). Put the Order field back to *Internal*.

## 2. Quote Request → Order (US1)

1. As the buyer, request a quote; as the admin, set the request's `order_source` = `fair` and
   approve it.
2. As the buyer, convert the approved request and place the order at checkout.
3. Admin → the new Order → *Custom fields*: `order_source` = `fair` (US1-1).
4. Repeat with *Carry value to Order* off → the new Order has no `order_source` (US1-2).
5. Drift: turn the carry on again; remove option `web` from the **Order** field (allowed because no
   order holds `web` yet) — **expect** a warning naming *Quote request · order_source* before the
   removal (US4-6); proceed. The table marks the Quote Request field's *Order* chip *Incompatible*
   (US4-7). Place another order from a request holding `web` → placement succeeds, the Order has no value,
   and its *Comments* tab shows a **System** note naming `order_source` and the reason; the buyer's
   order page shows no such comment and no e-mail is sent (US1-4, SC-006).

## 3. Into the Sales Opportunity (US2)

1. Create an **Opportunity** field `order_source` (same options, *Internal*); on the Order field tick
   *Carry value to Sales opportunity*.
2. Settings → turn on `crm.auto_create_from_orders` for the store's sales channel.
3. Place an order holding `order_source`; open the created Opportunity → the field holds the value
   (US2-1); *Change history* shows the creation entry with the value.
4. Place a second order from a Quote Request linked to that Opportunity, holding a different value
   → the Opportunity keeps the first value (US2-2, "several documents").
5. Delete the Opportunity field and place another order → the Opportunity is created without it,
   and its *Change history* names `order_source` as not carried, target missing (US2-5).

## 4. From the Sales Opportunity (US3)

1. On the Opportunity field tick *Carry value to Quote request* (re-create the field if you deleted
   it). Set it on an Opportunity of Organization A.
2. Opportunity → *Create quote request* → finish the form. Open the request → `order_source` holds
   the Opportunity's value once the link appears on the Opportunity (US3-1).
3. As an administrator who cannot reach Organization A, try the same → the request is created,
   not linked, and holds no carried value (US3-2).

## 5. Switched off (FR-005, FR-014)

1. `/platform/modules` → switch **CRM** off. `/custom-fields` no longer offers *Sales opportunity*
   anywhere; editing and saving the Order field keeps its hidden option (switch CRM back on and see
   it again).
2. With CRM off, place an order → nothing fails; switch CRM back on → no Opportunity appears for
   that order and nothing is replayed (US2-4).
3. Switch **Quote requests** off → its fields and options disappear from `/custom-fields`; an order
   placed from a previously seeded basket carries nothing.
