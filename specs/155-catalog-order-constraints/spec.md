# Feature Specification: Minimum order quantities (pieces and packaging units) and the returnable flag

**Feature Branch**: `feat/155-catalog-order-constraints` (spec directory `specs/155-catalog-order-constraints/`)
**Created**: 2026-10-13 (clarified draft); revised 2026-10-15
**Status**: Clarified — ready for plan (amended after analyze, 2026-10-15). Clarify sessions
2026-10-13 and 2026-10-15 (two rounds, Q0–Q10, then the analyze and threat-model rulings P1–P4)
closed; no open questions remain. Amended 2026-10-18 (FR-039, owner ruling 2026-10-18;
FR-020 complaint refund of a line not returnable at purchase, owner ruling R1).
**Issues**: #285, #294
**Input**: Product owner's request, summarised in English.

1. **Minimum purchase quantity (#285).** An operator wants to set, on a product, the minimum number
   of pieces a buyer must purchase. Products can also be sold in packaging units (for example a
   pallet of 64 pieces), and the operator wants to set a minimum at that level too — "at least 10
   pieces", "at least 2 pallets", or both at once.
2. **"Eligible for return" flag (#294).** An operator wants a yes/no flag on a product in the admin
   that says whether the product may be returned. Only products carrying the flag may be returned;
   today every product of a completed order can be.

## What the product does today (measured on `origin/master` at `39b9b9989`)

Paths are relative to the repository root. Everything outside `quote_requests`, the quote-request
contracts and `cart-conversion-service.ts` was first measured at `854f8564f`; `git diff` shows none of
those files changed up to `39b9b9989`, so their line references stand. The quote-request references
were re-measured on `39b9b9989`, after feature 146 (`specs/146-quote-request-pricing-history/`) merged
(see *What feature 146 changed that this feature builds on*). `.changeset/` holds 30 pending
changesets; none of them,
and no module `CHANGELOG.md`, mentions a product minimum order quantity or a product-level return
eligibility (`git grep -i "returnable\|minimum order quantit"` finds only the existing
order-level `returns` contract).

### Catalog — quantities and packaging units

- **No product-level minimum, maximum or step quantity exists.** `Product`
  (`packages/modules/catalog/src/backend/entities/product.entity.ts`) has no such column. The only
  `minQuantity` fields in catalog are bundle-slot bounds (`packages/contracts/src/catalog.ts:371`,
  `:1684`) and the price-bracket ladder rung (`catalog.ts:217`). `Product` does carry first-class
  inventory flags (`manageStock`, `backorderEnabled`, `lowStockThreshold`,
  `product.entity.ts:155–167`).
- **Packaging units exist (feature 043).** `ProductPackagingUnit`
  (`packages/modules/catalog/src/backend/entities/product-packaging-unit.entity.ts`, table
  `product_packaging_units`): `name` (≤ 160, unique per product), `baseQuantity` (integer ≥ 1),
  `position`, `isDefault`. **No minimum column.** Only `simple` and `configurable` products may have
  them (`packages/modules/catalog/src/backend/services/packaging-unit.service.ts:29`,
  `ELIGIBLE_TYPES`). Create/update requests are `.strict()` (`catalog.ts:1571–1589`), so a new field
  is a contract change. The storefront product DTO carries `packagingUnits[]` (`catalog.ts:462`).
  `CatalogPackagingPort` (`catalog.ts:3049`) is also written by `pim_pimcore`.
- **Variants** carry no attribute values of their own; a setting on a configurable product is the
  natural setting of its variants.
- **Custom product attributes** are runtime custom fields, but a write is refused when the key is not
  in the product's attribute set (`catalog-admin.service.ts`, `assertAttributeValueKeysAllowed`) — a
  flag stored that way would not be editable on every product without touching every set.
- **Bulk edit** (`packages/modules/catalog/src/backend/services/catalog-bulk-update.service.ts`,
  request `bulkUpdateFieldsObject`, `catalog.ts:718`) patches `status`, `visibility`,
  `salesChannels`, `categories`, `attributeSetId` and `attributeValues` per product (200 per
  synchronous batch, an asynchronous path beyond that); it has no product-level flag field today.

### Where quantities enter a cart, a quote request or an order, and what is checked

The only quantity rules anywhere are `quantity ≥ 1` (`CART_LINE_MIN_QUANTITY`,
`packages/modules/carts/src/backend/services/cart-service.ts:65`, refusal
`CART_QUANTITY_INVALID` at `:221`), the 200-line cart cap (`:312`), and the per-sales-channel minimum
order **value** in `placeOrder`
(`packages/modules/orders/src/backend/services/order-service.ts:1420–1435`, `422
VALIDATION_FAILED` with `details.code = 'order_below_minimum'`).

| Entry point | Code path on `origin/master` | Through `CartService.addItem`? |
| --- | --- | --- |
| Storefront add (PDP, product card, compare) | `POST /api/v1/cart/items` (`carts/src/backend/routes.ts:304`) → `addItem` (`cart-service.ts:192`); packaging unit validated against the catalogue (`:277–288`, `404 PACKAGING_UNIT_NOT_FOUND`); line pieces = `baseQuantity × units` (`:290`); an identical (product, variant, unit) line is bumped (`:298–307`) | yes |
| Cart line edit | `PATCH /api/v1/cart/items/:itemId` (`routes.ts:327`) → `updateItem` (`cart-service.ts:443`): `quantity ≤ 0` removes the line, anything else sets raw pieces with no packaging awareness (`:456–460`) | no |
| Anonymous → customer merge on login | `mergeAnonymousIntoCustomer` (`cart-service.ts:584`) sums quantities, matching on product and variant only — **ignores `packagingUnitId`** (`:616–620`, pre-existing) | no |
| Quick order build (form, CSV/XLSX import; also operator on behalf, `POST /api/v1/admin/quick-order/build`, `quick_order/src/backend/routes.admin.ts:90–120`, gated `orders:write`) | `packages/modules/quick_order/src/backend/services/quick-order-build-service.ts` `buildCart` (`:54–71`) loops `cartWrite.addItem` with **no per-line error handling and no per-line outcome**: the first refusal aborts the request with earlier lines already in the cart. `quickOrderRejectionReasonSchema` (`packages/contracts/src/quick-order.ts:37`) belongs to the import **preview**, not the build | yes |
| Quick order → quote request | `buildQuoteRequest` (`quick-order-build-service.ts:73–102`) → `RfqService.createForCustomer`, pieces only, one atomic request. The operator-on-behalf build reaches the same call | no (RFQ path) |
| One-click buy | `quick_order/.../one-click-service.ts:108–117`, `quantity ?? 1`, then `placeOrder` | yes |
| Shopping list → cart | `shopping_lists/.../shopping-list-service.ts` `convertToCart` (`:314–337`): `skipped` covers only `product_archived \| variant_unavailable \| product_not_found` (`:39`); `addItem` errors are not caught | yes |
| Shopping list → quote request | `convertToRfq` (`:345–373`) → `createForCustomer` | no (RFQ path) |
| Quote request → cart | `carts/.../cart-conversion-service.ts` `createCartFromQuoteRequest` (`:165–252`): per-line tolerant, but **every** `HttpError` from `addItem` is reported as `no_price_in_customer_list` (`:233–240`); the packaging unit is not carried (`:209–216`) | yes |
| Cart → quote request | `convertToQuoteRequest` (`:93–154`) → `createForCustomer` (`:107–132`), carrying the cart line's packaging **name and base quantity** snapshot (not the unit id) and, since feature 146, the cart's unit prices as index-aligned `lineReferencePrices` (`:125–131`) | no (RFQ path) |
| Order → quote request ("clone to quote") | `orders/.../order-clone-to-quote-service.ts` `clone` (`:30–61`) → `createForCustomer`, pieces only (the order line's packaging snapshot is not carried, `:45–50`). Two routes: the buyer's `POST /api/v1/orders/:id/clone-to-quote` (`orders/src/backend/routes.ts:1306–1318`) and the operator's `POST /api/v1/admin/orders/:id/clone-to-quote` (`:1292–1304`, `orders:write`), which raises the request as the order's placing customer | no (RFQ path) |
| Reorder (customer, admin) | `orders/.../order-reorder-service.ts:133` → `cartWritePort.replaceItemsForCustomer` (`carts/.../cart-read-port.ts:85–122`): writes `CartItem` rows directly, no checks, packaging dropped, source mark set to `null` | **no** |
| Accepted quote → order | `quote_requests/.../rfq-service.ts` `convertToOrder` (`:886–1014`) builds piece lines with no packaging (`:933–942`) → `replaceItemsForCustomer` with `{ sourceQuoteRequestId }` (`:989–1002`). **It places no order**: it seeds the buyer's cart at the agreed prices, and the buyer then checks out through `placeOrder` | **no** (seed), then checkout |
| Quote request create / draft edit / resubmit / accept a revision (buyer) | `rfq-service.ts` `createForCustomer` (`:309–438`), `patchDraft` (`:444–624`), `resubmit` (`:630–731`), `acceptRevision` (`:737–743`) | no (own path) |
| Quote request create / modify (operator) | `quote_requests/.../rfq-admin-service.ts` `createOnBehalf` (`:651–799`), `modify` (`:479–645`) | no (own path) |
| Admin "create order" | `orders/.../order-creation-admin-service.ts` → `cartService.addItem` (`:179–186`) on a transient basket, then `placeOrder` (`:190`); line shape `{ productId, variantId?, quantity }` (`:35`) — **no packaging unit** | yes |
| API order intake (bound API key) | `orders/.../order-api-intake-service.ts` → `addItem` (`:296–299`), then `placeOrder` (`:302`); line shape `{ productId, quantity }` (`:203`) — **no packaging unit** | yes |
| Checkout | `POST /api/v1/orders` → `placeOrder` (`order-service.ts:1344`) reads the active basket (`:1409–1418`); no per-line quantity rule. `previewTotal` (`:1168`) is the read the checkout page uses before placement | n/a |

**The accepted-quote basket is marked.** `Cart.sourceQuoteRequestId`
(`packages/modules/carts/src/backend/entities/cart.entity.ts:139–152`) is written only by
`replaceItemsForCustomer`, replaced by every later seed (a reorder seeds `null`), untouched by add,
edit and remove, and cleared when the last line goes (`cart-service.ts:125–137`).
`placeOrder` re-reads it to stamp `orders.source_quote_request_id` (`order-service.ts:1777–1792`).

**The accepted-quote basket is marked per basket, not per line.** `CartItem` has no column saying a
line was seeded from a quote (`carts/src/backend/entities/cart-item.entity.ts`); the mark is the
basket's only. Telling "a quote line whose quantity equals the quote's quantity" apart from a line
added afterwards or currently edited to another quantity (FR-008, FR-028) therefore needs new
per-line state that remembers the quote's quantity for the line (a one-way "unchanged" flag is not
enough, because the exemption is state-based: 5 → 12 → 5 is exempt again); how it is stored is the
plan's.

**Packaging units on quote requests are not validated.** `QuoteRequestItem` stores
`packagingUnitName` and `packagingUnitBaseQuantity` only — **no unit id**
(`quote_requests/src/backend/entities/quote-request-item.entity.ts:59–66`). The buyer request line
(`createQuoteRequestLineSchema`, `packages/contracts/src/quote-requests.ts:422–431`, shared by create
and draft edit) accepts a free `packagingUnitName` (≤ 160) and any positive
`packagingUnitBaseQuantity`; `createForCustomer` stores them unchecked (`rfq-service.ts:367–395`), and
so does `patchDraft` (`:526–553`); `resubmit` drops them (`:686–698`); the operator schemas
(`adminCreateQuoteRequestLineSchema` `:475–481`, `adminPatchQuoteRequestLineSchema` `:516–523`) have no
packaging key, `createOnBehalf` writes none (`rfq-admin-service.ts:731–746`) and `modify` carries the
stored snapshot of the line it pairs with (`:565–566`). Cart lines, by contrast, carry the unit id
and are validated. RFQ line `quantity` is in base pieces. The storefront's quote-request draft is
piece-based: the product page adds the resulting pieces with no unit (`storefront/components/ProductBuyActions.tsx:123–135`),
the draft page submits `productId` and `quantity` only (`storefront/components/rfq/RfqDraftView.tsx:244–255`),
and quantities are clamped to ≥ 1 (`storefront/lib/rfqDraft.ts:86`, `:107`). The draft holds one line per
product — a second add bumps it (`rfqDraft.ts:88–90`) — so a draft line is that product's total. Three
storefront actions add to the draft: the product page's buy actions (`ProductBuyActions.tsx:123–135`,
the quantity input's pieces), the product page's quote call-to-action shown when prices are hidden
(`storefront/components/pricing/QuoteRequestCta.tsx` → `storefront/components/rfq/AddToRfqButton.tsx`,
quantity starts at 1, `:32`, input `min={1}`, `:57`), and the product card
(`storefront/components/ProductCardActions.tsx:157–167`, always quantity 1). Labelled packaging lines
reach a quote request only through cart → quote request.

### What feature 146 changed that this feature builds on

Feature 146 (`specs/146-quote-request-pricing-history/`, merged in `328ac4c1d`) rewrote the
quote-request write paths this feature also changes. What matters here:

- **`patchDraft` now keeps the buyer's packaging.** It stores `packagingUnitName` /
  `packagingUnitBaseQuantity` as sent (`rfq-service.ts:545–546`) instead of dropping them, so FR-026
  has a draft-edit path to validate, not only create.
- **Draft edit and operator modify pair incoming lines with stored ones** (`line-carry-over.ts`
  `pairLines`, `:60`): the customer side pairs by product, variant and packaging **name**
  (`:94–101`), the operator side by line id, product and variant, carrying the stored packaging
  snapshot (`rfq-admin-service.ts:539–566`). Once a line names its unit by `packagingUnitId` (FR-026),
  pairing must resolve the unit before it compares; and the customer-side pairing is the seam that
  tells "a line the buyer did not change" on a draft edit (FR-031, clarify Q7).
- **A negotiation-policy check runs first.** `createForCustomer` refuses a forbidden price proposal
  (`RFQ_PRICE_PROPOSAL_NOT_ALLOWED`, the one code feature 146 added to `packages/contracts/src/errors.ts`)
  before any product is read (`rfq-service.ts:326`); `patchDraft` pre-checks it before pricing
  (`:468`) and asserts it again under the row lock (`:574`). FR-029 fixes where the minimum check sits
  relative to it.
- **Reference prices are resolved before the write.** Every create and draft edit prices its lines
  through `price_lists` (`reference-price.ts`), and `convertToQuoteRequest` supplies the cart's prices
  index-aligned with the lines (`cart-conversion-service.ts:125–131`). A refusal for a minimum or a
  packaging unit (FR-012, FR-026) must therefore come before that pricing so a refused request costs
  no pricing call and writes nothing — the same property feature 146 states for its own refusal.
- **Buyer line arrays are capped at 200** (`quote-requests.ts:441`, `:448`); a per-line refusal can
  name a line by its index within that bound.
- **Unchanged by feature 146:** `resubmit` still drops packaging (`:686–698`), `convertToOrder` still
  seeds pieces without packaging (`:933–942`), and `createCartFromQuoteRequest` is untouched.

**Line storage.** Cart, order and quote lines store **pieces**. A packaging line snapshots the unit
(`CartItem.packagingUnitId/Name/BaseQuantity`; `OrderItem.packagingUnitSnapshot`
`{ name, baseQuantity }`, `orders/.../order-item.entity.ts:38–39`; RFQ as above). Order lines are
created in `placeOrder` (`order-service.ts:1905–1940`) with a JSON `productSnapshot`
`{ sku, name, primaryAssetUrl }` (`order-item.entity.ts:20–25`).

**Admin order preview.** Feature 145 added a per-line availability message to the admin create-order
preview with a fixed precedence (`ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE`,
`packages/contracts/src/orders.ts:799`; `orders/.../preview-line-availability.ts`): not found → not
visible to the customer → not in the order's channel → quote-only. No quantity rule.

### Storefront

- PDP `storefront/components/ProductBuyActions.tsx`: packaging selector ("single piece" or a unit),
  quantity starts at 1 (`:82`), input `min={1}` (`:169`), resulting pieces shown as
  `baseQuantity × qty` (`:89`).
- Cart `storefront/app/(commerce)/cart/page.tsx`: an edit below 1 is refused client-side (`:467`);
  API refusals reach the buyer through `/cart?error=…` and are rendered as given (`:215–217`,
  `:474`, `:488`).
- Product card `storefront/components/ProductCardActions.tsx` and
  `storefront/components/CompareAddToCartButton.tsx` always add quantity 1 (`ProductCardActions.tsx:104`).
- Quick order `storefront/app/(account)/quick-order/`, shopping lists
  `storefront/app/(account)/shopping-lists/`.

### Returns

- Module `returns`; a case has `kind` `return` (withdrawal) or `complaint` (warranty).
- Eligibility is **order-level only**. `GET /api/v1/orders/:orderId/returnable` →
  `packages/modules/returns/src/backend/services/return-case-service.ts` `getReturnable` (`:56–80`):
  the order must have entered the completing status, and every line is listed with its remaining
  quantity. Response `returnableResponseSchema` (`packages/contracts/src/returns.ts:197–202`):
  `eligible`, `reason ∈ { order_not_completing, window_passed, fully_returned }` (`window_passed` is
  declared but never emitted), `freeReturnEligible`, `lines[]`. `returnableLineSchema`
  (`returns.ts:187–195`) has **no per-line eligibility**.
- `createCase` (`return-case-service.ts:83–140`) checks line existence, remaining quantity and reason;
  `kind` is read only to decide the free-return window (`:133`). **No product-level rule.** The
  remaining-quantity check runs per request line against the same `remaining` (`:106–119`), so a
  request naming one order line twice (e.g. 3 + 3 against 4 remaining) passes it — each entry alone
  is ≤ 4 (FR-033).
- `returns` learns about the order only through `OrderReturnContextPort`
  (`packages/contracts/src/returns.ts:580–614`), implemented by
  `packages/modules/orders/src/backend/services/order-return-context.ts` (`:26–52`); its line shape has
  no returnability field.
- Storefront `storefront/app/(account)/returns/new/page.tsx`: one form for both kinds (kind chosen at
  submit, `:91`); when `eligible` is `false` the whole form is replaced by a message (`:67–73`), so
  **an order-level "not eligible" also blocks complaints today**. Those messages are hard-coded
  English. The order detail page shows the return action only when `eligible`
  (`storefront/app/(account)/orders/[id]/page.tsx:135–140`, `:212`).
- Admins list, read, authorise, reject and transition cases (`returns/src/backend/routes.admin.ts`);
  they do not create them.

The quick-order feature (feature 039) already anticipated this work: its one-click button "purchases
the product at quantity 1 (or the product's minimum order quantity if one is defined)".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Minimum order quantity in pieces (Priority: P1)

An operator sets, on a product, the minimum number of pieces a buyer must order. Buyers cannot put
fewer pieces of that product into the cart or check out with fewer, whichever way they add it.

**Why this priority**: The core of #285; valuable alone for every product without packaging units.

**Independent Test**: Set minimum 10 pieces on product A (no packaging units). As a buyer, try to add 5,
add 10, edit 10 → 4, and check out; verify both the storefront and a direct API call.

**Acceptance Scenarios**:

1. **Given** product A has a minimum of 10 pieces, **When** an operator opens A in the admin product editor, **Then** the minimum is shown and editable, and saving an empty value removes it.
2. **Given** A has minimum 10, **When** a buyer opens A's product page, **Then** the page states "minimum 10 pcs" and the quantity input starts at 10 and does not offer less.
3. **Given** A has minimum 10 and the cart has no A, **When** a buyer (via storefront or directly via the API) adds 5 pieces, **Then** the add is refused with a message naming the minimum, in the buyer's language (PL or EN), and the cart is unchanged.
4. **Given** the cart holds 10 pieces of A, **When** the buyer changes the line to 4, **Then** the change is refused with the same message and the line stays at 10; removing the line entirely (including an edit to 0) remains possible.
5. **Given** the cart holds 3 pieces of A because the minimum was raised after they were added, **When** the buyer views the cart and tries to check out, **Then** the line is flagged as below the minimum and checkout is refused until the line is fixed or removed.
6. **Given** A has no minimum, **When** a buyer adds 1 piece, **Then** behaviour is unchanged from today.

---

### User Story 2 - Minimum order quantity in packaging units (Priority: P1)

An operator sets, for a product's packaging unit (e.g. "Pallet" = 64 pcs), the minimum number of that
unit a buyer must order (e.g. 2 pallets). Buyers ordering in that unit cannot order fewer.

**Why this priority**: Explicitly requested in #285 ("minimum 2 Pallets"); B2B buyers order bulk goods
by the pallet.

**Independent Test**: Product B has unit "Pallet" = 64 with a minimum of 2. As a buyer, choose "Pallet" on
the PDP, try 1, then 2; check the cart line and checkout.

**Acceptance Scenarios**:

1. **Given** B has unit "Pallet" (64 pcs), **When** an operator edits that unit in the admin, **Then** they can set and clear a minimum number of units.
2. **Given** "Pallet" has minimum 2, **When** a buyer selects "Pallet" on B's product page, **Then** the page states the minimum (2 pallets = 128 pcs) and the quantity input starts at 2.
3. **Given** "Pallet" has minimum 2, **When** a buyer adds 1 pallet (storefront or API), **Then** the add is refused with a message naming the unit and its minimum.
4. **Given** the cart holds a 2-pallet line (128 pcs), **When** the buyer edits it to fewer than 2 pallets' worth, **Then** the change is refused.
5. **Given** "Pallet" has minimum 2 and B has no pieces minimum, **When** a buyer adds 5 single pieces of B, **Then** the add succeeds — the pallet minimum governs only what is ordered in pallets.
6. **Given** "Pallet" has minimum 2 and B is configurable, **When** the cart holds 1 pallet of variant red and the buyer adds 1 pallet of variant blue, **Then** the add succeeds (2 pallets of B in total) and the cart is valid at checkout.
7. **Given** the cart holds 1 pallet of red and 1 of blue, **When** the buyer removes the blue line, **Then** removal succeeds and the remaining red line is flagged below the pallet minimum; checkout is refused until fixed.

---

### User Story 3 - Both minimums on one product (Priority: P2)

An operator sets both a piece minimum and a packaging-unit minimum on one product; each rule governs
the way of ordering it belongs to.

**Why this priority**: Combination of US1 and US2; needs both to exist first.

**Independent Test**: Product C: minimum 10 pcs, "Pallet" = 64 with minimum 2. Add 5 pcs (refused), 10 pcs
(accepted), 1 pallet (refused), 2 pallets (accepted).

**Acceptance Scenarios**:

1. **Given** C has minimum 10 pcs and "Pallet" minimum 2, **When** a buyer adds 10 single pieces, **Then** the add succeeds.
2. **Given** the same product, **When** a buyer adds 1 pallet, **Then** the add is refused citing the pallet minimum.
3. **Given** the cart holds 2 pallets of C (128 pcs), **When** the buyer adds 3 single pieces, **Then** the add succeeds — the product total is 131 pcs ≥ 10, and the pallet count (2) is unchanged.
4. **Given** C as above and an empty cart, **When** the buyer adds 1 pallet (64 pcs), **Then** the add is refused: the pieces minimum is met (64 ≥ 10) but the pallet minimum is not (1 < 2) — each setting is checked separately.
5. **Given** C as above and an empty cart, **When** the buyer adds 5 single pieces, **Then** the add is refused citing the pieces minimum (5 < 10).

---

### User Story 4 - Constraints hold on every way into the basket (Priority: P2)

Minimums are enforced not only on the product page but on quick order, CSV import, one-click buy,
shopping list → cart, quote request → cart, quote requests, admin-created orders, API intake,
submit for approval and checkout, so a buyer cannot route around them.

**Why this priority**: Without it, US1–US3 are UI-only and bypassable; but US1–US3 deliver visible value first.

**Independent Test**: With product A at minimum 10, try each entry point with 5 pieces and confirm a clear,
per-line refusal — except the sales-representative quote paths and the operator's quick-order import preview, which warn instead (FR-030, FR-011(a)); confirm a
valid line in the same batch is still added.

**Acceptance Scenarios**:

1. **Given** a quick-order form or CSV with A × 5 and D × 1 (no minimum), **When** the buyer sends it to the cart, **Then** D is added and the response lists A as rejected with the reason "below minimum" and the minimum (10 pcs); the cart holds D only.
1a. **Given** a CSV/XLSX file with a row A × 5, **When** the buyer imports it, **Then** the import preview lists that row as rejected with the reason "below minimum" and the minimum, alongside today's rejection reasons, before anything is sent to the cart.
1b. **Given** the buyer's cart already holds A × 8 and a CSV/XLSX file has a row A × 5 (A minimum 10), **When** the buyer imports it, **Then** the preview lists the row as rejected below the minimum — it judges A's total across the file (5), not with the cart; **When** the buyer instead sends the same lines to the cart through the build, **Then** the build judges A's cart total (13) and adds the line.
1c. **Given** A is configurable with minimum 10 and a CSV/XLSX file has rows A-red × 4 and A-blue × 6 (distinct SKUs), **When** the buyer imports it, **Then** the preview accepts both rows — A's total across the file is 10; **Given** the file instead has A-red × 4 and A-blue × 3, **Then** the preview rejects both rows below the minimum (total 7 < 10), each with the minimum.
1d. **Given** a CSV/XLSX file with a row A × 5 (A minimum 10), **When** an operator imports it on the admin quick order, **Then** the preview keeps the row buildable and flags it with a "below minimum (10 pcs)" warning instead of rejecting it; **When** the operator builds it into a quote request for a customer, **Then** the request is created with the FR-030 warning on the A line (scenario 15); **When** the operator builds it into the customer's cart instead, **Then** the build reports A as rejected below the minimum (FR-011).
2. **Given** A has minimum 10, **When** the buyer uses one-click buy on A, **Then** it orders 10 (the minimum), not 1.
3. **Given** a shopping list with A × 5, **When** the buyer moves the list to the cart, **Then** A is reported as not added (with the minimum) and other lines are added.
4. **Given** a reorder of an old order containing A × 5, **When** the cart is seeded, **Then** the A line keeps its quantity and is flagged below the minimum, so that checkout cannot complete with 5.
5. **Given** A has minimum 10, **When** a buyer submits or edits a quote request with A × 5 (directly, from the cart, from quick order, from a shopping list, or by cloning one of their orders), **Then** the whole request is refused with HTTP 422 naming the A line and the minimum, and nothing is written.
5a. **Given** an order placed when A had no minimum contains A × 5 and A now has minimum 10, **When** the buyer clones that order into a quote request, **Then** the whole request is refused with HTTP 422 naming the A line and its minimum, and no request is created; the buyer can raise the quantity and submit.
5b. **Given** a sales representative revised a quote request so that A is at 5 (A minimum 10), **When** the buyer accepts that revision, **Then** the acceptance succeeds.
5c. **Given** the same request after the buyer accepted that revision, while it is still editable (`Pending`, no revision awaiting acceptance, `rfq-service.ts:452–458`), **When** the buyer edits the draft and leaves the A × 5 line unchanged (same product, variant, packaging and quantity), **Then** the edit is not refused for that line; **When** the buyer changes that line to 6, **Then** the edit is refused (6 < 10).
5d. **Given** the same request, **When** the buyer resubmits it, **Then** it is checked like a new submission: the A × 5 line is refused with HTTP 422 naming it, and no new request is created.
6. **Given** an operator creates an order on behalf of a customer with A × 5, **When** they submit it, **Then** it is refused with the minimum message.
7. **Given** an accepted quote for A × 5 (negotiated below the minimum, or accepted before it was set), **When** the buyer converts it into an order and checks out without changing that line, **Then** the negotiated quantity is kept and the order is placed.
7a. **Given** a basket seeded from an accepted quote with A × 5 and B × 3 (B minimum 10), **When** the buyer changes B to 4, **Then** the change is refused as for any basket (4 < 10); the unchanged A line is still exempt and checkout succeeds once B is fixed or removed.
7b. **Given** a basket seeded from an accepted quote, **When** the buyer adds product E × 2 (E minimum 5), **Then** the add is refused as for any basket — lines added after the quote was loaded are not exempt.
7c. **Given** a basket seeded from an accepted quote with an exempt line A × 5 (A minimum 10), **When** the buyer adds a new line of A × 3 pieces (another variant of A, or a packaging line; adding the same variant as single pieces bumps the quote line instead, to a quantity other than the quote's, so it is not exempt at that quantity, FR-028), **Then** the add is refused — A's total is 8 < 10, the exempt line's 5 pieces counting toward it; **When** the buyer instead adds A × 5, **Then** the add succeeds (total 10) and checkout succeeds. The exemption waives only the refusal of the quote line itself.
7d. **Given** a basket seeded from an accepted quote with an exempt line A × 5 (A minimum 10), **When** the buyer edits it to 12, **Then** the edit succeeds (12 ≥ 10) and the line is no longer exempt; **When** the buyer then edits it back to 5, **Then** the edit succeeds — the line's quantity equals the quote's quantity again, so it is exempt again — and checkout succeeds with A × 5. **When** the buyer instead edits it to 6, **Then** the edit is refused (6 < 10, and 6 is not the quote's quantity).
7e. **Given** a basket seeded from an accepted quote with an exempt line A × 5 (A minimum 10), **When** the quote request is cancelled, has expired, has already produced an order, or no longer belongs to the buyer's organization by the time the buyer checks out, **Then** the A line is judged like any basket line: the checkout preview flags it and placement is refused naming it (FR-036).
8. **Given** a quote request containing A × 5 is converted back into a cart, **When** the conversion reports the dropped A line, **Then** the reported reason is the minimum, not "no price in your price list".
9. **Given** A has minimum 10, **When** a sales representative creates a quote request on a customer's behalf, or modifies one, with A × 5, **Then** the write succeeds and the admin quote-request screen shows a "below minimum (10 pcs)" warning on the A line, in PL or EN.
10. **Given** product B has unit "Pallet" (64 pcs), **When** a buyer submits a quote-request line for B naming the unit by its id, **Then** the line is stored with the catalogue's name and base quantity (64), whatever name or base quantity the request also sent; **When** the line instead names "Pallet" with base quantity 64 and no id, **Then** it is accepted; **When** it names "Pallet" with base quantity 50, or a unit B does not have, **Then** the request is refused with HTTP 422 naming the line.
11. **Given** a cart line of B in a unit that the operator has since deleted, **When** the buyer converts the cart into a quote request, **Then** the line is carried as plain pieces (its piece quantity unchanged, no packaging) and the conversion is not refused for it.
12. **Given** A has minimum 10, **When** the buyer uses "add to cart" on A's product card or in the comparison, **Then** 10 pieces are added in one action.
13. **Given** A has minimum 10 and the storefront quote-request draft has no A, **When** the buyer uses "add to quote request" on A's product page (either the buy actions or the quote call-to-action shown when prices are hidden) or on A's product card, **Then** the draft gets an A line of at least 10 pieces — the product page's quantity input starts at 10 and does not offer less, the product card adds 10 in one action.
14. **Given** the draft holds A × 10, **When** the buyer lowers the line on the draft page, **Then** the page does not allow a value below 10; removing the line remains possible. **Given** the draft holds A × 3 because it was added before the minimum was set, **When** the buyer opens the draft page, **Then** the line is shown below the minimum (10 pcs), and submitting it unchanged is refused by the API (scenario 5).
15. **Given** A has minimum 10, **When** a sales representative clones an order with A × 5 into a quote request from the admin, or builds an operator quick order with A × 5 to a quote request, **Then** the request is created and the admin quote-request screen shows the "below minimum" warning on the A line (as scenario 9).
16. **Given** product H is not visible to the buyer (or not published in the request's channel) and has minimum 10, **When** a batch path (quick-order import or build, shopping list → cart, quote request → cart, API intake, admin create-order preview) receives H × 5, **Then** the line is reported exactly as an unknown product id would be — never "below minimum", never H's name or minimum.
17. **Given** a quick-order build, an admin order create or an admin order preview request with more than 200 lines (FR-038), **When** it is submitted, **Then** it is refused as a whole with HTTP 422 `VALIDATION_FAILED` and `details.code = 'too_many_items'` before any line is evaluated or added.
18. **Given** an organization that requires cart approval and a member (not an Org Admin) whose cart holds A × 3 because A's minimum was raised to 10 after the line was added, **When** the member views the cart, **Then** "Submit for approval" is disabled with the reason shown, in PL or EN; **When** the member instead submits through the API, **Then** the submit is refused with HTTP 422 naming the A line and the minimum, and the cart is not sent for approval; **When** the member changes the line to 10 and submits, **Then** the cart is sent for approval (FR-039).
18a. **Given** the same organization and a basket seeded from an accepted quote with an exempt line A × 5 (A minimum 10), **When** the member submits it for approval, **Then** the submit is not refused for that line, provided the quote source is confirmed valid at that moment (FR-036). **Given** the same basket, **When** its quote request has expired, been cancelled, already produced an order, or no longer belongs to the member's organization by the time the member submits, **Then** the A line is judged like any basket line: the submit is refused with HTTP 422 naming the A line and its minimum, as placement would refuse it, and the cart is not sent for approval (FR-039).

---

### User Story 5 - "Returnable" flag on the product (Priority: P1)

An operator marks a product as returnable in the admin product editor.

**Why this priority**: #294; the prerequisite for US6, and cheap.

**Independent Test**: Toggle the flag on a product, reload the editor, confirm it persisted; set it on
many products with one bulk action.

**Acceptance Scenarios**:

1. **Given** any product (any type and attribute set), **When** an operator opens it in the admin, **Then** a "Returnable" yes/no control is shown with its current value (label translated in PL and EN).
2. **Given** an operator changes the flag and saves, **Then** the change persists and is recorded in the audit log like any product edit.
3. **Given** a product that existed before this feature and was never edited, **When** the operator opens it, **Then** the flag shows "not returnable".
4. **Given** many products, **When** the operator selects them in the product list and uses the bulk "Set returnable" action (yes or no), **Then** every selected product's flag is set in one action rather than product by product, and each change is audited.

---

### User Story 6 - Only returnable products can be returned (Priority: P1)

A buyer opening a return sees which order lines can be returned; lines of non-returnable products are
shown as not returnable and cannot be submitted. Complaints (warranty) are not affected.

**Why this priority**: The behavioural half of #294.

**Independent Test**: A completed order with product R (returnable) and N (not returnable). Open a return:
R selectable, N shown as "not returnable". Submit N directly via the API: refused. Open a complaint for N: allowed.

**Acceptance Scenarios**:

1. **Given** a completed order with lines R (returnable) and N (not), **When** the buyer opens "new return", **Then** R can be selected and N is shown as not eligible for return with a reason, in PL or EN.
2. **Given** the same order, **When** a return case including N is submitted directly to the API, **Then** it is refused with a stable error code identifying N's line; no case is created.
3. **Given** a completed order where every line is non-returnable, **When** the buyer views the order or the return form, **Then** the return action states that no products in this order are returnable and does not offer a return, while a complaint can still be filed.
4. **Given** the same order, **When** the buyer files a **complaint** for N, **Then** it is accepted as today.
5. **Given** a return case opened before this feature (or before the flag changed), **When** it continues through its workflow, **Then** it is not affected.
6. **Given** R was returnable when the order was placed and the operator later marks R not returnable, **When** the buyer opens a return for that order, **Then** R is still returnable (the value recorded at purchase governs); the reverse change likewise does not make a line returnable.
7. **Given** an order placed before this feature (no value recorded on its lines), **When** the buyer opens a return, **Then** every line of that order is returnable (subject to the existing order-level rules), regardless of the products' current flags.
8. **Given** a completed order line R × 4 with nothing returned yet, **When** a return or complaint case is submitted listing that line twice (3 + 3), **Then** it is refused with HTTP 422 (requested 6 exceeds the remaining 4) and no case is created; **When** it lists the line twice as 2 + 2, **Then** it is never treated as more than 4 of that line — accepted as a request for 4, or refused as a duplicate, per the plan's choice in FR-033.
9. **Given** an order placed after this feature where, for one line, the product's returnable value could not be read when the order was placed (the product record was read and the line was accepted, but the record carried no returnable value — e.g. a record lacking the flag; a line whose product record is missing entirely is refused at placement with 404 under FR-037, whatever its type, so it never reaches an order), **When** the buyer opens a return, **Then** that line is not returnable (recorded not returnable at placement, FR-016a); a complaint can still be filed.

---

### Edge Cases

- **Variants**: a configurable product's minimums and returnable flag apply to all its variants; variants have
  no own setting. Both minimums count the product total across variants.
- **Product types**: packaging units exist only for simple/configurable. Minimums apply to simple and
  configurable products (and their variants); grouped, bundle and virtual products are out of scope for
  minimums in this release. The returnable flag applies to every product type.
- **Minimum ≤ 0, non-integer or above the upper bound**: rejected at save — in the admin and through
  `CatalogPackagingPort` alike (FR-001, FR-002; the bound's value is the plan's); empty means "no
  minimum". A piece minimum of 1 is equivalent to none.
- **Minimum larger than available stock**: the minimum still applies; stock/back-order rules are unchanged
  and evaluated separately.
- **Minimum changed after the line was added** (raised, or a packaging unit deleted/renamed): existing cart lines
  are not silently changed; they are flagged and re-validated at checkout (US1 #5).
- **Packaging line quantity not a multiple of the unit** (possible today via cart edit, which works in pieces,
  `cart-service.ts:456–460`): no whole-unit rule is added; for the unit minimum the line counts as pieces ÷
  base quantity (e.g. 96 pcs on a 64-pc pallet line = 1.5 pallets, below a minimum of 2). Its pieces count
  toward the pieces minimum.
- **Several packaging units on one product** (e.g. "Carton" = 8 and "Pallet" = 64): each unit's minimum counts only
  lines in that unit; a unit without a minimum has no unit rule.
- **Packaging unit deleted after lines were added**: its lines still count toward the pieces minimum; no unit
  minimum applies to them any more.
- **Lines that lose their packaging unit on the way** (reorder, quote → cart, accepted quote → basket and
  order → quote request drop it today, `cart-read-port.ts:85–101`, `cart-conversion-service.ts:209–216`,
  `rfq-service.ts:933–942`, `order-clone-to-quote-service.ts:45–50`): they arrive as single-piece lines
  and are checked against the pieces minimum only. A buyer's clone of an order to a quote request is
  therefore refused on the pieces minimum only (FR-012); a quote request's `resubmit` drops packaging
  too (`rfq-service.ts:686–698`), so a resubmission is likewise checked on pieces only (FR-031).
- **Cart line whose packaging unit was deleted, converted to a quote request**: carried as plain pieces
  (FR-026); its piece quantity is unchanged and only the pieces minimum applies to it. A unit that still
  exists but whose name or base quantity changed since the line was added is carried with the
  catalogue's current values; the line's pieces are unchanged, so its unit count is pieces ÷ the current
  base quantity (FR-006a).
- **Accepted-quote basket** (FR-028): only the lines seeded from the quote whose current quantity
  equals the quote's quantity are exempt. The exemption is a state, not a one-way loss: a line edited
  to another quantity is judged normally while it stays there, and is exempt again once its quantity
  equals the quote's (5 → 12 → 5); the edit that restores the quote's quantity is itself allowed even
  though it is below the minimum. Adding the same product and variant again bumps the seeded line
  (`cart-service.ts:298–307`) to another quantity, so it is not exempt at that quantity. The
  exemption applies at placement only when the basket's quote source is still valid (FR-036). An exempt line's
  pieces still count toward the product total when another line of the same product is checked; the
  exemption waives only that line's own refusal (A × 5 exempt + new A × 3 = 8 < 10 → refused; + A × 5 =
  10 → accepted). Seeded lines carry no packaging unit (`rfq-service.ts:933–942`), so they count toward
  the pieces minimum only and never toward a unit count.
- **Quote requests a sales representative writes** (create on behalf, modify, clone an order to a quote
  from the admin, admin quick order to a quote request): never refused for minimums; each below-minimum
  line carries a warning on the admin quote-request screen (FR-012, FR-030). The rule follows the actor,
  not the code path — the admin clone and the admin quick order reach the buyer's `createForCustomer`
  today.
- **Buyer writes after a representative's below-minimum line** (FR-031): accepting the revision is
  allowed; a draft edit is not refused for a line the pairing finds unchanged (same product, variant,
  packaging and quantity); a resubmission is checked as a new submission. The pairing cannot tell who
  set a quantity, so "unchanged" also covers a buyer's own line that fell below a minimum raised after
  it was written: it, too, survives a draft edit that does not touch it, and is refused only once the
  buyer changes it or resubmits. An unchanged line's pieces count toward the product total when another
  line of the same product in the draft is checked, as in the accepted-quote basket (FR-028).
- **Storefront quote-request draft** (FR-032): the draft is piece-based and holds one line per product,
  so only the pieces minimum applies to it; packaging minimums reach a quote request only through cart
  → quote request (FR-027). A draft line already below the minimum (added before the minimum was set) is
  shown as such; the API still refuses it at submission (FR-012).
- **Quick order, both reports** (FR-011): the import preview checks the product's pieces minimum
  against the product's total across all rows of the file — duplicate rows merged as today (by SKU,
  `mergedFromLines`), then every variant's rows of the same product summed — never with what the
  buyer's cart already holds; when the total is below the minimum, every row of that product is
  reported, each with the minimum. Import rows carry no packaging unit, so only the pieces minimum is
  reachable in the preview. The add-to-cart build checks against the cart's product total. A row the
  preview rejects (A × 5, minimum 10) can therefore be accepted by the build when the cart already
  holds A × 8 — accepted, not a defect to fix in the plan: the preview does not know whether the target
  will be the cart or a quote request, and on the operator's import the buyer is named only at build
  time (`quick_order/src/backend/routes.admin.ts:74–87`). A row refused for visibility, channel or an
  unknown product does not count toward any product total (FR-035).
- **Operator's quick-order import** (FR-011(a), clarify P1): the preview on the admin endpoint does not
  reject a below-minimum row; it keeps it buildable and flags it with a warning carrying the minimum,
  consistent with Q3 (representatives are warned, never blocked on quote requests). What the operator
  does next decides the outcome: a build to `quote_request` creates the request with the FR-030
  warning (FR-012); a build to `cart` on the customer's behalf still rejects the line (FR-011(b)). The
  buyer's own import still rejects.
- **Cart merge on login**: merging only sums quantities, so it cannot take a line below a minimum. The
  pre-existing defect that a pallet line merges into a piece line (packaging unit ignored when matching,
  `cart-service.ts:616–620`) is noted, not fixed here (Out of Scope) — checkout re-validation (FR-008) still holds. A merge into a line seeded
  from an accepted quote changes that line's quantity, so the line is not exempt while its quantity
  differs from the quote's (FR-028).
- **Partial batch adds** (quick order, CSV, shopping list, quote → cart): valid lines are added, invalid lines are
  reported per line with the minimum; the whole batch is not rolled back. Only quote → cart is per-line tolerant
  today; quick order and shopping list → cart abort on the first refusal (see *What the product does today*), so
  FR-011 changes their behaviour.
- **Reorder** of an order placed before a minimum existed: the seeded line keeps its quantity and is flagged
  below the minimum; the buyer fixes it before checkout. (Alternative — auto-raise — rejected: it changes
  money without consent.)
- **Removing a line** is always allowed, even if the line is below the minimum.
- **Order of checks**: an add that violates both a visibility/channel rule and a minimum answers with the
  existing 404 (no disclosure that the product exists); an unknown packaging unit keeps its existing 404.
  On every batch path the same holds per line (FR-035): a product the buyer cannot see, or that the
  channel does not publish, is reported exactly as an unknown id; visibility, channel and packaging-unit
  checks run before any minimum check, and such a line never reveals the product's name or minimum.
  In the admin create-order preview the below-minimum message ranks after the four existing messages
  of `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE`.
- **Product record unreadable** (FR-037): when a minimum check cannot read the product's record, the
  line is refused as an unknown product — never treated as "no minimum". When the returnable value
  cannot be read at placement, the line is recorded **not returnable** (FR-016a) — never left without
  a value, because an absent value means "returnable" (FR-025).
- **Oversized batches** (FR-038): the quick-order build, the admin order create and the admin order
  preview accept at most 200 lines; a larger request is refused whole with HTTP 422 `VALIDATION_FAILED`
  and `details.code = 'too_many_items'` before any line is evaluated. The API order intake
  (`apiPlaceOrderRequestSchema.lines`) is covered by the same cap (owner ruling 2026-10-16; a public API
  change, documented in the changeset).
- **Submit for approval below a minimum** (FR-039): an organization cart with a line below its
  minimum, or a line whose product record is gone, cannot be submitted for approval — the storefront
  disables the control and the API refuses the submit (owner ruling 2026-10-18). A quote line is
  exempt at submit only once its quote source is confirmed valid, as at placement (FR-036); a basket
  whose quote has lapsed is refused at submit with placement's minimum refusal, although the cart view,
  which trusts the quote mark (FR-028), does not flag it beforehand.
- **Return request naming one order line more than once** (FR-033): the requested quantities are
  aggregated per order line before the remaining-quantity check, for both case kinds.
- **Returnable flag changed after purchase**: the value recorded on the order line at placement governs.
- **Product never flagged at purchase time**: recorded as "not returnable" (default).
- **Existing catalogue when this feature ships** (FR-004, FR-034): every existing product reads as not
  returnable, so orders placed after the release are not returnable until the operator marks products
  — a behaviour change for operators, stated in the docs and the changeset.
- **Orders placed before this feature** (nothing recorded): their lines are returnable (FR-025).
- **Mixed order** (some lines returnable, some not): a partial return of the returnable lines is allowed.
- **Existing return cases**: not re-evaluated; only new cases are checked.
- **B2C vs B2B**: the same rules apply to every buyer (anonymous, consumer, organisation member); no
  per-customer-group or per-channel override in this release.
- **API vs UI**: every rule is enforced by the API; the storefront only mirrors it for usability.
- **Module activation** (Constitution XVII): with `returns` off, nothing about return eligibility is
  reachable; the recorded per-line value is still written at placement so that turning `returns` back on
  answers correctly for orders placed in between. Whether the product editor shows the "Returnable"
  control while `returns` is off is an assumption below, not a requirement.

## Requirements *(mandatory)*

Numbering is kept from the clarified draft, including its inserted numbers (FR-006a, FR-016a) and the
hole left by FR-024, which was removed rather than renumbered so that clarify answers and analysis
notes citing the draft's numbers stay valid. New requirements from the re-measurement start at FR-026; FR-028–FR-030 come from the first 2026-10-15 clarify round and FR-031–FR-032 from the second (Q6–Q10); FR-033–FR-038 come from the analyze and threat-model rulings (P1–P4, F1–F6) of 2026-10-15, which also amended FR-001, FR-002, FR-003, FR-004, FR-011, FR-016a, FR-026 and FR-028. FR-039 comes from the owner ruling 2026-10-18 and is placed beside FR-008, the rule it parallels.

### Functional Requirements

**Configuration (admin)**

- **FR-001**: Operators MUST be able to set, clear and see an optional minimum order quantity in pieces (integer ≥ 1 and ≤ a fixed upper bound) on any simple or configurable product in the admin product editor. A value outside that range MUST be refused at save on every write path (admin, bulk, API). The bound's value is the plan's; it exists so that no minimum can be set that no realistic order can meet or that overflows piece arithmetic.
- **FR-002**: Operators MUST be able to set, clear and see an optional minimum number of units on each packaging unit of a product (integer ≥ 1 and ≤ a fixed upper bound, as in FR-001) in the admin, independently of the pieces minimum; both may be set at once. The packaging-unit API (and therefore `CatalogPackagingPort`, also written by `pim_pimcore`) MUST accept and return it as an optional field, so existing writers that do not send it keep working, and MUST refuse a value outside the range like the admin does.
- **FR-003**: Operators MUST be able to set and see a "Returnable" yes/no flag on every product in the admin product editor, regardless of the product's type and attribute set, and set it — to yes or to no — for many selected products in one bulk admin action ("Set returnable"), audited per product like any product edit.
- **FR-004**: A product that has never had the flag set MUST be treated as not returnable. Operators mark existing products in one bulk action (FR-003). **Behaviour change for operators**: on release, every existing product reads as not returnable, so lines of orders placed after the release are not returnable until the operator marks their products (orders placed before the release are unaffected, FR-025). This is the deliberate default (clarification P4); FR-034 requires it to be stated where operators read it.
- **FR-005**: Changes to minimums and the flag MUST be audited like other product edits and MUST NOT alter existing cart, order, quote or return lines.

**Enforcement (API)**

- **FR-006a**: The pieces minimum MUST be checked against the product's total pieces in the cart — every line of that product (single-piece and packaging lines, all variants). A packaging unit's minimum MUST be checked against the number of that unit ordered for the product — the sum over the product's lines in that unit (all variants), each line counting pieces ÷ the unit's base quantity. The two checks are independent; an add, edit or placement must satisfy every minimum that is set.
- **FR-006**: The API MUST refuse to add a product line, or change a line's quantity to a value ≥ 1, so that it falls below an applicable minimum (FR-001/FR-002), returning HTTP 422 with a stable machine code (one for the pieces minimum, one for a packaging-unit minimum; names fixed in the plan and registered with the platform's error codes), the minimum and the unit in the details, plus a human message in the requester's language (PL or EN).
- **FR-007**: Removing a cart line — including an edit to quantity 0, which removes the line today — MUST always be allowed regardless of minimums.
- **FR-008**: Placing an order MUST re-validate every basket line against the minimums current at that moment and refuse placement, naming each offending line, if any line is below its minimum — except the lines FR-028 exempts in a basket seeded from an accepted quote request. The checkout preview (`previewTotal`) MUST report the same lines so the buyer learns before submitting.
- **FR-039**: Submitting an organization cart for approval (`POST /api/v1/cart/submit-for-approval`) MUST be refused while any line of the basket is below its current minimum, as proceeding to checkout is (owner ruling 2026-10-18): a basket that cannot be ordered cannot be sent for approval either. The basket MUST be judged as placement judges it (FR-008): the FR-028 exemption applies only once the basket's quote source has been confirmed valid at that moment, exactly as at the checkout preview and placement (FR-036) — the quote request belongs to the submitting buyer's organization, is `Approved`, has not expired (its validity has not ended), no order already carries it, and the basket still holds a line agreed in it; when the quote source cannot be confirmed (including while `quote_requests` is off), every line is judged like any basket line, so a basket whose quote has lapsed is refused at submit with the same minimum refusal placement gives (owner ruling 2026-10-18). The cart read model keeps taking the quote mark at face value (FR-028), so for a lapsed quote the submit refusal is the first place the buyer learns of it. A violation MUST be refused with HTTP 422 and the minimum codes of FR-006 (the first offending line's kind), naming every offending line with its minimum, with a message in the requester's language (PL or EN); a line whose product record cannot be read MUST be refused as an unknown product (HTTP 404, FR-037) naming the lines, without a product name or minimum. Nothing is written and the cart's approval state stays unchanged. The check comes after the endpoint's existing refusals (empty cart, approval already initiated, approval not required for the organization, an Org Admin submitting their own cart). The storefront MUST disable "Submit for approval" under the same condition that blocks proceeding to checkout, with the reason shown as visible text (PL and EN); the API refusal is the binding rule. Because this changes the public API, the change MUST be documented in the `mod-carts` changeset.
- **FR-009**: The minimums MUST apply on every buyer path into the cart: storefront add, cart edit, quick order (form and CSV/XLSX import), one-click buy, shopping list → cart, quote request → cart, reorder (via FR-008 at the latest), and API order intake; and on admin-created orders, where the admin create-order preview SHOULD show the below-minimum line before submit. Admin-created orders and API intake carry no packaging unit today, so only the pieces minimum is reachable there.
- **FR-010**: One-click buy MUST order the product's minimum (pieces) when one is set, instead of 1.
- **FR-011**: Batch paths into the cart (quick order build to the cart — form, CSV/XLSX and operator on behalf — shopping list → cart, quote request → cart) MUST add the valid lines and report each rejected line with its reason and minimum; the batch is not rolled back. Each path's reported reasons MUST gain a below-minimum value distinct from its existing ones — in particular quote request → cart MUST NOT report a minimum refusal as `no_price_in_customer_list`. For quick order the report is twofold: (a) the CSV/XLSX import preview MUST judge the pieces minimum against the **product's total across all rows of the file** — after today's duplicate-row merge (by SKU), the rows of every variant of the same product summed — never together with the buyer's cart (the preview's verdict and the build's may therefore differ); rows refused for an existing reason (FR-035) do not count toward the total. On the **buyer's** import, every row of a product whose file total is below the minimum MUST be listed as rejected with a new reason in `quickOrderRejectionReasonSchema` and the minimum, beside the existing reasons. On the **operator's** import (`POST /api/v1/admin/quick-order/import`), such a row MUST NOT be rejected: it stays among the buildable rows and carries a below-minimum warning with the minimum (PL and EN in the admin), so the operator can build it into a quote request (FR-012, FR-030); the response shape is the plan's; (b) the build response for target `cart` MUST list the rejected lines with the minimum, the valid ones having been added. A quick-order build to target `quote_request` is one quote request, not a batch: FR-012 governs it.
- **FR-012**: The minimums MUST bind quote-request writes **made by the buyer**: submission (directly, from the cart, from quick order, from a shopping list, and cloning one of their orders into a quote request), draft editing (with the exemption of FR-031(b)) and resubmission (FR-031(c): checked as a new submission, no exemption), using the same product-total rule over the quote's lines. A violation refuses the whole request with HTTP 422 naming each offending line and its minimum, and nothing is written. Quote-request writes **made by a sales representative** — create on behalf, modify (including negotiating quantities), cloning an order to a quote from the admin, and an operator's quick-order build to a quote request — MUST NOT be refused for minimums; each below-minimum line is flagged instead (FR-030). The rule follows the actor, not the code path. Converting an accepted quote into an order MUST keep the negotiated quantities and MUST NOT be refused for minimums when the basket is seeded; at checkout FR-028 applies. How the buyer's later writes treat lines a sales representative set below the minimum: FR-031.
- **FR-013**: The cart read model MUST indicate for each line whether it is below its current minimum and what the minimum is, so clients can flag it.

**Storefront**

- **FR-014**: The product page MUST state the applicable minimum (pieces, and per packaging unit when one is selected), start the quantity input at that minimum, and not offer lower values.
- **FR-015**: The cart page MUST show a line that is below its minimum as such, with the minimum, and MUST show refused edits with the localized message.
- **FR-016**: Product-card and comparison "add to cart" for a product with a piece minimum MUST add the minimum number of pieces in one action instead of 1; for a product without one, behaviour is unchanged.
- **FR-032**: The storefront quote-request draft MUST mirror the cart for the pieces minimum: every "add to quote request" action — the product page's buy actions, the product page's quote call-to-action shown when prices are hidden, and the product card — MUST add at least the product's minimum (the product page's quantity input starts at the minimum and does not offer less, per FR-014; the product card adds the minimum in one action, per FR-016); the draft page MUST start a new line at the minimum, MUST NOT let a line's quantity be lowered below it, and MUST show a line already below it as such, with the minimum (PL and EN). Removing a draft line remains possible. The API refusal at submission (FR-012) stays the binding rule. How the draft page learns a product's current minimum (read at render, or carried on the draft line — the draft stores only product id, slug, name, unit price and quantity today) is the plan's decision.

**Returns**

- **FR-016a**: When an order is placed (any path: checkout, one-click, admin-created, API intake, checkout of an accepted-quote basket), each order line MUST record whether its product was returnable at that moment; later changes to the product's flag MUST NOT change it. If the product's record (or its flag) cannot be read at placement, the line MUST be recorded explicitly as **not returnable** (fail-closed) — the value is never left absent, because an absent value means "returnable" (FR-025). This rule covers every product type; it is distinct from FR-037, which governs minimum evaluation.
- **FR-017**: The returnable-lines answer for an order MUST mark each line returnable or not according to the value recorded on the line (FR-016a), with a reason code for non-returnable lines (e.g. `product_not_returnable`), without changing the existing order-level reasons. The value MUST reach `returns` through `OrderReturnContextPort`; `returns` reads no `orders` table.
- **FR-018**: When no line of an order is returnable, the order-level answer MUST say that no `return` case can be opened and why, with a reason distinct from the existing ones — and MUST NOT, by that alone, stop a `complaint` from being filed (today `eligible: false` blocks both).
- **FR-019**: Opening a case of kind `return` that includes a non-returnable line MUST be refused with HTTP 422 and a stable code identifying the line; no case is created.
- **FR-020**: Cases of kind `complaint` MUST NOT be restricted by the flag.
- **FR-021**: The storefront return form and order detail MUST show non-returnable lines as not selectable for a return (with a PL/EN explanation) and MUST hide the return action when nothing is returnable; complaints remain available.
- **FR-022**: Return cases created before this feature MUST be unaffected.
- **FR-025**: Lines of orders placed before this feature (no recorded returnable value) MUST be treated as returnable, regardless of the product's current flag; the existing order-level rules (completing status, remaining quantity) still apply.
- **FR-033**: Opening a case (kind `return` or `complaint`) MUST NOT let the total requested for one order line exceed that line's remaining quantity: when a request lists the same order line more than once, the quantities MUST be aggregated per order line before the remaining-quantity check (or the duplicate entries refused — the plan's choice; either way a request whose per-line total exceeds the remaining quantity is refused with HTTP 422 and no case is created). This hardens the existing quantity rule, which is kind-agnostic, so it applies to both kinds; FR-019 is evaluated per order line likewise.
- **FR-034**: The operator documentation (`docs/`, PL and EN) and the release changeset MUST state the FR-004 behaviour change: existing products become not returnable for new orders by default, how to mark them with the bulk "Set returnable" action (FR-003), and that orders placed before the release are unaffected (FR-025).

**Packaging units on quote requests**

- **FR-026**: A buyer's quote-request line (create, draft edit, from the cart) MAY name its packaging unit by a new optional `packagingUnitId`. When it does, the id MUST resolve to a current packaging unit of that line's product, and the server MUST store that unit's catalogue name and base quantity, ignoring any name or base quantity the line also sent. A line that sends a packaging name (with its base quantity) and no id MUST be accepted only when name and base quantity together match an existing packaging unit of that product. Any other packaging reference — an unknown id, an id of another product's unit, a name the product does not have, a base quantity that does not match — MUST be refused with HTTP 422 naming the line, and nothing is written. Every failure of a `packagingUnitId` (unknown, deleted, belonging to another product) MUST give one and the same external reason, so a buyer cannot learn whether an id exists elsewhere in the catalogue — as the cart's single `PACKAGING_UNIT_NOT_FOUND` does today. Cart → quote request MUST send the cart line's `packagingUnitId`; a cart line whose unit was deleted before the conversion MUST be carried as plain pieces (no packaging, piece quantity unchanged) rather than refused.
- **FR-027**: The packaging-unit minimum on a quote request MUST be counted over the quote's lines in that unit, per FR-006a, using the unit resolved by FR-026; a line carried as plain pieces counts toward the pieces minimum only.

**Accepted quotes, check order and operator warnings**

- **FR-028**: In a basket seeded from an accepted quote request (`Cart.sourceQuoteRequestId`), each line seeded from the quote MUST be exempt from the minimums **while its quantity equals the quote's quantity** for that line — at add, edit, the cart read model (FR-013 reports it as not below its minimum) and placement (subject to FR-036). The exemption is state-based: a seeded line whose quantity differs from the quote's (after an edit, a bump by adding the same product and variant again, or a merge) is checked as in any basket while it differs, and is exempt again once its quantity equals the quote's (5 → 12 → 5 is exempt again); an edit that sets a seeded line back to the quote's quantity MUST therefore be allowed even below the minimum. Every line added after seeding is checked as in any basket. Add, edit and the cart read model take the basket's quote mark at face value; the quote source's validity is confirmed at the checkout preview and at placement (FR-036), so a line the cart shows as exempt can still be flagged there. A later seed (another accepted quote, a reorder) replaces the basket and with it every exemption. An exempt line's pieces MUST still count toward the product total (FR-006a) when any other line of the same product is checked — at add, edit, the cart read model and placement; the exemption removes only the refusal of the exempt line itself (exempt A × 5 + new A × 3 = 8 < 10 → refused; + A × 5 → 10 → accepted).
- **FR-029**: On quote-request writes, the minimum and packaging-unit refusals (FR-012, FR-026) MUST come after the existing refusal of a product the buyer may not see or the channel does not publish (so they disclose nothing about such a product) and before reference prices are resolved or anything is written. The existing price-proposal refusal (`RFQ_PRICE_PROPOSAL_NOT_ALLOWED`) keeps its current place.
- **FR-030**: The admin quote-request read model MUST indicate, for each line, whether it is below its product's current minimum (pieces, or the line's packaging unit) and what the minimum is, and the admin quote-request screen MUST show that line with a "below minimum" warning (PL and EN). The warning informs; it blocks nothing.
- **FR-031**: For a quote request in which a sales representative set a line below its minimum: (a) the buyer accepting that revision (`acceptRevision`) MUST NOT be refused for minimums; (b) a buyer's draft edit MUST NOT be refused for a line that the customer-side pairing (`line-carry-over.ts` `pairLines`) matches to a stored line with the same product, variant, packaging and quantity — such an unchanged line's pieces still count toward the product total when another line of that product in the request is checked, as in FR-028; a line the buyer changed or added is checked per FR-012; (c) resubmission (`resubmit`) MUST be checked as a new submission per FR-012, with no exemption for any line. The exemption in (b) follows from the pairing, not from who set the quantity.
- **FR-035**: On every batch path — quick-order import preview and build (buyer and operator), shopping list → cart, quote request → cart, API order intake, admin order create and its preview — a product the requester (or the customer acted for) may not see, or that the request's channel does not publish, MUST be reported exactly as an unknown product id would be. The visibility, channel and packaging-unit checks MUST run before any minimum check, and a line failing them MUST NOT reveal the product's name or minimum. Quote-request writes follow the same rule through FR-029. In the admin create-order preview the below-minimum message ranks after the existing entries of `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE`.
- **FR-036**: At order placement, and in the checkout preview (`previewTotal`) so that both report the same lines (FR-008), the FR-028 exemption MUST apply only when the basket's quote source is confirmed valid at that moment: the quote request exists, is still in the state from which `convertToOrder` seeds a basket (`Approved`, `rfq-service.ts:893`) — not cancelled, not expired, its quote validity not ended — no order already carries it as `source_quote_request_id`, and it belongs to the same organization as the placing buyer (Constitution XI). The exact status set is the plan's, measured against the quote-request state machine. Otherwise every line of the basket is judged against the minimums like any basket line.
- **FR-037**: When a minimum check cannot read the product's record, the line MUST NOT be treated as having no minimum (fail-closed): a write (add, edit, batch path, quote-request write, placement) MUST refuse the line, reporting it as an unknown product per FR-035; a read model (cart, checkout preview) MUST report the line as blocking checkout. This governs minimum evaluation only; the returnable value recorded at placement is governed by FR-016a.
- **FR-038**: The quick-order build (`quickOrderBuildRequestSchema.items`, `packages/contracts/src/quick-order.ts:115`, today `.min(1)` with no maximum) and the admin create-order request and its preview (`adminCreateOrderRequestSchema.items`, `packages/contracts/src/orders.ts:655`, and `adminOrderPreviewRequestSchema.items`, `:777`, likewise unbounded) MUST accept at most **200** lines and refuse a larger request whole with HTTP 422 `VALIDATION_FAILED` and `details.code = 'too_many_items'` before any line is evaluated — on the quick-order build, the admin order create and the admin order preview alike. The cap matches the existing limits (the 200-line cart cap and the 200-line quote-request cap). The API order intake (`apiPlaceOrderRequestSchema.lines`, likewise unbounded) is covered by the same cap (owner ruling 2026-10-16): more than 200 lines is refused whole with HTTP 422 `VALIDATION_FAILED` and `details.code = 'too_many_items'` before any line is evaluated. Because this changes the public API, the change MUST be documented in the `mod-orders` changeset.

**Cross-cutting**

- **FR-023**: Every new admin label and every buyer-facing message MUST exist in Polish and English.
- **FR-024**: *Removed.* Demonstration seed data is not platform scope (product owner).

### Key Entities

- **Product minimum order quantity**: optional integer ≥ 1 on a product, in pieces; inherited by variants.
- **Packaging unit minimum**: optional integer ≥ 1 attached to one packaging unit of a product (e.g. "Pallet" min 2).
- **Returnable flag**: yes/no on a product, default no; governs only `return`-kind cases.
- **Returnable at purchase**: the flag's value recorded on each order line when the order is placed; the only input to return eligibility for that line. Absent on lines of orders placed before this feature.
- **Quote-line exemption**: per-line state of a basket seeded from an accepted quote — "seeded from the quote, with the quote's quantity for the line" — under which the line is exempt whenever its current quantity equals that quantity (state-based, FR-028), provided the quote source is still valid at placement (FR-036); it waives the refusal of that line itself; its pieces still count toward the product total. New; no such per-line state exists today.
- **Quote-request line packaging reference**: an optional `packagingUnitId` on a buyer's quote-request line, resolved against the catalogue (FR-026).
- **Line minimum violation**: the condition "line quantity below the applicable minimum", reported per line by cart, checkout preview, placement and batch paths, and shown as a warning on the admin quote-request screen (FR-030).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a product with a minimum, 0 orders can be placed with a line below the minimum — verified by direct API calls on every entry point in FR-009 — other than the quote lines of an accepted-quote basket whose quantity equals the quote's, and only while the quote source is valid at placement (FR-028, FR-036).
- **SC-006**: 0 return or complaint cases can be created whose requested quantity for one order line exceeds that line's remaining quantity, however the request splits it (FR-033).
- **SC-002**: A buyer on the product page of a product with a minimum can add a valid quantity in one click (input pre-filled with the minimum).
- **SC-003**: 0 return cases of kind `return` can be created for a non-returnable product line; complaints for the same line still succeed.
- **SC-004**: Every refusal introduced by this feature shows a message that names the product (or the line), and for a minimum refusal also the minimum, in PL and EN.
- **SC-005**: An operator can set the returnable flag on every product of a 200-product catalogue in under 2 minutes.

## Assumptions

- Minimums are global per product: the same for every customer, organisation, customer group and sales channel (no B2B/B2C or per-channel overrides in this release).
- The piece minimum is a floor, not a step: any quantity ≥ the minimum is allowed (no "multiples of N" for single pieces).
- No maximum order quantity is introduced.
- The returnable flag governs only `return` (withdrawal) cases; `complaint` (warranty) cases are never restricted. Under Polish consumer law the 14-day withdrawal right for consumers' distance purchases can only be excluded for statutory product categories; whether a given product may be marked non-returnable for consumers is the operator's legal responsibility, not a system rule.
- Admins do not create return cases today (only process them), so there is no admin creation path to restrict; admin processing of existing cases is unchanged.
- Minimums are evaluated on basket contents in pieces as stored today; a packaging line's unit count is its pieces divided by the unit's base quantity snapshotted on the line.
- Enforcement on admin-created orders was the recommended default in the 2026-10-13 session (the product owner did not object); it may be revisited. Enforcement on quote requests and the accepted-quote exemption were refined by the product owner on 2026-10-15 (buyer writes refused, sales-representative writes warned, only unchanged quote lines exempt), and completed in the second 2026-10-15 round (Q6–Q10): exempt lines count toward the product total, a representative's below-minimum line survives the buyer's acceptance and unchanged draft edits but not a resubmission, the import preview judges rows without the cart, the storefront quote draft mirrors the cart, and a buyer's order clone to a quote request is refused like any buyer submission. The analyze rulings of 2026-10-15 (P1–P4) then refined three of them: the import preview judges a product's total across the file (all variants) and the operator's import warns instead of rejecting; the quote-line exemption is state-based; and duplicate order lines in one return request are aggregated.
- Storage of the three settings (pieces minimum, unit minimum, returnable flag) and of the per-line recorded value is the plan's decision. Behavioural constraints it must meet: the flag is editable on every product whatever its attribute set (FR-003) — a custom attribute is refused outside its set today — and is reachable by the existing bulk edit; the unit minimum belongs to a packaging unit, of which a product may have several.
- `carts` reads the minimums through the catalog's published read port (`CatalogProductRecord`, `findPackagingUnitInProduct`), not catalog internals (Constitution I).
- The "Returnable" control is a catalog field and is shown whether or not `returns` is active (it has no effect while `returns` is off). If the product owner prefers it hidden while `returns` is off, that becomes an activation-gated admin surface per `specs/conventions/module-activation.md`.

## Out of Scope

- Maximum order quantities and quantity steps for single pieces.
- Minimums for grouped, bundle and virtual products; minimums per variant different from the parent.
- Per-customer-group, per-organisation or per-channel minimums or returnability.
- Fixing the pre-existing merge defect (anonymous → customer cart merge ignores the packaging unit) and the loss of packaging-unit info on reorder, quote → cart, accepted quote → basket, order → quote request and quote resubmit; noted for the platform backlog.
- Carrying packaging units on admin-created orders and API order intake.
- Return windows (time limits) beyond today's order-completing rule; restocking fees.
- Changing the price-bracket logic (quantity breaks in price lists).
- Demonstration seed data (former FR-024).

## Clarifications

### Session 2026-10-13

- Q: What does "at least 2 pallets" mean alongside a pieces minimum? → A (product owner): it is configurable; the pieces setting and the pallet setting are checked separately, and both may be in force at once. Each packaging unit's minimum is an independent setting. The packaging-unit minimum counts the units of that packaging unit ordered for the product, summed over all the product's lines in that unit (all variants) — the same "product total" scope as the pieces minimum. No whole-unit/multiple rule is introduced.
- Q: Is the pieces minimum counted per line or per product? → A: per product total, counting every line of the product — single-piece lines and packaging lines (in pieces) — across all variants.
- Q: Default "returnable" for products never set? → A: NOT returnable. Operators mark the returnable products with a one-time bulk action.
- Q: Where besides the buyer's cart are minimums enforced? → A (no answer; recommended default adopted): also quote request submission and draft editing, and admin-created orders; converting an accepted quote into an order keeps the negotiated quantities.
- Q: When is "returnable" evaluated? → A: at purchase time — the product's flag is recorded on the order line when the order is placed; later flag changes do not affect placed orders.
- Q: What applies to lines of orders placed before this feature (no recorded value)? → A: they are treated as returnable; only orders placed after the feature follow the flag.
- Q (2026-10-15): demonstration seed data (former FR-024)? → A (product owner): not platform scope; removed from this specification.
- Q (carried from feature 146, 2026-10-14): validating quote-request packaging units against the catalogue? → A (product owner): out of scope for feature 146, in scope here (#285) — FR-026, FR-027.

### Session 2026-10-15

- (Q0) Q: Feature 146 (quote-request pricing history) rewrites the quote-request write paths this feature changes; wait for it, stack on it, or split? → A (product owner): feature 146 is merged; this feature is planned entirely from `origin/master`, and its quote-request references were re-measured there.
- (Q1) Q: In a basket seeded from an accepted quote, is the minimum exemption the whole basket or only the quote's lines? → A (product owner): only the quote's lines whose quantity is unchanged; lines added or changed after loading are checked normally (FR-008, FR-028). (Refined by P2 below: "unchanged" means "equal to the quote's quantity", state-based.)
- (Q2) Q: How does a quote-request line identify its packaging unit? → A (product owner): by a new optional `packagingUnitId`; the server takes the name and base quantity from the catalogue. A line with a name only is accepted when name and base quantity match an existing unit of that product, otherwise 422 (FR-026).
- (Q2) Q: What happens to a cart line whose packaging unit was deleted before the cart is converted into a quote request? → A (product owner, accepting the recommended default): it is carried as plain pieces (FR-026).
- (Q3) Q: Are a sales representative's quote-request writes (create on behalf, modify, negotiating quantities) bound by minimums? → A (product owner): no; they are not blocked, and the admin sees a "below minimum" warning on the line (FR-012, FR-030).
- (Q4) Q: Where does quick order (form, CSV) report a below-minimum line? → A (product owner): both in the import preview, as a new rejection reason, and in the add-to-cart response, where the valid lines are added and the rejected ones are listed with the minimum (FR-011).
- (Q5) Q: What does "add to cart" from the product list or the comparison do for a product with a piece minimum? → A (product owner): it adds the minimum quantity at once (FR-016).
- (Q6) Q: In a basket seeded from an accepted quote, does an exempt (unchanged) quote line's pieces count toward the product total when another line of the same product is checked? → A (product owner): yes; a new line of the same product is judged on the combined total (A × 5 exempt + new A × 3 = 8 < 10 → refused; + A × 5 → 10 → accepted). The exemption only removes the refusal of the quote line itself (FR-028).
- (Q7) Q: How do the buyer's writes treat a line a sales representative set below the minimum — accepting that revision, a later draft edit leaving the line unchanged, resubmitting? → A (product owner): accepting the revision is allowed; a draft edit that leaves the line unchanged is allowed; a resubmission is checked like a new submission (FR-031).
- (Q8) Q: Does the quick-order import preview judge a row alone or together with the buyer's cart? → A (product owner): each row alone, after duplicate rows are merged; the cart total is checked only by the add-to-cart step (FR-011). (Superseded for variants and for the operator's import by P1 below.)
- (Q9) Q: Does the storefront quote-request draft mirror the cart for minimums? → A (product owner): yes; "add to quote request" adds the minimum, and the draft page starts a line at the minimum and does not allow going below it (FR-032).
- (Q10) Q: A buyer clones an old order into a quote request and a line is now below its minimum — refuse or create and flag? → A (product owner): refuse the whole request naming the lines, like any buyer submission (FR-012).
- Q: Do the admin "clone to quote" and an operator's quick-order build to a quote request follow Q3 (warn, do not block)? → A (product owner, by not objecting to the stated rule): yes (FR-012, FR-030).
- (P1, analyze) Q: The import preview judges each row alone (Q8), so rows of several variants of one product that together meet the minimum are each rejected; and an operator's import rejects a below-minimum row that a representative may legitimately put into a quote request. How should the preview judge? → A (product owner): (A) the preview judges the product's total across all rows of the file — all variants summed after duplicate rows are merged — still without the cart; the cart total is checked only at add-to-cart. (C) On the operator's (sales representative or admin) import, a below-minimum row is flagged with a warning, not rejected, so it can be built into a quote request (consistent with Q3); the buyer's import still rejects (FR-011).
- (P2, analyze) Q: Is the quote-line exemption lost for good once the buyer changes the line's quantity, or does it follow the line's current quantity? → A (product owner): state-based — a seeded line is exempt while its quantity equals the quantity from the quote; 5 → 12 → 5 is exempt again (FR-028).
- (P3, analyze) Q: A return request can list the same order line more than once, each entry checked alone against the remaining quantity; is closing that in scope? → A (product owner): yes, in this feature — quantities are aggregated per order line (or duplicates refused) so the request never exceeds the purchased or remaining quantity (FR-033).
- (P4, analyze) Q: With "not returnable" as the default, every existing product stops being returnable for new orders on release; is a bulk action enough, and what if a line's product record is missing at placement? → A (product owner): a bulk admin action "set returnable" plus a clear statement in the docs and the changeset that existing products become not returnable for new orders by default is sufficient (FR-003, FR-004, FR-034); a line whose product record is missing at placement is recorded not returnable — fail-closed (FR-016a).
- (Threat model, product owner) The behaviour points F1–F6 restate the specification's existing intent as requirements: batch-path non-disclosure (FR-035), quote-source validity at placement (FR-036), fail-closed minimum evaluation (FR-037), bounded batch sizes (FR-038), an upper bound on minimums (FR-001, FR-002) and one external reason for packaging-unit id failures (FR-026).
- (Follow-up 1, coordinator default the product owner did not object to) Q: An operator's quick-order build to a **cart** — warning (as for an operator's build to a quote request) or rejection below the minimum? → A: the cart path still rejects a below-minimum line; the warning-only treatment applies to an operator's build to a quote request (FR-011, FR-012, FR-030).
- (Follow-up 2, coordinator default the product owner did not object to) Q: Does FR-033's per-order-line aggregation cover complaints as well as returns? → A: yes; both case kinds aggregate the requested quantities per order line before the remaining-quantity check (FR-033).
- (Follow-up 3, coordinator default the product owner did not object to) Q: Does the cart read model re-verify that a seeded line's accepted quote is still valid before exempting it? → A: no; the cart read model trusts the line's quote mark, and the quote source's validity is confirmed at checkout preview and at placement (FR-028, FR-036).

### Session 2026-10-18

- Q: Must "Submit for approval" on an organization cart be refused while a line is below its minimum? → A (owner ruling 2026-10-18): yes, as proceeding to checkout is; the storefront blocks the control and the server refuses the submit (FR-039).
- Q: At submit, is a quote-seeded line's exemption taken at face value, as the cart view does, or only once the quote source is confirmed valid, as at placement? → A (owner ruling 2026-10-18): only once confirmed valid, exactly as at the checkout preview and placement (FR-036, FR-037); a basket whose quote has lapsed is refused at submit with placement's minimum refusal (FR-039). The cart read model still trusts the mark (Follow-up 3 stands).
- Q: A complaint may name a line that was not returnable at purchase (FR-020); what does it refund by default? → A (owner ruling R1): A complaint line recorded as not returnable at purchase is stored with an approved refund of 0; its default refund stays the amount paid (the settlement cap); the admin case view marks it 'Not returnable at purchase'; nothing pays out automatically.
