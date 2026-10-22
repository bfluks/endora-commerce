# Quickstart: line-item groups on quote requests and orders

Manual acceptance walk for `specs/159-quote-request-item-groups/`. Run after the automated suites are
green. Every step names the requirement it proves.

## 0. Setup

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm run build:packages
pnpm run dev:infra && pnpm run setup        # db:fresh then module:install --all
pnpm run dev
```

Admin: a platform administrator, and a sales representative assigned to organisation **Acme** only.
Storefront: a buyer of **Acme**. Have ≥ 10 products with prices on Acme's price list, two of them with a
list price above what you will agree (to see discounts).

## 1. Group a quote (US1 — FR-001–FR-010)

1. As the representative, *Create quote request* for the Acme buyer with 9 lines. *Add group* → focus is
   in the name field; type `Ground floor`. Add `First floor`, `Options` (FR-001).
2. Drag 3 lines into each group with the mouse. Move one line with the keyboard: focus its handle,
   Space, ↓ past the group's last line — it enters the next group — Space; the screen reader / live region
   announces the moves (FR-004, FR-085).
3. Use a line's *Move to group* menu to move it without dragging (WCAG 2.5.7).
4. Move `Options` above `First floor` with *Move up*; *Ungrouped* stays last and has no controls (FR-005).
5. Check each group's summary: item count, net, VAT, gross; a group holding a discounted line shows its
   discount (FR-008). Create.
6. Reload: groups, order, membership and line order are as left (FR-011). The quote's totals equal those
   of the same lines ungrouped (FR-010, SC-002).
7. *Modify*: rename `First floor` → `Floor 1`; delete `Options` → its lines appear under *Ungrouped*, none
   lost (FR-003); empty `Floor 1` by moving its lines out → it stays, showing the drop hint (FR-007).
   *Save revision*.
8. Try a 51st group → *Add group* disabled with the limit message (FR-002). Clear a name → *Enter a group
   name* and the save is blocked.

## 2. The customer's view and acceptance (US2 — FR-020–FR-034)

1. Storefront, as the buyer: the quote shows `Ground floor`, then *Other items*; **not** the empty
   `Floor 1` (D2, FR-034); each section with its summary; no grouping control anywhere (FR-030, FR-025).
2. The comparison with the last-seen revision says the arrangement of the lines changed (FR-023).
3. Accept the revision — works as before (FR-024).
4. Admin *History*: the revision lists *group renamed*, *group removed*, *line moved* entries (FR-022);
   *Overview* shows the grouping read-only (FR-032). *Modify* is gone (Approved) and the groups are
   read-only (FR-012).
5. Open a quote that has never been grouped on both surfaces: unchanged (FR-033).

## 3. PDF (US3 — FR-040–FR-045)

1. *Export PDF* of the grouped quote with the built-in layout: heading rows with names and item counts,
   subtotal rows after each group, *Pozostałe pozycje* / *Other items*, then the totals; positions 1…n
   continuous (FR-042, FR-043).
2. Export with a template created **before** this feature: same sections, no edit needed (FR-041).
3. *Document templates → Quote request →* a template → Line items table → *Grouping*: *Document's groups*
   selected; switch to *No grouping* → preview prints flat; *By field* → 153 behaviour (FR-041).
4. Export an ungrouped quote: identical to before this feature (SC-004).
5. Known limitation (research N-28): a group's heading row can fall at the foot of a page with its first
   line on the next. Rows are never split; a heading is not kept with the row after it.

## 4. Carry-over (US4 — FR-050–FR-053)

1. As the buyer convert the accepted quote, check out without changing the basket. The order shows
   `Ground floor` and *Other items* with the same lines and order (FR-050, SC-003); an empty quote group
   is not on the order.
2. Repeat with a second accepted grouped quote, adding one more product in the basket: it is under
   *Other items* (FR-051).
3. Modify nothing on the order; change the first quote (not possible once completed — confirm the order's
   groups never change, FR-053).
4. With *quote requests* switched off on `/platform/modules`, place an order from a seeded basket: placed
   without groups (FR-052, FR-083).

## 5. Admin order creation (US5 — FR-060–FR-063)

1. *Orders → Create order* for the Acme buyer; add 5 products; *Add group* `Hall A`, `Hall B`; arrange;
   check the summaries next to the live price summary (FR-060).
2. Create → the order shows both groups and *Other items* (FR-061). Its totals equal those of the same
   order without groups.
3. The order screen offers no way to change the grouping (FR-063).

## 6. Order views (US6 — FR-031, FR-032, FR-070)

1. Storefront order detail and admin order screen: grouped, read-only, with summaries (FR-031, FR-032).
   An order placed before this feature: unchanged.
2. The order screen offers no PDF action (owner answer Q-A); the order's invoice has no groups
   (FR-070).

## 7. Isolation

As the representative (Acme only), request the admin quote and order of another organisation by id →
404, no group data (FR-082). As another organisation's buyer, the storefront quote/order URL → not found.
