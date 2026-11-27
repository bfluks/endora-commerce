# Quickstart: walking feature 155 by hand

For the builder's T144 walk and the owner's manual test. Run `pnpm run dev:infra`, then
`pnpm run build:packages`, `pnpm --filter backend run migration:up` (three new migrations), and the dev
servers (`pnpm run dev`, or backend / admin / storefront separately). Sign in to the admin as a
platform administrator and to the storefront as a buyer of an organisation with prices.

Fixtures to create in the admin (unique names per run):

- **A** — simple product, minimum order quantity **10 pcs**, no packaging units.
- **B** — configurable product with two variants (red, blue), packaging unit **Pallet = 64**, Pallet
  minimum **2**, no pieces minimum.
- **C** — simple product, minimum **10 pcs**, Pallet = 64 with minimum **2**.
- **D** — simple product, no minimum.
- **R** returnable, **N** not returnable (both simple, no minimums).

## §1 Configuration (US1, US2, US5)

1. Product A → Inventory tab: "Returnable" and "Minimum order quantity (pcs)" are shown; set 10, save,
   reload — persisted; clear it, save — gone; set it again. Try 1 000 001 → refused. Switch the admin
   to Polish: labels translated.
2. A bundle product → Inventory tab: "Returnable" shown, the minimum field is not.
3. Product B → packaging units: set Pallet minimum 2; clear; set again.
4. Products list → select R and several others → Bulk edit → Returnable: yes → all updated; the
   dialog says products are not returnable until marked.
5. Audit log: the product and packaging-unit entries show old → new values, and the bulk edit wrote
   one entry per product with `returnable` false → true.

## §2 Cart (US1–US3, FR-013/FR-015)

1. PDP of A: "minimum 10 pcs", quantity starts at 10 and will not go below. Add 10 → in cart.
2. Cart: change A to 4 → refused with the minimum message (try `pl` and `en`); change to 0 → removed.
3. API: `POST /api/v1/cart/items {productId: A, quantity: 5}` → 422 `PRODUCT_BELOW_MINIMUM_QUANTITY`.
4. PDP of B, choose Pallet: starts at 2 ("2 pallets = 128 pcs"). Add 1 pallet via the API → 422
   `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`. Add 5 single pieces of B → accepted.
5. C: 5 pcs refused; 10 pcs accepted; 1 pallet refused; 2 pallets accepted; then +3 pcs accepted.
6. Raise A's minimum to 20 in the admin with A × 10 in the cart → the cart line shows "below the
   minimum (20 pcs)"; checkout shows it and will not place.

## §3 Batch paths (US4 #1–#4, #8, #12)

1. Quick order CSV `A,5` / `D,1`: the preview rejects A ("below minimum, 10"); send to cart → D added.
2. Put A × 8 in the cart, import `A,5` → preview rejects; build the same lines to the cart → added (13).
2a. Make A configurable (red, blue) with minimum 10. CSV `A-red,4` / `A-blue,6` → both rows accepted
    (file total 10); `A-red,4` / `A-blue,3` → both rejected, "total in this file 7, minimum 10".
2b. Admin → Quick order on behalf of the buyer, import `A,5`: the row stays buildable with a "below
    minimum (10 pcs)" badge. Build to a quote request → created, the quote detail shows the warning.
    Build to the customer's cart instead → A reported rejected below the minimum.
2c. Hide product H from the buyer's organization (minimum 10); a quick-order build of `H × 5` + `D × 1`
    through the API → the same 404 an unknown id gets, nothing added; a quote request containing H,
    converted to a cart → H dropped as "not purchasable", never "below minimum".
2d. API: a quick-order build with 201 items, and an admin create order with 201 items → 422.
3. One-click on A → an order for 10.
4. Shopping list with A × 5, D × 1 → move to cart → D added, A reported with its minimum.
5. A past order containing A × 5 → reorder → the line is flagged; checkout refused until fixed.
6. A quote request with A × 5 → "convert to cart" → A dropped with "below minimum", not "no price".
7. Product card / comparison "add to cart" on A → 10 added.

## §4 Quote requests (US4 #5–#11, #13–#15)

1. Storefront: "add to quote request" on A → the draft line starts at 10; lowering below 10 is not
   possible; set A's minimum to 15 and reload the draft → the line shows "below the minimum (15 pcs)";
   submitting is refused (422) naming the line.
2. Cart with a 2-pallet B line → convert to quote request → the admin shows the line with Pallet (64).
   Delete the Pallet unit first on another cart → the line arrives as plain pieces.
3. API: a quote line `{ productId: B, packagingUnitName: "Pallet", packagingUnitBaseQuantity: 50 }` →
   422 `PACKAGING_UNIT_MISMATCH`.
4. Admin: create a quote request on behalf with A × 5 → created; the detail shows "Below minimum
   (10 pcs)" on the line (Overview and Modify; check `pl`). The buyer's view of the request shows no
   such warning.
5. Buyer accepts that revision → accepted. Edit the draft leaving A × 5 → accepted; change it to 6 →
   refused. Resubmit → refused.
6. Buyer clones an old order with A × 5 into a quote request → refused naming A. The admin clone of
   the same order → created with the warning.

## §5 Accepted-quote basket (US4 #7–#7c)

1. Accept a quote with A × 5 (agreed price) and B × 3 (set B's pieces minimum to 10 first) → convert
   to order → the basket holds both.
2. Change B to 4 → refused. Remove B → checkout places A × 5.
3. Repeat; add another variant/packaging line of A × 3 → refused (8 < 10); add A × 5 instead →
   accepted (10).
4. Repeat; edit A 5 → 12 (accepted), 12 → 5 (accepted, exempt again), 5 → 6 (refused).
5. Repeat; in the admin cancel the accepted quote (or set its expiry in the past) before checkout. The
   cart still shows A × 5 without a warning; the checkout summary flags it and placement is refused
   naming A. Same when a colleague of the same organization converted the same quote and placed first.

## §6 Returns (US6)

1. Order R and N, move the order to `completed`. "New return": R selectable, N "not returnable" with
   a reason (PL/EN). Submit N through the API with `kind: "return"` → 422
   `RETURN_LINE_NOT_RETURNABLE`; with `kind: "complaint"` → accepted.
2. An order with only N: the order page offers a complaint, not a return, and says no products in
   the order are returnable.
3. Mark R not returnable after placement → the old order still lets R be returned.
4. An order placed before the migration: every line returnable.
5. Switch `returns` off on `/platform/modules`, place an order with N, switch it on → N is not
   returnable on that order.
6. An order with R × 4: submit through the API a `return` case listing R's line twice, 3 + 3 → 422
   (exceeds the remaining 4), no case; 2 + 2 with two different reasons → one case with two lines.

## §7 Release note check (FR-034)

The changeset and the catalogue docs (EN and PL) say that existing products become not returnable for
new orders on release, how to mark them in bulk, and that orders placed before are unaffected.
